/**
 * 30-day cash-flow forecast (pure). Owner question: "will I have enough on payday?"
 *
 *  start      = cash on hand (drawers, safe, petty, bank, wallets) + what card machines / apps owe us (lands in 1–7 days)
 *  inflows    = expected takings per weekday (average of the last 8 weeks of sales journals, collected the same day)
 *  outflows   = payroll on payday (+ service-charge payout), recurring bills on their day, open supplier invoices on
 *               their due date + new purchases at the recent daily rate (due after supplier terms), VAT for closed
 *               months on the VAT due day, social insurance + payroll tax on the 15th.
 * Everything is an estimate — the UI says so.
 */
import type { AccountingSettings, RecurringExpense } from "@/data/accountingTypes";
import type { LedgerEntry } from "@/data/types";
import type { Units } from "@/lib/money";
import { ACC } from "./chart";
import { addDays, balanceOf, monthEnd, monthStart, weekday } from "./core";

export type OutflowKind = "payroll" | "service" | "recurring" | "supplier" | "vat" | "insurance" | "payroll_tax";
export interface ForecastFlow {
  kind: OutflowKind | "sales" | "settlement";
  label: string;
  amount: Units;
}
export interface ForecastDay {
  date: string;
  inflow: Units;
  outflow: Units;
  flows: ForecastFlow[];
  balance: Units;
}
export interface CashForecast {
  start: Units;
  days: ForecastDay[];
  minBalance: Units;
  minDate: string;
  endBalance: Units;
  totalIn: Units;
  totalOut: Units;
  paydays: { date: string; amount: Units; balanceAfter: Units }[];
  /** average takings per weekday (Sun…Sat) used for the inflow */
  weekdayTakings: Units[];
}

type E = Pick<LedgerEntry, "date" | "lines" | "sourceType" | "sourceId">;
const SALES = new Set(["receipt", "z-summary"]);
const TAKINGS = new Set<string>([ACC.cash, ACC.cardClearing, ACC.walletClearing, ACC.aggregatorReceivable]);

/** Average gross takings by weekday over the `weeks` before `today` (receipts + daily summaries, net of returns). */
export function weekdayTakings(entries: E[], today: string, weeks = 8): Units[] {
  const from = addDays(today, -7 * weeks);
  const sum = Array(7).fill(0) as number[];
  const days = Array.from({ length: 7 }, () => new Set<string>());
  for (const e of entries) {
    if (e.date < from || e.date >= today) continue;
    const sign = SALES.has(e.sourceType) ? 1 : e.sourceType === "return-receipt" ? -1 : 0;
    if (!sign) continue;
    const v = e.lines.filter((l) => TAKINGS.has(l.account)).reduce((a, l) => a + l.debit - l.credit, 0);
    const wd = weekday(e.date);
    sum[wd] += v;
    days[wd].add(e.date);
  }
  // divide by the number of that weekday in the window (days with no sales count as zero)
  const count = Array(7).fill(0) as number[];
  for (let d = from; d < today; d = addDays(d, 1)) count[weekday(d)]++;
  return sum.map((s, i) => (count[i] ? Math.round(s / count[i]) : 0));
}

function nextDayOfMonth(today: string, dom: number, horizon: string): string[] {
  const out: string[] = [];
  let m = monthStart(today);
  for (let i = 0; i < 3; i++) {
    const end = monthEnd(m);
    const d = `${m.slice(0, 8)}${String(Math.min(dom, Number(end.slice(8)))).padStart(2, "0")}`;
    if (d >= today && d <= horizon) out.push(d);
    m = addDays(end, 1);
  }
  return out;
}

export const vatDueDate = (periodEnd: string, dueDay: number) => {
  const nextM = addDays(monthEnd(periodEnd), 1);
  const end = monthEnd(nextM);
  return `${nextM.slice(0, 8)}${String(Math.min(dueDay, Number(end.slice(8)))).padStart(2, "0")}`;
};

export function cashForecast(x: {
  today: string;
  entries: E[];
  /** spendable now (drawers + safe + petty + bank + wallets) */
  onHand: Units;
  settings: Pick<AccountingSettings, "payrollDay" | "payrollEstimate" | "vatDueDay" | "supplierTermsDays">;
  recurring: RecurringExpense[];
  days?: number;
  /** recent card / app fees for the pending-settlement haircut (basis points) */
  settlementFeeBp?: { card: number; apps: number };
}): CashForecast {
  const horizonDays = x.days ?? 30;
  const today = x.today;
  const horizon = addDays(today, horizonDays - 1);
  const flows = new Map<string, ForecastFlow[]>();
  const add = (date: string, f: ForecastFlow) => {
    if (date < today || date > horizon || !f.amount) return;
    flows.set(date, [...(flows.get(date) ?? []), f]);
  };
  const fee = x.settlementFeeBp ?? { card: 180, apps: 2500 };

  // pending settlements: cards next day, wallets next Monday, delivery apps next Tuesday (net of commission)
  const card = balanceOf(x.entries, ACC.cardClearing);
  const wallet = balanceOf(x.entries, ACC.walletClearing);
  const apps = balanceOf(x.entries, ACC.aggregatorReceivable);
  const nextWd = (wd: number) => {
    let d = addDays(today, 1);
    while (weekday(d) !== wd) d = addDays(d, 1);
    return d;
  };
  if (card > 0) add(addDays(today, 1), { kind: "settlement", label: "card", amount: card - Math.round((card * fee.card) / 10_000) });
  if (wallet > 0) add(nextWd(1), { kind: "settlement", label: "wallet", amount: wallet });
  if (apps > 0) add(nextWd(2), { kind: "settlement", label: "apps", amount: apps - Math.round((apps * fee.apps) / 10_000) });

  // expected takings by weekday; card/app share of it is not cash today, but lands within days — counted same day
  const wdTake = weekdayTakings(x.entries, today);
  for (let d = today; d <= horizon; d = addDays(d, 1)) add(d, { kind: "sales", label: "sales", amount: wdTake[weekday(d)] });

  // payroll: last posted payroll net (or the estimate) + the service charge that will have accrued by then
  const lastPay = [...x.entries].filter((e) => e.sourceType === "payroll.payment").sort((a, b) => b.date.localeCompare(a.date))[0];
  const payNet = lastPay ? lastPay.lines.filter((l) => l.account === ACC.salariesPayable).reduce((a, l) => a + l.debit, 0) : x.settings.payrollEstimate;
  const svcNow = -balanceOf(x.entries, ACC.servicePayable);
  const svcDaily = (() => {
    const from = addDays(today, -28);
    const accrued = x.entries.filter((e) => e.date >= from && e.date < today).reduce((a, e) => a + e.lines.filter((l) => l.account === ACC.servicePayable).reduce((b, l) => b + l.credit, 0), 0);
    return Math.round(accrued / 28);
  })();
  const paydays: string[] = nextDayOfMonth(today, x.settings.payrollDay, horizon);
  let svcBase = svcNow;
  let prev = today;
  for (const pd of paydays) {
    add(pd, { kind: "payroll", label: "payroll", amount: -payNet });
    const days = Math.max(0, Math.round((Date.parse(pd) - Date.parse(prev)) / 86_400_000));
    const svc = svcBase + svcDaily * days;
    add(pd, { kind: "service", label: "service", amount: -svc });
    svcBase = 0;
    prev = pd;
  }

  // recurring bills (cash / bank paid)
  for (const r of x.recurring) {
    if (!r.active) continue;
    for (const d of nextDayOfMonth(today, r.dayOfMonth, horizon)) {
      // already raised for that month (posted early) → not again
      if (r.lastRaisedFor && r.lastRaisedFor >= d.slice(0, 7)) continue;
      add(d, { kind: "recurring", label: r.description, amount: -(r.net + r.vat) });
    }
  }

  // suppliers: open payables FIFO-matched to the most recent invoices, each due invoice date + terms (overdue → tomorrow)
  const terms = x.settings.supplierTermsDays;
  let open = -balanceOf(x.entries, ACC.payables);
  const invoices = x.entries
    .filter((e) => e.sourceType === "purchase-invoice" || e.sourceType === "expense")
    .map((e) => ({ date: e.date, total: e.lines.filter((l) => l.account === ACC.payables).reduce((a, l) => a + l.credit - l.debit, 0) }))
    .filter((i) => i.total > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const inv of invoices) {
    if (open <= 0) break;
    const amt = Math.min(open, inv.total);
    open -= amt;
    const due = addDays(inv.date, terms);
    add(due < today ? addDays(today, 1) : due, { kind: "supplier", label: "supplier", amount: -amt });
  }
  // purchases yet to come: recent daily rate, due after terms
  const recentFrom = addDays(today, -28);
  const recentPurch = invoices.filter((i) => i.date >= recentFrom).reduce((a, i) => a + i.total, 0);
  const daily = Math.round(recentPurch / 28);
  for (let d = today; d <= horizon; d = addDays(d, 1)) {
    const due = addDays(d, terms);
    if (due <= horizon && daily) add(due, { kind: "supplier", label: "supplier", amount: -daily });
  }

  // VAT: already settled (2301) due on the VAT day of this month; last month's (unsettled) estimate due next month
  const vatDue = (periodEnd: string) => vatDueDate(periodEnd, x.settings.vatDueDay);
  const settled = -balanceOf(x.entries, ACC.vatSettlement);
  const lastSettledThrough = x.entries.filter((e) => e.sourceType === "vat-return").map((e) => e.sourceId.split("..")[1] ?? "").sort().pop() ?? "";
  if (settled > 0) {
    const d = lastSettledThrough ? vatDue(lastSettledThrough) : today;
    add(d < today ? today : d, { kind: "vat", label: "vat", amount: -settled });
  }
  const live = x.entries.filter((e) => e.sourceType !== "vat-return");
  const lastMonth = addDays(monthStart(today), -1);
  const unsettled = -balanceOf(live, ACC.outputVat, { from: monthStart(lastMonth), to: lastMonth }) - balanceOf(live, ACC.inputVat, { from: monthStart(lastMonth), to: lastMonth });
  if (unsettled > 0 && lastSettledThrough < lastMonth) add(vatDue(lastMonth), { kind: "vat", label: "vat", amount: -unsettled });

  // social insurance + payroll tax: balances due on the 15th
  const si = -balanceOf(x.entries, ACC.socialInsurancePayable);
  const pt = -balanceOf(x.entries, ACC.payrollTaxPayable);
  const fifteenth = nextDayOfMonth(today, 15, horizon)[0];
  if (fifteenth) {
    add(fifteenth, { kind: "insurance", label: "insurance", amount: -si });
    add(fifteenth, { kind: "payroll_tax", label: "payroll_tax", amount: -pt });
  }

  // roll forward
  const days: ForecastDay[] = [];
  let bal = x.onHand;
  let minBalance = bal;
  let minDate = today;
  let totalIn = 0;
  let totalOut = 0;
  const pays: CashForecast["paydays"] = [];
  for (let d = today; d <= horizon; d = addDays(d, 1)) {
    const fs = flows.get(d) ?? [];
    const inflow = fs.filter((f) => f.amount > 0).reduce((a, f) => a + f.amount, 0);
    const outflow = -fs.filter((f) => f.amount < 0).reduce((a, f) => a + f.amount, 0);
    bal += inflow - outflow;
    totalIn += inflow;
    totalOut += outflow;
    days.push({ date: d, inflow, outflow, flows: fs, balance: bal });
    if (bal < minBalance) {
      minBalance = bal;
      minDate = d;
    }
    const pay = fs.filter((f) => f.kind === "payroll" || f.kind === "service").reduce((a, f) => a - f.amount, 0);
    if (pay) pays.push({ date: d, amount: pay, balanceAfter: bal });
  }
  return { start: x.onHand, days, minBalance, minDate, endBalance: bal, totalIn, totalOut, paydays: pays, weekdayTakings: wdTake };
}

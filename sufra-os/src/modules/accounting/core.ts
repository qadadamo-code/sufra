/**
 * Pure accounting core (no I/O): journal validation, reversal lines, period lock, balances, trial balance,
 * P&L, balance sheet, cash-flow statement and VAT return over `ledgerEntries`-shaped rows (Units).
 * Same rules as sufra-finance's `Ledger` (validateEntry / reverse / closeThrough / vatReturn) but over a
 * tenant-editable chart, so payroll / inventory / expense accounts can be posted too.
 */
import type { GlAccount, GlAccountType, GlGroup, JournalLineRow } from "@/data/accountingTypes";
import type { LedgerEntry } from "@/data/types";
import type { Units } from "@/lib/money";
import { ACC, DEFAULT_CHART, debitNormal } from "./chart";

export class JournalError extends Error {
  constructor(public code: "lines" | "account" | "side" | "balance" | "locked" | "date" | "reversed" | "not_found" | "inactive", msg: string) {
    super(msg);
  }
}

export interface ChartInfo {
  code: string;
  type: GlAccountType;
  group: GlGroup;
  name: { ar: string; en: string };
  active: boolean;
  parentCode: string | null;
}

/** Default chart merged with the tenant's rows (tenant rows win). */
export function mergeChart(rows: Pick<GlAccount, "code" | "type" | "group" | "name" | "active" | "parentCode">[] = []): Map<string, ChartInfo> {
  const m = new Map<string, ChartInfo>();
  for (const a of DEFAULT_CHART) m.set(a.code, { code: a.code, type: a.type, group: a.group, name: { ar: a.ar, en: a.en }, active: true, parentCode: a.parent ?? null });
  for (const r of rows) m.set(r.code, { code: r.code, type: r.type, group: r.group, name: r.name, active: r.active, parentCode: r.parentCode });
  return m;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Throws JournalError unless the lines form a valid, balanced entry on active accounts outside the closed period. */
export function validateJournal(e: { date: string; lines: JournalLineRow[] }, chart: Map<string, ChartInfo>, closedThrough: string | null = null) {
  if (!DAY.test(e.date)) throw new JournalError("date", `bad date ${e.date}`);
  if (closedThrough && e.date <= closedThrough) throw new JournalError("locked", `period closed through ${closedThrough}`);
  if (e.lines.length < 2) throw new JournalError("lines", "an entry needs at least two lines");
  let dr = 0;
  let cr = 0;
  for (const l of e.lines) {
    const a = chart.get(l.account);
    if (!a) throw new JournalError("account", `unknown account ${l.account}`);
    if (!a.active) throw new JournalError("inactive", `account ${l.account} is inactive`);
    if (!Number.isSafeInteger(l.debit) || !Number.isSafeInteger(l.credit) || l.debit < 0 || l.credit < 0) throw new JournalError("side", "amounts must be positive whole units; swap the side instead");
    if ((l.debit === 0) === (l.credit === 0)) throw new JournalError("side", "each line is either a debit or a credit");
    dr += l.debit;
    cr += l.credit;
  }
  if (dr !== cr) throw new JournalError("balance", `entry does not balance: debit ${dr} ≠ credit ${cr}`);
}

/** Builds lines from [account, signed] (+ debit, − credit), dropping zeros. */
export function signedLines(items: Array<[account: string, signed: Units, dims?: Record<string, string>]>): JournalLineRow[] {
  return items
    .filter(([, v]) => v !== 0)
    .map(([account, v, dims]) => ({ account, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0, ...(dims ? { dims } : {}) }));
}

export const reverseLines = (lines: JournalLineRow[]): JournalLineRow[] => lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));

export const entryTotal = (e: { lines: JournalLineRow[] }) => e.lines.reduce((a, l) => a + l.debit, 0);

/** id of the entry that reversed `id` (reversals are entries with sourceType "reversal", sourceId = original). */
export function reversalIndex(entries: Pick<LedgerEntry, "id" | "sourceType" | "sourceId">[]) {
  const m = new Map<string, string>();
  for (const e of entries) if (e.sourceType === "reversal") m.set(e.sourceId, e.id);
  return m;
}

/** Restaurants trade past midnight: before 05:00 still belongs to yesterday's business day. */
export function businessDay(d = new Date()) {
  const x = new Date(d.getTime() - 5 * 3600_000);
  return ymd(x);
}
export const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
export function addDays(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  const x = new Date(y, m - 1, d + n, 12);
  return ymd(x);
}
export const monthOf = (day: string) => day.slice(0, 7);
export function monthStart(day: string) {
  return `${day.slice(0, 7)}-01`;
}
export function monthEnd(day: string) {
  const [y, m] = day.split("-").map(Number);
  return ymd(new Date(y, m, 0, 12));
}
export const weekday = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12).getDay();
};

/* ───────── balances & statements ───────── */

type Entry = Pick<LedgerEntry, "date" | "lines" | "branchId">;
export interface Filter {
  from?: string;
  to?: string;
  branchId?: string | null;
}
const inRange = (e: Entry, f: Filter) => (!f.from || e.date >= f.from) && (!f.to || e.date <= f.to) && (!f.branchId || e.branchId === f.branchId || e.lines.some((l) => l.dims?.branch === f.branchId));

/** Debit-positive balance of each account over the filter. */
export function balances(entries: Entry[], f: Filter = {}): Map<string, { debit: Units; credit: Units; balance: Units }> {
  const m = new Map<string, { debit: Units; credit: Units; balance: Units }>();
  for (const e of entries) {
    if (!inRange(e, f)) continue;
    for (const l of e.lines) {
      // branch filter is per entry: the whole entry counts, so one branch's trial balance still balances
      const r = m.get(l.account) ?? { debit: 0, credit: 0, balance: 0 };
      r.debit += l.debit;
      r.credit += l.credit;
      r.balance += l.debit - l.credit;
      m.set(l.account, r);
    }
  }
  return m;
}

export const balanceOf = (entries: Entry[], code: string, f: Filter = {}, dims?: Record<string, string>) => {
  let b = 0;
  for (const e of entries) {
    if (!inRange(e, f)) continue;
    for (const l of e.lines) {
      if (l.account !== code) continue;
      if (dims && !Object.entries(dims).every(([k, v]) => l.dims?.[k] === v)) continue;
      b += l.debit - l.credit;
    }
  }
  return b;
};

export interface TbRow {
  code: string;
  account: ChartInfo | undefined;
  debit: Units;
  credit: Units;
  balance: Units;
}
export function trialBalance(entries: Entry[], chart: Map<string, ChartInfo>, f: Filter = {}) {
  const rows: TbRow[] = [...balances(entries, f).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, r]) => ({ code, account: chart.get(code), ...r }));
  const totals = rows.reduce((a, r) => ({ debit: a.debit + r.debit, credit: a.credit + r.credit, balance: a.balance + r.balance }), { debit: 0, credit: 0, balance: 0 });
  return { rows, totals };
}

export interface PlLine {
  code: string;
  name: { ar: string; en: string };
  amount: Units;
}
export interface ProfitAndLoss {
  revenue: PlLine[];
  cogs: PlLine[];
  labour: PlLine[];
  occupancy: PlLine[];
  fees: PlLine[];
  opex: PlLine[];
  other: PlLine[];
  totals: {
    revenue: Units;
    cogs: Units;
    grossProfit: Units;
    labour: Units;
    occupancy: Units;
    fees: Units;
    opex: Units;
    other: Units;
    expenses: Units;
    netProfit: Units;
    /** cost of sales + labour */
    primeCost: Units;
    /** basis points of revenue */
    foodCostBp: number;
    labourBp: number;
    primeCostBp: number;
  };
}

export const bp = (part: Units, whole: Units) => (whole ? Math.round((part * 10_000) / whole) : 0);

/** Revenue credit-positive, expenses debit-positive. */
export function profitAndLoss(entries: Entry[], chart: Map<string, ChartInfo>, f: Filter = {}): ProfitAndLoss {
  const b = balances(entries, f);
  const out: ProfitAndLoss = { revenue: [], cogs: [], labour: [], occupancy: [], fees: [], opex: [], other: [], totals: {} as ProfitAndLoss["totals"] };
  for (const [code, r] of [...b.entries()].sort(([a], [c]) => a.localeCompare(c))) {
    const a = chart.get(code);
    if (!a || (a.type !== "revenue" && a.type !== "expense") || r.balance === 0) continue;
    const line = { code, name: a.name, amount: a.type === "revenue" ? -r.balance : r.balance };
    if (a.type === "revenue") out.revenue.push(line);
    else if (a.group === "cogs") out.cogs.push(line);
    else if (a.group === "labour") out.labour.push(line);
    else if (a.group === "occupancy") out.occupancy.push(line);
    else if (a.group === "fees") out.fees.push(line);
    else if (a.group === "other_expense") out.other.push(line);
    else out.opex.push(line);
  }
  const s = (xs: PlLine[]) => xs.reduce((a, x) => a + x.amount, 0);
  const revenue = s(out.revenue);
  const cogs = s(out.cogs);
  const labour = s(out.labour);
  const occupancy = s(out.occupancy);
  const fees = s(out.fees);
  const opex = s(out.opex);
  const other = s(out.other);
  const expenses = labour + occupancy + fees + opex + other;
  out.totals = {
    revenue, cogs, grossProfit: revenue - cogs, labour, occupancy, fees, opex, other, expenses, netProfit: revenue - cogs - expenses,
    primeCost: cogs + labour, foodCostBp: bp(cogs, revenue), labourBp: bp(labour, revenue), primeCostBp: bp(cogs + labour, revenue),
  };
  return out;
}

export interface BalanceSheet {
  assets: PlLine[];
  liabilities: PlLine[];
  equity: PlLine[];
  totals: { assets: Units; liabilities: Units; equity: Units; currentEarnings: Units; liabilitiesAndEquity: Units; difference: Units };
}

/** As at `to` (cumulative). Current earnings = revenue − expenses not yet closed into retained earnings. */
export function balanceSheet(entries: Entry[], chart: Map<string, ChartInfo>, to: string, branchId?: string | null): BalanceSheet {
  const b = balances(entries, { to, branchId });
  const out: BalanceSheet = { assets: [], liabilities: [], equity: [], totals: {} as BalanceSheet["totals"] };
  let earnings = 0;
  for (const [code, r] of [...b.entries()].sort(([a], [c]) => a.localeCompare(c))) {
    const a = chart.get(code);
    const type = a?.type ?? (code[0] === "1" ? "asset" : code[0] === "2" ? "liability" : code[0] === "3" ? "equity" : code[0] === "4" ? "revenue" : "expense");
    const name = a?.name ?? { ar: code, en: code };
    if (type === "revenue" || type === "expense") {
      earnings -= r.balance;
      continue;
    }
    if (r.balance === 0) continue;
    if (type === "asset") out.assets.push({ code, name, amount: r.balance });
    else if (type === "liability") out.liabilities.push({ code, name, amount: -r.balance });
    else out.equity.push({ code, name, amount: -r.balance });
  }
  const s = (xs: PlLine[]) => xs.reduce((a, x) => a + x.amount, 0);
  const assets = s(out.assets);
  const liabilities = s(out.liabilities);
  const equity = s(out.equity) + earnings;
  out.totals = { assets, liabilities, equity, currentEarnings: earnings, liabilitiesAndEquity: liabilities + equity, difference: assets - liabilities - equity };
  return out;
}

/** Codes counted as cash for the cash-flow statement and the liquidity view. */
export function cashCodes(chart: Map<string, ChartInfo>) {
  return new Set([...chart.values()].filter((a) => a.type === "asset" && (a.group === "cash" || a.group === "bank")).map((a) => a.code));
}

export interface CashFlowStatement {
  opening: Units;
  operating: { label: string; amount: Units }[];
  investing: Units;
  financing: Units;
  operatingTotal: Units;
  net: Units;
  closing: Units;
}

/**
 * Direct method: every entry that moves cash is classified by its counter-accounts — fixed assets → investing,
 * equity / loans → financing, everything else operating (grouped by the counter-account's group).
 * Transfers between cash accounts (drawer → safe → bank) net to zero and drop out.
 */
export function cashFlow(entries: Entry[], chart: Map<string, ChartInfo>, f: { from: string; to: string; branchId?: string | null }): CashFlowStatement {
  const cash = cashCodes(chart);
  const opening = [...cash].reduce((a, c) => a + balanceOf(entries, c, { to: addDays(f.from, -1), branchId: f.branchId }), 0);
  const op = new Map<string, Units>();
  let investing = 0;
  let financing = 0;
  for (const e of entries) {
    if (!inRange(e, f)) continue;
    const move = e.lines.filter((l) => cash.has(l.account)).reduce((a, l) => a + l.debit - l.credit, 0);
    if (move === 0) continue;
    const others = e.lines.filter((l) => !cash.has(l.account));
    const weight = others.reduce((a, l) => a + Math.abs(l.debit - l.credit), 0) || 1;
    let left = move;
    others.forEach((l, i) => {
      const a = chart.get(l.account);
      const share = i === others.length - 1 ? left : Math.round((move * Math.abs(l.debit - l.credit)) / weight);
      left -= share;
      if (a?.group === "fixed_asset") investing += share;
      else if (a?.type === "equity" || l.account === ACC.ownerLoan) financing += share;
      else {
        const key = flowLabel(a);
        op.set(key, (op.get(key) ?? 0) + share);
      }
    });
  }
  const operating = [...op.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
  const operatingTotal = operating.reduce((a, x) => a + x.amount, 0);
  const net = operatingTotal + investing + financing;
  return { opening, operating, investing, financing, operatingTotal, net, closing: opening + net };
}

function flowLabel(a: ChartInfo | undefined): string {
  if (!a) return "other";
  if (a.type === "revenue" || a.group === "clearing" || a.group === "receivable" || a.group === "deposit") return "customers";
  if (a.group === "tax" || a.group === "tax_asset") return "taxes";
  if (a.group === "labour" || a.group === "staff_liability") return "staff";
  if (a.group === "payable" || a.group === "inventory" || a.group === "cogs") return "suppliers";
  if (a.group === "occupancy") return "occupancy";
  return "expenses";
}

/* ───────── VAT ───────── */

export interface VatReturnResult {
  from: string;
  to: string;
  outputVat: Units;
  inputVat: Units;
  /** + payable to ETA, − credit carried forward */
  net: Units;
  /** taxable sales base and purchases base (for the return form) */
  salesBase: Units;
  purchasesBase: Units;
}

/** Same definition as sufra-finance `vatReturn`: output = −balance(2201), input = balance(1401) over the period, excluding settlement entries. */
export function vatReturn(entries: (Entry & Pick<LedgerEntry, "sourceType">)[], from: string, to: string, branchId?: string | null): VatReturnResult {
  const live = entries.filter((e) => e.sourceType !== "vat-return");
  const outputVat = -balanceOf(live, ACC.outputVat, { from, to, branchId });
  const inputVat = balanceOf(live, ACC.inputVat, { from, to, branchId });
  let salesBase = 0;
  let purchasesBase = 0;
  for (const e of live) {
    if (!inRange(e, { from, to, branchId })) continue;
    const hasOut = e.lines.some((l) => l.account === ACC.outputVat);
    const hasIn = e.lines.some((l) => l.account === ACC.inputVat);
    for (const l of e.lines) {
      const first = l.account[0];
      if (hasOut && first === "4") salesBase += l.credit - l.debit;
      if (hasIn && (first === "5" || first === "6" || first === "1") && l.account !== ACC.inputVat && !["1101", "1105", "1106", "1107", "1109"].includes(l.account)) purchasesBase += l.debit - l.credit;
    }
  }
  return { from, to, outputVat, inputVat, net: outputVat - inputVat, salesBase, purchasesBase };
}

/** Settlement journal (finance settleVat): Dr output VAT, Cr input VAT, Cr (or Dr) VAT payable to ETA. */
export function vatSettlementLines(r: VatReturnResult): JournalLineRow[] {
  return signedLines([
    [ACC.outputVat, r.outputVat],
    [ACC.inputVat, -r.inputVat],
    [ACC.vatSettlement, -r.net],
  ]);
}

export const isDebitNormal = (a: ChartInfo | undefined) => (a ? debitNormal(a.type) : true);

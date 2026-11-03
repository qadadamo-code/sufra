/** السيولة والنقدية — live cash position, 30-day forecast, alerts and the daily cash-up report. */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeftRight, Banknote, Building2, CalendarClock, CreditCard, Landmark, PiggyBank, Receipt, Smartphone, TrendingDown, Truck, Vault, Wallet } from "lucide-react";
import { useLive } from "@/data/hooks";
import type { CashAccount } from "@/data/accountingTypes";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { AnimatedMoney, Badge, BarChart, Card, CardHeader, EmptyState, LinkButton, Meter, Money, StatTile, Table, type Column } from "@/ui";
import { ACC } from "./chart";
import { addDays, balanceOf, businessDay } from "./core";
import { cashForecast, vatDueDate, type ForecastFlow } from "./forecast";
import { cashAlerts, cashPosition, type CashAlert } from "./treasury";
import { EstimateNote, useBooks, useMoney } from "./ui";

export const KIND_ICON: Record<CashAccount["kind"], typeof Wallet> = { drawer: Banknote, safe: Vault, petty: PiggyBank, bank: Landmark, wallet: Smartphone, provider: CreditCard };

const KIND_BG: Record<CashAccount["kind"], string> = { drawer: "bg-ok-soft", safe: "bg-ok-soft", petty: "bg-warn-soft", bank: "bg-primary-soft", wallet: "bg-info-soft", provider: "bg-brass-soft" };

export default function CashPage() {
  const { L, loc, lang } = useT();
  const { m, w } = useMoney();
  const { entries, settings } = useBooks();
  const accounts = useLive("cashAccounts", { orderBy: [{ field: "sort" }] }).data;
  const recurring = useLive("recurringExpenses").data;
  const transfers = useLive("cashTransfers", { orderBy: [{ field: "date", dir: "desc" }] }).data;
  const expenses = useLive("expenses", { where: { status: "pending" } }).data;
  const drafts = useLive("journalDrafts", { where: { status: "pending" } }).data;
  const bankLines = useLive("bankLines", { where: { status: "unmatched" } }).data;
  const shifts = useLive("shifts", { where: { status: "closed" }, orderBy: [{ field: "closedAt", dir: "desc" }], limit: 20 }).data;
  const today = businessDay();

  const position = useMemo(() => cashPosition(accounts, entries), [accounts, entries]);
  const forecast = useMemo(() => cashForecast({ today, entries, onHand: position.onHand, settings, recurring, days: 30 }), [today, entries, position.onHand, settings, recurring]);
  const vatDue = useMemo(() => {
    const settled = -balanceOf(entries, ACC.vatSettlement);
    const through = entries.filter((e) => e.sourceType === "vat-return").map((e) => e.sourceId.split("..")[1]).sort().pop();
    return settled > 0 && through ? { date: vatDueDate(through, settings.vatDueDay), amount: settled } : (forecast.days.flatMap((d) => d.flows.filter((f) => f.kind === "vat").map((f) => ({ date: d.date, amount: -f.amount })))[0] ?? null);
  }, [entries, settings.vatDueDay, forecast]);
  const alerts = useMemo(
    () => cashAlerts({ today, position, settings, forecast, entries, shifts, transfers, expenses, drafts, bankLines, vatDue }),
    [today, position, settings, forecast, entries, shifts, transfers, expenses, drafts, bankLines, vatDue],
  );
  const nextPay = forecast.paydays[0];

  const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { weekday: "short", day: "numeric", month: "short" });
  const bars = forecast.days.map((d) => ({ key: d.date, label: d.date.slice(8), value: Math.max(0, d.balance), tip: `${fmtDay(d.date)} · ${w(d.balance)}` }));

  const flowLabel = (f: ForecastFlow) =>
    ({
      payroll: L("المرتبات", "Payroll"), service: L("توزيع الخدمة", "Service charge payout"), supplier: L("موردين", "Suppliers"), vat: L("ضريبة القيمة المضافة", "VAT"), insurance: L("التأمينات", "Social insurance"),
      payroll_tax: L("ضريبة كسب العمل", "Payroll tax"), recurring: f.label, sales: L("مبيعات متوقعة", "Expected sales"),
      settlement: f.label === "card" ? L("تسوية الفيزا", "Card settlement") : f.label === "wallet" ? L("تحويل المحافظ", "Wallet sweep") : L("تحويل تطبيقات التوصيل", "Delivery apps payout"),
    })[f.kind];
  const upcoming = useMemo(() => {
    const out: { date: string; label: string; amount: number; kind: string }[] = [];
    for (const d of forecast.days) {
      const sup = d.flows.filter((f) => f.kind === "supplier").reduce((a, f) => a + f.amount, 0);
      if (sup) out.push({ date: d.date, label: L("موردين", "Suppliers"), amount: sup, kind: "supplier" });
      for (const f of d.flows) if (f.amount < 0 && f.kind !== "supplier") out.push({ date: d.date, label: flowLabel(f), amount: f.amount, kind: f.kind });
    }
    return out.filter((x) => x.amount <= -1_000 * 100_000).slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forecast, lang]);

  const alertText = (a: CashAlert) => {
    const amt = a.amount != null ? w(Math.abs(a.amount)) : "";
    const acc = a.ref ? accounts.find((x) => x.id === a.ref) : null;
    switch (a.kind) {
      case "low_cash_payday": return L(`الرصيد المتوقع بعد المرتبات يوم ${fmtDay(a.date!)}: ${w(a.amount!)} — أقل من حد الأمان`, `Expected balance after payroll on ${fmtDay(a.date!)}: ${w(a.amount!)} — below your safety line`);
      case "low_cash": return L(`أقل رصيد متوقع ${w(a.amount!)} يوم ${a.date ? fmtDay(a.date) : ""}`, `Lowest expected balance ${w(a.amount!)} on ${a.date ? fmtDay(a.date) : ""}`);
      case "over_short": return (a.amount ?? 0) < 0 ? L(`عجز ${amt} في عد الكاش (${a.date})`, `Cash short ${amt} at count (${a.date})`) : L(`زيادة ${amt} في عد الكاش (${a.date})`, `Cash over ${amt} at count (${a.date})`);
      case "shift_over_short": return L(`فرق ${amt} في تقفيل وردية ${a.ref}`, `Shift ${a.ref} closed ${amt} out`);
      case "safe_over_limit": return L(`الخزنة فيها ${amt} فوق الحد — اعمل إيداع بنكي`, `Safe is ${amt} over its limit — make a bank deposit`);
      case "petty_low": return L(`العهدة النثرية قربت تخلص (${amt})`, `Petty cash running low (${amt})`);
      case "vat_due": return L(`ضريبة القيمة المضافة ${amt} مستحقة يوم ${fmtDay(a.date!)}`, `VAT of ${amt} due on ${fmtDay(a.date!)}`);
      case "approvals": return L(`${a.count} طلبات مستنية موافقتك (مصروفات / تحويلات / قيود)`, `${a.count} items waiting for approval (expenses / transfers / journals)`);
      case "bank_unmatched": return L(`${a.count} حركة بنكية من أكتر من أسبوع لسه مش متسوية`, `${a.count} bank lines older than a week are unreconciled`);
      case "negative_balance": return L(`رصيد ${acc ? loc(acc.name) : ""} بالسالب (${amt}) — راجع القيود`, `${acc ? loc(acc.name) : ""} is negative (${amt}) — check the postings`);
    }
  };
  const alertLink = (a: CashAlert) => (a.kind === "approvals" ? (transfers.some((t) => t.status === "pending") ? "/accounting/treasury" : "/accounting/expenses") : a.kind === "bank_unmatched" ? "/accounting/bank" : a.kind === "vat_due" ? "/accounting/vat" : a.kind === "safe_over_limit" || a.kind === "petty_low" ? "/accounting/treasury" : null);

  // daily cash-up report: last 7 business days
  const cashup = useMemo(() => {
    const drawerIds = new Set(accounts.filter((a) => a.kind === "drawer").map((a) => a.id));
    const bankIds = new Set(accounts.filter((a) => a.kind === "bank").map((a) => a.id));
    const rows = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, -i);
      const day = entries.filter((e) => e.date === d);
      const cashSales = day.filter((e) => e.sourceType === "receipt" || e.sourceType === "z-summary").reduce((a, e) => a + e.lines.filter((l) => l.account === ACC.cash).reduce((b, l) => b + l.debit, 0), 0)
        - day.filter((e) => e.sourceType === "return-receipt").reduce((a, e) => a + e.lines.filter((l) => l.account === ACC.cash).reduce((b, l) => b + l.credit, 0), 0);
      const cashOut = day.filter((e) => e.sourceType === "cash-move").reduce((a, e) => a + e.lines.filter((l) => l.account === ACC.cash).reduce((b, l) => b + l.debit - l.credit, 0), 0);
      const ups = transfers.filter((t) => t.date === d && drawerIds.has(t.fromId) && t.status === "posted");
      const expected = ups.reduce((a, t) => a + t.amount, 0);
      const counted = ups.reduce((a, t) => a + (t.counted ?? t.amount), 0);
      const os = day.reduce((a, e) => a + e.lines.filter((l) => l.account === ACC.cashOverShort).reduce((b, l) => b + l.credit - l.debit, 0), 0);
      const deposited = transfers.filter((t) => t.date === d && bankIds.has(t.toId) && t.status === "posted").reduce((a, t) => a + (t.counted ?? t.amount), 0);
      rows.push({ d, cashSales, cashOut, expected, counted, os, deposited });
    }
    return rows;
  }, [accounts, entries, transfers, today]);

  const cols: Column<(typeof cashup)[number]>[] = [
    { key: "d", header: L("اليوم", "Day"), cell: (r) => fmtDay(r.d) },
    { key: "s", header: L("مبيعات كاش", "Cash sales"), align: "end", cell: (r) => <Money value={r.cashSales} compact /> },
    { key: "m", header: L("وارد/منصرف الدرج", "Paid in/out"), align: "end", hideOnMobile: true, cell: (r) => (r.cashOut ? <Money value={r.cashOut} compact signed /> : <span className="text-faint">—</span>) },
    { key: "c", header: L("اتسلم للخزنة", "Counted to safe"), align: "end", cell: (r) => (r.counted ? <Money value={r.counted} compact /> : <span className="text-faint">—</span>) },
    { key: "o", header: L("عجز / زيادة", "Over / short"), align: "end", cell: (r) => (r.os ? <span className={r.os < 0 ? "text-danger" : "text-ok"}><Money value={r.os} compact signed /></span> : <span className="text-faint">0</span>) },
    { key: "b", header: L("إيداع بنكي", "Bank deposit"), align: "end", hideOnMobile: true, cell: (r) => (r.deposited ? <Money value={r.deposited} compact /> : <span className="text-faint">—</span>) },
  ];


  return (
    <div className="grid gap-5">
      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label={L("ملخص السيولة", "Liquidity summary")}>
        <StatTile index={0} icon={<Wallet />} label={L("الفلوس اللي في إيدك", "Cash on hand")} value={<AnimatedMoney value={position.onHand} whole />} sub={L("أدراج + خزنة + عهدة + بنك + محافظ", "Tills + safe + petty + bank + wallets")} />
        <StatTile index={1} icon={<Truck />} tone="brass" label={L("مستحق لسه ماوصلش", "Pending settlement")} value={<AnimatedMoney value={position.pending} whole />} sub={L("فيزا وبوابات وتطبيقات التوصيل", "Cards, gateways, delivery apps")} />
        <StatTile index={2} icon={<TrendingDown />} tone={forecast.minBalance < settings.lowCashThreshold ? "danger" : "info"} label={L("أقل رصيد متوقع (٣٠ يوم)", "Lowest balance (30 days)")} value={<AnimatedMoney value={forecast.minBalance} whole />} sub={fmtDay(forecast.minDate)} />
        <StatTile index={3} icon={<CalendarClock />} tone="warn" label={L("المرتبات الجاية", "Next payroll")} value={nextPay ? <AnimatedMoney value={nextPay.amount} whole /> : "—"} sub={nextPay ? `${fmtDay(nextPay.date)} · ${L("الرصيد بعدها", "after")} ${w(nextPay.balanceAfter)}` : L("مفيش في الـ٣٠ يوم", "None in 30 days")} />
      </section>

      {alerts.length ? (
        <Card>
          <CardHeader icon={<AlertTriangle />} title={L("تنبيهات", "Alerts")} subtitle={L("حاجات محتاجة تتعمل النهارده", "Things to act on today")} />
          <ul className="grid gap-2 px-5 pb-5">
            {alerts.map((a, i) => {
              const href = alertLink(a);
              const body = (
                <span className={cn("flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[14px]", a.tone === "danger" ? "border-danger/40 bg-danger-soft" : a.tone === "warn" ? "border-warn/40 bg-warn-soft" : "border-info/30 bg-info-soft")}>
                  <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", a.tone === "danger" ? "text-danger" : a.tone === "warn" ? "text-warn" : "text-info")} aria-hidden />
                  <span className="min-w-0 flex-1">{alertText(a)}</span>
                </span>
              );
              return <li key={i}>{href ? <Link to={href} className="block focus-visible:outline-none focus-visible:shadow-sf-glow rounded-xl">{body}</Link> : body}</li>;
            })}
          </ul>
        </Card>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={L("الفلوس فين", "Where the money is")}>
        {position.rows.map((r) => {
          const Icon = KIND_ICON[r.account.kind];
          return (
            <Card key={r.account.id} className="p-4">
              <div className="flex items-center gap-3">
                <span className={cn("grid size-10 place-items-center rounded-xl text-ink-2", KIND_BG[r.account.kind])}>
                  <Icon className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">{loc(r.account.name)}</div>
                  <div className="truncate text-[12px] text-muted">{[r.account.institution, r.account.last4 ? `•••• ${r.account.last4}` : ""].filter(Boolean).join(" · ") || " "}</div>
                </div>
              </div>
              <div className={cn("mt-3 font-mono text-[22px] font-semibold tabular-nums", r.balance < 0 && "text-danger")} dir="ltr">
                <Money value={r.balance} whole />
              </div>
              {r.account.limit ? (
                <Meter className="mt-2" value={Math.max(0, r.balance)} max={r.account.limit} tone={r.account.kind === "safe" && r.balance > r.account.limit ? "danger" : "primary"} label={L(`من الحد ${w(r.account.limit)}`, `of limit ${w(r.account.limit)}`)} />
              ) : r.account.kind === "provider" ? (
                <div className="mt-2 text-[12px] text-muted">{L("هيتحول للبنك", "Will settle to the bank")}</div>
              ) : null}
            </Card>
          );
        })}
      </section>

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-5">
        <Card className="lg:col-span-2">
          <CardHeader icon={<TrendingDown />} title={L("توقع السيولة — ٣٠ يوم", "Cash forecast — 30 days")} subtitle={L(`داخل ${w(forecast.totalIn)} · خارج ${w(forecast.totalOut)} · آخر الفترة ${w(forecast.endBalance)}`, `In ${w(forecast.totalIn)} · out ${w(forecast.totalOut)} · end ${w(forecast.endBalance)}`)} />
          <div className="px-5 pb-3">
            <BarChart data={bars} height={200} highlight={forecast.minDate} ariaLabel={L("الرصيد المتوقع يوم بيوم", "Expected balance by day")} />
          </div>
          <EstimateNote className="px-5 pb-5">{L("المبيعات المتوقعة = متوسط نفس اليوم في آخر ٨ أسابيع", "Expected sales = average of the same weekday over the last 8 weeks")}</EstimateNote>
        </Card>
        <Card>
          <CardHeader icon={<CalendarClock />} title={L("التزامات جاية", "Upcoming obligations")} />
          {upcoming.length ? (
            <ul className="divide-y divide-line px-5 pb-4">
              {upcoming.map((u, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-[14px]">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{u.label}</span>
                    <span className="text-[12px] text-muted">{fmtDay(u.date)}</span>
                  </span>
                  <Money value={-u.amount} whole className="font-mono" />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact title={L("مفيش التزامات كبيرة", "No large obligations")} />
          )}
        </Card>
      </div>

      <Card>
        <CardHeader icon={<Receipt />} title={L("تقرير تقفيل الكاش اليومي", "Daily cash-up")} action={
          <div className="flex gap-2">
            <LinkButton to="/accounting/treasury" size="sm" variant="outline" icon={<ArrowLeftRight />}>{L("تحويل / إيداع", "Transfer / deposit")}</LinkButton>
            <LinkButton to="/accounting/bank" size="sm" variant="ghost" icon={<Building2 />}>{L("البنك", "Bank")}</LinkButton>
          </div>
        } />
        <Table columns={cols} rows={cashup} rowKey={(r) => r.d} dense />
        <p className="px-5 py-3 text-[12.5px] text-muted">
          {L(`أي عجز أو زيادة أكبر من ${m(settings.overShortAlert)} بيطلع تنبيه.`, `Any over/short above ${m(settings.overShortAlert)} raises an alert.`)}
          {position.unassignedDrawerCash ? <Badge tone="warn" className="ms-2">{L("كاش في 1101 من غير درج", "Cash in 1101 without a till")}: {w(position.unassignedDrawerCash)}</Badge> : null}
        </p>
      </Card>
    </div>
  );
}

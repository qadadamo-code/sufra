/** Owner dashboard strip (overview): today's profit estimate, cash on hand, upcoming obligations. */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, LineChart, Wallet } from "lucide-react";
import { useLive } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Card, Money } from "@/ui";
import { addDays, businessDay, profitAndLoss } from "./core";
import { cashForecast } from "./forecast";
import { cashPosition } from "./treasury";
import { EstimateNote, useBooks, useMoney } from "./ui";

export function OwnerMoney({ branchId }: { branchId?: string | null }) {
  const { L, lang } = useT();
  const { w } = useMoney();
  const { entries, chart, settings } = useBooks();
  const accounts = useLive("cashAccounts").data;
  const recurring = useLive("recurringExpenses").data;
  const today = businessDay();
  const since = useMemo(() => new Date(Date.now() - 36 * 3600_000).toISOString().slice(0, 13), []);
  const checks = useLive("checks", { where: { status: "paid", ...(branchId ? { branchId } : {}) }, gte: { closedAt: since } }).data;

  const est = useMemo(() => {
    const todays = checks.filter((c) => c.closedAt && businessDay(new Date(c.closedAt)) === today);
    const sales = todays.reduce((a, c) => a + c.subtotal - c.discountTotal, 0);
    const pl = profitAndLoss(entries, chart, { from: addDays(today, -30), to: addDays(today, -1) });
    const foodBp = pl.totals.revenue ? pl.totals.foodCostBp : settings.defaultFoodCostBp;
    const food = Math.round((sales * foodBp) / 10_000);
    // fixed costs in proportion to how much of a normal day's sales is already in (so the morning isn't "a loss")
    const avgDay = pl.totals.revenue / 30;
    const fixedDaily = Math.round((pl.totals.expenses / 30) * (avgDay ? Math.min(1, sales / avgDay) : 1));
    return { sales, food, fixedDaily, profit: sales - food - fixedDaily, foodBp };
  }, [checks, entries, chart, today, settings.defaultFoodCostBp]);
  const position = useMemo(() => cashPosition(accounts, entries), [accounts, entries]);
  const forecast = useMemo(() => cashForecast({ today, entries, onHand: position.onHand, settings, recurring, days: 30 }), [today, entries, position.onHand, settings, recurring]);
  const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short" });
  const obligations = useMemo(() => {
    const out: { date: string; label: string; amount: number }[] = [];
    for (const d of forecast.days) {
      const pay = d.flows.filter((f) => f.kind === "payroll" || f.kind === "service").reduce((a, f) => a - f.amount, 0);
      if (pay) out.push({ date: d.date, label: L("المرتبات والخدمة", "Payroll & service"), amount: pay });
      const tax = d.flows.filter((f) => f.kind === "vat" || f.kind === "insurance" || f.kind === "payroll_tax").reduce((a, f) => a - f.amount, 0);
      if (tax) out.push({ date: d.date, label: L("ضرايب وتأمينات", "Taxes & insurance"), amount: tax });
      for (const f of d.flows) if (f.kind === "recurring" && -f.amount >= 10_000 * 100_000) out.push({ date: d.date, label: f.label, amount: -f.amount });
    }
    return out.slice(0, 4);
  }, [forecast, L]);

  const tile = "p-4 sm:p-5";
  return (
    <section className="grid gap-3 sm:gap-4 lg:grid-cols-3" aria-label={L("الفلوس", "Money")}>
      <Card className={tile}>
        <div className="flex items-center gap-2 text-[13px] font-semibold text-muted"><LineChart className="size-4 text-primary" />{L("ربح النهارده التقريبي", "Today's profit (estimate)")}</div>
        <div className={cn("mt-2 font-mono text-[26px] font-semibold tabular-nums", est.profit < 0 && "text-danger")} dir="ltr"><Money value={est.profit} whole /></div>
        <div className="mt-1 text-[12.5px] text-muted">{L(`مبيعات ${w(est.sales)} − طعام ${w(est.food)} − نصيبها من المصاريف الثابتة ${w(est.fixedDaily)}`, `Sales ${w(est.sales)} − food ${w(est.food)} − their share of fixed costs ${w(est.fixedDaily)}`)}</div>
        <EstimateNote className="mt-2" />
      </Card>
      <Link to="/accounting" className="rounded-[var(--radius)] focus-visible:outline-none focus-visible:shadow-sf-glow">
        <Card className={cn(tile, "h-full")} interactive>
          <div className="flex items-center gap-2 text-[13px] font-semibold text-muted"><Wallet className="size-4 text-ok" />{L("الفلوس اللي في إيدك", "Cash on hand")}</div>
          <div className="mt-2 font-mono text-[26px] font-semibold tabular-nums" dir="ltr"><Money value={position.onHand} whole /></div>
          <div className="mt-1 text-[12.5px] text-muted">{L(`+ ${w(position.pending)} جاية من الفيزا والتطبيقات`, `+ ${w(position.pending)} on its way from cards & apps`)}</div>
          <div className="mt-1 text-[12.5px] text-muted">{L(`أقل رصيد متوقع ${w(forecast.minBalance)} يوم ${fmtDay(forecast.minDate)}`, `Lowest expected ${w(forecast.minBalance)} on ${fmtDay(forecast.minDate)}`)}</div>
        </Card>
      </Link>
      <Card className={tile}>
        <div className="flex items-center gap-2 text-[13px] font-semibold text-muted"><CalendarClock className="size-4 text-warn" />{L("التزامات جاية", "Coming up")}</div>
        <ul className="mt-2 grid gap-1.5 text-[14px]">
          {obligations.map((o, i) => (
            <li key={i} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">{o.label} <span className="text-[12px] text-muted">· {fmtDay(o.date)}</span></span>
              <Money value={o.amount} whole className="font-mono" />
            </li>
          ))}
          {!obligations.length ? <li className="text-muted">{L("مفيش التزامات كبيرة الشهر ده", "Nothing large this month")}</li> : null}
        </ul>
      </Card>
    </section>
  );
}

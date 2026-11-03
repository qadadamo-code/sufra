import { useMemo, useState } from "react";
import { Award, BellRing, Coins, Star, TrendingUp } from "lucide-react";
import { useLive } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { Badge, Input, StatTile, Table } from "@/ui";
import { useHr } from "@/modules/hr/useHr";
import { evaluateRange } from "@/modules/hr/ops";
import { summarize } from "@/modules/hr/lib/attendance";
import { addDays, periodBounds } from "@/modules/hr/lib/tz";
import { PersonCell, Section } from "@/modules/hr/ui";

/** add-on categories: what counts as an upsell (drinks, desserts, appetizers) */
const UPSELL_HINTS = ["مشروب", "حلو", "مقبلات", "drink", "dessert", "starter", "appetizer"];

export default function PerformancePage() {
  const { L, lang } = useT();
  const hr = useHr();
  const [period, setPeriod] = useState(hr.today.slice(0, 7));
  const { from, to } = periodBounds(period);
  const range = { gte: { createdAt: `${from}T00:00:00` }, lte: { createdAt: `${addDays(to, 1)}T05:00:00` } };
  const payments = useLive("payments", { where: { status: "captured" }, ...range }).data;
  const orders = useLive("orders", { gte: { openedAt: `${from}T00:00:00` }, lte: { openedAt: `${addDays(to, 1)}T05:00:00` } }).data;
  const checks = useLive("checks", range).data;
  const items = useLive("orderItems", range).data;
  const cats = useLive("menuCategories").data;
  const menu = useLive("menuItems").data;
  const calls = useLive("serviceCalls", range).data;
  const feedback = useLive("guestFeedback", range).data;
  const shifts = useLive("rotaShifts", { gte: { date: from }, lte: { date: to } }).data;
  const punches = useLive("attendancePunches", { gte: { at: `${from}T00:00:00` }, lte: { at: `${addDays(to, 1)}T05:00:00` } }).data;
  const leaves = useLive("leaveRequests", { where: { status: "approved" } }).data;

  const rows = useMemo(() => {
    const upsellCats = new Set(cats.filter((c) => UPSELL_HINTS.some((h) => `${c.name.ar} ${c.name.en}`.toLowerCase().includes(h))).map((c) => c.id));
    const isUpsell = (itemId: string) => upsellCats.has(menu.find((m) => m.id === itemId)?.categoryId ?? "");
    const checkBy = new Map(checks.map((c) => [c.id, c]));
    return hr.active
      .filter((m) => m.role !== "owner")
      .map((m) => {
        const myOrders = orders.filter((o) => o.waiterId === m.id || (o.openedBy === m.id && m.role === "cashier"));
        const myChecks = [...new Set(myOrders.map((o) => o.checkId).filter(Boolean))].map((id) => checkBy.get(id!)).filter((c) => c && c.status === "paid");
        const taken = payments.filter((p) => p.takenBy === m.id);
        const sales = m.role === "cashier" ? taken.reduce((a, p) => a + p.amount, 0) : myChecks.reduce((a, c) => a + (c?.total ?? 0), 0);
        const nChecks = m.role === "cashier" ? new Set(taken.map((p) => p.checkId)).size : myChecks.length;
        const myItems = items.filter((i) => i.createdBy === m.id && !i.voidReason);
        const ups = myItems.filter((i) => isUpsell(i.itemId)).reduce((a, i) => a + i.qty, 0);
        const acks = calls.filter((c) => c.ackBy === m.id && c.ackAt);
        const resp = acks.length ? acks.reduce((a, c) => a + (Date.parse(c.ackAt!) - Date.parse(c.createdAt)) / 1000, 0) / acks.length : null;
        const fb = feedback.filter((f) => f.waiterId === m.id);
        const rating = fb.length ? fb.reduce((a, f) => a + f.stars, 0) / fb.length : null;
        const att = summarize(evaluateRange(m.id, from, to, { shifts, punches, leaves }, hr.rules, hr.tz, hr.now));
        return { m, sales, nChecks, avg: nChecks ? sales / nChecks : 0, ups, resp, calls: acks.length, tips: taken.reduce((a, p) => a + p.tip, 0), rating, ratings: fb.length, score: att.score };
      })
      .sort((a, b) => b.sales - a.sales || b.score - a.score);
  }, [hr.active, orders, checks, payments, items, cats, menu, calls, feedback, shifts, punches, leaves, hr.rules, hr.tz, hr.now, from, to]);

  const money = (u: number) => formatMoney(u, { lang, currency: hr.currency, whole: true });
  const top = rows.find((r) => r.sales > 0);
  const fastest = rows.filter((r) => r.resp !== null).sort((a, b) => a.resp! - b.resp!)[0];
  const best = rows.filter((r) => r.rating !== null).sort((a, b) => b.rating! - a.rating!)[0];
  const punctual = [...rows].sort((a, b) => b.score - a.score)[0];
  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-2">
        <Input aria-label={L("الشهر", "Month")} type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} tone="brass" icon={<TrendingUp />} label={L("أعلى مبيعات", "Top seller")} value={top?.m.name ?? "—"} sub={top ? money(top.sales) : undefined} />
        <StatTile index={1} tone="info" icon={<BellRing />} label={L("أسرع رد على النداء", "Fastest to calls")} value={fastest?.m.name ?? "—"} sub={fastest ? L(`${Math.round(fastest.resp!)} ث في المتوسط`, `${Math.round(fastest.resp!)}s average`) : undefined} />
        <StatTile index={2} tone="ok" icon={<Star />} label={L("أعلى تقييم", "Best rated")} value={best?.m.name ?? "—"} sub={best ? `★ ${best.rating!.toFixed(1)} (${best.ratings})` : undefined} />
        <StatTile index={3} tone="primary" icon={<Award />} label={L("الأكثر التزامًا", "Most punctual")} value={punctual?.m.name ?? "—"} sub={punctual ? `${punctual.score}%` : undefined} />
      </div>
      <Section title={L("أداء الفريق", "Team performance")} icon={<Coins />} bodyClass="px-0 pb-2">
        <Table
          rows={rows}
          rowKey={(r) => r.m.id}
          columns={[
            { key: "who", header: L("الموظف", "Staff"), cell: (r) => <PersonCell m={r.m} p={hr.profileOf(r.m.id)} size="sm" /> },
            { key: "sales", header: L("المبيعات", "Sales"), cell: (r) => <span className="tabular-nums font-semibold">{r.sales ? money(r.sales) : "—"}</span>, align: "end" },
            { key: "avg", header: L("متوسط الشيك", "Avg check"), cell: (r) => <span className="tabular-nums">{r.nChecks ? money(r.avg) : "—"}</span>, align: "end", hideOnMobile: true },
            { key: "ups", header: L("إضافات", "Upsells"), cell: (r) => <span className="tabular-nums">{r.ups || "—"}</span>, align: "center", hideOnMobile: true },
            { key: "resp", header: L("الرد على النداء", "Call response"), cell: (r) => (r.resp !== null ? <span className="tabular-nums">{Math.round(r.resp)}{L("ث", "s")} · {r.calls}</span> : "—"), align: "center", hideOnMobile: true },
            { key: "tips", header: L("بقشيش", "Tips"), cell: (r) => <span className="tabular-nums">{r.tips ? money(r.tips) : "—"}</span>, align: "end", hideOnMobile: true },
            { key: "rate", header: L("التقييم", "Rating"), cell: (r) => (r.rating !== null ? <span className="tabular-nums">★ {r.rating.toFixed(1)}</span> : "—"), align: "center", hideOnMobile: true },
            { key: "att", header: L("الالتزام", "Attendance"), cell: (r) => <Badge tone={r.score >= 90 ? "ok" : r.score >= 75 ? "warn" : "danger"}>{r.score}%</Badge>, align: "center" },
          ]}
        />
      </Section>
    </div>
  );
}

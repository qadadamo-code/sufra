/**
 * /reports — sales (item, category, hour, day, channel, order type, staff, table, payment, discounts, voids, refunds),
 * menu engineering, and the financial statements from the journal: P&L (branch, period, compare), balance sheet,
 * trial balance, cash flow, service-charge / tips and other liabilities, prime cost. CSV + print/PDF on every tab.
 */
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BarChart3, ChefHat, Coins, FileSpreadsheet, HandCoins, LineChart, PieChart, Scale, ShoppingBag, Users } from "lucide-react";
import { useSession } from "@/auth/session";
import { useLive } from "@/data/hooks";
import type { Localized } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/shell/PageHeader";
import { Badge, BarChart, Card, CardHeader, EmptyState, Input, Meter, Money, Select, StatTile, Switch, Table, Tabs, type Column } from "@/ui";
import { ACC } from "@/modules/accounting/chart";
import { addDays, balanceOf, balanceSheet, businessDay, cashFlow, profitAndLoss, trialBalance, type PlLine, type ProfitAndLoss } from "@/modules/accounting/core";
import { dec, downloadCsv, EstimateNote, ExportButtons, Num, PeriodPicker, previousPeriod, Row, SectionTitle, useBooks, useMoney, usePeriod, type Period } from "@/modules/accounting/ui";
import { menuEngineering, type MenuClass } from "./menuEngineering";
import { salesReport, type Bucket } from "./sales";

type Tab = "sales" | "items" | "staff" | "pnl" | "bs" | "tb" | "cashflow" | "liabilities";
const FIN: Tab[] = ["pnl", "bs", "tb", "cashflow", "liabilities"];

export default function ReportsPage() {
  const { L } = useT();
  const { can } = useSession();
  const loc = useLocation();
  const nav = useNavigate();
  const fin = can("reports.financial");
  const seg = (loc.pathname.split("/reports")[1] ?? "").split("/")[1] || "sales";
  const all: { value: Tab; label: string; icon: ReactNode }[] = [
    { value: "sales", label: L("المبيعات", "Sales"), icon: <ShoppingBag /> },
    { value: "items", label: L("هندسة المنيو", "Menu engineering"), icon: <ChefHat /> },
    { value: "staff", label: L("الموظفين", "Staff"), icon: <Users /> },
    { value: "pnl", label: L("الأرباح والخسائر", "P&L"), icon: <LineChart /> },
    { value: "bs", label: L("الميزانية", "Balance sheet"), icon: <Scale /> },
    { value: "tb", label: L("ميزان المراجعة", "Trial balance"), icon: <FileSpreadsheet /> },
    { value: "cashflow", label: L("التدفقات النقدية", "Cash flow"), icon: <Coins /> },
    { value: "liabilities", label: L("الخدمة والتيبس والالتزامات", "Service, tips & dues"), icon: <HandCoins /> },
  ];
  const items = all.filter((t) => fin || !FIN.includes(t.value));
  const tab = (items.some((t) => t.value === seg) ? seg : "sales") as Tab;
  return (
    <div className="mx-auto grid max-w-[1400px] gap-5">
      <div data-noprint><PageHeader icon={<BarChart3 />} title={L("التقارير", "Reports")} subtitle={L("المبيعات والمنيو والموظفين والقوائم المالية", "Sales, menu, staff and financial statements")} /></div>
      <div data-noprint><Tabs value={tab} onChange={(v) => nav(v === "sales" ? "/reports" : `/reports/${v}`)} items={items} label={L("أنواع التقارير", "Report types")} /></div>
      {tab === "sales" ? <SalesTab /> : null}
      {tab === "items" ? <ItemsTab /> : null}
      {tab === "staff" ? <StaffTab /> : null}
      {tab === "pnl" ? <PnlTab /> : null}
      {tab === "bs" ? <BsTab /> : null}
      {tab === "tb" ? <TbTab /> : null}
      {tab === "cashflow" ? <CashFlowTab /> : null}
      {tab === "liabilities" ? <LiabilitiesTab /> : null}
    </div>
  );
}

/* ───────── shared ───────── */

function useSales(period: Period) {
  const checks = useLive("checks", { where: { status: "paid" } }).data;
  const orders = useLive("orders").data;
  const items = useLive("orderItems").data;
  const payments = useLive("payments").data;
  const menuItems = useLive("menuItems").data;
  const categories = useLive("menuCategories").data;
  const tables = useLive("tables").data;
  return useMemo(() => salesReport({ checks, orders, items, payments, menuItems, categories, tables }, period.from, period.to), [checks, orders, items, payments, menuItems, categories, tables, period.from, period.to]);
}

function Head({ title, period, setPeriod, onCsv, extra }: { title: ReactNode; period?: Period; setPeriod?: (p: Period) => void; onCsv?: () => void; extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <h2 className="text-[19px] font-semibold">{title}</h2>
      <div className="flex flex-wrap items-end gap-2" data-noprint>
        {extra}
        {period && setPeriod ? <PeriodPicker value={period} onChange={setPeriod} /> : null}
        <ExportButtons onCsv={onCsv} />
      </div>
    </div>
  );
}

const label = (l: Localized | string, loc: (x: Localized) => string) => (typeof l === "string" ? l : loc(l));

function BucketTable({ title, rows, total, name, icon }: { title: string; rows: Bucket[]; total: number; name?: (b: Bucket) => ReactNode; icon?: ReactNode }) {
  const { L, loc } = useT();
  return (
    <Card>
      <CardHeader icon={icon} title={title} />
      {rows.length ? (
        <ul className="grid gap-2 px-5 pb-5">
          {rows.slice(0, 12).map((b) => (
            <li key={b.key} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-3 text-[14px]">
                <span className="min-w-0 truncate">{name ? name(b) : label(b.label, loc)}</span>
                <span className="shrink-0 font-mono tabular-nums"><Money value={b.net} whole /> <span className="text-[12px] text-muted">· {total ? Math.round((b.net / total) * 100) : 0}%</span></span>
              </div>
              <Meter value={Math.max(0, b.net)} max={Math.max(1, rows[0].net)} label={`${b.count} ${L("شيك", "checks")}`} />
            </li>
          ))}
        </ul>
      ) : <EmptyState compact title={L("مفيش بيانات", "No data")} />}
    </Card>
  );
}

/* ───────── sales ───────── */

function SalesTab() {
  const { L, loc, lang } = useT();
  const { w, m } = useMoney();
  const [period, setPeriod] = usePeriod("today");
  const r = useSales(period);
  const members = useLive("memberships").data;
  const who = (id: string | null) => members.find((x) => x.id === id)?.name ?? "—";
  const k = r.kpis;
  const CH: Record<string, string> = { pos: L("الكاشير", "POS"), waiter: L("الجرسون", "Waiter"), qr: L("QR الترابيزة", "Table QR"), online: L("أونلاين", "Online"), phone: L("تليفون", "Phone"), aggregator: L("تطبيقات التوصيل", "Delivery apps"), app: L("تطبيق", "App") };
  const MODE: Record<string, string> = { dine_in: L("صالة", "Dine-in"), takeaway: L("تيك أواي", "Takeaway"), delivery: L("دليفري", "Delivery"), pickup: L("استلام", "Pickup") };
  const PAY: Record<string, string> = { cash: L("كاش", "Cash"), card: L("فيزا", "Card"), wallet: L("محفظة", "Wallet"), instapay: "InstaPay", online: L("أونلاين", "Online"), gift_card: L("كارت هدية", "Gift card") };
  const WD = lang === "ar" ? ["الأحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const csv = () => downloadCsv(`sales_${period.from}_${period.to}`, ["section", "key", "label", "count", "qty", "net"], [
    ...(["byItem", "byCategory", "byHour", "byDay", "byChannel", "byMode", "byTable", "byPayment"] as const).flatMap((s) => r[s].map((b) => [s, b.key, label(b.label, loc), b.count, b.qty, dec(b.net)])),
    ...r.discounts.map((d) => ["discount", d.receiptNo ?? d.checkId, d.reason, 1, 0, dec(d.amount)]),
    ...r.voids.map((v) => ["void", v.id, `${loc(v.name)} — ${v.reason}`, 1, v.qty, dec(v.value)]),
    ...r.refunds.map((x) => ["refund", x.id, x.method, 1, 0, dec(x.amount)]),
  ]);
  return (
    <div className="grid gap-5 print-area">
      <Head title={L("تقرير المبيعات", "Sales report")} period={period} setPeriod={setPeriod} onCsv={csv} />
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile index={0} icon={<ShoppingBag />} label={L("صافي المبيعات", "Net sales")} value={w(k.net)} sub={L(`قبل الخصم ${w(k.gross)} · خصومات ${w(k.discounts)}`, `Gross ${w(k.gross)} · discounts ${w(k.discounts)}`)} />
        <StatTile index={1} icon={<FileSpreadsheet />} tone="brass" label={L("الشيكات · متوسط الشيك", "Checks · avg check")} value={`${k.checks} · ${w(k.avgCheck)}`} sub={L(`خدمة ${w(k.service)} · ضريبة ${w(k.vat)}`, `Service ${w(k.service)} · VAT ${w(k.vat)}`)} />
        <StatTile index={2} icon={<Users />} tone="info" label={L("الضيوف · للفرد", "Covers · per cover")} value={`${k.covers} · ${w(k.avgCover)}`} sub={L(`دوران الترابيزة ${k.tableTurns} في اليوم`, `Table turns ${k.tableTurns} / day`)} />
        <StatTile index={3} icon={<HandCoins />} tone="danger" label={L("ملغي · مرتجع", "Voids · refunds")} value={`${k.voidCount} · ${w(k.refunds)}`} sub={L(`قيمة الملغي ${w(k.voidValue)} · تيبس ${w(k.tips)}`, `Voided ${w(k.voidValue)} · tips ${w(k.tips)}`)} />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={L("حسب الساعة", "By hour")} />
          <div className="px-5 pb-5">{r.byHour.length ? <BarChart data={r.byHour.map((b) => ({ key: b.key, label: b.key, value: b.net, tip: `${b.key}:00 · ${w(b.net)} · ${b.count}` }))} ariaLabel={L("المبيعات حسب الساعة", "Sales by hour")} /> : <EmptyState compact title={L("مفيش مبيعات", "No sales")} />}</div>
        </Card>
        <Card>
          <CardHeader title={r.byDay.length > 1 ? L("حسب اليوم", "By day") : L("حسب يوم الأسبوع", "By weekday")} />
          <div className="px-5 pb-5">{r.byDay.length > 1 ? <BarChart data={r.byDay.map((b) => ({ key: b.key, label: b.key.slice(8), value: b.net, tip: `${b.key} · ${w(b.net)}` }))} ariaLabel={L("المبيعات حسب اليوم", "Sales by day")} /> : r.byWeekday.length ? <BarChart data={r.byWeekday.map((b) => ({ key: b.key, label: WD[Number(b.key)], value: b.net, tip: `${WD[Number(b.key)]} · ${w(b.net)}` }))} ariaLabel={L("حسب يوم الأسبوع", "By weekday")} /> : <EmptyState compact title="—" />}</div>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <BucketTable title={L("الأقسام", "Categories")} rows={r.byCategory} total={r.byCategory.reduce((a, b) => a + b.net, 0)} />
        <BucketTable title={L("القناة", "Channel")} rows={r.byChannel} total={k.net} name={(b) => CH[b.key] ?? b.key} />
        <BucketTable title={L("نوع الطلب", "Order type")} rows={r.byMode} total={k.net} name={(b) => MODE[b.key] ?? b.key} />
        <BucketTable title={L("طريقة الدفع", "Payment method")} rows={r.byPayment} total={r.byPayment.reduce((a, b) => a + b.net, 0)} name={(b) => PAY[b.key] ?? b.key} />
        <BucketTable title={L("الترابيزات", "Tables")} rows={r.byTable} total={k.net} name={(b) => `${L("ترابيزة", "Table")} ${label(b.label, loc)}`} />
        <BucketTable title={L("الأصناف الأكتر مبيعاً", "Top items")} rows={r.byItem} total={r.byItem.reduce((a, b) => a + b.net, 0)} name={(b) => `${label(b.label, loc)} × ${b.qty}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={L("الخصومات", "Discounts")} subtitle={m(k.discounts)} />
          <ul className="divide-y divide-line px-5 pb-4 text-[13.5px]">
            {r.discounts.map((d) => <li key={d.checkId} className="flex justify-between gap-2 py-2"><span className="min-w-0 truncate">{d.reason || L("بدون سبب", "No reason")} {d.rate ? <Badge size="sm">{d.rate / 100}%</Badge> : null} <span className="text-muted">· {who(d.approvedBy)}</span></span><Money value={d.amount} compact /></li>)}
            {r.lineDiscounts.map((d, i) => <li key={i} className="flex justify-between gap-2 py-2"><span>{loc(d.name)} <span className="text-muted">({L("على الصنف", "line")})</span></span><Money value={d.amount} compact /></li>)}
            {!r.discounts.length && !r.lineDiscounts.length ? <li className="py-3 text-muted">{L("مفيش خصومات", "No discounts")}</li> : null}
          </ul>
        </Card>
        <Card>
          <CardHeader title={L("الملغي (Void) وأسبابه", "Voids & reasons")} subtitle={m(k.voidValue)} />
          <ul className="divide-y divide-line px-5 pb-4 text-[13.5px]">
            {r.voids.map((v) => <li key={v.id} className="flex justify-between gap-2 py-2"><span className="min-w-0 truncate">{v.qty}× {loc(v.name)} <span className="text-muted">· {v.reason || L("بدون سبب", "No reason")}{v.afterSend ? L(" · بعد المطبخ", " · after kitchen") : ""}</span></span><Money value={v.value} compact /></li>)}
            {!r.voids.length ? <li className="py-3 text-muted">{L("مفيش ملغي", "No voids")}</li> : null}
          </ul>
        </Card>
        <Card>
          <CardHeader title={L("المرتجعات", "Refunds")} subtitle={m(k.refunds)} />
          <ul className="divide-y divide-line px-5 pb-4 text-[13.5px]">
            {r.refunds.map((x) => <li key={x.id} className="flex justify-between py-2"><span>{PAY[x.method] ?? x.method} <span className="text-muted">{x.reference}</span></span><Money value={x.amount} compact /></li>)}
            {!r.refunds.length ? <li className="py-3 text-muted">{L("مفيش مرتجعات", "No refunds")}</li> : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}

/* ───────── menu engineering ───────── */

const CLASS: Record<MenuClass, { ar: string; en: string; hint: { ar: string; en: string }; tone: "ok" | "brass" | "info" | "danger" }> = {
  star: { ar: "نجوم ⭐", en: "Stars ⭐", hint: { ar: "مطلوبة ومربحة — حافظ عليها ومتغيرش الوصفة", en: "Popular & profitable — keep them, don't touch the recipe" }, tone: "ok" },
  plowhorse: { ar: "حصان شغل 🐎", en: "Plowhorses 🐎", hint: { ar: "مطلوبة بس هامشها قليل — زوّد السعر شوية أو قلل التكلفة", en: "Popular, thin margin — nudge the price or cut the cost" }, tone: "brass" },
  puzzle: { ar: "لغز 🧩", en: "Puzzles 🧩", hint: { ar: "مربحة بس مش مطلوبة — اعرضها أحسن ورشّحها", en: "Profitable, rarely ordered — feature and recommend them" }, tone: "info" },
  dog: { ar: "ضعيفة 🐶", en: "Dogs 🐶", hint: { ar: "لا مطلوبة ولا مربحة — فكّر تشيلها أو تغيّرها", en: "Neither — consider replacing them" }, tone: "danger" },
};

function ItemsTab() {
  const { L, loc } = useT();
  const { w, pct } = useMoney();
  const [period, setPeriod] = usePeriod("30d");
  const r = useSales(period);
  const menu = useLive("menuItems").data;
  const { settings } = useBooks();
  const me = useMemo(() => {
    const cost = new Map(menu.map((m) => [m.id, m.cost]));
    return menuEngineering(r.byItem.map((b) => ({ id: b.key, name: b.label, qty: b.qty, revenue: b.net, unitCost: cost.get(b.key) ?? null })), settings.defaultFoodCostBp);
  }, [r.byItem, menu, settings.defaultFoodCostBp]);
  const csv = () => downloadCsv(`menu_engineering_${period.from}_${period.to}`, ["item", "qty", "mix_pct", "avg_price", "unit_cost", "cost_source", "margin", "contribution", "food_cost_pct", "class"], me.rows.map((x) => [label(x.name, loc), x.qty, (x.mix * 100).toFixed(1), dec(x.price), dec(x.cost), x.costSource, dec(x.margin), dec(x.contribution), (x.foodCostBp / 100).toFixed(1), x.klass]));
  const cols: Column<(typeof me.rows)[number]>[] = [
    { key: "n", header: L("الصنف", "Item"), cell: (x) => label(x.name, loc) },
    { key: "q", header: L("الكمية", "Qty"), align: "end", cell: (x) => <span className="font-mono">{x.qty}</span> },
    { key: "p", header: L("متوسط السعر", "Avg price"), align: "end", hideOnMobile: true, cell: (x) => <Money value={x.price} compact /> },
    { key: "c", header: L("التكلفة", "Cost"), align: "end", hideOnMobile: true, cell: (x) => <span className={x.costSource === "default" ? "text-muted italic" : ""}><Money value={x.cost} compact /></span> },
    { key: "f", header: L("تكلفة ٪", "Cost %"), align: "end", cell: (x) => <span className={cn("font-mono", x.foodCostBp > 3800 && "text-danger")}>{pct(x.foodCostBp)}</span> },
    { key: "m", header: L("الربح للطبق", "Margin"), align: "end", cell: (x) => <Money value={x.margin} compact /> },
    { key: "t", header: L("مساهمة", "Contribution"), align: "end", hideOnMobile: true, cell: (x) => <Money value={x.contribution} whole /> },
    { key: "k", header: L("التصنيف", "Class"), cell: (x) => <Badge size="sm" tone={CLASS[x.klass].tone}>{loc(CLASS[x.klass])}</Badge> },
  ];
  return (
    <div className="grid gap-5 print-area">
      <Head title={L("هندسة المنيو", "Menu engineering")} period={period} setPeriod={setPeriod} onCsv={csv} />
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile index={0} icon={<ShoppingBag />} label={L("أطباق اتباعت", "Portions sold")} value={me.totalQty} />
        <StatTile index={1} icon={<Coins />} tone="ok" label={L("متوسط الربح للطبق", "Avg margin / portion")} value={w(me.avgMargin)} />
        <StatTile index={2} icon={<PieChart />} tone="brass" label={L("تكلفة الطعام النظرية", "Theoretical food cost")} value={pct(me.revenue ? Math.round((me.cost * 10_000) / me.revenue) : 0)} sub={L(`تكلفة ${w(me.cost)} من ${w(me.revenue)}`, `${w(me.cost)} of ${w(me.revenue)}`)} />
        <StatTile index={3} icon={<ChefHat />} tone="info" label={L("أصناف بتكلفة افتراضية", "Items on default cost")} value={me.defaultCosted} sub={L(`${pct(settings.defaultFoodCostBp)} من السعر لحد ما الوصفة تتسجل`, `${pct(settings.defaultFoodCostBp)} of price until a recipe exists`)} />
      </section>
      {me.rows.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["puzzle", "star", "dog", "plowhorse"] as MenuClass[]).map((c) => {
            const list = me.rows.filter((x) => x.klass === c);
            return (
              <Card key={c} className={cn("p-4", c === "star" && "border-ok/40", c === "dog" && "border-danger/30")}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[16px] font-semibold">{loc(CLASS[c])}</h3>
                  <Badge tone={CLASS[c].tone}>{list.length}</Badge>
                </div>
                <p className="mt-0.5 text-[12.5px] text-muted">{loc(CLASS[c].hint)}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {list.slice(0, 14).map((x) => <span key={x.id} className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[12.5px]">{label(x.name, loc)} <span className="text-muted">×{x.qty}</span></span>)}
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}
      <Card>
        <CardHeader title={L("كل الأصناف", "All items")} subtitle={L("الشعبية = نصيب الصنف ≥ ٧٠٪ من النصيب المتساوي · الربحية = ربح الطبق ≥ المتوسط المرجّح", "Popular = mix ≥ 70% of an equal share · profitable = margin ≥ weighted average")} />
        <Table columns={cols} rows={me.rows} rowKey={(x) => x.id} dense empty={<EmptyState compact title={L("مفيش مبيعات في الفترة", "No sales in this period")} />} />
      </Card>
    </div>
  );
}

/* ───────── staff ───────── */

function StaffTab() {
  const { L } = useT();
  const [period, setPeriod] = usePeriod("7d");
  const r = useSales(period);
  const members = useLive("memberships").data;
  const name = (id: string) => members.find((x) => x.id === id)?.name ?? (id === "—" ? "—" : id.slice(0, 6));
  const rows = r.staff;
  const csv = () => downloadCsv(`staff_${period.from}_${period.to}`, ["staff", "checks", "covers", "net", "avg_check", "tips", "discounts", "voids"], rows.map((s) => [name(s.id), s.checks, s.covers, dec(s.net), dec(s.checks ? Math.round(s.net / s.checks) : 0), dec(s.tips), dec(s.discounts), s.voids]));
  return (
    <div className="grid gap-5 print-area">
      <Head title={L("أداء الموظفين", "Staff performance")} period={period} setPeriod={setPeriod} onCsv={csv} />
      <Card>
        <Table dense rows={rows} rowKey={(s) => s.id} empty={<EmptyState compact title={L("مفيش بيانات", "No data")} />} columns={[
          { key: "n", header: L("الموظف", "Staff"), cell: (s) => name(s.id) },
          { key: "c", header: L("شيكات", "Checks"), align: "end", cell: (s) => s.checks },
          { key: "v", header: L("ضيوف", "Covers"), align: "end", hideOnMobile: true, cell: (s) => s.covers },
          { key: "s", header: L("المبيعات", "Sales"), align: "end", cell: (s) => <Money value={s.net} whole /> },
          { key: "a", header: L("متوسط الشيك", "Avg check"), align: "end", cell: (s) => <Money value={s.checks ? Math.round(s.net / s.checks) : 0} whole /> },
          { key: "t", header: L("تيبس", "Tips"), align: "end", hideOnMobile: true, cell: (s) => <Money value={s.tips} whole /> },
          { key: "d", header: L("خصومات", "Discounts"), align: "end", hideOnMobile: true, cell: (s) => <Money value={s.discounts} whole /> },
          { key: "x", header: L("ملغي", "Voids"), align: "end", cell: (s) => <span className={s.voids > 2 ? "text-danger" : ""}>{s.voids}</span> },
        ]} />
      </Card>
    </div>
  );
}

/* ───────── P&L ───────── */

function useBranchFilter() {
  const branches = useLive("branches").data;
  const [branch, setBranch] = useState("");
  return { branch, setBranch, branches };
}

function PnlTab() {
  const { L, loc, lang } = useT();
  const { w, pct } = useMoney();
  const { entries, chart } = useBooks();
  const [period, setPeriod] = usePeriod("last_month");
  const [compare, setCompare] = useState(true);
  const { branch, setBranch, branches } = useBranchFilter();
  const prev = previousPeriod(period);
  const cur = useMemo(() => profitAndLoss(entries, chart, { ...period, branchId: branch || null }), [entries, chart, period, branch]);
  const old = useMemo(() => profitAndLoss(entries, chart, { ...prev, branchId: branch || null }), [entries, chart, prev.from, prev.to, branch]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = cur.totals;
  const sec = (key: keyof Omit<ProfitAndLoss, "totals">) => {
    const codes = [...new Set([...cur[key], ...(compare ? old[key] : [])].map((x) => x.code))].sort();
    return codes.map((code) => ({ code, name: chart.get(code)?.name ?? { ar: code, en: code }, a: cur[key].find((x) => x.code === code)?.amount ?? 0, b: old[key].find((x) => x.code === code)?.amount ?? 0 }));
  };
  const line = (lbl: ReactNode, a: number, b: number, opts: { strong?: boolean; indent?: boolean; invert?: boolean } = {}) => {
    const ch = b ? Math.round(((a - b) / Math.abs(b)) * 100) : null;
    const good = ch == null ? null : opts.invert ? ch <= 0 : ch >= 0;
    return (
      <div className={cn("grid grid-cols-[1fr_auto] items-baseline gap-4 border-b border-line/70 px-5 py-2 text-[14px] sm:grid-cols-[1fr_10rem_11rem_5rem]", opts.strong && "bg-surface-2/70 font-semibold", opts.indent && "ps-9 text-ink-2")}>
        <span className="min-w-0">{lbl}</span>
        <span className="text-end font-mono tabular-nums" dir="ltr"><Num value={a} whole /></span>
        {compare ? <span className="hidden text-end font-mono text-muted tabular-nums sm:block" dir="ltr"><Num value={b} whole /></span> : <span className="hidden sm:block" />}
        {compare ? <span className={cn("hidden text-end font-mono text-[12.5px] sm:block", good == null ? "text-faint" : good ? "text-ok" : "text-danger")} dir="ltr">{ch == null ? "—" : `${ch > 0 ? "+" : ""}${ch}%`}</span> : <span className="hidden sm:block" />}
      </div>
    );
  };
  const block = (title: string, key: keyof Omit<ProfitAndLoss, "totals">, ta: number, tb: number, invert = true) => {
    const rows = sec(key);
    if (!rows.length) return null;
    return (
      <>
        <SectionTitle>{title}</SectionTitle>
        {rows.map((r) => <Fragment key={r.code}>{line(<><span className="font-mono text-[12px] text-muted" dir="ltr">{r.code}</span> {loc(r.name)}</>, r.a, r.b, { indent: true, invert })}</Fragment>)}
        {line(L(`إجمالي ${title}`, `Total ${title.toLowerCase()}`), ta, tb, { strong: true, invert })}
      </>
    );
  };
  const csv = () => downloadCsv(`pnl_${period.from}_${period.to}`, ["section", "code", "account", "current", "previous"], (["revenue", "cogs", "labour", "occupancy", "fees", "opex", "other"] as const).flatMap((k) => sec(k).map((r) => [k, r.code, r.name[lang], dec(r.a), dec(r.b)])).concat([["total", "", "net_profit", dec(t.netProfit), dec(old.totals.netProfit)]]));
  return (
    <div className="grid gap-5 print-area">
      <Head title={L("قائمة الأرباح والخسائر", "Profit & loss")} period={period} setPeriod={setPeriod} onCsv={csv} extra={
        <>
          <Select aria-label={L("الفرع", "Branch")} value={branch} onChange={(e) => setBranch(e.target.value)} options={[{ value: "", label: L("كل الفروع", "All branches") }, ...branches.map((b) => ({ value: b.id, label: loc(b.name) }))]} className="min-w-36" />
          <Switch checked={compare} onChange={setCompare} label={L("قارن", "Compare")} />
        </>
      } />
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile index={0} icon={<LineChart />} label={L("صافي الربح", "Net profit")} value={w(t.netProfit)} sub={L(`هامش ${pct(t.revenue ? Math.round((t.netProfit * 10_000) / t.revenue) : 0)}`, `Margin ${pct(t.revenue ? Math.round((t.netProfit * 10_000) / t.revenue) : 0)}`)} tone={t.netProfit >= 0 ? "ok" : "danger"} />
        <StatTile index={1} icon={<ChefHat />} tone="brass" label={L("تكلفة الطعام ٪", "Food cost %")} value={pct(t.foodCostBp)} sub={w(t.cogs)} />
        <StatTile index={2} icon={<Users />} tone="info" label={L("تكلفة العمالة ٪", "Labour %")} value={pct(t.labourBp)} sub={w(t.labour)} />
        <StatTile index={3} icon={<PieChart />} tone={t.primeCostBp > 6500 ? "danger" : "primary"} label={L("التكلفة الأساسية (Prime) ٪", "Prime cost %")} value={pct(t.primeCostBp)} sub={L("الطعام + العمالة · الهدف أقل من ٦٠–٦٥٪", "Food + labour · aim under 60–65%")} />
      </section>
      <Card className="overflow-hidden">
        <div className="hidden grid-cols-[1fr_10rem_11rem_5rem] gap-4 border-b border-line bg-surface-2 px-5 py-2 text-[12px] font-semibold text-muted sm:grid">
          <span>{period.from} → {period.to}</span><span className="text-end">{L("الفترة", "Period")}</span><span className="text-end">{compare ? `${prev.from} → ${prev.to}` : ""}</span><span className="text-end">{compare ? L("التغير", "Change") : ""}</span>
        </div>
        {block(L("الإيرادات", "Revenue"), "revenue", t.revenue, old.totals.revenue, false)}
        {block(L("تكلفة المبيعات", "Cost of sales"), "cogs", t.cogs, old.totals.cogs)}
        {line(L("مجمل الربح", "Gross profit"), t.grossProfit, old.totals.grossProfit, { strong: true })}
        {block(L("العمالة", "Labour"), "labour", t.labour, old.totals.labour)}
        {block(L("الإيجار والمرافق", "Rent & utilities"), "occupancy", t.occupancy, old.totals.occupancy)}
        {block(L("العمولات", "Fees & commissions"), "fees", t.fees, old.totals.fees)}
        {block(L("مصروفات التشغيل", "Operating expenses"), "opex", t.opex, old.totals.opex)}
        {block(L("مصروفات أخرى", "Other expenses"), "other", t.other, old.totals.other)}
        <div className="border-t-2 border-line-strong">{line(L("صافي الربح", "Net profit"), t.netProfit, old.totals.netProfit, { strong: true })}</div>
      </Card>
      <EstimateNote>{L("قبل ضريبة الدخل؛ تكلفة الطعام من الجرد الأسبوعي", "Before income tax; food cost from the weekly stock counts")}</EstimateNote>
    </div>
  );
}

/* ───────── balance sheet / trial balance / cash flow ───────── */

function BsTab() {
  const { L, loc, lang } = useT();
  const { m } = useMoney();
  const { entries, chart } = useBooks();
  const [to, setTo] = useState(businessDay());
  const bs = useMemo(() => balanceSheet(entries, chart, to), [entries, chart, to]);
  const list = (xs: PlLine[]) => xs.map((x) => <Row key={x.code} indent label={<><span className="font-mono text-[12px] text-muted" dir="ltr">{x.code}</span> {loc(x.name)}</>} value={m(x.amount)} />);
  const csv = () => downloadCsv(`balance_sheet_${to}`, ["section", "code", "account", "amount"], [...bs.assets.map((x) => ["asset", x.code, x.name[lang], dec(x.amount)]), ...bs.liabilities.map((x) => ["liability", x.code, x.name[lang], dec(x.amount)]), ...bs.equity.map((x) => ["equity", x.code, x.name[lang], dec(x.amount)]), ["equity", "", "current_earnings", dec(bs.totals.currentEarnings)]]);
  return (
    <div className="grid gap-5 print-area">
      <Head title={L("الميزانية العمومية", "Balance sheet")} onCsv={csv} extra={<Input type="date" aria-label={L("في تاريخ", "As at")} value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <SectionTitle>{L("الأصول", "Assets")}</SectionTitle>
          {list(bs.assets)}
          <Row strong label={L("إجمالي الأصول", "Total assets")} value={m(bs.totals.assets)} />
        </Card>
        <Card className="overflow-hidden">
          <SectionTitle>{L("الالتزامات", "Liabilities")}</SectionTitle>
          {list(bs.liabilities)}
          <Row strong label={L("إجمالي الالتزامات", "Total liabilities")} value={m(bs.totals.liabilities)} />
          <SectionTitle>{L("حقوق الملكية", "Equity")}</SectionTitle>
          {list(bs.equity)}
          <Row indent label={L("أرباح الفترة الجارية", "Current earnings")} value={m(bs.totals.currentEarnings)} />
          <Row strong label={L("الالتزامات + حقوق الملكية", "Liabilities + equity")} value={m(bs.totals.liabilitiesAndEquity)} />
          <Row label={L("الفرق", "Difference")} value={m(bs.totals.difference)} tone={bs.totals.difference ? "danger" : "ok"} />
        </Card>
      </div>
    </div>
  );
}

function TbTab() {
  const { L, loc, lang } = useT();
  const { entries, chart } = useBooks();
  const [period, setPeriod] = usePeriod("ytd");
  const tb = useMemo(() => trialBalance(entries, chart, period), [entries, chart, period]);
  const csv = () => downloadCsv(`trial_balance_${period.from}_${period.to}`, ["code", "account", "debit", "credit", "balance"], tb.rows.map((r) => [r.code, r.account?.name[lang] ?? r.code, dec(r.debit), dec(r.credit), dec(r.balance)]));
  return (
    <div className="grid gap-5 print-area">
      <Head title={L("ميزان المراجعة", "Trial balance")} period={period} setPeriod={setPeriod} onCsv={csv} />
      <Card>
        <Table dense rows={[...tb.rows, { code: "Σ", account: undefined, ...tb.totals }]} rowKey={(r) => r.code} columns={[
          { key: "c", header: L("الحساب", "Account"), cell: (r) => (r.code === "Σ" ? <b>{L("الإجمالي", "Total")}</b> : <span><span className="font-mono text-[12px] text-muted" dir="ltr">{r.code}</span> {r.account ? loc(r.account.name) : ""}</span>) },
          { key: "d", header: L("مدين", "Debit"), align: "end", cell: (r) => <span className="font-mono tabular-nums"><Num value={r.debit} /></span> },
          { key: "k", header: L("دائن", "Credit"), align: "end", cell: (r) => <span className="font-mono tabular-nums"><Num value={r.credit} /></span> },
          { key: "b", header: L("الرصيد", "Balance"), align: "end", cell: (r) => <span className={cn("font-mono tabular-nums", r.code === "Σ" && (r.balance ? "text-danger" : "text-ok"))}><Num value={r.balance} /></span> },
        ]} />
      </Card>
    </div>
  );
}

function CashFlowTab() {
  const { L } = useT();
  const { m } = useMoney();
  const { entries, chart } = useBooks();
  const [period, setPeriod] = usePeriod("last_month");
  const cf = useMemo(() => cashFlow(entries, chart, period), [entries, chart, period]);
  const LBL: Record<string, string> = { customers: L("متحصلات من العملاء والمبيعات", "Received from customers"), suppliers: L("مدفوع للموردين", "Paid to suppliers"), staff: L("مدفوع للعاملين", "Paid to staff"), occupancy: L("إيجار ومرافق", "Rent & utilities"), taxes: L("ضرايب (صافي محصل/مدفوع)", "Taxes (net)"), expenses: L("مصروفات أخرى", "Other expenses"), other: L("أخرى", "Other") };
  const csv = () => downloadCsv(`cash_flow_${period.from}_${period.to}`, ["line", "amount"], [["opening", dec(cf.opening)], ...cf.operating.map((o) => [o.label, dec(o.amount)]), ["operating_total", dec(cf.operatingTotal)], ["investing", dec(cf.investing)], ["financing", dec(cf.financing)], ["net", dec(cf.net)], ["closing", dec(cf.closing)]]);
  return (
    <div className="grid gap-5 print-area">
      <Head title={L("قائمة التدفقات النقدية", "Cash flow statement")} period={period} setPeriod={setPeriod} onCsv={csv} />
      <Card className="overflow-hidden">
        <Row strong label={L("النقدية أول الفترة", "Opening cash")} value={m(cf.opening)} />
        <SectionTitle>{L("أنشطة التشغيل", "Operating activities")}</SectionTitle>
        {cf.operating.map((o) => <Row key={o.label} indent label={LBL[o.label] ?? o.label} value={m(o.amount)} tone={o.amount < 0 ? "danger" : undefined} />)}
        <Row strong label={L("صافي التشغيل", "Net operating")} value={m(cf.operatingTotal)} />
        <Row label={L("أنشطة الاستثمار (أصول ثابتة)", "Investing (fixed assets)")} value={m(cf.investing)} />
        <Row label={L("أنشطة التمويل (الملاك والقروض)", "Financing (owners & loans)")} value={m(cf.financing)} />
        <Row strong label={L("صافي التغير", "Net change")} value={m(cf.net)} tone={cf.net < 0 ? "danger" : "ok"} />
        <Row strong label={L("النقدية آخر الفترة", "Closing cash")} value={m(cf.closing)} />
      </Card>
      <p className="text-[12.5px] text-muted">{L("النقدية = الأدراج + الخزنة + العهدة + البنوك. التحويل بينهم مش بيظهر. فلوس الفيزا والتطبيقات بتظهر لما توصل البنك.", "Cash = tills + safe + petty + banks. Transfers between them net out. Card / app money shows when it reaches the bank.")}</p>
    </div>
  );
}

function LiabilitiesTab() {
  const { L, loc } = useT();
  const { m } = useMoney();
  const { entries, chart } = useBooks();
  const [period, setPeriod] = usePeriod("month");
  const mv = (code: string) => {
    let acc = 0;
    let paid = 0;
    for (const e of entries) {
      if (e.date < period.from || e.date > period.to) continue;
      for (const l of e.lines) if (l.account === code) {
        acc += l.credit;
        paid += l.debit;
      }
    }
    return { opening: -balanceOf(entries, code, { to: addDays(period.from, -1) }), accrued: acc, paid, closing: -balanceOf(entries, code, { to: period.to }) };
  };
  const codes = [ACC.servicePayable, ACC.tipsPayable, ACC.customerDeposits, ACC.salariesPayable, ACC.socialInsurancePayable, ACC.payrollTaxPayable, ACC.outputVat, ACC.vatSettlement, ACC.payables, ACC.accrued];
  const rows = codes.map((c) => ({ code: c, name: chart.get(c)?.name ?? { ar: c, en: c }, ...mv(c) }));
  const csv = () => downloadCsv(`liabilities_${period.from}_${period.to}`, ["code", "account", "opening", "accrued", "paid", "closing"], rows.map((r) => [r.code, r.name.en, dec(r.opening), dec(r.accrued), dec(r.paid), dec(r.closing)]));
  const svc = rows[0];
  const tips = rows[1];
  return (
    <div className="grid gap-5 print-area">
      <Head title={L("الخدمة والتيبس والالتزامات", "Service, tips & liabilities")} period={period} setPeriod={setPeriod} onCsv={csv} />
      <section className="grid gap-3 sm:grid-cols-2">
        <StatTile index={0} icon={<HandCoins />} label={L("الخدمة المستحقة للعاملين", "Service charge owed to staff")} value={m(svc.closing)} sub={L(`اتحصّل ${m(svc.accrued)} · اتوزع ${m(svc.paid)}`, `Collected ${m(svc.accrued)} · paid out ${m(svc.paid)}`)} />
        <StatTile index={1} icon={<Coins />} tone="brass" label={L("التيبس المستحقة", "Tips owed")} value={m(tips.closing)} sub={L(`اتحصّل ${m(tips.accrued)} · اتصرف ${m(tips.paid)}`, `Collected ${m(tips.accrued)} · paid ${m(tips.paid)}`)} />
      </section>
      <Card>
        <Table dense rows={rows} rowKey={(r) => r.code} columns={[
          { key: "n", header: L("الالتزام", "Liability"), cell: (r) => <span><span className="font-mono text-[12px] text-muted" dir="ltr">{r.code}</span> {loc(r.name)}</span> },
          { key: "o", header: L("أول الفترة", "Opening"), align: "end", hideOnMobile: true, cell: (r) => <Money value={r.opening} whole /> },
          { key: "a", header: L("اتضاف", "Added"), align: "end", cell: (r) => <Money value={r.accrued} whole /> },
          { key: "p", header: L("اتسدد", "Settled"), align: "end", cell: (r) => <Money value={r.paid} whole /> },
          { key: "c", header: L("آخر الفترة", "Closing"), align: "end", cell: (r) => <b><Money value={r.closing} whole /></b> },
        ]} />
      </Card>
      <EstimateNote>{L("أرصدة الضرايب والتأمينات من الدفاتر", "Tax and insurance balances from the books")}</EstimateNote>
    </div>
  );
}

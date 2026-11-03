import { lazy, Suspense, useMemo, useState } from "react";
import { Link, Route, Routes, useNavigate } from "react-router-dom";
import {
  AlertTriangle, ArrowLeftRight, BarChart3, BookOpenCheck, Boxes, ClipboardCheck, ClipboardList, Factory, LayoutDashboard, PackageX, RefreshCw, ShoppingCart, Store, Trash2, Truck, Warehouse,
} from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { Badge, Button, Card, CardHeader, EmptyState, Skeleton, StatTile, useToast } from "@/ui";
import { PageHeader } from "@/shell/PageHeader";
import { RouteTabs } from "@/modules/marketing/ui";
import { catchUpDeductions } from "./deduct";
import { stockAlerts, type Alert } from "./reports";
import { supplierBalances } from "./purchasing";
import { useInventory } from "./useInventory";
import { pct } from "./bits";
import MovesPage, { ProduceDialog, TransferDialog, WasteDialog } from "./MovesPage";

const ItemsPage = lazy(() => import("./ItemsPage"));
const RecipesPage = lazy(() => import("./RecipesPage"));
const CountsPage = lazy(() => import("./CountsPage"));
const CountSheet = lazy(() => import("./CountSheet"));
const PurchasingPage = lazy(() => import("./PurchasingPage"));
const SuppliersPage = lazy(() => import("./SuppliersPage"));
const MarketplacePage = lazy(() => import("./MarketplacePage"));
const ReportsPage = lazy(() => import("./ReportsPage"));

export default function InventoryPage() {
  const { L } = useT();
  const { can } = useSession();
  const inv = useInventory();
  const alerts = useAlerts(inv);
  const openCounts = useLive("stockCounts", { where: { status: ["open", "submitted"] } }).data.length;
  const drafts = useLive("purchaseOrders", { where: { status: ["draft", "sent", "partial"] } }).data.length;
  return (
    <div className="grid gap-5">
      <PageHeader icon={<Warehouse />} title={L("المخزن والمشتريات", "Inventory & purchasing")} subtitle={L("كل جرام داخل وخارج: وصفات، جرد، هالك، طلبات شراء وموردين", "Every gram in and out: recipes, counts, waste, purchase orders and suppliers")} />
      <RouteTabs
        label={L("أقسام المخزن", "Inventory sections")}
        items={[
          { to: "/inventory", end: true, label: L("نظرة عامة", "Overview"), icon: <LayoutDashboard />, count: alerts.filter((a) => a.severity !== "info").length || null },
          { to: "/inventory/items", label: L("الخامات", "Stock items"), icon: <Boxes /> },
          { to: "/inventory/recipes", label: L("الوصفات", "Recipes"), icon: <BookOpenCheck /> },
          { to: "/inventory/moves", label: L("الحركة والهالك", "Moves & waste"), icon: <ArrowLeftRight /> },
          { to: "/inventory/counts", label: L("الجرد", "Counts"), icon: <ClipboardCheck />, count: openCounts || null },
          ...(can("purchasing.manage") || can("inventory.manage")
            ? [
                { to: "/inventory/purchasing", label: L("طلبات الشراء", "Purchase orders"), icon: <ShoppingCart />, count: drafts || null },
                { to: "/inventory/suppliers", label: L("الموردين", "Suppliers"), icon: <Truck /> },
                { to: "/inventory/marketplace", label: L("سوق الموردين", "Supplier marketplace"), icon: <Store /> },
              ]
            : []),
          { to: "/inventory/reports", label: L("تقارير", "Reports"), icon: <BarChart3 /> },
        ]}
      />
      <Suspense fallback={<Skeleton className="h-96" rounded="rounded-[20px]" />}>
        <Routes>
          <Route index element={<Overview alerts={alerts} />} />
          <Route path="items" element={<ItemsPage />} />
          <Route path="recipes" element={<RecipesPage />} />
          <Route path="moves" element={<MovesPage />} />
          <Route path="counts" element={<CountsPage />} />
          <Route path="counts/:countId" element={<CountSheet />} />
          <Route path="purchasing" element={<PurchasingPage />} />
          <Route path="suppliers" element={<SuppliersPage />} />
          <Route path="marketplace" element={<MarketplacePage />} />
          <Route path="reports" element={<ReportsPage />} />
        </Routes>
      </Suspense>
    </div>
  );
}

export function useAlerts(inv: ReturnType<typeof useInventory>) {
  const counts = useLive("stockCounts").data;
  return useMemo(
    () =>
      stockAlerts({
        items: inv.items, levels: inv.levels, batches: inv.batches, offers: inv.offers, counts, branchId: inv.branchId,
        expiryWarnDays: inv.settings.expiryWarnDays, priceAlertBp: inv.settings.priceAlertBp, varianceAlertBp: inv.settings.varianceAlertBp,
      }),
    [inv, counts],
  );
}

function Overview({ alerts }: { alerts: Alert[] }) {
  const { L, lang, loc } = useT();
  const { can } = useSession();
  const db = useDb();
  const nav = useNavigate();
  const { toast } = useToast();
  const inv = useInventory();
  const since = useMemo(() => new Date(Date.now() - 7 * 86_400_000).toISOString(), []);
  const moves = useLive("stockMoves", { gte: { at: since } }).data;
  const invoices = useLive("supplierInvoices").data;
  const pos = useLive("purchaseOrders", { where: { status: ["draft", "sent", "partial"] } }).data;
  const receipts = useLive("receipts", { gte: { issuedAt: since } }).data;
  const [dialog, setDialog] = useState<null | "waste" | "transfer" | "produce">(null);
  const [busy, setBusy] = useState(false);

  const value = inv.levels.reduce((a, l) => a + Math.max(0, l.value), 0);
  const waste = -moves.filter((m) => m.kind === "waste" || m.kind === "staff_meal").reduce((a, m) => a + m.value, 0);
  const cogs = -moves.filter((m) => m.kind === "sale" || m.kind === "sale_reversal").reduce((a, m) => a + m.value, 0);
  const sales = receipts.reduce((a, r) => a + (r.kind === "SC" ? r.bill.net : -r.bill.net), 0);
  const owed = [...supplierBalances(invoices).values()].reduce((a, b) => a + b.owed, 0);
  const low = alerts.filter((a) => a.kind === "low" || a.kind === "out");
  const money = (u: number) => formatMoney(u, { lang, whole: true });

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile index={0} icon={<Warehouse />} label={L("قيمة المخزون", "Stock value")} value={money(value)} sub={L("بمتوسط التكلفة المرجّح", "at weighted average cost")} />
        <StatTile index={1} tone={low.length ? "warn" : "ok"} icon={<PackageX />} label={L("خامات قليلة/خلصانة", "Low / out")} value={String(low.length)} sub={L("تحت حد الطلب", "below reorder point")} />
        <StatTile index={2} tone="primary" icon={<BarChart3 />} label={L("تكلفة المبيعات (٧ أيام)", "Cost of sales (7 days)")} value={money(cogs)} sub={sales > 0 ? `${L("نسبة تكلفة الأكل", "Food cost")} ${pct(Math.round((cogs * 10_000) / sales), lang)}` : L("حسب الوصفات", "from recipes")} />
        <StatTile index={3} tone="danger" icon={<Trash2 />} label={L("الهالك (٧ أيام)", "Waste (7 days)")} value={money(waste)} sub={cogs ? `${pct(Math.round((waste * 10_000) / Math.max(1, cogs)), lang)} ${L("من التكلفة", "of cost")}` : undefined} />
        <StatTile index={4} tone="brass" icon={<Truck />} label={L("للموردين", "Owed to suppliers")} value={money(owed)} sub={`${pos.length} ${L("طلب شراء مفتوح", "open POs")}`} className="col-span-2 lg:col-span-1" />
      </div>

      <div className="flex flex-wrap gap-2">
        {can("inventory.count") ? <Button variant="secondary" icon={<Trash2 className="size-4" />} onClick={() => setDialog("waste")}>{L("سجّل هالك", "Record waste")}</Button> : null}
        {can("inventory.count") ? <Button variant="secondary" icon={<ClipboardCheck className="size-4" />} onClick={() => nav("/inventory/counts?new=1")}>{L("ابدأ جرد", "Start a count")}</Button> : null}
        {can("inventory.manage") ? <Button variant="secondary" icon={<Factory className="size-4" />} onClick={() => setDialog("produce")}>{L("إنتاج تحضيرات", "Produce prep")}</Button> : null}
        {can("inventory.manage") ? <Button variant="secondary" icon={<ArrowLeftRight className="size-4" />} onClick={() => setDialog("transfer")}>{L("تحويل", "Transfer")}</Button> : null}
        {can("purchasing.manage") || can("inventory.manage") ? <Button icon={<ClipboardList className="size-4" />} onClick={() => nav("/inventory/purchasing?suggest=1")}>{L("اقترح طلبات شراء", "Suggest orders")}</Button> : null}
        <Button
          variant="ghost"
          loading={busy}
          icon={<RefreshCw className="size-4" />}
          onClick={async () => {
            setBusy(true);
            try {
              const n = await catchUpDeductions(db, 48);
              toast({ title: n ? L(`اتخصم ${n} حركة متأخرة`, `${n} late deductions booked`) : L("كل المبيعات متخصمة", "Every sale is deducted"), tone: "success" });
            } finally {
              setBusy(false);
            }
          }}
        >
          {L("راجع خصم المبيعات", "Re-check sale deductions")}
        </Button>
      </div>

      <Card>
        <CardHeader icon={<AlertTriangle />} title={L("تنبيهات", "Alerts")} subtitle={L("نواقص، صلاحية، زيادة أسعار، وفروق جرد", "Shortages, expiry, price rises and count variance")} action={<Badge tone={alerts.length ? "warn" : "ok"}>{alerts.length}</Badge>} />
        <div className="px-5 pb-5">
          {alerts.length ? (
            <ul className="grid gap-2 md:grid-cols-2">
              {alerts.slice(0, 18).map((a) => {
                const it = a.itemId ? inv.itemById.get(a.itemId) : null;
                return (
                  <li key={a.id} className="flex min-w-0 items-center gap-3 rounded-2xl border border-line bg-surface-2/60 px-3.5 py-2.5">
                    <span className={`size-2.5 shrink-0 rounded-full ${a.severity === "danger" ? "bg-danger" : a.severity === "warn" ? "bg-warn" : "bg-info"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold">{it ? loc(it.name) : "—"}</p>
                      <p className="truncate text-[12.5px] text-muted">{alertText(a, it, L, lang, inv)}</p>
                    </div>
                    {a.kind === "low" || a.kind === "out" ? (
                      <Link className="shrink-0 text-[13px] font-semibold text-primary" to="/inventory/purchasing?suggest=1">{L("اطلب", "Order")}</Link>
                    ) : a.kind === "variance" ? (
                      <Link className="shrink-0 text-[13px] font-semibold text-primary" to={`/inventory/counts/${a.data.countId}`}>{L("الجرد", "Count")}</Link>
                    ) : a.kind === "price" ? (
                      <Link className="shrink-0 text-[13px] font-semibold text-primary" to="/inventory/suppliers">{L("قارن", "Compare")}</Link>
                    ) : (
                      <button type="button" className="shrink-0 text-[13px] font-semibold text-primary" onClick={() => setDialog("waste")}>{L("هالك", "Waste")}</button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState compact icon={<ClipboardCheck />} title={L("مفيش تنبيهات", "All clear")} body={L("المخزن ماشي تمام", "Stock looks healthy")} />
          )}
        </div>
      </Card>

      <WasteDialog open={dialog === "waste"} onClose={() => setDialog(null)} />
      <TransferDialog open={dialog === "transfer"} onClose={() => setDialog(null)} />
      <ProduceDialog open={dialog === "produce"} onClose={() => setDialog(null)} />
    </div>
  );
}

function alertText(a: Alert, it: ReturnType<typeof useInventory>["items"][number] | null | undefined, L: (ar: string, en: string) => string, lang: "ar" | "en", inv: ReturnType<typeof useInventory>) {
  const fq = (n: number) => (it ? new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-US", { maximumFractionDigits: 1 }).format(it.baseUnit === "pc" ? n : n / 1000) + (it.baseUnit === "pc" ? "" : it.baseUnit === "g" ? (lang === "ar" ? " كجم" : " kg") : lang === "ar" ? " لتر" : " L") : String(n));
  switch (a.kind) {
    case "out":
      return L(`خلص — حد الطلب ${fq(Number(a.data.min))}`, `Out — reorder point ${fq(Number(a.data.min))}`);
    case "low":
      return L(`فاضل ${fq(Number(a.data.qty))} (الحد ${fq(Number(a.data.min))})`, `${fq(Number(a.data.qty))} left (min ${fq(Number(a.data.min))})`);
    case "expiring":
      return L(`تشغيلة ${a.data.lot} تنتهي ${a.data.on} — ${fq(Number(a.data.qty))}`, `Lot ${a.data.lot} expires ${a.data.on} — ${fq(Number(a.data.qty))}`);
    case "expired":
      return L(`تشغيلة ${a.data.lot} انتهت ${a.data.on}`, `Lot ${a.data.lot} expired ${a.data.on}`);
    case "price": {
      const s = inv.supplierById.get(String(a.data.supplierId));
      return L(`${s?.name.ar ?? ""} زوّد السعر ${pct(Number(a.data.bp), lang)}: ${formatMoney(Number(a.data.from), { lang, whole: true })} ← ${formatMoney(Number(a.data.to), { lang, whole: true })}`, `${s?.name.en ?? ""} raised the price ${pct(Number(a.data.bp), lang)}: ${formatMoney(Number(a.data.from), { lang, whole: true })} → ${formatMoney(Number(a.data.to), { lang, whole: true })}`);
    }
    case "variance":
      return L(`فرق جرد ${fq(Number(a.data.qty))} = ${formatMoney(Number(a.data.value), { lang, whole: true })}`, `Count variance ${fq(Number(a.data.qty))} = ${formatMoney(Number(a.data.value), { lang, whole: true })}`);
  }
}

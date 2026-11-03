import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { useLive } from "@/data/hooks";
import type { StockItem } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { Badge, BarChart, Meter, Money, Segmented, StatTile, Table, type Column } from "@/ui";
import { Section } from "@/modules/marketing/ui";
import { CATEGORY_LABEL, Qty, WASTE_REASONS, pct } from "./bits";
import { cogsSummary, purchaseHistory, supplierPerformance, usageReport, valuation, wasteReport, type SupplierScore, type UsageRow } from "./reports";
import { useInventory } from "./useInventory";

type Sec = "usage" | "cogs" | "waste" | "valuation" | "purchases" | "suppliers";

export default function ReportsPage() {
  const { L, lang, loc } = useT();
  const inv = useInventory();
  const [sec, setSec] = useState<Sec>("usage");
  const [days, setDays] = useState<"7" | "30">("7");
  const from = useMemo(() => new Date(Date.now() - Number(days) * 86_400_000).toISOString(), [days]);
  const to = useMemo(() => new Date(Date.now() + 60_000).toISOString(), [days]); // eslint-disable-line react-hooks/exhaustive-deps
  const moves = useLive("stockMoves", { gte: { at: from } }).data.filter((m) => !inv.branchId || m.branchId === inv.branchId);
  const receipts = useLive("receipts", { gte: { issuedAt: from } }).data;
  const pos = useLive("purchaseOrders").data;
  const money = (u: number) => formatMoney(u, { lang, whole: true });
  const sales = receipts.reduce((a, r) => a + (r.kind === "SC" ? r.bill.net : -r.bill.net), 0);
  const it = (id: string) => inv.itemById.get(id);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="-mx-4 overflow-x-auto px-4 no-scrollbar md:mx-0 md:px-0">
          <Segmented
            label={L("التقرير", "Report")}
            value={sec}
            onChange={setSec}
            options={[
              { value: "usage", label: L("الفعلي مقابل النظري", "Actual vs theoretical") },
              { value: "cogs", label: L("تكلفة المبيعات", "COGS") },
              { value: "waste", label: L("الهالك", "Waste") },
              { value: "valuation", label: L("قيمة المخزون", "Valuation") },
              { value: "purchases", label: L("المشتريات", "Purchases") },
              { value: "suppliers", label: L("أداء الموردين", "Suppliers") },
            ]}
          />
        </div>
        {sec !== "valuation" && sec !== "suppliers" ? <Segmented size="sm" label={L("الفترة", "Period")} value={days} onChange={setDays} options={[{ value: "7", label: L("٧ أيام", "7 days") }, { value: "30", label: L("٣٠ يوم", "30 days") }]} /> : null}
      </div>
      {sec === "usage" ? <Usage rows={usageReport(moves, from, to)} item={it} /> : null}
      {sec === "cogs" ? (() => {
        const c = cogsSummary(moves, inv.itemById, from, to);
        return (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile index={0} label={L("صافي المبيعات", "Net sales")} value={money(sales)} sub={L("من الإيصالات", "from receipts")} />
              <StatTile index={1} tone="primary" label={L("تكلفة المبيعات (وصفات)", "Cost of sales (recipes)")} value={money(c.sales)} sub={sales ? `${pct(Math.round((c.sales * 10_000) / sales), lang)} ${L("من المبيعات", "of sales")}` : undefined} />
              <StatTile index={2} tone="danger" label={L("هالك + وجبات طاقم", "Waste + staff meals")} value={money(c.waste + c.staffMeal)} />
              <StatTile index={3} tone="warn" label={L("فروق جرد (صافي)", "Count variance (net)")} value={money(c.countLoss - c.countGain)} />
            </div>
            <Section title={L("تفصيل التكلفة", "Cost breakdown")} subtitle={L("التكلفة الفعلية = نظرية + هالك + وجبات + فروق جرد", "Actual = theoretical + waste + staff meals + count variance")}>
              <ul className="grid gap-3">
                {[
                  [L("طعام (٥١٠١)", "Food (5101)"), c.food],
                  [L("مشروبات (٥١٠٢)", "Beverage (5102)"), c.beverage],
                  [L("تغليف (٥١٠٣)", "Packaging (5103)"), c.packaging],
                  [L("هالك (٥٢٠١)", "Waste (5201)"), c.waste],
                  [L("وجبات الطاقم (٥٣٠١)", "Staff meals (5301)"), c.staffMeal],
                  [L("فروق جرد (٥٤٠١)", "Count variance (5401)"), c.countLoss - c.countGain],
                ].map(([k, v]) => (
                  <li key={String(k)} className="grid gap-1">
                    <div className="flex justify-between text-[14px]"><span>{k}</span><Money value={Number(v)} whole /></div>
                    <Meter value={Math.max(0, Number(v))} max={Math.max(1, c.total)} label={String(k)} />
                  </li>
                ))}
                <li className="flex justify-between border-t border-line pt-2 text-[15px] font-semibold"><span>{L("التكلفة الفعلية", "Actual cost")}</span><span>{money(c.total)}{sales ? ` · ${pct(Math.round((c.total * 10_000) / sales), lang)}` : ""}</span></li>
              </ul>
            </Section>
          </div>
        );
      })() : null}
      {sec === "waste" ? (() => {
        const w = wasteReport(moves, from, to);
        const byItem = [...w.byItem.entries()].sort((a, b) => b[1].value - a[1].value);
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title={L("الهالك حسب السبب", "Waste by reason")} subtitle={money(w.total)}>
              <BarChart ariaLabel={L("الهالك حسب السبب", "Waste by reason")} data={[...w.byReason.entries()].sort((a, b) => b[1].value - a[1].value).map(([r, v]) => ({ key: r, label: WASTE_REASONS.find((x) => x.id === r)?.[lang] ?? r, value: v.value / 100_000, tip: `${money(v.value)} · ${v.n}` }))} />
            </Section>
            <Section title={L("أكتر خامات بتتهلك", "Most wasted items")}>
              <ul className="grid gap-1.5">
                {byItem.slice(0, 10).map(([id, v]) => {
                  const x = it(id);
                  return x ? <li key={id} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2 text-[14px]"><span className="truncate">{loc(x.name)}</span><span className="flex gap-3"><Qty qty={v.qty} item={x} className="text-muted" /><Money value={v.value} whole className="font-semibold" /></span></li> : null;
                })}
              </ul>
            </Section>
          </div>
        );
      })() : null}
      {sec === "valuation" ? (() => {
        const v = valuation(inv.levels, inv.itemById, inv.branchId);
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title={L("حسب المكان", "By location")} subtitle={`${L("الإجمالي", "Total")} ${money(v.total)}`}>
              <BarChart ariaLabel={L("قيمة المخزون حسب المكان", "Stock value by location")} data={[...v.byLocation.entries()].map(([id, val]) => ({ key: id, label: loc(inv.locationById.get(id)?.name), value: val / 100_000, tip: money(val) }))} />
            </Section>
            <Section title={L("حسب القسم", "By category")}>
              <ul className="grid gap-2">
                {[...v.byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([c, val]) => (
                  <li key={c} className="grid gap-1"><div className="flex justify-between text-[14px]"><span>{CATEGORY_LABEL[c as StockItem["category"]]?.[lang] ?? c}</span><Money value={val} whole /></div><Meter value={val} max={Math.max(1, v.total)} label={c} /></li>
                ))}
              </ul>
            </Section>
          </div>
        );
      })() : null}
      {sec === "purchases" ? (() => {
        const h = purchaseHistory(pos, from, to);
        return (
          <Section title={L("المشتريات حسب المورد", "Purchases by supplier")} subtitle={money(h.total)}>
            <ul className="grid gap-2">
              {[...h.bySupplier.entries()].sort((a, b) => b[1].value - a[1].value).map(([sid, x]) => (
                <li key={sid} className="grid gap-1"><div className="flex justify-between text-[14px]"><span>{loc(inv.supplierById.get(sid)?.name)} <span className="text-muted">· {x.orders} {L("طلب", "orders")}</span></span><Money value={x.value} whole /></div><Meter value={x.value} max={Math.max(1, h.total)} label={sid} /></li>
              ))}
            </ul>
          </Section>
        );
      })() : null}
      {sec === "suppliers" ? <Suppliers rows={supplierPerformance(inv.suppliers, pos, inv.offers)} /> : null}
    </div>
  );
}

function Usage({ rows, item }: { rows: UsageRow[]; item: (id: string) => StockItem | undefined }) {
  const { L, lang, loc } = useT();
  const totalVar = rows.reduce((a, r) => a + r.varianceValue, 0);
  const totalTheo = rows.reduce((a, r) => a + r.theoreticalValue, 0);
  const cols: Column<UsageRow>[] = [
    { key: "i", header: L("الخامة", "Item"), cell: (r) => <span className="font-semibold">{loc(item(r.itemId)?.name)}</span> },
    { key: "t", header: L("نظري (وصفات)", "Theoretical"), align: "end", cell: (r) => { const x = item(r.itemId); return x ? <Qty qty={r.theoretical} item={x} /> : null; } },
    { key: "w", header: L("هالك", "Waste"), align: "end", hideOnMobile: true, cell: (r) => { const x = item(r.itemId); return x && r.waste + r.staffMeal ? <Qty qty={r.waste + r.staffMeal} item={x} /> : "—"; } },
    { key: "c", header: L("فرق جرد", "Count diff"), align: "end", hideOnMobile: true, cell: (r) => { const x = item(r.itemId); return x && r.countDiff ? <Qty qty={r.countDiff} item={x} className={r.countDiff < 0 ? "text-danger" : "text-ok"} /> : "—"; } },
    { key: "a", header: L("فعلي", "Actual"), align: "end", cell: (r) => { const x = item(r.itemId); return x ? <Qty qty={r.actual} item={x} className="font-semibold" /> : null; } },
    { key: "v", header: L("الفرق", "Variance"), align: "end", cell: (r) => (r.theoretical > 0 ? <Badge size="sm" tone={r.variance / r.theoretical > 0.05 ? "danger" : r.variance / r.theoretical > 0.02 ? "warn" : "ok"}>{pct(Math.round((r.variance * 10_000) / r.theoretical), lang)}</Badge> : "—") },
    { key: "vv", header: L("قيمة الفرق", "Variance value"), align: "end", hideOnMobile: true, cell: (r) => <Money value={-r.varianceValue} signed /> },
  ];
  return (
    <div className="grid gap-3">
      <p className="text-[13.5px] text-muted">
        {L("النظري = الوصفات × المبيعات. الفعلي = النظري + الهالك + وجبات الطاقم + فروق الجرد. الفرق اللي الوصفات مش بتفسره", "Theoretical = recipes × sales. Actual = theoretical + waste + staff meals + count differences. What recipes don't explain")}: <b className="text-danger">{formatMoney(-totalVar, { lang, whole: true, signed: true })}</b> ({totalTheo ? pct(Math.round((-totalVar * 10_000) / totalTheo), lang) : "—"})
      </p>
      <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-sf-sm">
        <Table dense columns={cols} rows={rows} rowKey={(r) => r.itemId} caption={L("الفعلي مقابل النظري", "Actual vs theoretical usage")} empty={<div className="p-6 text-center text-muted"><BarChart3 className="mx-auto mb-2 size-6" />{L("مفيش حركة في الفترة دي", "No movement in this period")}</div>} />
      </div>
    </div>
  );
}

function Suppliers({ rows }: { rows: SupplierScore[] }) {
  const { L, lang, loc } = useT();
  const inv = useInventory();
  const cols: Column<SupplierScore>[] = [
    { key: "n", header: L("المورد", "Supplier"), cell: (r) => <span className="font-semibold">{loc(inv.supplierById.get(r.supplierId)?.name)}</span> },
    { key: "o", header: L("طلبات", "Orders"), align: "end", cell: (r) => <span className="num">{r.orders}</span> },
    { key: "t", header: L("في الميعاد", "On time"), align: "end", cell: (r) => (r.delivered ? <Badge size="sm" tone={r.onTimeBp >= 9000 ? "ok" : r.onTimeBp >= 7000 ? "warn" : "danger"}>{pct(r.onTimeBp, lang, 0)}</Badge> : "—") },
    { key: "f", header: L("نسبة التوريد", "Fill rate"), align: "end", cell: (r) => (r.orders ? <span className="num">{pct(r.fillBp, lang, 0)}</span> : "—") },
    { key: "p", header: L("زيادات أسعار", "Price rises"), align: "end", cell: (r) => <span className="num">{r.priceRises}</span> },
    { key: "c", header: L("تغيّر السعر", "Price change"), align: "end", cell: (r) => (r.priceChangeBp ? <span className={`num ${r.priceChangeBp > 0 ? "text-danger" : "text-ok"}`}>{r.priceChangeBp > 0 ? "+" : ""}{pct(r.priceChangeBp, lang)}</span> : "—") },
  ];
  return (
    <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-sf-sm">
      <Table dense columns={cols} rows={[...rows].sort((a, b) => b.orders - a.orders)} rowKey={(r) => r.supplierId} caption={L("أداء الموردين", "Supplier performance")} />
    </div>
  );
}

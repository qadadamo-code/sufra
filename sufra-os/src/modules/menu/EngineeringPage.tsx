import { useMemo, useState } from "react";
import { LineChart } from "lucide-react";
import { useLive } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { Badge, Card, EmptyState, Segmented, Table, type Column } from "@/ui";
import { margin, netPrice } from "@/modules/inventory/costing";
import { defaultModifierIds, menuItemCost } from "@/modules/inventory/menuCost";
import { useInventory } from "@/modules/inventory/useInventory";
import { pct } from "@/modules/inventory/bits";
import { classify, ENG_LABEL, type EngClass, type EngRow } from "./engineering";

export default function EngineeringPage() {
  const { L, lang, loc } = useT();
  const inv = useInventory();
  const [days, setDays] = useState<"7" | "30">("7");
  const since = useMemo(() => new Date(Date.now() - Number(days) * 86_400_000).toISOString(), [days]);
  const items = useLive("menuItems", { where: { active: true } }).data;
  const mods = useLive("modifiers").data;
  const lines = useLive("orderItems", { gte: { createdAt: since } }).data;
  const tax = inv.settingsRow?.tax;
  const [only, setOnly] = useState<EngClass | null>(null);
  const result = useMemo(() => {
    const sold = new Map<string, number>();
    for (const l of lines) if (l.status !== "void") sold.set(l.itemId, (sold.get(l.itemId) ?? 0) + l.qty);
    const rows = items
      .filter((i) => i.restaurantId === inv.settingsRow?.restaurantId)
      .map((i) => {
        const cost = menuItemCost(i, inv.recipes, inv.costCtx, defaultModifierIds(i, mods)) ?? 0;
        const mg = margin(cost, netPrice(i.price, { inclusive: tax?.priceMode === "inclusive", vatBp: tax?.vatRate ?? 1400 }));
        return { id: i.id, qty: sold.get(i.id) ?? 0, contribution: mg.contribution, foodCostBp: mg.foodCostBp };
      });
    return { ...classify(rows), fc: new Map(rows.map((r) => [r.id, r.foodCostBp])) };
  }, [lines, items, mods, inv, tax]);
  const name = (id: string) => loc(items.find((i) => i.id === id)?.name);
  const rows = result.rows.filter((r) => !only || r.cls === only).sort((a, b) => b.totalContribution - a.totalContribution);
  const cols: Column<EngRow>[] = [
    { key: "n", header: L("الصنف", "Item"), cell: (r) => <span className="font-semibold">{name(r.id)}</span> },
    { key: "q", header: L("اتباع", "Sold"), align: "end", cell: (r) => <span className="num">{r.qty}</span> },
    { key: "mix", header: L("نسبة", "Mix"), align: "end", hideOnMobile: true, cell: (r) => <span className="num text-[13px]">{pct(r.mixBp, lang)}</span> },
    { key: "fc", header: L("تكلفة", "Food cost"), align: "end", hideOnMobile: true, cell: (r) => <span className="num text-[13px]">{pct(result.fc.get(r.id) ?? 0, lang, 0)}</span> },
    { key: "cm", header: L("مساهمة الحصة", "CM / portion"), align: "end", cell: (r) => <span className="num">{formatMoney(r.contribution, { lang, whole: true })}</span> },
    { key: "t", header: L("إجمالي المساهمة", "Total CM"), align: "end", hideOnMobile: true, cell: (r) => <span className="num font-semibold">{formatMoney(r.totalContribution, { lang, whole: true })}</span> },
    { key: "c", header: L("التصنيف", "Class"), align: "end", cell: (r) => <Badge size="sm" tone={ENG_LABEL[r.cls].tone}>{ENG_LABEL[r.cls][lang]}</Badge> },
  ];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13.5px] text-muted">{L("كل صنف حسب شعبيته (الكمية المباعة) ومساهمته (السعر الصافي − تكلفة الوصفة). الخط الفاصل للشعبية ٧٠٪ من النصيب المتساوي، وللمساهمة متوسط المنيو المرجّح.", "Each item by popularity (portions sold) and contribution (net price − recipe cost). Popularity cut = 70% of an equal share; contribution cut = the sales-weighted menu average.")}</p>
        <Segmented size="sm" label={L("الفترة", "Period")} value={days} onChange={setDays} options={[{ value: "7", label: L("٧ أيام", "7 days") }, { value: "30", label: L("٣٠ يوم", "30 days") }]} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(["star", "plowhorse", "puzzle", "dog"] as EngClass[]).map((c) => {
          const n = result.rows.filter((r) => r.cls === c).length;
          return (
            <button key={c} type="button" onClick={() => setOnly(only === c ? null : c)} className="text-start">
              <Card className={`h-full p-4 ${only === c ? "ring-2 ring-primary" : ""}`}>
                <div className="flex items-center justify-between"><Badge tone={ENG_LABEL[c].tone}>{ENG_LABEL[c][lang]}</Badge><span className="num font-display text-[24px] font-semibold">{n}</span></div>
                <p className="mt-2 text-[12.5px] text-muted">{ENG_LABEL[c].tip[lang]}</p>
              </Card>
            </button>
          );
        })}
      </div>
      <p className="text-[13px] text-muted">{L("متوسط المساهمة", "Average contribution")} <b className="num">{formatMoney(result.avgContribution, { lang, whole: true })}</b> · {L("حد الشعبية", "popularity cut")} <b className="num">{Math.round(result.popularityCut * 10) / 10}</b></p>
      <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-sf-sm">
        <Table dense columns={cols} rows={rows} rowKey={(r) => r.id} caption={L("هندسة المنيو", "Menu engineering")} empty={<EmptyState compact icon={<LineChart />} title={L("مفيش مبيعات في الفترة دي", "No sales in this period")} />} />
      </div>
    </div>
  );
}

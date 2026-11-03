import { useMemo, useState } from "react";
import { BookOpenCheck, Factory, Search } from "lucide-react";
import { useLive } from "@/data/hooks";
import type { MenuItem, Modifier, StockItem } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { matches } from "@/lib/arabic";
import { formatMoney } from "@/lib/money";
import { Badge, Button, Dialog, EmptyState, Input, Money, Segmented, Table, type Column } from "@/ui";
import { costTone, linesCost, margin, netPrice } from "./costing";
import { defaultModifierIds, menuItemCost } from "./menuCost";
import { RecipeEditor } from "./RecipeEditor";
import { ProduceDialog } from "./MovesPage";
import { pct } from "./bits";
import { useInventory } from "./useInventory";

type View = "menu" | "prep" | "modifiers";

export default function RecipesPage() {
  const { L, lang, loc } = useT();
  const inv = useInventory();
  const menu = useLive("menuItems", { where: { active: true }, orderBy: [{ field: "sort" }] }).data;
  const mods = useLive("modifiers", { orderBy: [{ field: "sort" }] }).data;
  const groups = useLive("modifierGroups").data;
  const tax = inv.settingsRow?.tax;
  const [view, setView] = useState<View>("menu");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<{ kind: "menu"; item: MenuItem } | { kind: "prep"; item: StockItem } | { kind: "mod"; item: Modifier } | null>(null);
  const [produce, setProduce] = useState<string | null>(null);
  const net = (p: number) => netPrice(p, { inclusive: tax?.priceMode === "inclusive", vatBp: tax?.vatRate ?? 1400 });

  const menuRows = useMemo(
    () =>
      menu
        .filter((m) => !q.trim() || matches(`${m.name.ar} ${m.name.en}`, q))
        .map((m) => {
          const cost = menuItemCost(m, inv.recipes, inv.costCtx, defaultModifierIds(m, mods));
          return { m, cost, mg: cost == null ? null : margin(cost, net(m.price)) };
        }),
    [menu, mods, inv, q], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const avgFc = (() => {
    const xs = menuRows.filter((r) => r.mg);
    return xs.length ? Math.round(xs.reduce((a, r) => a + r.mg!.foodCostBp, 0) / xs.length) : 0;
  })();
  const preps = inv.items.filter((i) => i.kind === "prep" && (!q.trim() || matches(`${i.name.ar} ${i.name.en}`, q)));
  const modRows = mods.filter((m) => !q.trim() || matches(`${m.name.ar} ${m.name.en}`, q));

  const menuCols: Column<(typeof menuRows)[number]>[] = [
    { key: "n", header: L("الصنف", "Item"), cell: (r) => <span className="font-semibold">{loc(r.m.name)}{r.m.comboOf?.length ? <Badge size="sm" className="ms-2">{L("كومبو", "combo")}</Badge> : null}</span> },
    { key: "p", header: L("السعر", "Price"), align: "end", cell: (r) => <Money value={r.m.price} whole /> },
    { key: "c", header: L("التكلفة", "Cost"), align: "end", cell: (r) => (r.cost == null ? <Badge size="sm" tone="warn">{L("مفيش وصفة", "no recipe")}</Badge> : <Money value={r.cost} />) },
    { key: "f", header: L("تكلفة الأكل", "Food cost"), align: "end", cell: (r) => (r.mg ? <Badge size="sm" tone={costTone(r.mg.foodCostBp)} dot>{pct(r.mg.foodCostBp, lang)}</Badge> : "—") },
    { key: "m", header: L("المساهمة", "Contribution"), align: "end", hideOnMobile: true, cell: (r) => (r.mg ? <Money value={r.mg.contribution} whole /> : "—") },
  ];
  const prepCols: Column<StockItem>[] = [
    { key: "n", header: L("التحضير", "Prep item"), cell: (p) => <span className="font-semibold">{loc(p.name)}</span> },
    { key: "y", header: L("التشغيلة", "Batch"), align: "end", cell: (p) => { const r = inv.recipeFor("prep", p.id); return r ? <span className="num text-[13px]">{new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-US").format(r.yieldQty / 1000)} {L("كجم", "kg")}</span> : "—"; } },
    { key: "c", header: L("تكلفة الكيلو", "Cost per kg"), align: "end", cell: (p) => { const r = inv.recipeFor("prep", p.id); return r ? <Money value={Math.round((linesCost(r.lines, inv.costCtx) / r.yieldQty) * 1000)} /> : "—"; } },
    { key: "a", header: "", align: "end", cell: (p) => <Button size="sm" variant="ghost" icon={<Factory className="size-4" />} onClick={(e) => { e.stopPropagation(); setProduce(p.id); }}>{L("اعمل", "Make")}</Button> },
  ];
  const modCols: Column<Modifier>[] = [
    { key: "n", header: L("الإضافة", "Modifier"), cell: (m) => <span className="font-semibold">{loc(m.name)} <span className="text-[12px] font-normal text-muted">· {loc(groups.find((g) => g.id === m.groupId)?.name)}</span></span> },
    { key: "p", header: L("السعر", "Price"), align: "end", cell: (m) => <Money value={m.price} whole /> },
    { key: "c", header: L("التكلفة", "Cost"), align: "end", cell: (m) => { const rs = inv.recipes.filter((r) => r.ownerType === "modifier" && r.ownerId === m.id); return rs.length ? <span className="num text-[13px]">{rs.map((r) => formatMoney(linesCost(r.lines, inv.costCtx), { lang })).join(" / ")}{rs.some((r) => r.scopeItemId) ? <Badge size="sm" className="ms-1.5">{L("حسب الصنف", "per item")}</Badge> : null}</span> : <span className="text-muted">—</span>; } },
  ];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Input wrapClassName="min-w-56 flex-1" icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("دوّر", "Search")} aria-label={L("بحث", "Search")} />
        <Segmented label={L("نوع الوصفة", "Recipe type")} value={view} onChange={setView} options={[{ value: "menu", label: L("أصناف المنيو", "Menu items") }, { value: "prep", label: L("تحضيرات", "Sub-recipes") }, { value: "modifiers", label: L("إضافات", "Modifiers") }]} />
      </div>
      {view === "menu" ? (
        <p className="text-[13.5px] text-muted">
          {L("متوسط تكلفة الأكل", "Average food cost")} <b className={avgFc > 3500 ? "text-danger" : "text-ok"}>{pct(avgFc, lang)}</b> · {L("التكلفة لحظية بمتوسط تكلفة المخزون وبتشمل الإضافات الافتراضية", "live at average stock cost, default modifiers included")}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-sf-sm">
        {view === "menu" ? <Table dense columns={menuCols} rows={menuRows} rowKey={(r) => r.m.id} onRowClick={(r) => setOpen({ kind: "menu", item: r.m })} caption={L("وصفات المنيو", "Menu recipes")} empty={<EmptyState compact icon={<BookOpenCheck />} title={L("مفيش أصناف", "No items")} />} /> : null}
        {view === "prep" ? <Table dense columns={prepCols} rows={preps} rowKey={(p) => p.id} onRowClick={(p) => setOpen({ kind: "prep", item: p })} caption={L("التحضيرات", "Sub-recipes")} /> : null}
        {view === "modifiers" ? <Table dense columns={modCols} rows={modRows} rowKey={(m) => m.id} onRowClick={(m) => setOpen({ kind: "mod", item: m })} caption={L("وصفات الإضافات", "Modifier recipes")} /> : null}
      </div>
      <Dialog open={!!open} onClose={() => setOpen(null)} size="lg" title={open ? loc(open.item.name) : ""} description={open?.kind === "prep" ? L("تحضير — بيتعمل بالتشغيلة ويتخزن", "Sub-recipe — made in batches and stocked") : open?.kind === "mod" ? L("الإضافة بتزوّد أو بتشيل مكونات", "A modifier adds or removes ingredients") : undefined}>
        {open?.kind === "menu" ? (
          open.item.comboOf?.length ? (
            <p className="pb-2 text-[14px] text-muted">{L("كومبو: بيخصم وصفة كل صنف جواه", "Combo: deducts each component's recipe")} — {open.item.comboOf.map((c) => `${c.qty}× ${loc(menu.find((m) => m.id === c.itemId)?.name)}`).join("، ")}</p>
          ) : (
            <RecipeEditor ownerType="menu_item" ownerId={open.item.id} price={net(open.item.price)} />
          )
        ) : null}
        {open?.kind === "prep" ? <RecipeEditor ownerType="prep" ownerId={open.item.id} /> : null}
        {open?.kind === "mod" ? <RecipeEditor ownerType="modifier" ownerId={open.item.id} compact /> : null}
      </Dialog>
      <ProduceDialog open={!!produce} onClose={() => setProduce(null)} prepId={produce ?? undefined} key={produce ?? "x"} />
    </div>
  );
}

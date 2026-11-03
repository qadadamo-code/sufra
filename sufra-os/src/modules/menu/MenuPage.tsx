import { lazy, Suspense, useMemo, useRef, useState, type DragEvent } from "react";
import { Route, Routes } from "react-router-dom";
import { ArrowDown, ArrowUp, BookOpen, Clock, GripVertical, Layers, LineChart, Pencil, Percent, Plus, Search, SlidersHorizontal, UtensilsCrossed } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { MenuCategory, MenuItem } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { matches } from "@/lib/arabic";
import { cn } from "@/lib/cn";
import { formatMoney, major } from "@/lib/money";
import { Badge, Button, Dialog, EmptyState, Input, Money, Segmented, Select, Skeleton, Switch, useToast } from "@/ui";
import { PageHeader } from "@/shell/PageHeader";
import { LocalizedInput, MoneyInput, RouteTabs } from "@/modules/marketing/ui";
import { costTone, margin, netPrice } from "@/modules/inventory/costing";
import { defaultModifierIds, menuItemCost } from "@/modules/inventory/menuCost";
import { useInventory } from "@/modules/inventory/useInventory";
import { pct } from "@/modules/inventory/bits";
import { bulkPrice, onSchedule, scheduleLabel } from "./rules";
import { ItemEditor } from "./ItemEditor";

const ModifiersPage = lazy(() => import("./ModifiersPage"));
const EngineeringPage = lazy(() => import("./EngineeringPage"));

export default function MenuPage() {
  const { L } = useT();
  return (
    <div className="grid gap-5">
      <PageHeader icon={<BookOpen />} title={L("المنيو", "Menu")} subtitle={L("أي تعديل بيوصل الكاشير والجرسون ومنيو الـ QR والأونلاين في نفس اللحظة", "Every change reaches the POS, waiters, QR and online menus instantly")} />
      <RouteTabs
        label={L("أقسام المنيو", "Menu sections")}
        items={[
          { to: "/menu", end: true, label: L("الأصناف", "Items"), icon: <UtensilsCrossed /> },
          { to: "/menu/modifiers", label: L("الإضافات", "Modifiers"), icon: <SlidersHorizontal /> },
          { to: "/menu/engineering", label: L("هندسة المنيو", "Menu engineering"), icon: <LineChart /> },
        ]}
      />
      <Suspense fallback={<Skeleton className="h-96" rounded="rounded-[20px]" />}>
        <Routes>
          <Route index element={<ItemsView />} />
          <Route path="modifiers" element={<ModifiersPage />} />
          <Route path="engineering" element={<EngineeringPage />} />
        </Routes>
      </Suspense>
    </div>
  );
}

/** Drag-to-reorder for a list; also exposes move(i, ±1) for keyboard/touch buttons. Persists `sort` 1..n. */
function useReorder<T extends { id: string }>(rows: T[], persist: (ordered: T[]) => Promise<void>) {
  const drag = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length || from === to) return;
    const next = [...rows];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    void persist(next);
  };
  const props = (i: number) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      drag.current = i;
      e.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setOver(i);
    },
    onDragLeave: () => setOver((o) => (o === i ? null : o)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (drag.current != null) move(drag.current, i);
      drag.current = null;
      setOver(null);
    },
    onDragEnd: () => setOver(null),
  });
  return { props, move, over };
}

function ItemsView() {
  const { L, lang, loc } = useT();
  const { can } = useSession();
  const db = useDb();
  const { toast } = useToast();
  const inv = useInventory();
  const cats = useLive("menuCategories", { orderBy: [{ field: "sort" }] }).data;
  const items = useLive("menuItems", { orderBy: [{ field: "sort" }] }).data;
  const mods = useLive("modifiers").data;
  const stations = useLive("kitchenStations").data;
  const [catId, setCatId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<MenuItem | "new" | null>(null);
  const [catEdit, setCatEdit] = useState<MenuCategory | "new" | null>(null);
  const [bulk, setBulk] = useState(false);
  const editable = can("menu.edit");
  const tax = inv.settingsRow?.tax;
  const active = catId ?? cats[0]?.id ?? null;
  const list = useMemo(() => (q.trim() ? items.filter((i) => matches(`${i.name.ar} ${i.name.en} ${i.sku ?? ""}`, q)) : items.filter((i) => i.categoryId === active)), [items, q, active]);
  const catDrag = useReorder(cats, async (ordered) => {
    await Promise.all(ordered.map((c, i) => (c.sort !== i + 1 ? db.update("menuCategories", c.id, { sort: i + 1 }) : null)));
  });
  const itemDrag = useReorder(list, async (ordered) => {
    await Promise.all(ordered.map((it, i) => (it.sort !== i + 1 ? db.update("menuItems", it.id, { sort: i + 1 }) : null)));
  });
  const costOf = (it: MenuItem) => {
    const c = menuItemCost(it, inv.recipes, inv.costCtx, defaultModifierIds(it, mods));
    return c == null ? null : margin(c, netPrice(it.price, { inclusive: tax?.priceMode === "inclusive", vatBp: tax?.vatRate ?? 1400 }));
  };
  const toggle86 = async (it: MenuItem) => {
    await db.update("menuItems", it.id, { available: !it.available });
    await db.audit(it.available ? "menu.86" : "menu.un86", "menuItems", it.id, { item: it.name.en });
    toast({ title: it.available ? L(`${it.name.ar} خلص (86)`, `${it.name.en} 86'd`) : L(`${it.name.ar} رجع`, `${it.name.en} is back`), tone: it.available ? "warn" : "success", duration: 1800 });
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="min-w-0">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar lg:mx-0 lg:grid lg:overflow-visible lg:px-0" role="listbox" aria-label={L("الأقسام", "Categories")}>
          {cats.map((c, i) => {
            const n = items.filter((x) => x.categoryId === c.id).length;
            return (
              <div key={c.id} {...(editable ? catDrag.props(i) : {})} className={cn("group flex shrink-0 items-center gap-1 rounded-2xl border px-2 transition-colors lg:shrink", c.id === active && !q ? "border-primary bg-primary-soft" : "border-line bg-surface hover:bg-surface-2", catDrag.over === i && "ring-2 ring-primary")}>
                {editable ? <GripVertical className="hidden size-4 shrink-0 cursor-grab text-faint lg:block" aria-hidden /> : null}
                <button type="button" role="option" aria-selected={c.id === active} onClick={() => { setCatId(c.id); setQ(""); }} className="flex h-11 min-w-0 flex-1 items-center gap-2 px-1 text-start">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                  <span className={cn("truncate text-[14px] font-semibold", !c.active && "text-muted line-through")}>{loc(c.name)}</span>
                  <span className="num ms-auto text-[12px] text-muted">{n}</span>
                </button>
                {editable ? (
                  <span className="hidden gap-0.5 group-hover:flex lg:flex">
                    <button type="button" aria-label={L("لفوق", "Up")} className="grid size-7 place-items-center rounded-lg text-muted hover:bg-surface-3" onClick={() => catDrag.move(i, i - 1)}><ArrowUp className="size-3.5" /></button>
                    <button type="button" aria-label={L("لتحت", "Down")} className="grid size-7 place-items-center rounded-lg text-muted hover:bg-surface-3" onClick={() => catDrag.move(i, i + 1)}><ArrowDown className="size-3.5" /></button>
                    <button type="button" aria-label={L("تعديل", "Edit")} className="grid size-7 place-items-center rounded-lg text-muted hover:bg-surface-3" onClick={() => setCatEdit(c)}><Pencil className="size-3.5" /></button>
                  </span>
                ) : null}
              </div>
            );
          })}
          {editable ? <Button variant="ghost" size="sm" icon={<Plus className="size-4" />} onClick={() => setCatEdit("new")} className="shrink-0">{L("قسم", "Category")}</Button> : null}
        </div>
      </aside>

      <section className="grid min-w-0 content-start gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <Input wrapClassName="min-w-52 flex-1" icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("دوّر في كل المنيو", "Search the whole menu")} aria-label={L("بحث", "Search")} />
          {editable && sel.size ? <Button variant="brass" icon={<Percent className="size-4" />} onClick={() => setBulk(true)}>{L(`غيّر أسعار ${sel.size}`, `Reprice ${sel.size}`)}</Button> : null}
          {editable ? <Button variant="secondary" onClick={() => setSel(sel.size ? new Set() : new Set(list.map((i) => i.id)))}>{sel.size ? L("إلغاء التحديد", "Clear") : L("حدد الكل", "Select all")}</Button> : null}
          {editable ? <Button icon={<Plus className="size-4" />} onClick={() => setEdit("new")}>{L("صنف جديد", "New item")}</Button> : null}
        </div>
        {list.length ? (
          <ul className="grid gap-2">
            {list.map((it, i) => {
              const m = costOf(it);
              const st = stations.find((s) => s.id === (it.stationId ?? cats.find((c) => c.id === it.categoryId)?.stationId));
              const off = !onSchedule(it);
              return (
                <li key={it.id} {...(editable && !q ? itemDrag.props(i) : {})} className={cn("flex items-center gap-3 rounded-2xl border border-line bg-surface p-2.5 shadow-sf-sm", itemDrag.over === i && "ring-2 ring-primary", !it.active && "opacity-60")}>
                  {editable ? (
                    <input type="checkbox" className="size-5 shrink-0 accent-[var(--sf-primary)]" aria-label={loc(it.name)} checked={sel.has(it.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(it.id)) n.delete(it.id); else n.add(it.id); return n; })} />
                  ) : null}
                  {editable && !q ? <GripVertical className="hidden size-4 shrink-0 cursor-grab text-faint md:block" aria-hidden /> : null}
                  <button type="button" onClick={() => setEdit(it)} className="flex min-w-0 flex-1 items-center gap-3 text-start">
                    <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-2 text-faint">{it.imageUrl ? <img src={it.imageUrl} alt="" className="size-full object-cover" /> : <UtensilsCrossed className="size-5" />}</span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-semibold">{loc(it.name)}</span>
                        {it.comboOf?.length ? <Badge size="sm" tone="info"><Layers className="size-3" />{L("كومبو", "combo")}</Badge> : null}
                        {it.schedule?.length ? <Badge size="sm" tone={off ? "warn" : "neutral"}><Clock className="size-3" />{scheduleLabel(it.schedule, lang)}</Badge> : null}
                      </span>
                      <span className="block truncate text-[12.5px] text-muted">{st ? loc(st.name) : ""} · {it.prepMinutes} {L("د", "min")}{it.calories ? ` · ${it.calories} kcal` : ""}{it.allergens?.length ? ` · ${it.allergens.join(", ")}` : ""}</span>
                    </span>
                  </button>
                  {m ? <Badge size="sm" tone={costTone(m.foodCostBp)} className="hidden sm:inline-flex">{pct(m.foodCostBp, lang, 0)}</Badge> : null}
                  <Money value={it.price} whole className="w-20 shrink-0 text-end font-semibold" />
                  {can("menu.availability") ? (
                    <button type="button" onClick={() => toggle86(it)} aria-pressed={!it.available} className={cn("h-9 shrink-0 rounded-full px-3 text-[12.5px] font-bold", it.available ? "bg-ok-soft text-ok" : "bg-danger text-white")}>
                      {it.available ? L("متاح", "On") : "86"}
                    </button>
                  ) : null}
                  {editable && !q ? (
                    <span className="hidden flex-col md:flex">
                      <button type="button" aria-label={L("لفوق", "Up")} className="grid size-6 place-items-center rounded text-muted hover:bg-surface-3" onClick={() => itemDrag.move(i, i - 1)}><ArrowUp className="size-3.5" /></button>
                      <button type="button" aria-label={L("لتحت", "Down")} className="grid size-6 place-items-center rounded text-muted hover:bg-surface-3" onClick={() => itemDrag.move(i, i + 1)}><ArrowDown className="size-3.5" /></button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={<UtensilsCrossed />} title={L("مفيش أصناف هنا", "No items here")} />
        )}
      </section>

      {edit ? <ItemEditor item={edit === "new" ? null : edit} categoryId={active} onClose={() => setEdit(null)} /> : null}
      {catEdit ? <CategoryDialog cat={catEdit === "new" ? null : catEdit} sort={cats.length + 1} onClose={() => setCatEdit(null)} /> : null}
      {bulk ? <BulkPriceDialog items={items.filter((i) => sel.has(i.id))} onClose={() => setBulk(false)} onDone={() => setSel(new Set())} /> : null}
    </div>
  );
}

function CategoryDialog({ cat, sort, onClose }: { cat: MenuCategory | null; sort: number; onClose: () => void }) {
  const { L, loc } = useT();
  const db = useDb();
  const stations = useLive("kitchenStations").data;
  const [name, setName] = useState(cat?.name ?? { ar: "", en: "" });
  const [stationId, setStation] = useState(cat?.stationId ?? stations[0]?.id ?? "");
  const [color, setColor] = useState(cat?.color ?? "#0d5a53");
  const [active, setActive] = useState(cat?.active ?? true);
  return (
    <Dialog open onClose={onClose} title={cat ? L("تعديل القسم", "Edit category") : L("قسم جديد", "New category")} footer={
      <Button block size="lg" disabled={!(name.ar || name.en)} onClick={async () => {
        const row = { name: { ar: name.ar || name.en, en: name.en || name.ar }, stationId: stationId || null, color, active };
        if (cat) await db.update("menuCategories", cat.id, row);
        else await db.insert("menuCategories", { ...row, sort, icon: "utensils" });
        onClose();
      }}>{L("احفظ", "Save")}</Button>
    }>
      <div className="grid gap-3 pb-1">
        <LocalizedInput label={L("الاسم", "Name")} value={name} onChange={setName} />
        <Select label={L("المحطة في المطبخ", "Kitchen station")} value={stationId} onChange={(e) => setStation(e.target.value)} options={stations.map((s) => ({ value: s.id, label: loc(s.name) }))} />
        <Input label={L("اللون", "Colour")} type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-11 p-1" />
        <Switch checked={active} onChange={setActive} label={L("ظاهر", "Visible")} />
      </div>
    </Dialog>
  );
}

function BulkPriceDialog({ items, onClose, onDone }: { items: MenuItem[]; onClose: () => void; onDone: () => void }) {
  const { L, lang, loc } = useT();
  const db = useDb();
  const { toast } = useToast();
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const [pctV, setPct] = useState(10);
  const [amount, setAmount] = useState(major(10));
  const [round, setRound] = useState("5");
  const [busy, setBusy] = useState(false);
  const change = kind === "percent" ? { kind, value: pctV } : { kind, value: amount };
  const rows = items.map((it) => ({ it, next: bulkPrice(it.price, change, major(Number(round))) }));
  const delta = rows.reduce((a, r) => a + r.next - r.it.price, 0);
  return (
    <Dialog open onClose={onClose} size="lg" title={L("تغيير أسعار بالجملة", "Bulk price change")} description={L("راجع قبل ما تطبّق — التغيير بيوصل كل القنوات في نفس اللحظة", "Preview before applying — it reaches every channel instantly")} footer={
      <Button block size="lg" loading={busy} onClick={async () => {
        setBusy(true);
        try {
          for (const r of rows) if (r.next !== r.it.price) await db.update("menuItems", r.it.id, { price: r.next });
          await db.audit("menu.bulk_price", "menuItems", null, { items: rows.length, change });
          toast({ title: L(`اتغيّر سعر ${rows.length} صنف`, `${rows.length} prices updated`), tone: "success" });
          onDone();
          onClose();
        } finally {
          setBusy(false);
        }
      }}>{L("طبّق", "Apply")}</Button>
    }>
      <div className="grid gap-4 pb-1">
        <Segmented block label={L("نوع التغيير", "Change")} value={kind} onChange={setKind} options={[{ value: "percent", label: L("نسبة ٪", "Percent %") }, { value: "amount", label: L("مبلغ", "Amount") }]} />
        <div className="grid gap-3 sm:grid-cols-2">
          {kind === "percent" ? <Input label={L("النسبة (سالب = تخفيض)", "Percent (negative = lower)")} type="number" className="num" value={pctV} onChange={(e) => setPct(Number(e.target.value) || 0)} end={<span className="px-3 text-muted">%</span>} /> : <MoneyInput label={L("المبلغ", "Amount")} value={amount} onChange={setAmount} />}
          <Select label={L("تقريب لأقرب", "Round to")} value={round} onChange={(e) => setRound(e.target.value)} options={[{ value: "1", label: L("جنيه", "1 EGP") }, { value: "5", label: L("٥ جنيه", "5 EGP") }, { value: "10", label: L("١٠ جنيه", "10 EGP") }]} />
        </div>
        <ul className="grid max-h-[40vh] gap-1 overflow-y-auto thin-scrollbar">
          {rows.map((r) => (
            <li key={r.it.id} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2 text-[14px]">
              <span className="truncate">{loc(r.it.name)}</span>
              <span className="num shrink-0"><span className="text-muted line-through">{formatMoney(r.it.price, { lang, whole: true })}</span> → <b className={r.next > r.it.price ? "text-ok" : r.next < r.it.price ? "text-danger" : ""}>{formatMoney(r.next, { lang, whole: true })}</b></span>
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-muted">{L("الفرق على كل الأصناف المختارة (لكل صنف مرة)", "Total change across the selected items (one of each)")}: <b>{formatMoney(delta, { lang, whole: true, signed: true })}</b></p>
      </div>
    </Dialog>
  );
}

import { useMemo, useState } from "react";
import { Boxes, Plus, Search, Star, Trash2 } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { BaseUnit, PackUnit, StockCategory, StockItem, SupplierItem } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { matches } from "@/lib/arabic";
import { formatMoney, major } from "@/lib/money";
import { ago } from "@/lib/time";
import { Badge, Button, Dialog, EmptyState, Input, Money, Select, Switch, Table, Tabs, useToast, type Column } from "@/ui";
import { LocalizedInput, MoneyInput } from "@/modules/marketing/ui";
import { CATEGORY_LABEL, MOVE_LABEL, MOVE_TONE, Qty, QtyInput, stockState } from "./bits";
import { avgCost } from "./costing";
import { BASE_NAME, formatQty, q3 } from "./units";
import { useInventory } from "./useInventory";
import { WasteDialog } from "./MovesPage";

type Row = { item: StockItem; qty: number; value: number; avg: number; state: ReturnType<typeof stockState> };

export default function ItemsPage() {
  const { L, lang, loc } = useT();
  const { can } = useSession();
  const inv = useInventory();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<StockCategory | "all" | "low">("all");
  const [open, setOpen] = useState<StockItem | "new" | null>(null);
  const rows = useMemo<Row[]>(() => {
    return inv.items
      .filter((i) => (cat === "all" || cat === "low" || i.category === cat) && (!q.trim() || matches(`${i.name.ar} ${i.name.en} ${i.sku}`, q)))
      .map((item) => {
        const p = inv.onHand.get(item.id) ?? { qty: 0, value: 0 };
        return { item, qty: p.qty, value: p.value, avg: avgCost(p) ?? item.lastCost, state: stockState(p.qty, inv.levelsFor(item)) };
      })
      .filter((r) => cat !== "low" || r.state.tone === "warn" || r.state.tone === "danger");
  }, [inv, q, cat]);
  const cats = [...new Set(inv.items.map((i) => i.category))];
  const unitLabel = (it: StockItem) => (it.baseUnit === "g" ? L("كجم", "kg") : it.baseUnit === "ml" ? L("لتر", "L") : L("قطعة", "pc"));
  const perUnit = (it: StockItem, cost: number) => (it.baseUnit === "pc" ? cost : cost * 1000);
  const cols: Column<Row>[] = [
    {
      key: "name", header: L("الخامة", "Item"), cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-semibold">{loc(r.item.name)}</p>
          <p className="truncate text-[12px] text-muted">{CATEGORY_LABEL[r.item.category][lang]}{r.item.kind === "prep" ? ` · ${L("تحضير", "prep")}` : ""}{r.item.trackBatches ? ` · ${L("بالتشغيلة", "batch-tracked")}` : ""}</p>
        </div>
      ),
    },
    { key: "qty", header: L("الموجود", "On hand"), align: "end", cell: (r) => <Qty qty={r.qty} item={r.item} className="font-semibold" /> },
    { key: "par", header: L("الحد / الـ par", "Min / par"), align: "end", hideOnMobile: true, cell: (r) => { const lv = inv.levelsFor(r.item); return <span className="num text-[13px] text-muted">{formatQty(lv.min, r.item, lang)} / {formatQty(lv.par, r.item, lang)}</span>; } },
    { key: "avg", header: L("متوسط التكلفة", "Avg cost"), align: "end", hideOnMobile: true, cell: (r) => <span className="num text-[13px]">{formatMoney(perUnit(r.item, r.avg), { lang })} / {unitLabel(r.item)}</span> },
    { key: "value", header: L("القيمة", "Value"), align: "end", hideOnMobile: true, cell: (r) => <Money value={r.value} whole /> },
    { key: "st", header: L("الحالة", "Status"), align: "end", cell: (r) => <Badge size="sm" tone={r.state.tone} dot>{r.state[lang]}</Badge> },
  ];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Input wrapClassName="min-w-56 flex-1" icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("دوّر باسم الخامة أو الكود", "Search name or SKU")} aria-label={L("بحث", "Search")} />
        <Select aria-label={L("القسم", "Category")} value={cat} onChange={(e) => setCat(e.target.value as typeof cat)} options={[{ value: "all", label: L("كل الأقسام", "All categories") }, { value: "low", label: L("القليل والخلصان", "Low & out") }, ...cats.map((c) => ({ value: c, label: CATEGORY_LABEL[c][lang] }))]} />
        {can("inventory.manage") ? <Button icon={<Plus className="size-4" />} onClick={() => setOpen("new")}>{L("خامة جديدة", "New item")}</Button> : null}
      </div>
      <p className="text-[13px] text-muted">
        {rows.length} {L("خامة", "items")} · {L("القيمة", "value")} {formatMoney(rows.reduce((a, r) => a + Math.max(0, r.value), 0), { lang, whole: true })}
      </p>
      <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-sf-sm">
        <Table dense columns={cols} rows={rows} rowKey={(r) => r.item.id} onRowClick={(r) => setOpen(r.item)} caption={L("الخامات", "Stock items")} empty={<EmptyState compact icon={<Boxes />} title={L("مفيش خامات", "No items")} />} />
      </div>
      {open ? <ItemSheet item={open === "new" ? null : open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

const blank = (): Omit<StockItem, "id" | "createdAt" | "updatedAt" | "restaurantId"> => ({
  name: { ar: "", en: "" }, sku: "", category: "dry", kind: "raw", baseUnit: "g", packs: [], countUnit: "g", account: "food", levels: { min: 0, par: 0, max: 0 }, branchLevels: {},
  supplierIds: [], preferredSupplierId: null, lastCost: 0, defaultLocationIds: [], trackBatches: false, shelfLifeDays: null, vatBp: 0, yieldBp: 10_000, allergens: [], active: true, note: "", marketKey: null,
});

export function ItemSheet({ item, onClose }: { item: StockItem | null; onClose: () => void }) {
  const { L, lang, loc } = useT();
  const { can } = useSession();
  const db = useDb();
  const { toast } = useToast();
  const inv = useInventory();
  const [tab, setTab] = useState<"stock" | "setup" | "suppliers" | "history">(item ? "stock" : "setup");
  const [d, setD] = useState(() => (item ? { ...item } : { ...blank() }));
  const [waste, setWaste] = useState(false);
  const [busy, setBusy] = useState(false);
  const editable = can("inventory.manage");
  const moves = useLive("stockMoves", { where: { itemId: item?.id ?? "-" }, orderBy: [{ field: "at", dir: "desc" }], limit: 40 }, { enabled: !!item }).data;
  const offers = inv.offers.filter((o) => item && o.itemId === item.id);
  const levels = inv.allLevels.filter((l) => item && l.itemId === item.id);
  const lv = d.levels;
  const save = async () => {
    if (!d.name.ar.trim() && !d.name.en.trim()) return;
    setBusy(true);
    try {
      const row = { ...d, name: { ar: d.name.ar || d.name.en, en: d.name.en || d.name.ar }, sku: d.sku || (d.name.en || d.name.ar).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) };
      if (item) {
        const { id: _i, createdAt: _c, updatedAt: _u, restaurantId: _r, ...patch } = row as StockItem;
        await db.update("stockItems", item.id, patch);
      } else await db.insert("stockItems", row);
      toast({ title: L("اتحفظ", "Saved"), tone: "success" });
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      variant="sheet-end"
      title={item ? loc(item.name) : L("خامة جديدة", "New stock item")}
      description={item ? `${CATEGORY_LABEL[item.category][lang]} · ${item.sku}` : undefined}
      footer={editable && (tab === "setup" || !item) ? <Button block size="lg" loading={busy} onClick={save}>{L("احفظ", "Save")}</Button> : undefined}
    >
      <div className="grid gap-4 pb-2">
        {item ? (
          <Tabs
            label={L("أقسام الخامة", "Item sections")}
            value={tab}
            onChange={setTab}
            items={[
              { value: "stock", label: L("المخزون", "Stock") },
              { value: "setup", label: L("الإعداد", "Setup") },
              { value: "suppliers", label: L("الموردين", "Suppliers"), count: offers.length },
              { value: "history", label: L("الحركة", "History") },
            ]}
          />
        ) : null}

        {item && tab === "stock" ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                [L("الموجود", "On hand"), <Qty key="q" qty={inv.onHand.get(item.id)?.qty ?? 0} item={item} />],
                [L("متوسط التكلفة", "Avg cost"), formatMoney(inv.unitCost(item.id) * (item.baseUnit === "pc" ? 1 : 1000), { lang }) + (item.baseUnit === "pc" ? "" : item.baseUnit === "g" ? L("/كجم", "/kg") : L("/لتر", "/L"))],
                [L("آخر سعر شراء", "Last cost"), formatMoney(item.lastCost * (item.baseUnit === "pc" ? 1 : 1000), { lang })],
              ].map(([k, v], i) => (
                <div key={i} className="rounded-2xl border border-line bg-surface-2/60 p-3">
                  <p className="text-[12px] text-muted">{k}</p>
                  <p className="mt-1 text-[16px] font-semibold">{v}</p>
                </div>
              ))}
            </div>
            <ul className="grid gap-1.5">
              {levels.map((l) => (
                <li key={l.id} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-[14px]">
                  <span>{loc(inv.locationById.get(l.locationId)?.name)}</span>
                  <span className="flex items-center gap-3"><Qty qty={l.qty} item={item} className="font-semibold" /><Money value={l.value} whole className="text-[12.5px] text-muted" /></span>
                </li>
              ))}
            </ul>
            {item.trackBatches ? (
              <div>
                <p className="mb-1.5 text-[13px] font-semibold text-ink-2">{L("التشغيلات", "Batches")}</p>
                <ul className="grid gap-1 text-[13px]">
                  {inv.batches.filter((b) => b.itemId === item.id).slice(-5).reverse().map((b) => (
                    <li key={b.id} className="flex justify-between rounded-lg bg-surface-2 px-3 py-1.5"><span className="num">{b.lot}</span><span>{L("تنتهي", "expires")} {b.expiresOn ?? "—"}</span></li>
                  ))}
                </ul>
              </div>
            ) : null}
            {can("inventory.count") ? <Button variant="danger-soft" icon={<Trash2 className="size-4" />} onClick={() => setWaste(true)}>{L("سجّل هالك", "Record waste")}</Button> : null}
          </div>
        ) : null}

        {tab === "setup" || !item ? (
          <fieldset disabled={!editable} className="grid gap-4">
            <LocalizedInput label={L("الاسم", "Name")} value={d.name} onChange={(name) => setD({ ...d, name })} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label={L("الكود", "SKU")} value={d.sku} onChange={(e) => setD({ ...d, sku: e.target.value.toUpperCase() })} dir="ltr" />
              <Select label={L("القسم", "Category")} value={d.category} onChange={(e) => setD({ ...d, category: e.target.value as StockCategory, kind: e.target.value === "prep" ? "prep" : "raw" })} options={(Object.keys(CATEGORY_LABEL) as StockCategory[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c][lang] }))} />
              <Select label={L("الوحدة الأساسية", "Base unit")} disabled={!!item} value={d.baseUnit} onChange={(e) => setD({ ...d, baseUnit: e.target.value as BaseUnit, countUnit: e.target.value })} options={(["g", "ml", "pc"] as BaseUnit[]).map((u) => ({ value: u, label: BASE_NAME[u][lang] }))} />
            </div>
            <PacksEditor packs={d.packs} base={d.baseUnit} onChange={(packs) => setD({ ...d, packs })} />
            <div className="grid gap-3 sm:grid-cols-3">
              <QtyInput item={d} value={lv.min} onChange={(min) => setD({ ...d, levels: { ...lv, min } })} label={L("حد الطلب (min)", "Reorder point (min)")} />
              <QtyInput item={d} value={lv.par} onChange={(par) => setD({ ...d, levels: { ...lv, par } })} label={L("المستوى الطبيعي (par)", "Par level")} />
              <QtyInput item={d} value={lv.max} onChange={(max) => setD({ ...d, levels: { ...lv, max } })} label={L("الحد الأقصى", "Max")} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select label={L("مكانه", "Home location")} value={d.defaultLocationIds[0] ?? ""} onChange={(e) => setD({ ...d, defaultLocationIds: e.target.value ? [e.target.value, ...d.defaultLocationIds.filter((x) => x !== e.target.value && !inv.locations.some((l) => l.id === x))] : [] })} options={[{ value: "", label: "—" }, ...inv.locations.map((l) => ({ value: l.id, label: loc(l.name) }))]} />
              <Select label={L("الحساب", "Account")} value={d.account} onChange={(e) => setD({ ...d, account: e.target.value as StockItem["account"] })} options={[{ value: "food", label: L("طعام ١٣٠١", "Food 1301") }, { value: "beverage", label: L("مشروبات ١٣٠٢", "Beverage 1302") }, { value: "packaging", label: L("تغليف ١٣٠٣", "Packaging 1303") }]} />
              <Select label={L("ضريبة الشراء", "Purchase VAT")} value={String(d.vatBp)} onChange={(e) => setD({ ...d, vatBp: Number(e.target.value) })} options={[{ value: "0", label: L("معفي ٠٪", "Exempt 0%") }, { value: "1400", label: "14%" }]} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={L("نسبة الصافي بعد التنضيف ٪", "Usable yield %")} hint={L("فرخة كاملة ← ٧٢٪ لحم صافي: الوصفة بتكتب الصافي والتكلفة بتتحسب على الكل", "Whole chicken → 72% meat: recipes state the trimmed weight, cost is grossed up")} type="number" className="num" min={1} max={100} value={d.yieldBp / 100} onChange={(e) => setD({ ...d, yieldBp: Math.min(10_000, Math.max(100, Math.round(Number(e.target.value) * 100) || 10_000)) })} />
              <MoneyInput label={L("آخر سعر شراء لكل وحدة أساسية", "Last cost per base unit")} value={d.lastCost} onChange={(lastCost) => setD({ ...d, lastCost })} hint={`${L("لكل", "per")} ${BASE_NAME[d.baseUnit][lang]}`} />
            </div>
            <Switch checked={d.trackBatches} onChange={(trackBatches) => setD({ ...d, trackBatches, shelfLifeDays: trackBatches ? (d.shelfLifeDays ?? 5) : null })} label={L("تتبع التشغيلة والصلاحية", "Track batches & expiry")} description={L("للألبان واللحوم: كل استلام بتشغيلة وتاريخ انتهاء", "For dairy and meat: every receipt gets a lot and an expiry date")} />
            {d.trackBatches ? <Input label={L("مدة الصلاحية (يوم)", "Shelf life (days)")} type="number" className="num" value={d.shelfLifeDays ?? 0} onChange={(e) => setD({ ...d, shelfLifeDays: Math.max(0, Number(e.target.value) || 0) })} /> : null}
            <Input label={L("مسببات الحساسية (مفصولة بفاصلة)", "Allergens (comma separated)")} value={d.allergens.join(", ")} onChange={(e) => setD({ ...d, allergens: e.target.value.split(/[,،]/).map((x) => x.trim()).filter(Boolean) })} />
            <Switch checked={d.active} onChange={(active) => setD({ ...d, active })} label={L("مستخدمة", "Active")} />
          </fieldset>
        ) : null}

        {item && tab === "suppliers" ? <OffersEditor item={item} offers={offers} /> : null}

        {item && tab === "history" ? (
          <ul className="grid gap-1.5">
            {moves.map((m) => (
              <li key={m.id} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2 text-[13.5px]">
                <Badge size="sm" tone={MOVE_TONE[m.kind] ?? "neutral"}>{MOVE_LABEL[m.kind][lang]}</Badge>
                <span className="flex-1 truncate text-muted">{m.note || ago(m.at, lang)}</span>
                <Qty qty={m.qty} item={item} className={m.qty > 0 ? "text-ok" : ""} />
              </li>
            ))}
            {!moves.length ? <EmptyState compact title={L("مفيش حركة", "No movements")} /> : null}
          </ul>
        ) : null}
      </div>
      {item ? <WasteDialog open={waste} onClose={() => setWaste(false)} itemId={item.id} /> : null}
    </Dialog>
  );
}

function PacksEditor({ packs, base, onChange }: { packs: PackUnit[]; base: BaseUnit; onChange: (p: PackUnit[]) => void }) {
  const { L, lang } = useT();
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-[13px] font-semibold text-ink-2">{L("وحدات الشراء والجرد", "Purchase & count units")}</legend>
      {packs.map((p, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <input aria-label={L("الاسم", "Name")} className="h-10 min-w-36 flex-1 rounded-xl border border-line bg-surface px-3" value={p.name[lang]} onChange={(e) => onChange(packs.map((x, j) => (j === i ? { ...x, name: { ...x.name, [lang]: e.target.value } } : x)))} />
          <span className="text-[13px] text-muted">=</span>
          <input aria-label={L("كام وحدة", "Factor")} inputMode="decimal" className="num h-10 w-28 rounded-xl border border-line bg-surface px-3" value={p.factor} onChange={(e) => onChange(packs.map((x, j) => (j === i ? { ...x, factor: q3(Math.max(0, Number(e.target.value) || 0)) } : x)))} />
          <span className="text-[13px] text-muted">{BASE_NAME[base][lang]}</span>
          <button type="button" aria-label={L("شيل", "Remove")} onClick={() => onChange(packs.filter((_, j) => j !== i))} className="grid size-10 place-items-center rounded-xl text-danger hover:bg-danger-soft"><Trash2 className="size-4" /></button>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => onChange([...packs, { id: `pack${packs.length + 1}`, name: { ar: "كرتونة", en: "carton" }, factor: base === "pc" ? 24 : 1000 }])}>
        {L("أضف وحدة (كرتونة = ٢٤ قطعة …)", "Add a unit (carton = 24 pcs …)")}
      </Button>
    </fieldset>
  );
}

function OffersEditor({ item, offers }: { item: StockItem; offers: SupplierItem[] }) {
  const { L, lang, loc } = useT();
  const db = useDb();
  const inv = useInventory();
  const [add, setAdd] = useState({ supplierId: "", packName: "", factor: item.packs[0]?.factor ?? 1000, price: 0 });
  const best = Math.min(...offers.map((o) => o.price / o.packFactor));
  return (
    <div className="grid gap-3">
      <ul className="grid gap-2">
        {offers.map((o) => {
          const s = inv.supplierById.get(o.supplierId);
          const per = o.price / o.packFactor;
          return (
            <li key={o.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{loc(s?.name)} {item.preferredSupplierId === o.supplierId ? <Star className="inline size-4 fill-brass text-brass" /> : null}</p>
                <p className="text-[12.5px] text-muted">{loc(o.packName)} · {formatMoney(o.price, { lang })} {o.history.length > 1 ? `· ${L("كان", "was")} ${formatMoney(o.history[o.history.length - 2].price, { lang })}` : ""}</p>
              </div>
              <span className="num text-[13px]">{formatMoney(Math.round(per * (item.baseUnit === "pc" ? 1 : 1000)), { lang })}/{item.baseUnit === "pc" ? L("قطعة", "pc") : item.baseUnit === "g" ? L("كجم", "kg") : L("لتر", "L")}</span>
              {per === best && offers.length > 1 ? <Badge size="sm" tone="ok">{L("الأرخص", "Cheapest")}</Badge> : null}
              {item.preferredSupplierId !== o.supplierId ? <Button size="sm" variant="ghost" onClick={() => db.update("stockItems", item.id, { preferredSupplierId: o.supplierId, supplierIds: [...new Set([...item.supplierIds, o.supplierId])] })}>{L("خليه الأساسي", "Make preferred")}</Button> : null}
            </li>
          );
        })}
      </ul>
      <div className="grid gap-2 rounded-2xl border border-dashed border-line p-3">
        <p className="text-[13px] font-semibold text-ink-2">{L("سعر من مورد", "Add a supplier price")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Select aria-label={L("المورد", "Supplier")} value={add.supplierId} onChange={(e) => setAdd({ ...add, supplierId: e.target.value })} options={[{ value: "", label: L("اختار المورد", "Pick a supplier") }, ...inv.suppliers.map((s) => ({ value: s.id, label: loc(s.name) }))]} />
          <Input aria-label={L("العبوة", "Pack")} placeholder={L("العبوة (مثلا: كرتونة ٢٤)", "Pack (e.g. carton of 24)")} value={add.packName} onChange={(e) => setAdd({ ...add, packName: e.target.value })} />
          <Input aria-label={L("كام وحدة أساسية", "Base units per pack")} type="number" className="num" value={add.factor} onChange={(e) => setAdd({ ...add, factor: Math.max(0.001, Number(e.target.value) || 0) })} end={<span className="px-3 text-[12.5px] text-muted">{BASE_NAME[item.baseUnit][lang]}</span>} />
          <MoneyInput label="" value={add.price} onChange={(price) => setAdd({ ...add, price })} />
        </div>
        <Button
          size="sm"
          disabled={!add.supplierId || add.price <= 0}
          onClick={async () => {
            const name = { ar: add.packName || L("وحدة", "unit"), en: add.packName || "unit" };
            const exist = offers.find((o) => o.supplierId === add.supplierId);
            const at = new Date().toISOString();
            if (exist) await db.update("supplierItems", exist.id, { packName: name, packFactor: add.factor, price: add.price, history: [...exist.history, { price: add.price, at }] });
            else await db.insert("supplierItems", { supplierId: add.supplierId, itemId: item.id, packName: name, packFactor: add.factor, price: add.price, vatBp: item.vatBp, code: null, history: [{ price: add.price, at }], preferred: false });
            await db.update("stockItems", item.id, { supplierIds: [...new Set([...item.supplierIds, add.supplierId])] });
            setAdd({ ...add, price: 0 });
          }}
        >
          {L("ضيف السعر", "Add price")}
        </Button>
        <p className="text-[12px] text-muted">{L("مثال", "e.g.")}: {formatMoney(major(380), { lang })} {L("للكرتونة ٢٤ كانز", "per carton of 24 cans")}</p>
      </div>
    </div>
  );
}

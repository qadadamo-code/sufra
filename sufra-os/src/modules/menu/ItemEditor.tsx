/** Menu item editor: details & photo, prices per channel/branch with live food cost, recipe, availability, modifiers, combo. */
import { useRef, useState } from "react";
import { Camera, Plus, Trash2 } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { AvailabilityWindow, MenuItem, MenuTag, SalesChannel } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { Badge, Button, Dialog, Input, Select, Switch, Tabs, useToast } from "@/ui";
import { LocalizedInput, MoneyInput } from "@/modules/marketing/ui";
import { costTone, margin, netPrice, priceForTarget } from "@/modules/inventory/costing";
import { defaultModifierIds, menuItemCost } from "@/modules/inventory/menuCost";
import { RecipeEditor } from "@/modules/inventory/RecipeEditor";
import { useInventory } from "@/modules/inventory/useInventory";
import { pct, readImage } from "@/modules/inventory/bits";
import { CHANNELS, scheduleLabel } from "./rules";

type Tab = "details" | "pricing" | "recipe" | "availability" | "options";
const TAGS: { id: MenuTag; ar: string; en: string }[] = [
  { id: "popular", ar: "الأكتر طلبًا", en: "Popular" },
  { id: "chef", ar: "اختيار الشيف", en: "Chef's pick" },
  { id: "new", ar: "جديد", en: "New" },
  { id: "spicy", ar: "حرّاق", en: "Spicy" },
  { id: "veg", ar: "نباتي", en: "Vegetarian" },
  { id: "kids", ar: "للأطفال", en: "Kids" },
  { id: "gluten_free", ar: "من غير جلوتين", en: "Gluten-free" },
];
const ALLERGENS = ["gluten", "milk", "egg", "nuts", "sesame", "fish", "shellfish", "soy", "mustard"];
const ALLERGEN_AR: Record<string, string> = { gluten: "جلوتين", milk: "لبن", egg: "بيض", nuts: "مكسرات", sesame: "سمسم", fish: "سمك", shellfish: "قشريات", soy: "صويا", mustard: "مستردة" };
const DAYS = { ar: ["ح", "ن", "ث", "ر", "خ", "ج", "س"], en: ["S", "M", "T", "W", "T", "F", "S"] };

const blank = (categoryId: string): Omit<MenuItem, "id" | "createdAt" | "updatedAt" | "restaurantId"> => ({
  categoryId, name: { ar: "", en: "" }, description: { ar: "", en: "" }, price: 0, cost: null, sku: null, stationId: null, modifierGroupIds: [], tags: [], prepMinutes: 10, available: true,
  vatExempt: false, imageUrl: null, sort: 999, active: true, channelPrices: {}, branchPrices: {}, schedule: [], allergens: [], calories: null, comboOf: [], hiddenOn: [],
});

export function ItemEditor({ item, categoryId, onClose }: { item: MenuItem | null; categoryId: string | null; onClose: () => void }) {
  const { L, lang, loc } = useT();
  const { can, branches } = useSession();
  const db = useDb();
  const { toast } = useToast();
  const inv = useInventory();
  const cats = useLive("menuCategories", { orderBy: [{ field: "sort" }] }).data;
  const stations = useLive("kitchenStations").data;
  const groups = useLive("modifierGroups", { orderBy: [{ field: "sort" }] }).data;
  const mods = useLive("modifiers").data;
  const menu = useLive("menuItems", { where: { active: true } }).data;
  const [tab, setTab] = useState<Tab>("details");
  const [d, setD] = useState(() => (item ? { ...item } : blank(categoryId ?? cats[0]?.id ?? "")));
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const editable = can("menu.edit");
  const tax = inv.settingsRow?.tax;
  const opts = { inclusive: tax?.priceMode === "inclusive", vatBp: tax?.vatRate ?? 1400 };
  const cost = menuItemCost({ id: item?.id ?? "-", comboOf: d.comboOf }, inv.recipes, inv.costCtx, defaultModifierIds(d, mods));
  const m = cost == null ? null : margin(cost, netPrice(d.price, opts));
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!(d.name.ar || d.name.en) || !d.categoryId) return;
    setBusy(true);
    try {
      const row = { ...d, name: { ar: d.name.ar || d.name.en, en: d.name.en || d.name.ar }, cost: cost ?? d.cost };
      if (item) {
        const { id: _i, createdAt: _c, updatedAt: _u, restaurantId: _r, ...patch } = row as MenuItem;
        await db.update("menuItems", item.id, patch);
        if (item.price !== d.price) await db.audit("menu.price", "menuItems", item.id, { from: item.price, to: d.price });
      } else await db.insert("menuItems", row);
      toast({ title: L("اتحفظ — المنيو اتحدّث في كل مكان", "Saved — every menu is updated"), tone: "success" });
      onClose();
    } finally {
      setBusy(false);
    }
  };
  const setWindow = (i: number, w: Partial<AvailabilityWindow>) => set("schedule", (d.schedule ?? []).map((x, j) => (j === i ? { ...x, ...w } : x)));
  return (
    <Dialog open onClose={onClose} size="xl" variant="sheet-end" title={item ? loc(item.name) : L("صنف جديد", "New item")} description={m ? <span className="inline-flex flex-wrap gap-1.5"><Badge size="sm" tone={costTone(m.foodCostBp)} dot>{L("تكلفة الأكل", "Food cost")} {pct(m.foodCostBp, lang)}</Badge><Badge size="sm">{L("مساهمة", "Contribution")} {formatMoney(m.contribution, { lang, whole: true })}</Badge></span> : undefined}
      footer={editable && tab !== "recipe" ? <Button block size="lg" loading={busy} onClick={save}>{L("احفظ", "Save")}</Button> : undefined}>
      <div className="grid gap-4 pb-2">
        <Tabs label={L("أقسام الصنف", "Item sections")} value={tab} onChange={setTab} items={[
          { value: "details", label: L("البيانات", "Details") },
          { value: "pricing", label: L("الأسعار", "Pricing") },
          ...(item ? [{ value: "recipe" as Tab, label: L("الوصفة", "Recipe") }] : []),
          { value: "availability", label: L("الإتاحة", "Availability") },
          { value: "options", label: L("إضافات وكومبو", "Modifiers & combo") },
        ]} />
        <fieldset disabled={!editable} className="contents">
          {tab === "details" ? (
            <div className="grid gap-4">
              <div className="flex items-center gap-4">
                <button type="button" onClick={() => file.current?.click()} className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-2xl border border-dashed border-line-strong bg-surface-2 text-muted hover:border-primary" aria-label={L("صورة الصنف", "Item photo")}>
                  {d.imageUrl ? <img src={d.imageUrl} alt="" className="size-full object-cover" /> : <Camera className="size-6" />}
                </button>
                <input ref={file} type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) set("imageUrl", await readImage(f, 720)); }} />
                <div className="grid gap-1 text-[13px] text-muted">
                  <span>{L("صورة مربعة واضحة — بتظهر في الـ QR والأونلاين", "A clear square photo — shown on QR and online menus")}</span>
                  {d.imageUrl ? <button type="button" className="text-start font-semibold text-danger" onClick={() => set("imageUrl", null)}>{L("شيل الصورة", "Remove photo")}</button> : null}
                </div>
              </div>
              <LocalizedInput label={L("الاسم", "Name")} value={d.name} onChange={(v) => set("name", v)} />
              <LocalizedInput label={L("الوصف", "Description")} value={d.description} onChange={(v) => set("description", v)} multiline />
              <div className="grid gap-3 sm:grid-cols-3">
                <Select label={L("القسم", "Category")} value={d.categoryId} onChange={(e) => set("categoryId", e.target.value)} options={cats.map((c) => ({ value: c.id, label: loc(c.name) }))} />
                <Select label={L("المحطة", "Station")} value={d.stationId ?? ""} onChange={(e) => set("stationId", e.target.value || null)} options={[{ value: "", label: L("زي القسم", "Category's station") }, ...stations.map((s) => ({ value: s.id, label: loc(s.name) }))]} />
                <Input label={L("وقت التحضير (د)", "Prep time (min)")} type="number" className="num" value={d.prepMinutes} onChange={(e) => set("prepMinutes", Math.max(0, Number(e.target.value) || 0))} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label={L("السعرات (kcal)", "Calories (kcal)")} type="number" className="num" value={d.calories ?? ""} onChange={(e) => set("calories", e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0))} />
                <Input label={L("الكود", "SKU")} dir="ltr" value={d.sku ?? ""} onChange={(e) => set("sku", e.target.value.toUpperCase() || null)} />
              </div>
              <ChipSet label={L("مسببات الحساسية", "Allergens")} options={ALLERGENS.map((a) => ({ id: a, label: lang === "ar" ? ALLERGEN_AR[a] : a }))} value={d.allergens ?? []} onChange={(v) => set("allergens", v)} />
              <ChipSet label={L("علامات", "Tags")} options={TAGS.map((t) => ({ id: t.id, label: t[lang] }))} value={d.tags} onChange={(v) => set("tags", v as MenuTag[])} />
              <Switch checked={!d.vatExempt} onChange={(v) => set("vatExempt", !v)} label={L("عليه ضريبة قيمة مضافة", "Subject to VAT")} description={L("اقفلها للأصناف المعفاة (مياه، خبز …)", "Turn off for exempt items (water, bread …)")} />
            </div>
          ) : null}

          {tab === "pricing" ? (
            <div className="grid gap-4">
              <MoneyInput label={L("السعر الأساسي", "Base price")} value={d.price} onChange={(v) => set("price", v)} hint={tax?.priceMode === "inclusive" ? L("شامل الضريبة", "VAT included") : L("قبل الضريبة والخدمة", "before VAT and service")} />
              {cost != null ? (
                <div className="grid gap-2 rounded-2xl border border-line bg-surface-2/60 p-3.5 text-[14px] sm:grid-cols-3">
                  <span>{L("تكلفة الحصة", "Portion cost")} <b className="num">{formatMoney(cost, { lang })}</b></span>
                  {m ? <span>{L("تكلفة الأكل", "Food cost")} <b className={costTone(m.foodCostBp) === "danger" ? "text-danger" : costTone(m.foodCostBp) === "warn" ? "text-warn" : "text-ok"}>{pct(m.foodCostBp, lang)}</b></span> : null}
                  <span>{L("سعر لـ ٣٠٪", "Price for 30%")} <button type="button" className="num font-semibold text-primary" onClick={() => set("price", priceForTarget(cost, 3000, opts))}>{formatMoney(priceForTarget(cost, 3000, opts), { lang, whole: true })}</button></span>
                </div>
              ) : <p className="text-[13px] text-warn">{L("مفيش وصفة — ضيفها عشان تشوف التكلفة والهامش", "No recipe yet — add one to see cost and margin")}</p>}
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-[13px] font-semibold text-ink-2">{L("سعر حسب القناة (فاضي = الأساسي)", "Price per channel (empty = base)")}</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {CHANNELS.map((c) => (
                    <MoneyInput key={c.id} label={c[lang]} value={d.channelPrices?.[c.id] ?? 0} onChange={(v) => set("channelPrices", { ...(d.channelPrices ?? {}), [c.id]: v || undefined })} />
                  ))}
                </div>
              </fieldset>
              {branches.length > 1 ? (
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-[13px] font-semibold text-ink-2">{L("سعر حسب الفرع", "Price per branch")}</legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {branches.map((b) => <MoneyInput key={b.id} label={loc(b.name)} value={d.branchPrices?.[b.id] ?? 0} onChange={(v) => { const n = { ...(d.branchPrices ?? {}) }; if (v) n[b.id] = v; else delete n[b.id]; set("branchPrices", n); }} />)}
                  </div>
                </fieldset>
              ) : null}
            </div>
          ) : null}
        </fieldset>

        {tab === "recipe" && item ? (
          item.comboOf?.length ? (
            <p className="text-[14px] text-muted">{L("الكومبو بيخصم وصفات الأصناف اللي جواه — عدّلها من تبويب الإضافات والكومبو", "A combo deducts its components' recipes — edit them under Modifiers & combo")}</p>
          ) : (
            <div className="grid gap-4">
              <RecipeEditor ownerType="menu_item" ownerId={item.id} price={netPrice(d.price, opts)} />
              {d.modifierGroupIds.length ? (
                <div className="grid gap-2">
                  <p className="text-[13px] font-semibold text-ink-2">{L("إضافات بتغيّر المكونات لهذا الصنف", "Modifiers that change ingredients on this item")}</p>
                  {mods.filter((x) => d.modifierGroupIds.includes(x.groupId)).map((x) => <ModRecipe key={x.id} modId={x.id} itemId={item.id} name={loc(x.name)} />)}
                </div>
              ) : null}
            </div>
          )
        ) : null}

        <fieldset disabled={!editable} className="contents">
          {tab === "availability" ? (
            <div className="grid gap-4">
              <Switch checked={d.available} onChange={(v) => set("available", v)} label={L("متاح النهارده", "Available today")} description={L("اقفلها = 86 (خلص) — بيختفي من الطلب في كل مكان", "Off = 86'd — can't be ordered anywhere")} />
              <Switch checked={d.active} onChange={(v) => set("active", v)} label={L("في المنيو", "On the menu")} />
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-[13px] font-semibold text-ink-2">{L("مواعيد البيع", "Selling hours")} · <span className="font-normal text-muted">{scheduleLabel(d.schedule, lang)}</span></legend>
                {(d.schedule ?? []).map((w, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-2xl border border-line p-2.5">
                    <div className="flex gap-1">
                      {DAYS[lang].map((x, di) => (
                        <button key={di} type="button" aria-pressed={w.days.includes(di)} onClick={() => setWindow(i, { days: w.days.includes(di) ? w.days.filter((y) => y !== di) : [...w.days, di].sort() })} className={`grid size-9 place-items-center rounded-lg text-[13px] font-semibold ${w.days.includes(di) ? "bg-primary text-primary-ink" : "bg-surface-2"}`}>{x}</button>
                      ))}
                    </div>
                    <input type="time" aria-label={L("من", "From")} value={w.from} onChange={(e) => setWindow(i, { from: e.target.value })} className="h-10 rounded-xl border border-line bg-surface px-2" />
                    <span>–</span>
                    <input type="time" aria-label={L("إلى", "To")} value={w.to} onChange={(e) => setWindow(i, { to: e.target.value })} className="h-10 rounded-xl border border-line bg-surface px-2" />
                    <button type="button" aria-label={L("شيل", "Remove")} className="grid size-10 place-items-center rounded-xl text-danger hover:bg-danger-soft" onClick={() => set("schedule", (d.schedule ?? []).filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => set("schedule", [...(d.schedule ?? []), { days: [], from: "08:00", to: "12:00" }])}>{L("ميعاد (مثلا الفطار ٨–١٢)", "A window (e.g. breakfast 8–12)")}</Button>
              </fieldset>
              <ChipSet label={L("مخفي على", "Hidden on")} options={CHANNELS.map((c) => ({ id: c.id, label: c[lang] }))} value={d.hiddenOn ?? []} onChange={(v) => set("hiddenOn", v as SalesChannel[])} tone="danger" />
            </div>
          ) : null}

          {tab === "options" ? (
            <div className="grid gap-4">
              <ChipSet label={L("مجموعات الإضافات", "Modifier groups")} options={groups.map((g) => ({ id: g.id, label: `${loc(g.name)}${g.min ? " *" : ""}` }))} value={d.modifierGroupIds} onChange={(v) => set("modifierGroupIds", v)} />
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-[13px] font-semibold text-ink-2">{L("كومبو / وجبة: الأصناف اللي جواه", "Combo / meal: what's inside")}</legend>
                {(d.comboOf ?? []).map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select aria-label={L("الصنف", "Item")} value={c.itemId} onChange={(e) => set("comboOf", (d.comboOf ?? []).map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))} options={menu.filter((x) => x.id !== item?.id && !x.comboOf?.length).map((x) => ({ value: x.id, label: loc(x.name) }))} />
                    <input type="number" min={1} aria-label={L("العدد", "Qty")} value={c.qty} onChange={(e) => set("comboOf", (d.comboOf ?? []).map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)))} className="num h-11 w-20 rounded-xl border border-line bg-surface px-2 text-center" />
                    <button type="button" aria-label={L("شيل", "Remove")} className="grid size-11 place-items-center rounded-xl text-danger hover:bg-danger-soft" onClick={() => set("comboOf", (d.comboOf ?? []).filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => set("comboOf", [...(d.comboOf ?? []), { itemId: menu[0]?.id ?? "", qty: 1 }])}>{L("ضيف صنف للكومبو", "Add a component")}</Button>
                {d.comboOf?.length ? <p className="text-[12.5px] text-muted">{L("لو اتباعوا لوحدهم", "Sold separately")}: {formatMoney(d.comboOf.reduce((a, c) => a + (menu.find((x) => x.id === c.itemId)?.price ?? 0) * c.qty, 0), { lang, whole: true })} · {L("سعر الكومبو", "combo price")} {formatMoney(d.price, { lang, whole: true })}</p> : null}
              </fieldset>
            </div>
          ) : null}
        </fieldset>
      </div>
    </Dialog>
  );
}

function ModRecipe({ modId, itemId, name }: { modId: string; itemId: string; name: string }) {
  const { L } = useT();
  const inv = useInventory();
  const [open, setOpen] = useState(false);
  const scoped = inv.recipeFor("modifier", modId, itemId);
  const general = inv.recipeFor("modifier", modId);
  return (
    <div className="rounded-2xl border border-line">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3.5 py-2.5 text-start text-[14px]">
        <span className="font-semibold">{name}</span>
        <span className="text-[12.5px] text-muted">{scoped ? L("وصفة خاصة بالصنف", "item-specific") : general ? L("وصفة عامة", "general recipe") : L("بدون مكونات", "no ingredients")}</span>
      </button>
      {open ? <div className="border-t border-line p-3"><RecipeEditor ownerType="modifier" ownerId={modId} scopeItemId={scoped || !general ? itemId : null} compact /></div> : null}
    </div>
  );
}

function ChipSet({ label, options, value, onChange, tone = "primary" }: { label: string; options: { id: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; tone?: "primary" | "danger" }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-[13px] font-semibold text-ink-2">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o.id);
          return (
            <button key={o.id} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])} className={`h-10 rounded-full border px-3.5 text-[13.5px] font-semibold ${on ? (tone === "danger" ? "border-danger bg-danger-soft text-danger" : "border-primary bg-primary-soft text-primary") : "border-line hover:bg-surface-2"}`}>
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}


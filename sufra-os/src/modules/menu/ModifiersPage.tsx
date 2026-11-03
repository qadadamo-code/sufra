import { useState } from "react";
import { Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { Modifier, ModifierGroup } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { Badge, Button, Card, Dialog, EmptyState, Input, Switch } from "@/ui";
import { LocalizedInput, MoneyInput } from "@/modules/marketing/ui";
import { RecipeEditor } from "@/modules/inventory/RecipeEditor";
import { linesCost } from "@/modules/inventory/costing";
import { useInventory } from "@/modules/inventory/useInventory";

export default function ModifiersPage() {
  const { L, lang, loc } = useT();
  const { can } = useSession();
  const inv = useInventory();
  const groups = useLive("modifierGroups", { orderBy: [{ field: "sort" }] }).data;
  const mods = useLive("modifiers", { orderBy: [{ field: "sort" }] }).data;
  const items = useLive("menuItems").data;
  const [group, setGroup] = useState<ModifierGroup | "new" | null>(null);
  const [mod, setMod] = useState<Modifier | { groupId: string } | null>(null);
  const editable = can("menu.edit");
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13.5px] text-muted">{L("كل إضافة ليها سعر ووصفة: «جبنة رومي» بتزوّد ٣٠ جم جبنة، «من غير شطة» ممكن تشيل مكوّن. الإضافة الافتراضية بتدخل في تكلفة الصنف.", "Every modifier has a price and a recipe: “Roumi cheese” adds 30 g cheese, “no chili” can remove one. Default choices count in the item's cost.")}</p>
        {editable ? <Button icon={<Plus className="size-4" />} onClick={() => setGroup("new")}>{L("مجموعة إضافات", "Modifier group")}</Button> : null}
      </div>
      {groups.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {groups.map((g) => {
            const list = mods.filter((m) => m.groupId === g.id);
            const used = items.filter((i) => i.modifierGroupIds.includes(g.id)).length;
            return (
              <Card key={g.id} className="grid content-start gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" className="text-start" onClick={() => editable && setGroup(g)}>
                    <p className="font-semibold">{loc(g.name)}</p>
                    <p className="text-[12.5px] text-muted">{g.min ? L(`إجباري · ${g.min}–${g.max}`, `Required · ${g.min}–${g.max}`) : L(`اختياري · لحد ${g.max}`, `Optional · up to ${g.max}`)} · {L(`على ${used} صنف`, `on ${used} items`)}</p>
                  </button>
                  {editable ? <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setMod({ groupId: g.id })}>{L("اختيار", "Option")}</Button> : null}
                </div>
                <ul className="grid gap-1.5">
                  {list.map((m) => {
                    const rs = inv.recipes.filter((r) => r.ownerType === "modifier" && r.ownerId === m.id);
                    return (
                      <li key={m.id}>
                        <button type="button" onClick={() => setMod(m)} className="flex w-full items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-start text-[14px] hover:bg-surface-3">
                          <span className="flex-1 truncate">{loc(m.name)} {m.isDefault ? <Badge size="sm">{L("افتراضي", "default")}</Badge> : null} {!m.available ? <Badge size="sm" tone="danger">86</Badge> : null}</span>
                          {rs.length ? <span className="num text-[12px] text-muted">{L("تكلفة", "cost")} {rs.map((r) => formatMoney(linesCost(r.lines, inv.costCtx), { lang })).join(" / ")}</span> : null}
                          <span className="num w-16 text-end font-semibold">{m.price ? `+${formatMoney(m.price, { lang, whole: true })}` : "—"}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={<SlidersHorizontal />} title={L("مفيش إضافات", "No modifiers")} />
      )}
      {group ? <GroupDialog group={group === "new" ? null : group} sort={groups.length + 1} onClose={() => setGroup(null)} /> : null}
      {mod ? <ModDialog mod={"id" in mod ? mod : null} groupId={mod.groupId} sort={mods.filter((m) => m.groupId === mod.groupId).length + 1} onClose={() => setMod(null)} editable={editable} /> : null}
    </div>
  );
}

function GroupDialog({ group, sort, onClose }: { group: ModifierGroup | null; sort: number; onClose: () => void }) {
  const { L } = useT();
  const db = useDb();
  const [name, setName] = useState(group?.name ?? { ar: "", en: "" });
  const [min, setMin] = useState(group?.min ?? 0);
  const [max, setMax] = useState(group?.max ?? 1);
  return (
    <Dialog open onClose={onClose} title={group ? L("تعديل المجموعة", "Edit group") : L("مجموعة جديدة", "New group")} footer={
      <Button block size="lg" disabled={!(name.ar || name.en) || max < Math.max(1, min)} onClick={async () => {
        const row = { name: { ar: name.ar || name.en, en: name.en || name.ar }, min, max };
        if (group) await db.update("modifierGroups", group.id, row);
        else await db.insert("modifierGroups", { ...row, sort });
        onClose();
      }}>{L("احفظ", "Save")}</Button>
    }>
      <div className="grid gap-3 pb-1">
        <LocalizedInput label={L("الاسم", "Name")} value={name} onChange={setName} />
        <div className="grid grid-cols-2 gap-3">
          <Input label={L("أقل عدد (٠ = اختياري)", "Min (0 = optional)")} type="number" className="num" min={0} value={min} onChange={(e) => setMin(Math.max(0, Number(e.target.value) || 0))} />
          <Input label={L("أكتر عدد", "Max")} type="number" className="num" min={1} value={max} onChange={(e) => setMax(Math.max(1, Number(e.target.value) || 1))} />
        </div>
      </div>
    </Dialog>
  );
}

function ModDialog({ mod, groupId, sort, onClose, editable }: { mod: Modifier | null; groupId: string; sort: number; onClose: () => void; editable: boolean }) {
  const { L } = useT();
  const db = useDb();
  const [name, setName] = useState(mod?.name ?? { ar: "", en: "" });
  const [price, setPrice] = useState(mod?.price ?? 0);
  const [isDefault, setDefault] = useState(mod?.isDefault ?? false);
  const [available, setAvailable] = useState(mod?.available ?? true);
  return (
    <Dialog open onClose={onClose} size="lg" title={mod ? L("تعديل الاختيار", "Edit option") : L("اختيار جديد", "New option")} footer={editable ? (
      <div className="flex w-full gap-2">
        {mod ? <Button variant="danger-soft" icon={<Trash2 className="size-4" />} onClick={async () => { await db.remove("modifiers", mod.id); onClose(); }}>{L("امسح", "Delete")}</Button> : null}
        <Button block size="lg" disabled={!(name.ar || name.en)} onClick={async () => {
          const row = { name: { ar: name.ar || name.en, en: name.en || name.ar }, price, isDefault, available };
          if (mod) await db.update("modifiers", mod.id, row);
          else await db.insert("modifiers", { ...row, groupId, sort });
          onClose();
        }}>{L("احفظ", "Save")}</Button>
      </div>
    ) : undefined}>
      <div className="grid gap-4 pb-1">
        <LocalizedInput label={L("الاسم", "Name")} value={name} onChange={setName} />
        <MoneyInput label={L("السعر الزيادة", "Extra price")} value={price} onChange={setPrice} />
        <Switch checked={isDefault} onChange={setDefault} label={L("الاختيار الافتراضي", "Default choice")} />
        <Switch checked={available} onChange={setAvailable} label={L("متاح", "Available")} />
        {mod ? (
          <div className="grid gap-2 border-t border-line pt-3">
            <p className="text-[13px] font-semibold text-ink-2">{L("الوصفة (لكل الأصناف)", "Recipe (all items)")}</p>
            <RecipeEditor ownerType="modifier" ownerId={mod.id} compact />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

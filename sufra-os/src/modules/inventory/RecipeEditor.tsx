/** Recipe / BOM editor — menu items, modifiers (optionally for one menu item) and prep items (with yield). Live cost. */
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb } from "@/data/hooks";
import type { Recipe, RecipeLine } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney, type Units } from "@/lib/money";
import { Badge, Button, Select, useToast } from "@/ui";
import { Qty, QtyInput, pct } from "./bits";
import { costTone, grossQty, lineCost, linesCost, margin } from "./costing";
import { useInventory } from "./useInventory";

export function RecipeEditor({ ownerType, ownerId, scopeItemId = null, price, onSaved, compact }: { ownerType: Recipe["ownerType"]; ownerId: string; scopeItemId?: string | null; price?: Units | null; onSaved?: () => void; compact?: boolean }) {
  const { L, lang } = useT();
  const { can } = useSession();
  const db = useDb();
  const { toast } = useToast();
  const inv = useInventory();
  const existing = inv.recipeFor(ownerType, ownerId, scopeItemId);
  const [lines, setLines] = useState<RecipeLine[]>(existing?.lines ?? []);
  const [yieldQty, setYield] = useState(existing?.yieldQty ?? 1);
  const [method, setMethod] = useState(existing?.method ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setLines(existing?.lines ?? []);
    setYield(existing?.yieldQty ?? 1);
    setMethod(existing?.method ?? "");
  }, [existing?.id, existing?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const editable = can("inventory.manage") || can("menu.edit");
  const dirty = JSON.stringify(lines) !== JSON.stringify(existing?.lines ?? []) || yieldQty !== (existing?.yieldQty ?? 1) || method !== (existing?.method ?? "");
  const total = useMemo(() => linesCost(lines.filter((l) => l.itemId), inv.costCtx), [lines, inv.costCtx]);
  const perPortion = ownerType === "prep" ? Math.round(total / Math.max(1, yieldQty)) : total;
  const m = price ? margin(perPortion, price) : null;
  const prepItem = ownerType === "prep" ? inv.itemById.get(ownerId) : null;
  const options = useMemo(() => inv.items.filter((i) => i.active && i.id !== ownerId).sort((a, b) => (a.kind === b.kind ? a.name[lang].localeCompare(b.name[lang], lang) : a.kind === "prep" ? -1 : 1)), [inv.items, ownerId, lang]);
  const save = async () => {
    setBusy(true);
    try {
      const clean = lines.filter((l) => l.itemId && l.qty !== 0);
      if (existing) await db.update("recipes", existing.id, { lines: clean, yieldQty, method, updatedBy: db.actorId });
      else await db.insert("recipes", { ownerType, ownerId, scopeItemId, lines: clean, yieldQty, method, updatedBy: db.actorId });
      toast({ title: L("الوصفة اتحفظت", "Recipe saved"), tone: "success", duration: 1800 });
      onSaved?.();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-xl bg-surface-2 px-3 py-1.5 text-[13.5px]">
          {ownerType === "prep" ? L("تكلفة التشغيلة", "Batch cost") : L("تكلفة الحصة", "Portion cost")} <b className="num">{formatMoney(total, { lang })}</b>
        </span>
        {ownerType === "prep" && prepItem ? (
          <span className="rounded-xl bg-surface-2 px-3 py-1.5 text-[13.5px]">
            {L("لكل", "per")} {prepItem.baseUnit === "pc" ? L("قطعة", "pc") : L("كجم", "kg")} <b className="num">{formatMoney(perPortion * (prepItem.baseUnit === "pc" ? 1 : 1000), { lang })}</b>
          </span>
        ) : null}
        {m ? (
          <>
            <Badge tone={costTone(m.foodCostBp)} dot>{L("تكلفة الأكل", "Food cost")} {pct(m.foodCostBp, lang)}</Badge>
            <Badge tone="neutral">{L("هامش", "Margin")} {pct(m.marginBp, lang)} · {formatMoney(m.contribution, { lang, whole: true })}</Badge>
          </>
        ) : null}
      </div>
      <ul className="grid gap-2">
        {lines.map((l, i) => {
          const it = inv.itemById.get(l.itemId);
          return (
            <li key={i} className="grid gap-2 rounded-2xl border border-line p-2.5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-end">
              <Select aria-label={L("المكوّن", "Ingredient")} disabled={!editable} value={l.itemId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))} options={[{ value: "", label: L("اختار مكوّن", "Pick an ingredient") }, ...options.map((o) => ({ value: o.id, label: `${o.kind === "prep" ? "◆ " : ""}${o.name[lang]}` }))]} />
              {it ? <QtyInput key={it.id} item={it} value={l.qty} onChange={(qty) => setLines(lines.map((x, j) => (j === i ? { ...x, qty } : x)))} defaultUnit={it.baseUnit} /> : <span />}
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <span className="num min-w-20 text-end text-[13px] text-muted">{it ? formatMoney(lineCost(l, inv.costCtx), { lang }) : ""}</span>
                {editable ? <button type="button" aria-label={L("شيل", "Remove")} className="grid size-10 place-items-center rounded-xl text-danger hover:bg-danger-soft" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button> : null}
              </div>
              {it && (it.yieldBp < 10_000 || l.lossBp) ? <p className="text-[12px] text-muted sm:col-span-3">{L("بيتخصم فعليًا", "Actually used")} <Qty qty={grossQty(l, it)} item={it} /> ({L("نسبة الصافي", "yield")} {pct(it.yieldBp, lang, 0)})</p> : null}
            </li>
          );
        })}
      </ul>
      {editable ? (
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setLines([...lines, { itemId: "", qty: 0 }])}>{L("مكوّن", "Ingredient")}</Button>
          {ownerType === "prep" && prepItem ? <div className="w-56"><QtyInput item={prepItem} value={yieldQty} onChange={(y) => setYield(Math.max(1, y))} label={L("التشغيلة بتطلع", "One batch yields")} /></div> : null}
          {ownerType === "modifier" ? <p className="text-[12px] text-muted">{L("كمية بالسالب = بتشيل مكوّن (مثلا: من غير بصل)", "A negative quantity removes an ingredient (e.g. no onion)")}</p> : null}
        </div>
      ) : null}
      {!compact ? <textarea aria-label={L("طريقة التحضير", "Method")} disabled={!editable} rows={2} value={method} onChange={(e) => setMethod(e.target.value)} placeholder={L("طريقة التحضير (اختياري)", "Method (optional)")} className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px]" /> : null}
      {editable ? <Button loading={busy} disabled={!dirty} onClick={save}>{L("احفظ الوصفة", "Save recipe")}</Button> : null}
    </div>
  );
}

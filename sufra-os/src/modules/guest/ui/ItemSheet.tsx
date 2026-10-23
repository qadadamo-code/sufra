import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { AnimatedMoney, Button, Dialog, Money } from "@/ui";
import { itemImage } from "../data/images";
import { defaultModifiers, groupsFor, invalidGroups, toggleModifier, unitPrice, type MenuItemView } from "../cart";
import { useGuest } from "./context";
import { Photo, QtyStepper } from "./bits";
import { TagChips } from "./Menu";

/** Item detail: photo, modifiers (radio/checkbox by group rules), notes, quantity → add to cart. */
export function ItemSheet({ item, onClose, onAdded }: { item: MenuItemView | null; onClose: () => void; onAdded?: (qty: number) => void }) {
  const { menu, add } = useGuest();
  const { L, loc } = useT();
  const [sel, setSel] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [qty, setQty] = useState(1);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!item) return;
    setSel(defaultModifiers(menu, item));
    setNotes("");
    setQty(1);
    setTried(false);
  }, [item, menu]);

  const groups = useMemo(() => (item ? groupsFor(menu, item) : []), [item, menu]);
  const bad = item ? invalidGroups(menu, item, sel) : [];
  const total = item ? unitPrice(menu, item.id, sel) * qty : 0;

  const submit = () => {
    if (!item) return;
    if (bad.length) {
      setTried(true);
      document.getElementById(`mg-${bad[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    add({ itemId: item.id, qty, modifierIds: sel, notes: notes.trim().slice(0, 200) });
    onAdded?.(qty);
    onClose();
  };

  return (
    <Dialog
      open={!!item}
      onClose={onClose}
      hideClose
      size="md"
      className="sm:max-w-[520px]"
      footer={
        item ? (
          <div className="flex w-full items-center gap-3">
            <QtyStepper value={qty} onChange={setQty} min={1} label={L("الكمية", "Quantity")} size="lg" />
            <Button size="lg" className="flex-1 justify-between gap-4" onClick={submit} disabled={!item.available}>
              <span>{L("أضف للطلب", "Add to order")}</span>
              <AnimatedMoney value={total} className="text-[15px]" />
            </Button>
          </div>
        ) : null
      }
    >
      {item ? (
        <div className="-mx-5 -mt-1 sm:-mx-6">
          <Photo src={itemImage(item)} alt={loc(item.name)} eager className="aspect-[16/10] w-full sm:rounded-t-[22px]">
            <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/25 to-transparent" />
            <button type="button" onClick={onClose} aria-label={L("اقفل", "Close")} className="absolute top-3 end-3 grid size-10 place-items-center rounded-full bg-black/40 text-white backdrop-blur-md transition active:scale-90">
              <X className="size-5" />
            </button>
          </Photo>
          <div className="px-5 pt-4 sm:px-6">
            <h2 className="text-[24px] leading-tight">{loc(item.name)}</h2>
            <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{loc(item.description)}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Money value={item.price} compact className="text-[18px] font-bold" />
              <TagChips tags={item.tags} max={3} />
            </div>

            {groups.map((g) => {
              const radio = g.max === 1;
              const err = tried && bad.includes(g.id);
              const n = sel.filter((id) => g.options.some((o) => o.id === id)).length;
              return (
                <fieldset key={g.id} id={`mg-${g.id}`} className="mt-6">
                  <legend className="flex w-full items-center justify-between gap-2">
                    <span className="text-[16px] font-bold">{loc(g.name)}</span>
                    <span className={cn("rounded-full px-2.5 py-0.5 text-[12px] font-semibold", err ? "bg-danger-soft text-danger" : g.min ? "bg-brass-soft text-brass-text" : "bg-surface-3 text-muted")}>
                      {g.min ? L("مطلوب", "Required") : radio ? L("اختياري", "Optional") : L(`اختار لحد ${g.max}`, `Up to ${g.max}`)}
                      {!radio && g.max > 1 ? <span className="num ms-1">{n}/{g.max}</span> : null}
                    </span>
                  </legend>
                  <div className="mt-2.5 grid gap-2">
                    {g.options.map((o) => {
                      const on = sel.includes(o.id);
                      return (
                        <button
                          key={o.id}
                          type="button"
                          role={radio ? "radio" : "checkbox"}
                          aria-checked={on}
                          onClick={() => setSel((s) => toggleModifier(menu, item, s, o.id))}
                          className={cn(
                            "flex min-h-12 items-center gap-3 rounded-2xl border px-3.5 text-start transition-colors active:scale-[0.99]",
                            on ? "border-primary bg-primary-soft" : "border-line bg-surface hover:border-line-strong",
                          )}
                        >
                          <span className={cn("grid size-5.5 shrink-0 place-items-center border-2 transition-colors", radio ? "rounded-full" : "rounded-md", on ? "border-primary bg-primary text-primary-ink" : "border-line-strong")}>
                            {on ? radio ? <span className="size-2 rounded-full bg-primary-ink" /> : <Check className="size-3.5" strokeWidth={3} /> : null}
                          </span>
                          <span className="flex-1 text-[15px] font-medium">{loc(o.name)}</span>
                          {o.price ? <Money value={o.price} compact signed className="text-[13.5px] text-muted" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}

            <label className="mt-6 block pb-2">
              <span className="text-[16px] font-bold">{L("ملاحظات للمطبخ", "Notes for the kitchen")}</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={200}
                rows={2}
                placeholder={L("مثلًا: من غير بصل، الصوص على جنب…", "e.g. no onions, sauce on the side…")}
                className="mt-2 w-full resize-none rounded-2xl border border-line bg-surface px-3.5 py-3 text-[15px] outline-none transition placeholder:text-faint focus:border-primary focus:shadow-[var(--sf-glow)]"
              />
            </label>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

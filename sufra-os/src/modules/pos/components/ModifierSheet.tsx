/** Modifiers, notes, seat, course and qty for one item before it goes on the ticket. */
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Check, CircleAlert } from "lucide-react";
import type { MenuItem, Modifier, ModifierGroup } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { AnimatedMoney, Badge, Button, Dialog, spring, useHotkeys, useReduced } from "@/ui";
import { Stepper } from "./bits";

export interface ModifierChoice {
  modifiers: Modifier[];
  qty: number;
  notes: string;
  seat: number | null;
  course: number;
}

const QUICK_NOTES = [
  { ar: "من غير بصل", en: "No onion" },
  { ar: "من غير طماطم", en: "No tomato" },
  { ar: "سوي كويس", en: "Well done" },
  { ar: "صوص على جنب", en: "Sauce on the side" },
  { ar: "حساسية مكسرات", en: "Nut allergy" },
  { ar: "مستعجل", en: "Rush" },
];

export function ModifierSheet({ item, groups, mods, guests, seat: seat0, course: course0, onClose, onAdd }: {
  item: MenuItem | null;
  groups: ModifierGroup[];
  mods: Modifier[];
  guests: number;
  seat: number | null;
  course: number;
  onClose: () => void;
  onAdd: (c: ModifierChoice) => void;
}) {
  const { L, loc, lang } = useT();
  const reduced = useReduced();
  const itemGroups = useMemo(() => (item ? item.modifierGroupIds.map((id) => groups.find((g) => g.id === id)).filter((g): g is ModifierGroup => !!g) : []), [item, groups]);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [seat, setSeat] = useState<number | null>(seat0);
  const [course, setCourse] = useState(course0);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!item) return;
    const init: Record<string, string[]> = {};
    for (const g of itemGroups) init[g.id] = mods.filter((m) => m.groupId === g.id && m.isDefault && m.available).map((m) => m.id).slice(0, g.max);
    setPicked(init);
    setQty(1);
    setNotes("");
    setSeat(seat0);
    setCourse(course0);
    setTried(false);
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = useMemo(() => Object.values(picked).flat().map((id) => mods.find((m) => m.id === id)).filter((m): m is Modifier => !!m), [picked, mods]);
  const missing = itemGroups.filter((g) => (picked[g.id]?.length ?? 0) < g.min);
  const unit = (item?.price ?? 0) + chosen.reduce((a, m) => a + m.price, 0);

  const toggle = (g: ModifierGroup, m: Modifier) =>
    setPicked((p) => {
      const cur = p[g.id] ?? [];
      if (g.max === 1) return { ...p, [g.id]: cur[0] === m.id && g.min === 0 ? [] : [m.id] };
      if (cur.includes(m.id)) return { ...p, [g.id]: cur.filter((x) => x !== m.id) };
      if (cur.length >= g.max) return p;
      return { ...p, [g.id]: [...cur, m.id] };
    });

  const submit = () => {
    setTried(true);
    if (missing.length) return;
    onAdd({ modifiers: chosen, qty, notes: notes.trim(), seat, course });
  };
  useHotkeys({ "mod+enter": submit }, { enabled: !!item, inInputs: true });

  return (
    <Dialog
      open={!!item}
      onClose={onClose}
      size="lg"
      title={item ? loc(item.name) : ""}
      description={item ? loc(item.description) : undefined}
      footer={
        <div className="flex w-full flex-wrap items-center gap-3">
          <Stepper value={qty} onChange={setQty} min={1} label={L("الكمية", "Quantity")} />
          <div className="flex-1" />
          <Button size="lg" onClick={submit} className="min-w-52" data-autofocus>
            {L("ضيف", "Add")} · <AnimatedMoney value={unit * qty} />
          </Button>
        </div>
      }
    >
      <div className="grid gap-5">
        {itemGroups.map((g) => {
          const opts = mods.filter((m) => m.groupId === g.id);
          const n = picked[g.id]?.length ?? 0;
          const bad = tried && n < g.min;
          return (
            <fieldset key={g.id} className={cn("-mx-2 rounded-2xl p-2 transition-colors", bad && "bg-danger-soft/50 ring-2 ring-danger/40")}>
              <legend className="contents">
                <span className="flex w-full items-center gap-2 text-[15px] font-semibold">
                {loc(g.name)}
                {g.min > 0 ? <Badge tone={bad ? "danger" : "brass"} size="sm">{L("مطلوب", "Required")}</Badge> : <Badge size="sm">{L("اختياري", "Optional")}</Badge>}
                <span className="text-[12.5px] font-medium text-muted">
                  {g.max === 1 ? L("اختار واحد", "Pick one") : L(`لحد ${g.max}`, `Up to ${g.max}`)}
                </span>
                </span>
              </legend>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3" role={g.max === 1 ? "radiogroup" : "group"} aria-label={loc(g.name)}>
                {opts.map((m) => {
                  const on = picked[g.id]?.includes(m.id) ?? false;
                  const full = !on && g.max > 1 && n >= g.max;
                  return (
                    <motion.button
                      key={m.id}
                      type="button"
                      role={g.max === 1 ? "radio" : "checkbox"}
                      aria-checked={on}
                      disabled={!m.available || full}
                      whileTap={reduced ? undefined : { scale: 0.96 }}
                      transition={spring.snappy}
                      onClick={() => toggle(g, m)}
                      className={cn(
                        "flex min-h-14 items-center gap-2.5 rounded-xl border px-3 py-2 text-start transition-colors disabled:opacity-40",
                        on ? "border-primary bg-primary-soft text-ink" : "border-line bg-surface hover:border-line-strong",
                      )}
                    >
                      <span className={cn("grid size-5 shrink-0 place-items-center border-2 transition-colors", g.max === 1 ? "rounded-full" : "rounded-md", on ? "border-primary bg-primary text-primary-ink" : "border-line-strong")}>
                        {on ? <Check className="size-3.5" strokeWidth={3} /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14.5px] font-semibold leading-tight">{loc(m.name)}</span>
                        {m.price ? (
                          <span className="num text-[12.5px] text-muted" dir="ltr">
                            +{formatMoney(m.price, { lang, compact: true, bare: true })}
                          </span>
                        ) : null}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-[13px] font-semibold text-ink-2">{L("الكرسي", "Seat")}</p>
            <div className="flex flex-wrap gap-1.5">
              {[null, ...Array.from({ length: Math.max(1, Math.min(guests, 12)) }, (_, i) => i + 1)].map((s) => (
                <button key={String(s)} type="button" onClick={() => setSeat(s)} aria-pressed={seat === s} className={cn("num h-10 min-w-10 rounded-xl border px-3 text-[14px] font-semibold", seat === s ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface hover:bg-surface-2")}>
                  {s ?? L("مشترك", "Shared")}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[13px] font-semibold text-ink-2">{L("الكورس", "Course")}</p>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3].map((c) => (
                <button key={c} type="button" onClick={() => setCourse(c)} aria-pressed={course === c} className={cn("h-10 rounded-xl border px-3 text-[14px] font-semibold", course === c ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface hover:bg-surface-2")}>
                  {c === 1 ? L("١ · مقبلات", "1 · Starters") : c === 2 ? L("٢ · رئيسي", "2 · Mains") : L("٣ · حلو", "3 · Dessert")}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="mod-notes" className="mb-2 block text-[13px] font-semibold text-ink-2">
            {L("ملاحظات للمطبخ", "Kitchen notes")}
          </label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK_NOTES.map((n) => (
              <button key={n.en} type="button" onClick={() => setNotes((v) => (v.includes(n[lang]) ? v : v ? `${v}، ${n[lang]}` : n[lang]))} className="h-9 rounded-full border border-line bg-surface-2 px-3 text-[13px] font-medium hover:bg-surface-3">
                {n[lang]}
              </button>
            ))}
          </div>
          <textarea id="mod-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={140} className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] outline-none focus:border-primary focus:shadow-[var(--sf-glow)]" placeholder={L("مثلاً: الصوص على جنب", "e.g. sauce on the side")} />
        </div>
        {tried && missing.length ? (
          <p className="flex items-center gap-2 text-[14px] font-semibold text-danger" role="alert">
            <CircleAlert className="size-4" /> {L("اختار", "Choose")}: {missing.map((g) => loc(g.name)).join("، ")}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

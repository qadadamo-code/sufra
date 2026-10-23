/** Small POS building blocks: category icons, chips, steppers, the money keypad. */
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { CakeSlice, Coffee, CupSoda, Delete, Flame, Leaf, Minus, Plus, Salad, Soup, Utensils, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n/i18n";
import { formatMoney, major, type Units } from "@/lib/money";
import { spring, useReduced } from "@/ui";

const ICONS: Record<string, LucideIcon> = { flame: Flame, soup: Soup, leaf: Leaf, salad: Salad, utensils: Utensils, "cake-slice": CakeSlice, coffee: Coffee, "cup-soda": CupSoda };
export const catIcon = (name: string | undefined): LucideIcon => (name && ICONS[name]) || UtensilsCrossed;

export function Chip({ active, onClick, children, className, color, count }: { active?: boolean; onClick?: () => void; children: ReactNode; className?: string; color?: string; count?: number | null }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "relative inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-[14.5px] font-semibold transition-[background-color,border-color,color,box-shadow] duration-150 active:scale-[0.97] [&_svg]:size-[18px]",
        active ? "border-transparent bg-ink text-bg shadow-sf" : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink",
        className,
      )}
      style={active && color ? { background: color, color: "#fff" } : undefined}
    >
      {children}
      {count ? <span className={cn("grid min-w-5 place-items-center rounded-full px-1 text-[11.5px] font-bold leading-5", active ? "bg-white/25" : "bg-primary-soft text-primary")}>{count}</span> : null}
    </button>
  );
}

export function Stepper({ value, onChange, min = 0, max = 99, size = "md", label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; size?: "sm" | "md"; label: string }) {
  const { L } = useT();
  const b = size === "sm" ? "size-9 rounded-[10px]" : "size-11 rounded-xl";
  return (
    <div className="inline-flex items-center gap-1 rounded-[14px] border border-line bg-surface-2 p-1" role="group" aria-label={label}>
      <button type="button" className={cn(b, "grid place-items-center text-ink-2 hover:bg-surface-3 active:scale-95 disabled:opacity-40")} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} aria-label={L("أقل", "Less")}>
        <Minus className="size-4" />
      </button>
      <span className={cn("num min-w-8 text-center font-semibold", size === "sm" ? "text-[15px]" : "text-[18px]")} aria-live="polite">
        {value}
      </span>
      <button type="button" className={cn(b, "grid place-items-center text-ink-2 hover:bg-surface-3 active:scale-95 disabled:opacity-40")} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} aria-label={L("أكتر", "More")}>
        <Plus className="size-4" />
      </button>
    </div>
  );
}

/** Amount keypad that edits a piastre string ("12345" → 123.45). */
export function MoneyKeypad({ value, onChange, className }: { value: Units; onChange: (u: Units) => void; className?: string }) {
  const { L } = useT();
  const reduced = useReduced();
  const piastres = Math.round(value / 1000);
  const press = (k: string) => {
    if (k === "del") return onChange(Math.floor(piastres / 10) * 1000);
    if (k === "00") return onChange(Math.min(piastres * 100, 99_999_999) * 1000);
    if (k === "c") return onChange(0);
    onChange(Math.min(piastres * 10 + Number(k), 99_999_999) * 1000);
  };
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "del"];
  return (
    <div className={cn("grid grid-cols-3 gap-2", className)} dir="ltr">
      {keys.map((k) => (
        <motion.button
          key={k}
          type="button"
          whileTap={reduced ? undefined : { scale: 0.94 }}
          transition={spring.snappy}
          onClick={() => press(k)}
          onContextMenu={(e) => (k === "del" ? (e.preventDefault(), press("c")) : undefined)}
          className="num grid h-14 place-items-center rounded-2xl border border-line bg-surface text-[22px] font-semibold shadow-sf-sm hover:bg-surface-2"
          aria-label={k === "del" ? L("امسح", "Delete") : k}
        >
          {k === "del" ? <Delete className="size-6" /> : k}
        </motion.button>
      ))}
    </div>
  );
}

export const egpLabel = (u: Units, lang: "ar" | "en") => formatMoney(u, { lang });
export const MAJOR = major;

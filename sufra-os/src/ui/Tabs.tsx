import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { useTransition, spring } from "./motion";

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
}

/** Underline tabs with a sliding indicator and arrow-key navigation (RTL-aware). */
export function Tabs<T extends string>({ value, onChange, items, label, className }: { value: T; onChange: (v: T) => void; items: TabItem<T>[]; label: string; className?: string }) {
  const id = useId();
  const tr = useTransition(spring.layout);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const rtl = document.documentElement.dir === "rtl";
    const next = e.key === "ArrowRight" ? (rtl ? -1 : 1) : e.key === "ArrowLeft" ? (rtl ? 1 : -1) : 0;
    if (!next) return;
    e.preventDefault();
    const j = (i + next + items.length) % items.length;
    refs.current[j]?.focus();
    onChange(items[j].value);
  };
  return (
    <div role="tablist" aria-label={label} className={cn("flex gap-1 overflow-x-auto border-b border-line no-scrollbar", className)}>
      {items.map((t, i) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => onChange(t.value)}
            className={cn("relative inline-flex h-11 shrink-0 items-center gap-2 px-3.5 text-[14.5px] font-semibold transition-colors [&_svg]:size-4", on ? "text-ink" : "text-muted hover:text-ink")}
          >
            {t.icon}
            {t.label}
            {t.count != null ? <span className={cn("num rounded-full px-1.5 text-[11.5px]", on ? "bg-primary text-primary-ink" : "bg-surface-3 text-muted")}>{t.count}</span> : null}
            {on ? <motion.span layoutId={`tab-${id}`} className="absolute inset-x-2 -bottom-px h-[2.5px] rounded-full bg-primary" transition={tr} /> : null}
          </button>
        );
      })}
    </div>
  );
}

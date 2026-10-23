import { useId, type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { useTransition, spring } from "./motion";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
}

/** Radio group with a sliding thumb. Touch-friendly (44px) by default. */
export function Segmented<T extends string>({ value, onChange, options, label, size = "md", block, className }: { value: T; onChange: (v: T) => void; options: SegmentOption<T>[]; label: string; size?: "sm" | "md"; block?: boolean; className?: string }) {
  const id = useId();
  const tr = useTransition(spring.layout);
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex max-w-full gap-1 overflow-x-auto rounded-[14px] border border-line bg-surface-2 p-1 no-scrollbar", block && "flex w-full", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[10px] font-semibold transition-colors",
              size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-[14.5px]",
              block && "flex-1",
              on ? "text-ink" : "text-muted hover:text-ink",
            )}
          >
            {on ? <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-[10px] bg-surface shadow-sf-sm ring-1 ring-line" transition={tr} /> : null}
            <span className="relative inline-flex items-center gap-1.5 [&_svg]:size-4">
              {o.icon}
              {o.label}
              {o.badge != null ? <span className="rounded-full bg-primary-soft px-1.5 text-[11px] font-bold text-primary">{o.badge}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

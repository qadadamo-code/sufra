/** Small single-series charts (teal bars, 4px rounded tops, recessive grid, hover/focus tooltip). Time runs LTR. */
import { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { useReduced } from "./motion";
import type { Tone } from "./Badge";

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  tip: string;
}

export function BarChart({ data, height = 180, className, highlight, ariaLabel }: { data: BarDatum[]; height?: number; className?: string; highlight?: string; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const reduced = useReduced();
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure className={cn("relative", className)} aria-label={ariaLabel} role="img">
      <div className="relative flex items-end gap-1.5" style={{ height }} dir="ltr" onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <span key={g} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line/80" style={{ bottom: `${g * 100}%` }} aria-hidden />
        ))}
        {data.map((d, i) => (
          <span key={d.key} className="relative flex h-full min-w-0 flex-1 items-end" onMouseEnter={() => setHover(i)}>
            <motion.span
              initial={reduced ? false : { height: 0 }}
              animate={{ height: `${Math.max(d.value > 0 ? 2 : 0, (d.value / max) * 100)}%` }}
              transition={{ delay: reduced ? 0 : i * 0.025, type: "spring", stiffness: 200, damping: 26 }}
              className={cn("block w-full rounded-t-[4px] transition-colors", hover === i ? "bg-brass" : d.key === highlight ? "bg-primary" : "bg-primary/55")}
            />
          </span>
        ))}
        {hover !== null ? (
          <span
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-[12px] font-semibold text-bg shadow"
            style={{ left: `${((hover + 0.5) / data.length) * 100}%`, bottom: `${(data[hover].value / max) * 100}%`, marginBottom: 6 }}
          >
            {data[hover].tip}
          </span>
        ) : null}
      </div>
      <figcaption className="mt-1.5 flex gap-1.5 text-[11px] text-muted" dir="ltr">
        {data.map((d, i) => (
          <span key={d.key} className="num min-w-0 flex-1 text-center">
            {i % 2 === 0 ? d.label : ""}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

const METER: Record<Tone, string> = { neutral: "bg-faint", primary: "bg-primary", brass: "bg-brass", ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", info: "bg-info" };

export function Meter({ value, max = 1, tone = "primary", className, label }: { value: number; max?: number; tone?: Tone; className?: string; label: string }) {
  const reduced = useReduced();
  const pct = Math.max(0, Math.min(1, value / (max || 1)));
  return (
    <span className={cn("block h-2 overflow-hidden rounded-full bg-surface-3", className)} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <motion.span initial={reduced ? false : { width: 0 }} animate={{ width: `${pct * 100}%` }} transition={{ type: "spring", stiffness: 160, damping: 26 }} className={cn("block h-full rounded-full", METER[tone])} />
    </span>
  );
}

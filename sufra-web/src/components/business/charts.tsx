/** Small single-series charts (teal, thin marks, 4px rounded ends, recessive axis, hover tooltip). */
import { useState } from "react";
import { cn } from "@/lib/utils";

export interface Bar {
  key: string;
  label: string;
  value: number;
  /** tooltip text */
  tip: string;
}

/** Vertical bars anchored to the baseline. Always LTR in time (oldest → newest). */
export function BarChart({ data, height = 160, className, highlightLast, axis, ariaLabel }: { data: Bar[]; height?: number; className?: string; highlightLast?: boolean; axis?: { first: string; last: string }; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const gap = data.length > 60 ? 1 : 2;
  return (
    <figure className={cn("relative", className)} aria-label={ariaLabel} role="img">
      <div className="relative flex items-end" style={{ height, gap }} dir="ltr" onMouseLeave={() => setHover(null)}>
        {/* recessive gridlines */}
        {[0.25, 0.5, 0.75].map((g) => (
          <span key={g} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border/70" style={{ bottom: `${g * 100}%` }} aria-hidden />
        ))}
        {data.map((d, i) => (
          <span key={d.key} className="relative flex h-full min-w-0 flex-1 items-end" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1}>
            <span
              className={cn("block w-full rounded-t-[4px] transition-colors", hover === i ? "bg-brass" : highlightLast && i === data.length - 1 ? "bg-primary" : "bg-primary/70")}
              style={{ height: `${Math.max(d.value > 0 ? 2 : 0, (d.value / max) * 100)}%` }}
            />
          </span>
        ))}
        {hover !== null ? (
          <span className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-foreground px-2 py-1 text-[12px] font-semibold text-background shadow" style={{ left: `${((hover + 0.5) / data.length) * 100}%`, bottom: `${(data[hover].value / max) * 100}%`, marginBottom: 6 }}>
            {data[hover].tip}
          </span>
        ) : null}
      </div>
      {axis ? (
        <figcaption className="mt-1 flex justify-between text-[11px] text-muted-foreground" dir="ltr">
          <span>{axis.first}</span>
          <span>{axis.last}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}

/** Horizontal meter (share of a whole). */
export function Meter({ value, max = 1, tone = "primary", className, label }: { value: number; max?: number; tone?: "primary" | "brass" | "warn" | "danger" | "ok"; className?: string; label: string }) {
  const pct = Math.max(0, Math.min(1, value / max));
  const bg = { primary: "bg-primary", brass: "bg-brass", warn: "bg-warn", danger: "bg-danger", ok: "bg-ok" }[tone];
  return (
    <span className={cn("block h-2 overflow-hidden rounded-full bg-muted", className)} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span className={cn("block h-full rounded-full", bg)} style={{ width: `${pct * 100}%` }} />
    </span>
  );
}

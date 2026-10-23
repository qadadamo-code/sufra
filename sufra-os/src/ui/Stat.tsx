import type { ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import type { Tone } from "./Badge";
import { useReduced } from "./motion";

const ICON_TONE: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-2",
  primary: "bg-primary-soft text-primary",
  brass: "bg-brass-soft text-brass",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

/** KPI tile: label, big value, a sub line, optional sparkline values. */
export function StatTile({ label, value, sub, icon, tone = "primary", spark, className, index = 0 }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: Tone; spark?: number[]; className?: string; index?: number }) {
  const reduced = useReduced();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduced ? 0 : index * 0.05, type: "spring", stiffness: 300, damping: 30 }}
      className={cn("relative overflow-hidden rounded-[20px] border border-line bg-surface p-4 shadow-sf-sm sm:p-5", className)}
    >
      <div className="flex items-center gap-2.5">
        {icon ? <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-[18px]", ICON_TONE[tone])}>{icon}</span> : null}
        <p className="min-w-0 truncate text-[13.5px] font-semibold text-muted">{label}</p>
      </div>
      <div className="mt-3 truncate font-display text-[23px] font-semibold leading-none tracking-tight sm:text-[30px]">{value}</div>
      {spark && spark.length > 1 ? <Sparkline values={spark} className="absolute bottom-0 end-0 h-12 w-1/2 opacity-50" /> : null}
      {sub ? <div className="relative mt-2 truncate text-[12.5px] text-muted">{sub}</div> : null}
    </motion.div>
  );
}

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(1, ...values);
  const w = 100;
  const h = 30;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - (v / max) * (h - 4) - 2] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("pointer-events-none", className)} aria-hidden>
      <defs>
        <linearGradient id="sf-spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--sf-primary)" stopOpacity="0.22" />
          <stop offset="1" stopColor="var(--sf-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill="url(#sf-spark)" />
      <path d={line} fill="none" stroke="var(--sf-primary)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

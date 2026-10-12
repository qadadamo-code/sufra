// TaskSteps + useTaskSteps — the hook is from the owner's paste; the list is rebuilt from the spec.
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export type TaskStep = { id: string; label: string; meta?: string };
export type TaskStepStatus = "pending" | "active" | "done" | "error";
export function useTaskSteps({ steps, current, failed = false }: { steps: TaskStep[]; current: number; failed?: boolean }) {
  const complete = !failed && current >= steps.length;
  const rows = steps.map((step, i) => ({
    ...step,
    status: (i < current ? "done" : i === current && failed ? "error" : i === current && !complete ? "active" : "pending") as TaskStepStatus,
  }));
  const active = rows.find((r) => r.status === "active");
  const sentence = failed
    ? `Failed at ${steps[Math.min(current, steps.length - 1)]?.label ?? "step"}`
    : complete
      ? `All ${steps.length} steps complete`
      : active
        ? `${active.label}, step ${current + 1} of ${steps.length}`
        : "";
  return { rows, complete, failed, sentence };
}

const POP = { type: "spring", stiffness: 640, damping: 22, mass: 0.7 } as const;

/**
 * TaskSteps: an <ol> of rows; each row's 16px status cell swaps between done (tick on a tinted tile, POP spring),
 * error (cross), active (spinning arc) and pending (small square dot). The active label shimmers; `meta` fades in
 * when done; a role=status line announces the sentence 500 ms after it changes.
 */
export function TaskSteps({ steps, current, failed = false, label = "Task progress", className }: { steps: TaskStep[]; current: number; failed?: boolean; label?: string; className?: string }) {
  const reduced = useReducedMotion();
  const { rows, sentence } = useTaskSteps({ steps, current, failed });
  const [spoken, setSpoken] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setSpoken(sentence), 500);
    return () => clearTimeout(id);
  }, [sentence]);
  const t = reduced ? { duration: 0 } : POP;
  return (
    <div className={className}>
      <ol aria-label={label} className="grid gap-1">
        {rows.map((row, i) => (
          <li key={row.id} className="relative flex min-h-10 items-center gap-3">
            {i < rows.length - 1 ? (
              <span aria-hidden className={cn("absolute top-[30px] h-[calc(100%-20px)] w-px start-[11px]", row.status === "done" ? "bg-ok/50" : "bg-border")} />
            ) : null}
            <span className="relative grid size-6 shrink-0 place-items-center">
              <AnimatePresence initial={false} mode="popLayout">
                {row.status === "done" ? (
                  <motion.span key="d" className="grid size-6 place-items-center rounded-[7px] bg-ok/15 text-ok" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={t}>
                    <svg viewBox="0 0 12 12" className="size-3" fill="none" aria-hidden>
                      <path d="M2 6.2 4.7 8.9 10 3.3" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </motion.span>
                ) : row.status === "error" ? (
                  <motion.span key="e" className="grid size-6 place-items-center rounded-[7px] bg-danger/15 text-danger" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={t}>
                    <svg viewBox="0 0 12 12" className="size-3" fill="none" aria-hidden>
                      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
                    </svg>
                  </motion.span>
                ) : row.status === "active" ? (
                  <motion.svg key="a" viewBox="0 0 16 16" className="size-4 text-primary" initial={{ opacity: 0 }} animate={reduced ? { opacity: 1 } : { opacity: 1, rotate: 360 }} exit={{ opacity: 0 }} transition={reduced ? { duration: 0 } : { rotate: { duration: 0.9, ease: "linear", repeat: Infinity }, opacity: { duration: 0.15 } }} aria-hidden>
                    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2" />
                    <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </motion.svg>
                ) : (
                  <motion.span key="p" className="size-[6px] rounded-[1.5px] bg-muted-foreground/45" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
                )}
              </AnimatePresence>
            </span>
            <span
              className={cn(
                "flex-1 text-[15px] leading-6",
                row.status === "pending" && "text-muted-foreground",
                row.status === "done" && "text-foreground",
                row.status === "error" && "text-danger",
                row.status === "active" && "ts-shimmer font-semibold",
              )}
            >
              {row.label}
            </span>
            <AnimatePresence>
              {row.meta && row.status === "done" ? (
                <motion.span key="m" className="num text-xs text-muted-foreground" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {row.meta}
                </motion.span>
              ) : null}
            </AnimatePresence>
          </li>
        ))}
      </ol>
      <span role="status" className="sr-only">
        {spoken}
      </span>
      <style>{`.ts-shimmer{background:linear-gradient(90deg,var(--foreground) 0%,var(--foreground) 35%,var(--sf-primary) 50%,var(--foreground) 65%,var(--foreground) 100%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:ts-sh 1.6s linear infinite}@keyframes ts-sh{from{background-position:100% 0}to{background-position:-150% 0}}@media (prefers-reduced-motion:reduce){.ts-shimmer{animation:none;color:var(--foreground)}}`}</style>
    </div>
  );
}

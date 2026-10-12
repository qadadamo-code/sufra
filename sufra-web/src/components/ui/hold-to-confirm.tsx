// HoldToConfirm — rebuilt from the owner's spec (useHoldToConfirm + HoldToConfirm) in Sufra colours.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type HoldPhase = "idle" | "holding" | "releasing" | "committed";

export function useHoldToConfirm({
  onConfirm,
  onAbort,
  duration = 1800,
  releaseRate = 2.5,
  moveTolerance = 10,
  haptic = true,
  disabled = false,
}: {
  onConfirm: () => void;
  onAbort?: () => void;
  duration?: number;
  steps?: number;
  releaseRate?: number;
  moveTolerance?: number;
  haptic?: boolean;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<HoldPhase>("idle");
  const progress = useMotionValue(0); // 0..1
  const elapsed = useRef(0);
  const held = useRef(false);
  const raf = useRef(0);
  const last = useRef(0);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const phaseRef = useRef<HoldPhase>("idle");
  const confirmRef = useRef(onConfirm);
  confirmRef.current = onConfirm;
  const abortRef = useRef(onAbort);
  abortRef.current = onAbort;

  const set = (p: HoldPhase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const loop = useCallback(
    (now: number) => {
      const dt = Math.min(64, now - last.current);
      last.current = now;
      if (held.current) elapsed.current += dt;
      else elapsed.current = Math.max(0, elapsed.current - dt * releaseRate);
      progress.set(Math.min(1, elapsed.current / duration));
      if (elapsed.current >= duration) {
        held.current = false;
        set("committed");
        if (haptic) navigator.vibrate?.(14);
        confirmRef.current();
        raf.current = 0;
        return;
      }
      if (!held.current && elapsed.current <= 0) {
        set("idle");
        raf.current = 0;
        return;
      }
      raf.current = requestAnimationFrame(loop);
    },
    [duration, haptic, progress, releaseRate],
  );

  const start = useCallback(
    (x = 0, y = 0) => {
      if (disabled || phaseRef.current === "committed") return;
      held.current = true;
      origin.current = { x, y };
      set("holding");
      if (!raf.current) {
        last.current = performance.now();
        raf.current = requestAnimationFrame(loop);
      }
    },
    [disabled, loop],
  );
  const release = useCallback(() => {
    if (!held.current) return;
    held.current = false;
    if (phaseRef.current === "holding") {
      set("releasing");
      abortRef.current?.();
    }
  }, []);
  const move = useCallback(
    (x: number, y: number) => {
      const o = origin.current;
      if (held.current && o && Math.hypot(x - o.x, y - o.y) > moveTolerance) release();
    },
    [moveTolerance, release],
  );
  const reset = useCallback(() => {
    held.current = false;
    elapsed.current = 0;
    progress.set(0);
    set("idle");
  }, [progress]);

  useEffect(() => {
    const cancel = () => release();
    const vis = () => document.hidden && release();
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", vis);
      cancelAnimationFrame(raf.current);
    };
  }, [release]);

  return { phase, progress, start, release, move, reset };
}

export function HoldToConfirm({
  label,
  confirmLabel,
  hint,
  onConfirm,
  duration = 1800,
  resetAfter = 1600,
  disabled = false,
  className,
}: {
  label: string;
  confirmLabel: string;
  /** sr-only hint, e.g. "Press and hold for 2 seconds to confirm" */
  hint?: string;
  onConfirm: () => void;
  duration?: number;
  resetAfter?: number;
  disabled?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const hintId = useId();
  const { phase, progress, start, release, move, reset } = useHoldToConfirm({ onConfirm, duration, disabled });
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  // reveal the filled copy from the start edge (right in RTL)
  const clip = useTransform(progress, (p) => (rtl ? `inset(0 0 0 ${(1 - p) * 100}%)` : `inset(0 ${(1 - p) * 100}% 0 0)`));
  const done = phase === "committed";

  useEffect(() => {
    if (!done) return;
    const id = setTimeout(reset, resetAfter);
    return () => clearTimeout(id);
  }, [done, reset, resetAfter]);

  return (
    <button
      type="button"
      disabled={disabled}
      aria-describedby={hintId}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start(e.clientX, e.clientY);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onPointerMove={(e) => move(e.clientX, e.clientY)}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          start();
        }
        if (e.key === "Escape") release();
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") release();
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        "relative inline-grid h-10 select-none overflow-hidden rounded-full border border-danger/40 bg-danger-soft px-5 text-sm font-semibold text-danger [touch-action:none] disabled:opacity-50",
        className,
      )}
    >
      <motion.span className="col-start-1 row-start-1 flex items-center justify-center gap-2" animate={{ opacity: done ? 0 : 1 }}>
        {label}
      </motion.span>
      <motion.span aria-hidden className="absolute inset-0 flex items-center justify-center gap-2 bg-danger text-white" style={{ clipPath: clip }} animate={{ opacity: done ? 0 : 1 }}>
        {label}
      </motion.span>
      <motion.span aria-hidden={!done} className="absolute inset-0 flex items-center justify-center gap-2 bg-danger text-white" initial={false} animate={{ opacity: done ? 1 : 0, scale: done || reduced ? 1 : 0.96 }}>
        <Check className="size-4" aria-hidden />
        {confirmLabel}
      </motion.span>
      <span id={hintId} className="sr-only">
        {hint ?? `Press and hold for ${Math.round(duration / 100) / 10} seconds to confirm`}
      </span>
    </button>
  );
}

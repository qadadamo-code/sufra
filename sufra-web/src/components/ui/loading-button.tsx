// LoadingButton + useAsyncAction — useAsyncAction is from the owner's paste; the button is rebuilt from the spec.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertCircle, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type AsyncActionStatus = "idle" | "pending" | "success" | "error";
export function useAsyncAction({ action, resetAfter = 1400, onError }: { action: () => unknown; resetAfter?: number; onError?: (error: unknown) => void }) {
  const [status, setStatus] = useState<AsyncActionStatus>("idle");
  const phase = useRef<AsyncActionStatus>("idle");
  const runId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const act = useRef(action);
  const fail = useRef(onError);
  useEffect(() => {
    act.current = action;
    fail.current = onError;
  });
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current), (timer.current = null);
  }, []);
  const reset = useCallback(() => {
    runId.current += 1;
    clear();
    phase.current = "idle";
    setStatus("idle");
  }, [clear]);
  const run = useCallback(() => {
    if (phase.current === "pending") return;
    clear();
    const id = ++runId.current;
    phase.current = "pending";
    setStatus("pending");
    const settle = (next: "success" | "error") => {
      if (!alive.current || id !== runId.current) return;
      clear();
      phase.current = next;
      setStatus(next);
      timer.current = setTimeout(() => {
        if (!alive.current || id !== runId.current) return;
        phase.current = "idle";
        setStatus("idle");
      }, resetAfter);
    };
    Promise.resolve()
      .then(() => act.current())
      .then(
        () => settle("success"),
        (error: unknown) => {
          fail.current?.(error);
          settle("error");
        },
      );
  }, [clear, resetAfter]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clear();
    };
  }, [clear]);
  return { status, run, reset, pending: status === "pending" };
}

const SWAP = { type: "spring", stiffness: 380, damping: 32, mass: 0.7 } as const;

/**
 * LoadingButton: idle / pending (spinning arc) / success (check) / error (alert) faces stacked in one grid cell
 * and crossfaded; aria-busy while pending; a role=status line announces success/error.
 */
export function LoadingButton({
  onAction,
  children,
  pendingLabel = "Working…",
  successLabel = "Done",
  errorLabel = "Try again",
  resetAfter = 1400,
  disabled = false,
  onError,
  variant = "primary",
  className,
  type = "button",
}: {
  onAction: () => unknown;
  children: ReactNode;
  pendingLabel?: string;
  successLabel?: string;
  errorLabel?: string;
  resetAfter?: number;
  disabled?: boolean;
  onError?: (error: unknown) => void;
  variant?: "primary" | "neutral" | "brass";
  className?: string;
  type?: "button" | "submit";
}) {
  const reduced = useReducedMotion();
  const { status, run } = useAsyncAction({ action: onAction, resetAfter, onError });
  const t = reduced ? { duration: 0 } : SWAP;
  const face = (key: string, node: ReactNode) => (
    <motion.span
      key={key}
      className="col-start-1 row-start-1 inline-flex items-center justify-center gap-2 whitespace-nowrap"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, filter: "blur(4px)" }}
      transition={t}
    >
      {node}
    </motion.span>
  );
  const tone =
    status === "success"
      ? "bg-ok text-white border-ok"
      : status === "error"
        ? "bg-danger text-white border-danger"
        : variant === "primary"
          ? "bg-primary text-primary-foreground border-primary hover:brightness-110"
          : variant === "brass"
            ? "bg-brass text-brass-ink border-brass hover:brightness-110"
            : "bg-card text-foreground border-border shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] hover:bg-surface-2";
  return (
    <>
      <motion.button
        type={type}
        onClick={run}
        disabled={disabled || status === "pending"}
        aria-busy={status === "pending" || undefined}
        whileTap={reduced ? undefined : { y: 1 }}
        className={cn(
          "inline-grid h-12 items-center justify-items-center rounded-full border px-6 text-[15px] font-semibold transition-[background-color,color,border-color,filter] duration-200 disabled:cursor-not-allowed disabled:opacity-60 aria-busy:opacity-100",
          tone,
          className,
        )}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {status === "pending"
            ? face(
                "p",
                <>
                  <motion.svg viewBox="0 0 16 16" className="size-4" animate={reduced ? undefined : { rotate: 360 }} transition={{ duration: 0.8, ease: "linear", repeat: Infinity }} aria-hidden>
                    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="2" />
                    <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </motion.svg>
                  {pendingLabel}
                </>,
              )
            : status === "success"
              ? face("s", <><Check className="size-4" aria-hidden />{successLabel}</>)
              : status === "error"
                ? face("e", <><AlertCircle className="size-4" aria-hidden />{errorLabel}</>)
                : face("i", children)}
        </AnimatePresence>
      </motion.button>
      <span role="status" className="sr-only">
        {status === "success" ? successLabel : status === "error" ? errorLabel : ""}
      </span>
    </>
  );
}

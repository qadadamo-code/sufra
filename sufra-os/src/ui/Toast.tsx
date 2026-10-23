import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { spring, useReduced } from "./motion";

export type ToastTone = "default" | "success" | "error" | "warn";
export interface ToastInput {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  /** ms; 0 = sticky */
  duration?: number;
}
interface ToastItem extends ToastInput {
  id: number;
}

const Ctx = createContext<{ toast: (t: ToastInput) => number; dismiss: (id: number) => void } | null>(null);

const ICON: Record<ToastTone, ReactNode> = {
  default: <Info className="size-5 text-info" aria-hidden />,
  success: <CheckCircle2 className="size-5 text-ok" aria-hidden />,
  error: <XCircle className="size-5 text-danger" aria-hidden />,
  warn: <AlertTriangle className="size-5 text-warn" aria-hidden />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const reduced = useReduced();
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: ToastInput) => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      const d = t.duration ?? (t.tone === "error" ? 6000 : 3500);
      if (d > 0) setTimeout(() => dismiss(id), d);
      return id;
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {typeof document !== "undefined"
        ? createPortal(
            <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:items-end md:pb-6 md:pe-6" aria-live="polite" aria-relevant="additions">
              <AnimatePresence initial={false}>
                {items.map((t) => (
                  <motion.div
                    key={t.id}
                    layout={!reduced}
                    initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, transition: { duration: 0.15 } }}
                    transition={spring.snappy}
                    role={t.tone === "error" ? "alert" : "status"}
                    className={cn("pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-line bg-surface/95 p-3.5 shadow-sf-lg backdrop-blur-xl")}
                  >
                    <span className="mt-0.5 shrink-0">{ICON[t.tone ?? "default"]}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14.5px] font-semibold leading-snug">{t.title}</p>
                      {t.description ? <p className="mt-0.5 text-[13px] text-muted">{t.description}</p> : null}
                    </div>
                    {t.action ? (
                      <button
                        type="button"
                        className="shrink-0 rounded-lg px-2 py-1 text-[13.5px] font-bold text-primary hover:bg-primary-soft"
                        onClick={() => {
                          t.action!.onClick();
                          dismiss(t.id);
                        }}
                      >
                        {t.action.label}
                      </button>
                    ) : null}
                    <button type="button" aria-label="×" className="-me-1 grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-3" onClick={() => dismiss(t.id)}>
                      <X className="size-4" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>,
            document.body,
          )
        : null}
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast outside ToastProvider");
  return c;
}

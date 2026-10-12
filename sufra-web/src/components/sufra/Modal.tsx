import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Bottom sheet on phones, centred dialog on larger screens. */
export function Modal({ open, onClose, title, children, footer, className }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; className?: string }) {
  const { L } = useLang();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => ref.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6">
          <motion.div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            ref={ref}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn("relative flex max-h-[92svh] w-full flex-col rounded-t-[28px] bg-background shadow-2xl outline-none sm:max-w-xl sm:rounded-[28px]", className)}
            initial={reduced ? { opacity: 0 } : { y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
          >
            <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
              <h2 className="text-xl font-bold">{title}</h2>
              <button type="button" onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-card" aria-label={L("اقفل", "Close")}>
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer ? <div className="border-t px-5 py-4 pb-[max(16px,env(safe-area-inset-bottom))]">{footer}</div> : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

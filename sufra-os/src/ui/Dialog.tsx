import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, type PanInfo } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n/i18n";
import { HotkeyScope, useHotkeys } from "./hotkeys";
import { IconButton } from "./Button";
import { spring, useReduced } from "./motion";
import { useIsMobile } from "./useMedia";

let locks = 0;
function useScrollLock(on: boolean) {
  useEffect(() => {
    if (!on) return;
    if (locks++ === 0) document.documentElement.style.overflow = "hidden";
    return () => {
      if (--locks === 0) document.documentElement.style.overflow = "";
    };
  }, [on]);
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function useFocusTrap(open: boolean, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const t = setTimeout(() => {
      const first = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? el)?.focus({ preventScroll: true });
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, [open, ref]);
}

function EscToClose({ onClose }: { onClose: () => void }) {
  useHotkeys({ escape: onClose });
  return null;
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** "auto": centred on desktop, bottom sheet on phones. "sheet-end": side panel. "bottom": always bottom sheet. */
  variant?: "auto" | "sheet-end" | "bottom";
  hideClose?: boolean;
  className?: string;
  /** false = clicking the backdrop does nothing (e.g. PIN approval) */
  dismissible?: boolean;
}

const WIDTH = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" };

export function Dialog({ open, onClose, title, description, children, footer, size = "md", variant = "auto", hideClose, className, dismissible = true }: DialogProps) {
  const isMobile = useIsMobile();
  const reduced = useReduced();
  const { t } = useT();
  const titleId = useId();
  const descId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useScrollLock(open);
  useFocusTrap(open, panel);

  const mode = variant === "sheet-end" ? (isMobile ? "bottom" : "end") : variant === "bottom" || isMobile ? "bottom" : "center";
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const offX = rtl ? "-100%" : "100%";

  const motionProps =
    mode === "bottom"
      ? { initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%" } }
      : mode === "end"
        ? { initial: { x: offX }, animate: { x: 0 }, exit: { x: offX } }
        : { initial: { opacity: 0, scale: 0.96, y: 8 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.97, y: 4 } };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose();
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <HotkeyScope>
          <EscToClose onClose={dismissible ? onClose : () => {}} />
          <div className={cn("fixed inset-0 z-[80] flex", mode === "center" ? "items-center justify-center p-4" : mode === "bottom" ? "items-end" : "justify-end")}>
            <motion.div
              className="absolute inset-0 bg-[var(--sf-overlay)] backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.2 }}
              onClick={dismissible ? onClose : undefined}
              aria-hidden
            />
            <motion.div
              ref={panel}
              role="dialog"
              aria-modal="true"
              aria-labelledby={title ? titleId : undefined}
              aria-describedby={description ? descId : undefined}
              tabIndex={-1}
              {...(reduced ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : motionProps)}
              transition={reduced ? { duration: 0 } : mode === "center" ? spring.snappy : spring.sheet}
              drag={mode === "bottom" && !reduced ? "y" : false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={mode === "bottom" ? onDragEnd : undefined}
              className={cn(
                "relative flex max-h-full w-full flex-col bg-surface text-ink shadow-sf-lg outline-none",
                mode === "center" && cn("max-h-[min(88dvh,820px)] rounded-[22px] border border-line", WIDTH[size]),
                mode === "bottom" && "max-h-[92dvh] rounded-t-[26px] border-t border-line pb-[env(safe-area-inset-bottom)]",
                mode === "end" && cn("h-full border-s border-line", size === "sm" ? "max-w-sm" : size === "md" ? "max-w-md" : size === "lg" ? "max-w-xl" : "max-w-3xl"),
                className,
              )}
            >
              {mode === "bottom" ? <div className="mx-auto mt-2.5 h-1.5 w-11 shrink-0 cursor-grab rounded-full bg-line-strong" aria-hidden /> : null}
              {title || !hideClose ? (
                <div className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-2 sm:px-6 sm:pt-5">
                  <div className="min-w-0 flex-1">
                    {title ? (
                      <h2 id={titleId} className="text-[20px] font-semibold leading-snug">
                        {title}
                      </h2>
                    ) : null}
                    {description ? (
                      <p id={descId} className="mt-1 text-[14px] text-muted">
                        {description}
                      </p>
                    ) : null}
                  </div>
                  {!hideClose ? (
                    <IconButton label={t("common.close")} size="sm" onClick={onClose} className="-me-2 -mt-1">
                      <X />
                    </IconButton>
                  ) : null}
                </div>
              ) : null}
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 thin-scrollbar sm:px-6">{children}</div>
              {footer ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2/60 px-5 py-3.5 sm:px-6">{footer}</div> : null}
            </motion.div>
          </div>
        </HotkeyScope>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/** Side panel on desktop, bottom sheet on phones. */
export function Sheet(props: Omit<DialogProps, "variant">) {
  return <Dialog {...props} variant="sheet-end" />;
}

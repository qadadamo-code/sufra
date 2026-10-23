import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";
import { HotkeyScope, useHotkeys } from "./hotkeys";
import { spring, useReduced } from "./motion";

/**
 * Anchored popover (menus, switchers). Closes on outside click and Escape.
 * `trigger` receives the open state and the props to spread on the trigger button.
 */
export function Popover({ trigger, children, align = "start", side = "bottom", className, width = "w-72" }: {
  trigger: (p: { open: boolean; props: { "aria-expanded": boolean; "aria-haspopup": "menu"; "aria-controls": string; onClick: () => void } }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end";
  side?: "bottom" | "top";
  className?: string;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReduced();
  useEffect(() => {
    if (!open) return;
    const on = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", on);
    return () => document.removeEventListener("pointerdown", on);
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div ref={root} className="relative">
      {trigger({ open, props: { "aria-expanded": open, "aria-haspopup": "menu", "aria-controls": id, onClick: () => setOpen((v) => !v) } })}
      <AnimatePresence>
        {open ? (
          <HotkeyScope>
            <PopEsc onClose={close} />
            <motion.div
              id={id}
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: side === "bottom" ? -6 : 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
              transition={spring.snappy}
              style={{ transformOrigin: side === "bottom" ? "top" : "bottom" }}
              className={cn(
                "absolute z-[70] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-sf-lg",
                width,
                side === "bottom" ? "top-[calc(100%+8px)]" : "bottom-[calc(100%+8px)]",
                align === "start" ? "start-0" : "end-0",
                className,
              )}
            >
              {typeof children === "function" ? children(close) : children}
            </motion.div>
          </HotkeyScope>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function PopEsc({ onClose }: { onClose: () => void }) {
  useHotkeys({ escape: onClose });
  return null;
}

export function MenuItem({ icon, children, onClick, active, danger, end, disabled }: { icon?: ReactNode; children: ReactNode; onClick?: () => void; active?: boolean; danger?: boolean; end?: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-start text-[14.5px] font-medium transition-colors [&_svg]:size-[18px] [&_svg]:shrink-0",
        danger ? "text-danger hover:bg-danger-soft" : "hover:bg-surface-3",
        active && "bg-primary-soft text-primary hover:bg-primary-soft",
        disabled && "opacity-50",
      )}
    >
      {icon ? <span className={cn(active ? "text-primary" : danger ? "text-danger" : "text-muted")}>{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {end}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-3 pt-2 pb-1 text-[11.5px] font-semibold tracking-wide text-faint">{children}</p>;
}
export function MenuSeparator() {
  return <div className="my-1.5 h-px bg-line" role="separator" />;
}

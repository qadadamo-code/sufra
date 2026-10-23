import { Fragment } from "react";
import { cn } from "@/lib/cn";
import { comboKeys } from "./hotkeys";

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-grid h-5.5 min-w-5.5 place-items-center rounded-md border border-line border-b-2 bg-surface px-1.5 font-mono text-[11px] font-semibold leading-none text-muted", className)} dir="ltr">
      {children}
    </kbd>
  );
}

/** <Combo combo="mod+k" /> → ⌘ K */
export function Combo({ combo, className }: { combo: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} dir="ltr">
      {comboKeys(combo).map((step, i) => (
        <Fragment key={i}>
          {i > 0 ? <span className="text-[11px] text-faint">·</span> : null}
          {step.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </Fragment>
      ))}
    </span>
  );
}

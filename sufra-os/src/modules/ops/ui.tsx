/** Small shared UI for the ops screens. */
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/cn";

export function SubNav({ items, label }: { items: { to: string; label: ReactNode; end?: boolean; badge?: number | null; hidden?: boolean }[]; label: string }) {
  return (
    <nav className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 no-scrollbar md:mx-0 md:px-0" aria-label={label}>
      {items
        .filter((i) => !i.hidden)
        .map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.end}
            className={({ isActive }) => cn("relative -mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-[14.5px] font-semibold transition-colors", isActive ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink")}
          >
            {i.label}
            {i.badge ? <span className="num grid min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-bold text-white">{i.badge}</span> : null}
          </NavLink>
        ))}
    </nav>
  );
}

export function BetaBadge({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-brass/50 bg-brass-soft px-2 py-0.5 text-[11.5px] font-bold uppercase tracking-wide text-brass-text">{children}</span>;
}

export function KV({ k, v, mono }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[13.5px]">
      <span className="text-muted">{k}</span>
      <span className={cn("min-w-0 truncate text-end font-semibold", mono && "font-mono text-[12.5px]")}>{v}</span>
    </div>
  );
}

export function copyText(s: string) {
  try {
    void navigator.clipboard?.writeText(s);
    return true;
  } catch {
    return false;
  }
}

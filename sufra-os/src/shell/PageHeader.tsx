import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function PageHeader({ title, subtitle, icon, actions, className, kicker }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; actions?: ReactNode; className?: string; kicker?: ReactNode }) {
  return (
    <header className={cn("flex flex-wrap items-end gap-x-6 gap-y-3", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        {icon ? <span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-line bg-surface text-primary shadow-sf-sm [&_svg]:size-6">{icon}</span> : null}
        <div className="min-w-0">
          {kicker ? <div className="mb-0.5 text-[12.5px] font-semibold text-brass">{kicker}</div> : null}
          <h1 className="truncate text-[26px] leading-tight sm:text-[30px]">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-[14px] text-muted">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

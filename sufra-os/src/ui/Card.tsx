import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, children, interactive, ...rest }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-[20px] border border-line bg-surface shadow-sf-sm",
        interactive && "transition-[box-shadow,transform,border-color] duration-200 ease-[var(--ease-sf)] hover:-translate-y-0.5 hover:border-line-strong hover:shadow-sf",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, icon, action, className }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 px-5 pt-4 pb-3", className)}>
      {icon ? <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-3 text-ink-2 [&_svg]:size-[18px]">{icon}</span> : null}
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-sans text-[15.5px] font-bold">{title}</h3>
        {subtitle ? <p className="truncate text-[12.5px] text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

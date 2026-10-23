import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function EmptyState({ icon, title, body, action, className, compact }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14", className)}>
      {icon ? (
        <span className={cn("relative grid place-items-center rounded-2xl bg-surface-3 text-muted", compact ? "size-11 [&_svg]:size-5" : "size-16 [&_svg]:size-7")}>
          <span className="absolute inset-0 rounded-2xl paper-grain opacity-60" aria-hidden />
          <span className="relative">{icon}</span>
        </span>
      ) : null}
      <p className={cn("font-semibold", compact ? "text-[14.5px]" : "text-[17px]")}>{title}</p>
      {body ? <p className="max-w-sm text-[13.5px] text-muted">{body}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

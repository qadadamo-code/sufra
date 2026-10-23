import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "primary" | "brass" | "ok" | "warn" | "danger" | "info";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-2",
  primary: "bg-primary-soft text-primary",
  brass: "bg-brass-soft text-brass-text",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};
const DOT: Record<Tone, string> = {
  neutral: "bg-faint",
  primary: "bg-primary",
  brass: "bg-brass",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
};

export function Badge({ tone = "neutral", dot, pulse, icon, children, className, size = "md" }: { tone?: Tone; dot?: boolean; pulse?: boolean; icon?: ReactNode; children: ReactNode; className?: string; size?: "sm" | "md" }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold [&_svg]:size-3.5", size === "sm" ? "h-5 px-2 text-[11.5px]" : "h-6 px-2.5 text-[12.5px]", TONE[tone], className)}>
      {dot ? <StatusDot tone={tone} pulse={pulse} /> : null}
      {icon}
      {children}
    </span>
  );
}

export function StatusDot({ tone = "neutral", pulse, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", DOT[tone], pulse && "animate-pulse-dot text-[inherit]", className)} aria-hidden />;
}

export const toneBg = (t: Tone) => TONE[t];
export const toneDot = (t: Tone) => DOT[t];

import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

/** Brass tray with an inner plate and a teal dot (سُفرة = a spread / tray). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-9", className)} aria-hidden>
      <circle cx="32" cy="32" r="29" fill="var(--sf-brass)" />
      <circle cx="32" cy="32" r="22.5" fill="none" stroke="color-mix(in srgb, var(--sf-brass) 30%, white)" strokeWidth="2.2" />
      <circle cx="32" cy="32" r="16" fill="color-mix(in srgb, var(--sf-brass) 8%, white)" />
      <circle cx="38" cy="27" r="5" fill="var(--sf-primary)" />
    </svg>
  );
}

export function Logo({ className, size = "md" }: { className?: string; size?: "md" | "lg" }) {
  const { lang } = useLang();
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className={size === "lg" ? "size-12" : "size-9"} />
      <span className={cn("font-display font-bold leading-none", size === "lg" ? "text-3xl" : "text-[22px]")}>{lang === "ar" ? "سُفرة" : "Sufra"}</span>
    </span>
  );
}

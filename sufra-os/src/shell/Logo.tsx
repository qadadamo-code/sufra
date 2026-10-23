import { cn } from "@/lib/cn";
import { useT } from "@/i18n/i18n";

/** The Sufra plate mark (same as sufra-web's favicon), drawn with tokens. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-9 shrink-0", className)} aria-hidden>
      <circle cx="32" cy="32" r="29" fill="var(--sf-brass)" />
      <circle cx="32" cy="32" r="22.5" fill="none" stroke="color-mix(in srgb, var(--sf-brass-soft) 90%, white)" strokeWidth="2.4" />
      <circle cx="32" cy="32" r="16" fill="#f7f3ea" />
      <circle cx="38" cy="27" r="5" fill="#0d5a53" />
    </svg>
  );
}

export function Logo({ compact, className }: { compact?: boolean; className?: string }) {
  const { t } = useT();
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Mark />
      {!compact ? (
        <span className="leading-none">
          <span className="block font-display text-[21px] font-semibold">{t("app.name")}</span>
          <span className="block text-[11px] font-semibold tracking-wide text-muted">{t("app.os")}</span>
        </span>
      ) : null}
    </span>
  );
}

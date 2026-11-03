/** Small shared pieces for the CRM / marketing / platform screens. */
import { useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Crown } from "lucide-react";
import type { LeadSource, Localized } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { major, UNITS_PER_MAJOR, type Units } from "@/lib/money";
import { RFM_LABEL, type RfmSegment, type Tier } from "@/lib/promo";
import { Badge, Card, CardHeader, Input } from "@/ui";

/** Route tabs (sub-pages of a module), RTL-aware, scrolls on phones. */
export function RouteTabs({ items, label }: { items: { to: string; label: ReactNode; icon?: ReactNode; end?: boolean; count?: number | null }[]; label: string }) {
  return (
    <nav aria-label={label} className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 no-scrollbar md:mx-0 md:px-0">
      {items.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            cn("relative inline-flex h-11 shrink-0 items-center gap-2 px-3 text-[14px] font-semibold transition-colors [&_svg]:size-4", isActive ? "text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-[2.5px] after:rounded-full after:bg-primary" : "text-muted hover:text-ink")
          }
        >
          {t.icon}
          {t.label}
          {t.count ? <span className="num rounded-full bg-brass-soft px-1.5 text-[11.5px] text-brass-text">{t.count}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}

export function Section({ title, subtitle, icon, action, children, className, bodyClass }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader title={title} subtitle={subtitle} icon={icon} action={action} />
      <div className={cn("px-5 pb-5", bodyClass)}>{children}</div>
    </Card>
  );
}

export function TierBadge({ tier, size = "md" }: { tier: Tier | null | undefined; size?: "sm" | "md" }) {
  const { loc } = useT();
  if (!tier) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border font-bold", size === "sm" ? "h-6 px-2 text-[11.5px]" : "h-7 px-2.5 text-[12.5px]")} style={{ color: tier.color, borderColor: `color-mix(in srgb, ${tier.color} 40%, transparent)`, background: `color-mix(in srgb, ${tier.color} 12%, transparent)` }}>
      <Crown className="size-3.5" />
      {loc(tier.name)}
    </span>
  );
}

export function RfmBadge({ segment, size = "md" }: { segment: RfmSegment | undefined; size?: "sm" | "md" }) {
  const { lang } = useT();
  if (!segment) return null;
  const x = RFM_LABEL[segment];
  return (
    <Badge tone={x.tone} size={size} dot>
      {x[lang]}
    </Badge>
  );
}

export const SOURCE_LABEL: Record<LeadSource, Localized> = {
  qr: { ar: "منيو QR", en: "QR menu" },
  online: { ar: "طلب أونلاين", en: "Online order" },
  pos: { ar: "الكاشير", en: "POS" },
  reservation: { ar: "حجز", en: "Reservation" },
  wifi: { ar: "واي فاي", en: "Wi-Fi" },
  manual: { ar: "يدوي", en: "Manual" },
  import: { ar: "استيراد", en: "Import" },
  referral: { ar: "ترشيح صاحب", en: "Referral" },
};

/** EGP amount input → Units (accepts Arabic digits). */
export function MoneyInput({ value, onChange, label, hint, className }: { value: Units; onChange: (u: Units) => void; label: ReactNode; hint?: ReactNode; className?: string }) {
  const { L } = useT();
  const [text, setText] = useState(() => (value ? String(value / UNITS_PER_MAJOR) : ""));
  useEffect(() => {
    const cur = text.trim() ? safeMajor(text) : 0;
    if (cur !== value) setText(value ? String(value / UNITS_PER_MAJOR) : "");
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Input
      wrapClassName={className}
      label={label}
      hint={hint}
      inputMode="decimal"
      dir="ltr"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(safeMajor(e.target.value));
      }}
      end={<span className="px-3 text-[12.5px] font-semibold text-muted">{L("ج.م", "EGP")}</span>}
    />
  );
}
function safeMajor(s: string): Units {
  const t = s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[^\d.]/g, "");
  if (!t) return 0;
  try {
    return major(Number(t).toFixed(2));
  } catch {
    return 0;
  }
}

export function NumberInput({ value, onChange, label, hint, suffix, min = 0, step = 1, className }: { value: number; onChange: (n: number) => void; label: ReactNode; hint?: ReactNode; suffix?: ReactNode; min?: number; step?: number; className?: string }) {
  return (
    <Input
      wrapClassName={className}
      label={label}
      hint={hint}
      type="number"
      inputMode="decimal"
      dir="ltr"
      min={min}
      step={step}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
      end={suffix ? <span className="px-3 text-[12.5px] font-semibold text-muted">{suffix}</span> : undefined}
    />
  );
}

/** Localized text pair editor (Arabic + English). */
export function LocalizedInput({ value, onChange, label, multiline }: { value: Localized; onChange: (v: Localized) => void; label: ReactNode; multiline?: boolean }) {
  const cls = "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] outline-none focus:border-primary focus:shadow-[var(--sf-glow)]";
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-[13px] font-semibold text-ink-2">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {(["ar", "en"] as const).map((k) =>
          multiline ? (
            <textarea key={k} dir={k === "ar" ? "rtl" : "ltr"} lang={k} aria-label={`${typeof label === "string" ? label : ""} ${k.toUpperCase()}`} rows={3} value={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.value })} className={cn(cls, "resize-y")} placeholder={k === "ar" ? "عربي" : "English"} />
          ) : (
            <input key={k} dir={k === "ar" ? "rtl" : "ltr"} lang={k} aria-label={`${typeof label === "string" ? label : ""} ${k.toUpperCase()}`} value={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.value })} className={cn(cls, "h-11 py-0")} placeholder={k === "ar" ? "عربي" : "English"} />
          ),
        )}
      </div>
    </fieldset>
  );
}

/** Horizontal bar list (label · bar · value). */
export function BarList({ rows, format }: { rows: { key: string; label: ReactNode; value: number; tone?: string }[]; format?: (v: number) => ReactNode }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="grid gap-2.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-[13.5px]">
          <span className="truncate font-semibold text-ink-2">{r.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.tone ?? "var(--sf-primary)" }} />
          </span>
          <span className="num text-end font-semibold">{format ? format(r.value) : r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;

export function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex text-brass", className)} aria-label={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} viewBox="0 0 20 20" className={cn("size-4", i > Math.round(value) && "opacity-25")} fill="currentColor" aria-hidden>
          <path d="M10 1.5l2.6 5.5 6 .8-4.4 4.1 1.1 6-5.3-3-5.3 3 1.1-6L1.4 7.8l6-.8z" />
        </svg>
      ))}
    </span>
  );
}

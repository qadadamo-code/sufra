/** Small shared pieces for the staff/HR screens. */
import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import type { Membership, StaffProfile } from "@/data/types";
import { ROLE_LABEL } from "@/auth/roles";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Avatar, Badge } from "@/ui";
import { ESTIMATE_LABEL } from "./lib/settings";
import type { DayStatus } from "./lib/attendance";
import { DAY_STATUS } from "./labels";

export { RouteTabs, Section, MoneyInput, NumberInput } from "@/modules/marketing/ui";

export function PersonPhoto({ m, p, size = "md", status }: { m: Pick<Membership, "name" | "color">; p?: Pick<StaffProfile, "photoUrl"> | null; size?: "sm" | "md" | "lg" | "xl"; status?: "online" | "away" | null }) {
  const px = { sm: "size-8", md: "size-10", lg: "size-14", xl: "size-20" }[size];
  if (p?.photoUrl)
    return (
      <span className={cn("relative inline-block shrink-0", px)}>
        <img src={p.photoUrl} alt="" className={cn("rounded-full object-cover", px)} />
        {status ? <span className={cn("absolute -bottom-0.5 -end-0.5 size-3 rounded-full ring-2 ring-[var(--sf-surface)]", status === "online" ? "bg-ok" : "bg-warn")} /> : null}
      </span>
    );
  return <Avatar name={m.name} color={m.color} size={size} status={status} />;
}

export function PersonCell({ m, p, sub, status, size = "md" }: { m: Membership; p?: StaffProfile | null; sub?: ReactNode; status?: "online" | "away" | null; size?: "sm" | "md" }) {
  const { loc, lang } = useT();
  return (
    <div className="flex min-w-0 items-center gap-3">
      <PersonPhoto m={m} p={p} size={size} status={status} />
      <div className="min-w-0">
        <p className="truncate font-semibold">{m.name}</p>
        <p className="truncate text-[12.5px] text-muted">{sub ?? (p?.position && loc(p.position)) ?? ROLE_LABEL[m.role][lang]}</p>
      </div>
    </div>
  );
}

export function DayBadge({ status, notYet }: { status: DayStatus; notYet?: boolean }) {
  const { lang, L } = useT();
  if (status === "absent" && notYet) return <Badge tone="warn" dot>{L("لسه ماجاش", "Not in yet")}</Badge>;
  const s = DAY_STATUS[status];
  return (
    <Badge tone={s.tone} dot pulse={status === "working"}>
      {s.label[lang]}
    </Badge>
  );
}

/** "تقديري — يراجعه المحاسب" — on every tax/insurance figure. */
export function EstimateNote({ className }: { className?: string }) {
  const { lang } = useT();
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-brass-soft px-2 py-0.5 text-[11.5px] font-semibold text-brass-text", className)}>
      <ShieldAlert className="size-3.5" />
      {ESTIMATE_LABEL[lang]}
    </span>
  );
}

export function Kpi({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "ok" | "warn" | "danger" | "primary" }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-surface-2/60 px-3.5 py-3">
      <p className="truncate text-[12.5px] font-semibold text-muted">{label}</p>
      <p className={cn("num mt-0.5 truncate font-display text-[22px] font-semibold leading-tight", tone === "ok" && "text-ok", tone === "warn" && "text-warn", tone === "danger" && "text-danger", tone === "primary" && "text-primary")}>{value}</p>
      {sub ? <p className="truncate text-[12px] text-muted">{sub}</p> : null}
    </div>
  );
}

/** fmt a local business date "2026-11-03" → "الثلاثاء ٣ نوفمبر" / "Tue 3 Nov" */
export function useDateFmt() {
  const { lang } = useT();
  const loc = lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
  return {
    day: (d: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) => new Date(`${d}T12:00:00Z`).toLocaleDateString(loc, { ...opts, timeZone: "UTC" }),
    month: (period: string) => new Date(`${period}-15T12:00:00Z`).toLocaleDateString(loc, { month: "long", year: "numeric", timeZone: "UTC" }),
    time: (iso: string, tz: string) => new Date(iso).toLocaleTimeString(loc, { hour: "numeric", minute: "2-digit", timeZone: tz }),
  };
}

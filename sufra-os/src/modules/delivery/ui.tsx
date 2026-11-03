/** Small shared pieces for the delivery screens. */
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Bike, Globe2, MessageCircle, Phone, QrCode, Receipt, ShoppingBag, Store } from "lucide-react";
import type { DispatchStage, Localized, OrderChannel, OrderItem } from "@/data/types";
import { useSession } from "@/auth/session";
import type { Permission } from "@/auth/permissions";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Badge } from "@/ui";
import { aggregatorInfo } from "./aggregators";
import type { OrderView } from "./useDelivery";
import { dispatchOf } from "./settings";

export const CHANNEL: Record<OrderChannel, { label: Localized; icon: ReactNode; tone: "primary" | "brass" | "info" | "ok" | "neutral" | "warn" }> = {
  online_delivery: { label: { ar: "أونلاين · توصيل", en: "Online · delivery" }, icon: <Globe2 />, tone: "primary" },
  online_takeaway: { label: { ar: "أونلاين · استلام", en: "Online · pickup" }, icon: <ShoppingBag />, tone: "info" },
  qr: { label: { ar: "QR ترابيزة", en: "Table QR" }, icon: <QrCode />, tone: "neutral" },
  phone: { label: { ar: "تليفون", en: "Phone" }, icon: <Phone />, tone: "brass" },
  pos: { label: { ar: "الكاشير", en: "Counter" }, icon: <Store />, tone: "neutral" },
  aggregator: { label: { ar: "تطبيق توصيل", en: "Delivery app" }, icon: <Receipt />, tone: "warn" },
};

export const STAGE_LABEL: Record<DispatchStage | "preparing" | "ready", Localized> = {
  received: { ar: "جديد", en: "New" },
  accepted: { ar: "اتقبل", en: "Accepted" },
  preparing: { ar: "بيتجهز", en: "Preparing" },
  ready: { ar: "جاهز", en: "Ready" },
  assigned: { ar: "مع طيار", en: "Assigned" },
  picked_up: { ar: "في الطريق", en: "Out for delivery" },
  arrived: { ar: "وصل للعنوان", en: "At the door" },
  delivered: { ar: "اتسلّم", en: "Delivered" },
  failed: { ar: "ماتسلّمش", en: "Failed" },
  rejected: { ar: "اترفض", en: "Rejected" },
  cancelled: { ar: "اتلغى", en: "Cancelled" },
};

export function ChannelBadge({ v, size = "sm" }: { v: OrderView; size?: "sm" | "md" }) {
  const { loc } = useT();
  const d = dispatchOf(v.order);
  const agg = aggregatorInfo(d.aggregator?.id);
  const c = CHANNEL[d.channel];
  return (
    <Badge tone={c.tone} size={size} icon={c.icon}>
      {agg ? loc(agg.name) : loc(c.label)}
    </Badge>
  );
}

export function ItemLines({ items, compact }: { items: OrderItem[]; compact?: boolean }) {
  const { loc } = useT();
  const live = items.filter((i) => i.status !== "void");
  return (
    <ul className={cn("grid", compact ? "gap-0.5 text-[13.5px]" : "gap-1 text-[14.5px]")}>
      {live.map((i) => (
        <li key={i.id} className="flex gap-2">
          <span className="num shrink-0 font-bold text-ink-2">{i.qty}×</span>
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{loc(i.name)}</span>
            {!compact && (i.modifiers.length || i.notes) ? <span className="block text-[12.5px] text-muted">{[...i.modifiers.map((m) => loc(m.name)), i.notes].filter(Boolean).join(" · ")}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

const waNumber = (phone: string) => phone.replace(/[^\d]/g, "").replace(/^0(?=1)/, "20");

export function ContactButtons({ phone, name, size = "md" }: { phone: string | null | undefined; name?: string; size?: "md" | "lg" }) {
  const { L } = useT();
  if (!phone) return null;
  const cls = size === "lg" ? "size-12" : "size-10";
  return (
    <div className="flex shrink-0 gap-2">
      <a href={`tel:${phone}`} aria-label={L(`اتصل ب${name ?? "العميل"}`, `Call ${name ?? "customer"}`)} className={cn("grid place-items-center rounded-full bg-ok text-white shadow-sf-sm transition-transform active:scale-95 [&_svg]:size-5", cls)}>
        <Phone />
      </a>
      <a href={`https://wa.me/${waNumber(phone)}`} target="_blank" rel="noreferrer" aria-label={L("واتساب", "WhatsApp")} className={cn("grid place-items-center rounded-full border border-line bg-surface text-[#1f9d55] transition-transform active:scale-95 [&_svg]:size-5", cls)}>
        <MessageCircle />
      </a>
    </div>
  );
}

/** mm:ss countdown (negative → 00:00) */
export const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function Countdown({ until, total, now, label }: { until: string; total: number; now: number; label: string }) {
  const left = Date.parse(until) - now;
  const frac = Math.max(0, Math.min(1, left / total));
  const tone = frac < 0.25 ? "var(--sf-danger)" : frac < 0.5 ? "var(--sf-warn)" : "var(--sf-primary)";
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid size-[58px] shrink-0 place-items-center" role="timer" aria-label={label}>
      <svg viewBox="0 0 52 52" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="26" cy="26" r={r} fill="none" stroke="var(--sf-line)" strokeWidth="4" />
        <circle cx="26" cy="26" r={r} fill="none" stroke={tone} strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} style={{ transition: "stroke-dashoffset 1s linear" }} />
      </svg>
      <span className="num text-[12.5px] font-bold" style={{ color: tone }} dir="ltr">
        {mmss(left)}
      </span>
    </div>
  );
}

export function minutesLabel(min: number, L: (ar: string, en: string) => string) {
  const m = Math.round(min);
  return L(`${m} د`, `${m} min`);
}

/** Sub-navigation for /delivery/* */
export function DeliveryTabs() {
  const { L } = useT();
  const { can } = useSession();
  const tabs: { to: string; label: string; perm: Permission; end?: boolean }[] = [
    { to: "/delivery", label: L("الوارد", "Inbox"), perm: "delivery.dispatch", end: true },
    { to: "/delivery/dispatch", label: L("التوزيع", "Dispatch"), perm: "delivery.dispatch" },
    { to: "/delivery/settle", label: L("كاش الطيارين", "Rider cash"), perm: "payments.take" },
    { to: "/delivery/reports", label: L("التقارير", "Reports"), perm: "reports.view" },
    { to: "/delivery/aggregators", label: L("تطبيقات التوصيل", "Delivery apps"), perm: "delivery.dispatch" },
    { to: "/settings/delivery", label: L("المناطق والقواعد", "Zones & rules"), perm: "settings.edit" },
  ];
  return (
    <nav className="-mb-1 flex gap-1 overflow-x-auto border-b border-line no-scrollbar" aria-label={L("الدليفري", "Delivery")}>
      {tabs
        .filter((t) => can(t.perm))
        .map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cn("relative -mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[14px] font-semibold transition-colors", isActive ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink")}>
            {t.label}
          </NavLink>
        ))}
    </nav>
  );
}

export function RiderIcon({ className }: { className?: string }) {
  return <Bike className={className} aria-hidden />;
}

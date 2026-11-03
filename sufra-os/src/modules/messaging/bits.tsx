/** Small presentational pieces shared by the messaging screens. */
import type { ReactNode } from "react";
import { AlertCircle, Ban, Check, CheckCheck, Clock, ExternalLink, Hand, MinusCircle, ShieldCheck, ShieldQuestion, ShieldX, Timer } from "lucide-react";
import type { Message, MessageStatus, MessagingConsent } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { windowState } from "@/lib/notify/core";
import type { MessagingMode } from "@/lib/notify/settings";
import { Badge, type Tone } from "@/ui";

export const STATUS_LABEL: Record<MessageStatus, { ar: string; en: string }> = {
  scheduled: { ar: "متجدولة", en: "Scheduled" },
  queued: { ar: "في الطابور", en: "Queued" },
  pending_tap: { ar: "مستنية ضغطة", en: "Tap to send" },
  opened: { ar: "اتفتحت في واتساب", en: "Opened in WhatsApp" },
  sent: { ar: "اتبعتت", en: "Sent" },
  delivered: { ar: "وصلت", en: "Delivered" },
  read: { ar: "اتقرت", en: "Read" },
  failed: { ar: "فشلت", en: "Failed" },
  received: { ar: "واردة", en: "Received" },
  skipped: { ar: "اتلغت", en: "Skipped" },
};
export const STATUS_TONE: Record<MessageStatus, Tone> = {
  scheduled: "info", queued: "neutral", pending_tap: "brass", opened: "primary", sent: "primary", delivered: "ok", read: "ok", failed: "danger", received: "neutral", skipped: "neutral",
};

export function StatusIcon({ status, className }: { status: MessageStatus; className?: string }) {
  const c = cn("size-3.5 shrink-0", className);
  switch (status) {
    case "scheduled":
      return <Timer className={cn(c, "text-info")} aria-hidden />;
    case "queued":
      return <Clock className={cn(c, "text-muted")} aria-hidden />;
    case "pending_tap":
      return <Hand className={cn(c, "text-brass")} aria-hidden />;
    case "opened":
      return <ExternalLink className={cn(c, "text-primary")} aria-hidden />;
    case "sent":
      return <Check className={cn(c, "text-muted")} aria-hidden />;
    case "delivered":
      return <CheckCheck className={cn(c, "text-muted")} aria-hidden />;
    case "read":
      return <CheckCheck className={cn(c, "text-info")} aria-hidden />;
    case "failed":
      return <AlertCircle className={cn(c, "text-danger")} aria-hidden />;
    case "skipped":
      return <MinusCircle className={cn(c, "text-muted")} aria-hidden />;
    default:
      return null;
  }
}

export const SKIP_REASON: Record<string, { ar: string; en: string }> = {
  opted_out: { ar: "الزبون لغى الاشتراك", en: "Customer opted out" },
  no_consent: { ar: "مفيش موافقة على الرسايل", en: "No messaging consent" },
  window_closed: { ar: "نافذة الـ ٢٤ ساعة مقفولة — ابعت قالب", en: "24h window closed — send a template" },
  messaging_off: { ar: "الرسايل مقفولة من الإعدادات", en: "Messaging is off in settings" },
  manual_channel: { ar: "محتاجة إرسال يدوي", en: "Needs a manual send" },
};

const hhmm = (ms: number, lang: "ar" | "en") => {
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return lang === "ar" ? (h ? `${h}س ${m}د` : `${m}د`) : h ? `${h}h ${m}m` : `${m}m`;
};

/** 24h customer-service window badge. In click-to-chat mode the window doesn't limit anything. */
export function WindowBadge({ lastInboundAt, mode, compact }: { lastInboundAt: string | null; mode: MessagingMode; compact?: boolean }) {
  const { L, lang } = useT();
  const w = windowState(lastInboundAt);
  if (mode === "click_to_chat" || mode === "off") {
    return compact ? null : <Badge tone="neutral" size="sm">{L("إرسال من واتساب الجهاز", "Sends from this device's WhatsApp")}</Badge>;
  }
  if (!w.open) return <Badge tone="neutral" size="sm" icon={<Clock />}>{compact ? L("قوالب بس", "Templates only") : L("النافذة مقفولة — قوالب بس", "Window closed — templates only")}</Badge>;
  return (
    <Badge tone={w.closingSoon ? "warn" : "ok"} size="sm" dot pulse={w.closingSoon}>
      {compact ? hhmm(w.msLeft, lang) : `${L("نافذة ٢٤ ساعة · فاضل", "24h window · ")} ${hhmm(w.msLeft, lang)}${lang === "en" ? " left" : ""}`}
    </Badge>
  );
}

export function ConsentBadge({ consent, size = "sm" }: { consent: Pick<MessagingConsent, "status"> | null | undefined; size?: "sm" | "md" }) {
  const { L } = useT();
  if (!consent) return <Badge tone="neutral" size={size} icon={<ShieldQuestion />}>{L("مفيش موافقة", "No consent")}</Badge>;
  return consent.status === "opted_in" ? (
    <Badge tone="ok" size={size} icon={<ShieldCheck />}>{L("موافق", "Opted in")}</Badge>
  ) : (
    <Badge tone="danger" size={size} icon={<ShieldX />}>{L("لغى الاشتراك", "Opted out")}</Badge>
  );
}

/** WhatsApp-like bubble. Outgoing on the inline-end side (mirrors in RTL like WhatsApp does). */
export function Bubble({ m, children, footer }: { m: Pick<Message, "direction" | "body" | "status" | "createdAt" | "kind" | "template" | "category">; children?: ReactNode; footer?: ReactNode }) {
  const { L, lang } = useT();
  const out = m.direction === "out";
  const time = new Date(m.createdAt).toLocaleTimeString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "numeric", minute: "2-digit" });
  return (
    <div className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "relative max-w-[min(85%,34rem)] rounded-[18px] px-3.5 pt-2 pb-1.5 text-[14.5px] leading-relaxed shadow-sf-sm",
          out ? "rounded-ee-md bg-primary-soft text-ink" : "rounded-es-md border border-line bg-surface text-ink",
          m.kind === "system" && "border border-dashed border-line-strong bg-surface-2",
          m.status === "skipped" && "opacity-70",
        )}
      >
        {m.template ? (
          <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-muted">
            <span className="rounded-md bg-surface/70 px-1.5 py-0.5 font-mono" dir="ltr">{m.template}</span>
            {m.category === "marketing" ? <span className="text-brass-text">{L("تسويق", "Marketing")}</span> : null}
          </div>
        ) : m.kind === "system" ? (
          <div className="mb-1 text-[11.5px] font-semibold text-muted">{L("رد تلقائي", "Automatic reply")}</div>
        ) : null}
        <p className="whitespace-pre-wrap break-words" dir="auto">{m.body}</p>
        {children}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted">
          <span className="num">{time}</span>
          {out ? <StatusIcon status={m.status} /> : null}
        </div>
        {footer}
      </div>
    </div>
  );
}

export function OptOutIcon() {
  return <Ban className="size-3.5 text-danger" aria-hidden />;
}

/** micro-USD → "$0.0036" */
export const usd = (micros: number) => (micros ? `$${(micros / 1_000_000).toFixed(micros < 1_000_000 ? 4 : 2)}` : "$0");

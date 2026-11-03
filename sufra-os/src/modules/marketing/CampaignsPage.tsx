import { Link } from "react-router-dom";
import { CalendarClock, Megaphone, MessageCircle, Plus, Smartphone } from "lucide-react";
import { useSession } from "@/auth/session";
import { useLive } from "@/data/hooks";
import type { Campaign } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { dayLabel } from "@/lib/time";
import { Badge, EmptyState, LinkButton, type Tone } from "@/ui";
import { pct } from "./ui";

export const STATUS_TONE: Record<Campaign["status"], Tone> = { draft: "neutral", scheduled: "info", sending: "warn", sent: "ok", cancelled: "danger" };
export const STATUS_LABEL: Record<Campaign["status"], { ar: string; en: string }> = {
  draft: { ar: "مسودة", en: "Draft" },
  scheduled: { ar: "متجدولة", en: "Scheduled" },
  sending: { ar: "بتتبعت", en: "Sending" },
  sent: { ar: "اتبعتت", en: "Sent" },
  cancelled: { ar: "اتلغت", en: "Cancelled" },
};

export default function CampaignsPage() {
  const { L, lang } = useT();
  const { can } = useSession();
  const campaigns = useLive("campaigns", { orderBy: [{ field: "createdAt", dir: "desc" }] }).data.filter((c) => !c.journeyId);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-[13.5px] text-muted">{L("ابعت لشريحة رسالة واتساب أو SMS بعرض وكود شخصي، وتابع مين قرا ومين جه واستخدم العرض.", "Send a segment a WhatsApp or SMS message with an offer and a personal code, then see who read it and who came back.")}</p>
        {can("marketing.manage") ? (
          <LinkButton to="/marketing/campaigns/new" icon={<Plus className="size-4" />}>
            {L("حملة جديدة", "New campaign")}
          </LinkButton>
        ) : null}
      </div>
      {campaigns.length ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {campaigns.map((c) => {
            const roi = c.stats.cost ? c.stats.revenue / c.stats.cost : 0;
            return (
              <li key={c.id}>
                <Link to={c.status === "draft" ? `/marketing/campaigns/${c.id}/edit` : `/marketing/campaigns/${c.id}`} className="block rounded-[20px] border border-line bg-surface p-4 shadow-sf-sm transition hover:-translate-y-0.5 hover:shadow-sf">
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">{c.channel === "sms" ? <Smartphone className="size-5" /> : <MessageCircle className="size-5" />}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{c.name}</p>
                      <p className="text-[12.5px] text-muted">
                        {c.sentAt ? dayLabel(c.sentAt, lang) : c.scheduledAt ? <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" />{dayLabel(c.scheduledAt, lang)}</span> : L("لسه", "not sent")}
                        {c.variants.length > 1 ? ` · A/B` : ""}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONE[c.status]} size="sm">{STATUS_LABEL[c.status][lang]}</Badge>
                  </div>
                  {c.status === "sent" ? (
                    <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
                      {[
                        [L("اتبعت", "Sent"), c.stats.sent],
                        [L("اتقرت", "Read"), c.stats.sent ? pct(c.stats.read / c.stats.sent) : "—"],
                        [L("استخدموا", "Redeemed"), c.stats.redeemed],
                        ["ROI", roi ? `${roi.toFixed(1)}×` : "—"],
                      ].map(([k, v]) => (
                        <div key={String(k)} className="rounded-xl bg-surface-2 px-1 py-2">
                          <dt className="text-[11.5px] text-muted">{k}</dt>
                          <dd className="num text-[16px] font-semibold">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {c.status === "sent" ? <p className="mt-2 text-[12.5px] text-muted">{L("إيراد", "Revenue")} <b className="text-ink">{formatMoney(c.stats.revenue, { lang, whole: true })}</b> · {L("تكلفة", "cost")} {formatMoney(c.stats.cost, { lang, whole: true })}</p> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={<Megaphone />} title={L("مفيش حملات لسه", "No campaigns yet")} />
      )}
    </div>
  );
}

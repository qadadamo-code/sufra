import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Send, Trophy } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive, useRow } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { dayLabel } from "@/lib/time";
import { Badge, Button, EmptyState, Skeleton, StatTile, useToast } from "@/ui";
import { refreshCampaignStats, sendCampaign, variantResults } from "./ops";
import { STATUS_LABEL, STATUS_TONE } from "./CampaignsPage";
import { pct, Section } from "./ui";

export default function CampaignResults() {
  const { campaignId = "" } = useParams();
  const { L, lang, loc } = useT();
  const db = useDb();
  const { toast } = useToast();
  const { restaurant, can } = useSession();
  const { data: c, loading } = useRow("campaigns", campaignId);
  const msgs = useLive("campaignMessages", { where: { campaignId }, orderBy: [{ field: "createdAt" }] }).data;
  const customers = useLive("customers").data;
  const settings = useLive("settings").data[0] ?? null;
  const promo = useRow("promotions", c?.promotionId).data;
  const by = useMemo(() => variantResults(msgs), [msgs]);
  if (loading && !c) return <Skeleton className="h-96" rounded="rounded-[20px]" />;
  if (!c) return <EmptyState title={L("الحملة مش موجودة", "Campaign not found")} />;
  const s = c.stats;
  const roi = s.cost ? s.revenue / s.cost : 0;
  const funnel = [
    { k: L("اتبعت", "Sent"), v: s.sent },
    { k: L("وصلت", "Delivered"), v: s.delivered },
    { k: L("اتقرت", "Read"), v: s.read },
    { k: L("استخدموا العرض", "Redeemed"), v: s.redeemed },
  ];
  const max = Math.max(1, s.targeted, s.sent);
  const winner = [...by.entries()].sort((a, b) => b[1].redeemed / Math.max(1, b[1].sent) - a[1].redeemed / Math.max(1, a[1].sent))[0]?.[0];
  const queued = msgs.filter((m) => m.status === "queued");
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/marketing/campaigns" className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-muted hover:text-ink">
          <ArrowLeft className="size-4 flip-rtl" /> {L("الحملات", "Campaigns")}
        </Link>
        <h2 className="text-[22px]">{c.name}</h2>
        <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status][lang]}</Badge>
        {c.sentAt ? <span className="text-[13px] text-muted">{dayLabel(c.sentAt, lang)}</span> : null}
        <div className="flex-1" />
        {c.status === "scheduled" && can("marketing.manage") ? (
          <Button icon={<Send className="size-4 flip-rtl" />} onClick={async () => {
            const r = await sendCampaign(db, c, { restaurantName: restaurant ? loc(restaurant.name) : "Sufra", slug: restaurant?.slug ?? "", origin: window.location.origin, lang: "ar", settings });
            toast({ title: L(`اتبعتت لـ ${r.sent + r.queued}`, `Sent to ${r.sent + r.queued}`), tone: "success" });
          }}>
            {L("ابعتها دلوقتي", "Send now")}
          </Button>
        ) : null}
        {c.status === "sent" ? <Button variant="ghost" size="sm" onClick={() => refreshCampaignStats(db, c.id)}>{L("حدّث الأرقام", "Refresh")}</Button> : null}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile index={0} label={L("المستهدفين", "Targeted")} value={s.targeted} />
        <StatTile index={1} tone="info" label={L("نسبة القراءة", "Read rate")} value={s.sent ? pct(s.read / s.sent) : "—"} />
        <StatTile index={2} tone="brass" label={L("استخدموا العرض", "Redeemed")} value={s.redeemed} sub={s.sent ? L(`${pct(s.redeemed / s.sent, 1)} تحويل`, `${pct(s.redeemed / s.sent, 1)} conversion`) : undefined} />
        <StatTile index={3} tone="ok" label={L("الإيراد المنسوب", "Attributed revenue")} value={formatMoney(s.revenue, { lang, whole: true })} />
        <StatTile index={4} tone={roi >= 1 ? "ok" : "warn"} label={L("العائد على التكلفة", "Return on cost")} value={roi ? `${roi.toFixed(1)}×` : "—"} sub={L(`تكلفة ${formatMoney(s.cost, { lang })}`, `cost ${formatMoney(s.cost, { lang })}`)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={L("المسار", "Funnel")}>
          <ul className="grid gap-3">
            {funnel.map((f, i) => (
              <li key={f.k} className="grid gap-1">
                <div className="flex justify-between text-[13.5px]">
                  <span className="font-semibold">{f.k}</span>
                  <span className="num">{f.v}{i ? <span className="ms-2 text-muted">{pct(f.v / Math.max(1, funnel[i - 1].v))}</span> : null}</span>
                </div>
                <span className="h-3 overflow-hidden rounded-full bg-surface-3">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${(f.v / max) * 100}%`, opacity: 1 - i * 0.15 }} />
                </span>
              </li>
            ))}
          </ul>
          {promo ? <p className="mt-4 text-[13px] text-muted">{L("العرض", "Offer")}: <b className="text-ink">{loc(promo.name)}</b></p> : null}
        </Section>
        <Section title={L("مقارنة A/B", "A/B results")} icon={<Trophy />}>
          {c.variants.length > 1 ? (
            <ul className="grid gap-3">
              {c.variants.map((v) => {
                const r = by.get(v.id) ?? { sent: 0, read: 0, redeemed: 0, revenue: 0 };
                return (
                  <li key={v.id} className={`rounded-2xl border p-3 ${winner === v.id ? "border-ok/50 bg-ok-soft" : "border-line"}`}>
                    <div className="flex items-center gap-2">
                      <Badge tone="primary">{v.label}</Badge>
                      {winner === v.id ? <Badge tone="ok" icon={<Trophy className="size-3" />}>{L("الأفضل", "Winner")}</Badge> : null}
                      <span className="flex-1" />
                      <span className="num text-[13px] text-muted">{v.share}%</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[13.5px]">{v.text[lang] || v.text.ar}</p>
                    <dl className="mt-2 grid grid-cols-4 gap-2 text-center text-[12px]">
                      <div><dt className="text-muted">{L("اتبعت", "Sent")}</dt><dd className="num font-semibold">{r.sent}</dd></div>
                      <div><dt className="text-muted">{L("قراءة", "Read")}</dt><dd className="num font-semibold">{r.sent ? pct(r.read / r.sent) : "—"}</dd></div>
                      <div><dt className="text-muted">{L("تحويل", "Conv.")}</dt><dd className="num font-semibold">{r.sent ? pct(r.redeemed / r.sent, 1) : "—"}</dd></div>
                      <div><dt className="text-muted">{L("إيراد", "Revenue")}</dt><dd className="num font-semibold">{formatMoney(r.revenue, { lang, whole: true, bare: true })}</dd></div>
                    </dl>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13.5px] text-muted">{L("الحملة دي نسخة واحدة", "Single-variant campaign")}</p>
          )}
        </Section>
      </div>

      {queued.length ? (
        <Section title={L("محتاجين ضغطة إرسال", "Waiting for a tap")} subtitle={L("واتساب click-to-chat: افتح كل لينك واضغط إرسال", "WhatsApp click-to-chat: open each link and tap send")}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {queued.slice(0, 40).map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[13.5px]">
                <span className="min-w-0 flex-1 truncate">{customers.find((x) => x.id === m.customerId)?.name ?? m.to}</span>
                {m.link ? (
                  <a href={m.link} target="_blank" rel="noreferrer" onClick={() => void db.update("campaignMessages", m.id, { status: "sent", sentAt: new Date().toISOString() })} className="inline-flex items-center gap-1 font-semibold text-primary">
                    {L("افتح", "Open")} <ExternalLink className="size-3.5" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title={L("الرسايل", "Messages")} subtitle={L(`${msgs.length} رسالة`, `${msgs.length} messages`)}>
        <ul className="grid max-h-96 gap-1 overflow-y-auto text-[13.5px] thin-scrollbar">
          {msgs.map((m) => (
            <li key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-2">
              <span className="truncate">
                <Link to={`/customers/${m.customerId}`} className="font-semibold hover:underline">{customers.find((x) => x.id === m.customerId)?.name ?? m.to}</Link>
                {m.code ? <span className="num ms-2 text-muted" dir="ltr">{m.code}</span> : null}
              </span>
              <Badge size="sm" tone={m.status === "read" ? "ok" : m.status === "failed" ? "danger" : m.status === "queued" ? "warn" : "info"}>{m.status}</Badge>
              <span className="num w-20 text-end">{m.redeemedAt ? formatMoney(m.revenue, { lang, whole: true }) : "—"}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

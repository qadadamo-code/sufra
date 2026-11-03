import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CalendarClock, CheckCheck, MessageCircle, Plus, Send, Smartphone, Ticket, Trash2, Users } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive, useRow } from "@/data/hooks";
import type { Campaign, CampaignChannel, CampaignVariant } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney, major } from "@/lib/money";
import { matchesSegment, RFM_LABEL, type RfmSegment } from "@/lib/promo";
import { messagingSettingsOf } from "@/lib/notify/settings";
import { Badge, Button, Card, IconButton, Input, Segmented, Select, useToast } from "@/ui";
import { useCrm } from "@/modules/customers/useCrm";
import { audienceDef, renderText, sendCampaign } from "./ops";
import { describePromo } from "./PromotionsPage";
import { MoneyInput, Section } from "./ui";

const TOKENS = ["{name}", "{code}", "{points}", "{link}", "{restaurant}"];
const STARTERS: { ar: string; en: string }[] = [
  { ar: "{name} وحشتنا! 🍢 تعالى سُفرة الأسبوع ده وخد خصم بالكود {code}.", en: "{name}, we miss you! 🍢 Come to Sufra this week — your code {code}." },
  { ar: "أهلًا {name} 👋 معاك {points} نقطة في نادي سُفرة. كارتك: {link}", en: "Hi {name} 👋 you have {points} points at Sufra Club. Your card: {link}" },
];

export default function CampaignComposer() {
  const { L, lang, loc } = useT();
  const db = useDb();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { restaurant, can } = useSession();
  const { campaignId } = useParams();
  const [params] = useSearchParams();
  const existing = useRow("campaigns", campaignId).data;
  const crm = useCrm();
  const promos = useLive("promotions", { where: { active: true, kind: "coupon" } }).data;
  const settings = useLive("settings").data[0] ?? null;
  const recent = useLive("campaignMessages", { gte: { createdAt: useMemo(() => new Date(Date.now() - 7 * 86_400_000).toISOString(), []) } }).data;
  const [c, setC] = useState<Omit<Campaign, "id" | "restaurantId" | "createdAt" | "updatedAt">>(() => ({
    name: L("حملة جديدة", "New campaign"), segmentId: params.get("segment"), audience: params.get("segment") ? "segment" : "all", channel: "whatsapp", status: "draft",
    variants: [{ id: "a", label: "A", text: { ...STARTERS[0] }, share: 100 }], promotionId: null, scheduledAt: null, sentAt: null, costPerMessage: major("3.20"), journeyId: null, createdBy: null,
    stats: { targeted: 0, sent: 0, delivered: 0, read: 0, clicked: 0, redeemed: 0, revenue: 0, cost: 0 },
  }));
  useEffect(() => {
    if (existing) setC({ ...existing });
  }, [existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sending, setSending] = useState(false);
  const [when, setWhen] = useState<"now" | "later">("now");

  const segment = crm.segments.find((s) => s.id === c.segmentId) ?? null;
  const def = audienceDef(c.audience === "segment" ? "segment" : c.audience, c.audience === "segment" ? segment : null);
  const consentKey = c.channel === "sms" ? "sms" : c.channel === "push" ? "push" : "whatsapp";
  const cap = messagingSettingsOf(settings).marketingCapPerWeek;
  const reach = useMemo(() => {
    const audience = crm.stats.filter((s) => matchesSegment(s, def));
    const consented = audience.filter((s) => s.consent[consentKey]);
    const sentCount = new Map<string, number>();
    for (const m of recent) sentCount.set(m.customerId, (sentCount.get(m.customerId) ?? 0) + 1);
    const eligible = consented.filter((s) => cap <= 0 || (sentCount.get(s.id) ?? 0) < cap);
    return { audience: audience.length, consented: consented.length, eligible: eligible.length, sample: eligible.slice(0, 1).map((s) => crm.customers.find((x) => x.id === s.id)!)[0] ?? crm.customers[0] };
  }, [crm, def, consentKey, recent, cap]);
  const promo = promos.find((p) => p.id === c.promotionId) ?? null;
  const cost = reach.eligible * c.costPerMessage;
  const totalShare = c.variants.reduce((a, v) => a + v.share, 0);

  const setVariant = (i: number, v: Partial<CampaignVariant>) => setC({ ...c, variants: c.variants.map((x, j) => (j === i ? { ...x, ...v } : x)) });
  const persist = async (patch: Partial<Campaign> = {}) => {
    const row = { ...c, ...patch, createdBy: c.createdBy ?? db.actorId };
    if (campaignId) return db.update("campaigns", campaignId, row);
    return db.insert("campaigns", row);
  };
  const go = async () => {
    setSending(true);
    try {
      if (when === "later") {
        const saved = await persist({ status: "scheduled" });
        toast({ title: L("الحملة اتجدولت", "Campaign scheduled"), tone: "success" });
        navigate(`/marketing/campaigns/${saved.id}`);
        return;
      }
      const saved = await persist({ status: "draft" });
      const r = await sendCampaign(db, saved, { restaurantName: restaurant ? loc(restaurant.name) : "Sufra", slug: restaurant?.slug ?? "", origin: window.location.origin, lang: "ar", settings });
      toast({ title: L(`اتبعتت لـ ${r.sent + r.queued} زبون`, `Sent to ${r.sent + r.queued} guests`), description: r.queued ? L(`${r.queued} محتاجين ضغطة إرسال من واتساب`, `${r.queued} need a tap in WhatsApp`) : undefined, tone: "success" });
      navigate(`/marketing/campaigns/${saved.id}`);
    } finally {
      setSending(false);
    }
  };

  const sample = reach.sample;
  const preview = (v: CampaignVariant) =>
    renderText(v.text[lang] || v.text.ar, { name: sample?.name.split(" ")[0] ?? L("دينا", "Dina"), code: promo ? (promo.code ?? "WB-7K2Q9") : null, points: sample?.loyaltyPoints ?? 120, link: `sufra.app/r/${restaurant?.slug ?? ""}/me`, restaurant: restaurant ? loc(restaurant.name) : "" });

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-5">
        <Section title={L("١. الجمهور", "1. Audience")} icon={<Users />}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={L("اسم الحملة", "Campaign name")} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
            <Select
              label={L("مين هيستلم", "Who receives it")}
              value={c.audience === "segment" ? `seg:${c.segmentId}` : c.audience}
              onChange={(e) => {
                const v = e.target.value;
                setC(v.startsWith("seg:") ? { ...c, audience: "segment", segmentId: v.slice(4) } : { ...c, audience: v, segmentId: null });
              }}
              options={[
                { value: "all", label: L("كل الزباين", "All customers") },
                ...crm.segments.map((s) => ({ value: `seg:${s.id}`, label: `◆ ${loc(s.name)}` })),
                ...(Object.keys(RFM_LABEL) as RfmSegment[]).map((k) => ({ value: `rfm:${k}`, label: `RFM · ${RFM_LABEL[k][lang]}` })),
              ]}
            />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Fact label={L("في الشريحة", "In audience")} value={reach.audience} />
            <Fact label={L("موافقين", "Consented")} value={reach.consented} />
            <Fact label={L("هيستلموا", "Will receive")} value={reach.eligible} strong />
          </div>
          {reach.consented > reach.eligible ? <p className="mt-2 text-[12.5px] text-muted">{L(`${reach.consented - reach.eligible} استلموا ${cap} رسايل تسويق الأسبوع ده (الحد في إعدادات الرسايل)`, `${reach.consented - reach.eligible} already got ${cap} marketing messages this week (cap in messaging settings)`)}</p> : null}
        </Section>

        <Section title={L("٢. القناة", "2. Channel")} icon={<MessageCircle />}>
          <Segmented
            block
            label={L("القناة", "Channel")}
            value={c.channel}
            onChange={(ch: CampaignChannel) => setC({ ...c, channel: ch, costPerMessage: ch === "sms" ? major("0.35") : ch === "push" ? 0 : major("3.20") })}
            options={[
              { value: "whatsapp", label: "WhatsApp", icon: <MessageCircle /> },
              { value: "sms", label: "SMS", icon: <Smartphone /> },
              { value: "push", label: L("إشعار (قريبًا)", "Push (soon)") },
            ]}
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <MoneyInput label={L("تكلفة الرسالة", "Cost per message")} value={c.costPerMessage} onChange={(u) => setC({ ...c, costPerMessage: u })} hint={c.channel === "whatsapp" ? L("رسالة تسويق Meta لمصر ≈ ٠٫٠٦٤$ (قالب marketing لازم يتوافق عليه)", "Meta marketing template, Egypt ≈ $0.064 (needs an approved template)") : undefined} />
            <div className="rounded-2xl bg-surface-2 p-3">
              <p className="text-[12.5px] text-muted">{L("التكلفة المتوقعة", "Estimated cost")}</p>
              <p className="num text-[22px] font-semibold">{formatMoney(cost, { lang })}</p>
            </div>
          </div>
        </Section>

        <Section title={L("٣. الرسالة", "3. Message")} icon={<CheckCheck />} action={c.variants.length < 3 ? <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setC({ ...c, variants: [...c.variants.map((v) => ({ ...v, share: Math.floor(100 / (c.variants.length + 1)) })), { id: String.fromCharCode(97 + c.variants.length), label: String.fromCharCode(65 + c.variants.length), text: { ...STARTERS[1] }, share: Math.floor(100 / (c.variants.length + 1)) }] })}>{L("نسخة A/B", "A/B variant")}</Button> : null}>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {TOKENS.map((t) => (
              <span key={t} className="num rounded-lg bg-surface-3 px-2 py-1 text-[12px] font-semibold text-ink-2" dir="ltr">{t}</span>
            ))}
          </div>
          <ul className="grid gap-4">
            {c.variants.map((v, i) => (
              <li key={v.id} className="grid gap-2 rounded-2xl border border-line p-3">
                <div className="flex items-center gap-2">
                  <Badge tone="primary">{L("نسخة", "Variant")} {v.label}</Badge>
                  {c.variants.length > 1 ? (
                    <>
                      <span className="flex-1" />
                      <Input aria-label={L("النسبة", "Share")} className="w-24" type="number" dir="ltr" value={v.share} onChange={(e) => setVariant(i, { share: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} end={<span className="px-2 text-muted">%</span>} />
                      <IconButton label={L("امسح النسخة", "Remove variant")} onClick={() => setC({ ...c, variants: c.variants.filter((_, j) => j !== i) })}>
                        <Trash2 />
                      </IconButton>
                    </>
                  ) : null}
                </div>
                <textarea dir="rtl" lang="ar" rows={3} value={v.text.ar} onChange={(e) => setVariant(i, { text: { ...v.text, ar: e.target.value } })} className="w-full resize-y rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] outline-none focus:border-primary" aria-label={L("نص عربي", "Arabic text")} />
                <textarea dir="ltr" lang="en" rows={2} value={v.text.en} onChange={(e) => setVariant(i, { text: { ...v.text, en: e.target.value } })} className="w-full resize-y rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] outline-none focus:border-primary" aria-label={L("نص إنجليزي", "English text")} />
                <p className="text-[12px] text-muted">{L(`${(v.text.ar || "").length} حرف`, `${(v.text.ar || "").length} chars`)}{c.channel === "sms" && v.text.ar.length > 70 ? L(" · أكتر من رسالة SMS", " · more than one SMS") : ""}</p>
              </li>
            ))}
          </ul>
          {c.variants.length > 1 && totalShare !== 100 ? <p className="mt-2 text-[12.5px] font-semibold text-warn">{L("مجموع النسب لازم يبقى ١٠٠٪", "Shares must add up to 100%")}</p> : null}
        </Section>

        <Section title={L("٤. العرض", "4. Offer")} icon={<Ticket />}>
          <Select label={L("ضيف عرض (كل زبون ياخد كود شخصي)", "Attach an offer (each guest gets a personal code)")} value={c.promotionId ?? ""} onChange={(e) => setC({ ...c, promotionId: e.target.value || null })} options={[{ value: "", label: L("من غير عرض", "No offer") }, ...promos.map((p) => ({ value: p.id, label: `${loc(p.name)} — ${describePromo(p, lang)}` }))]} />
          <p className="mt-2 text-[12.5px] text-muted">{L("اللي هيستخدم الكود في الكاشير أو أونلاين هيتحسب للحملة (استخدام + إيراد).", "Redemptions at the POS or online are attributed to the campaign (uses + revenue).")}</p>
        </Section>

        <Section title={L("٥. الإرسال", "5. Send")} icon={<Send />}>
          <Segmented block label={L("امتى", "When")} value={when} onChange={setWhen} options={[{ value: "now", label: L("ابعت دلوقتي", "Send now"), icon: <Send /> }, { value: "later", label: L("جدولها", "Schedule"), icon: <CalendarClock /> }]} />
          {when === "later" ? <Input className="mt-3" type="datetime-local" label={L("الميعاد", "Date & time")} value={c.scheduledAt?.slice(0, 16) ?? ""} onChange={(e) => setC({ ...c, scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : null })} /> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={async () => {
              const s = await persist({ status: "draft" });
              toast({ title: L("اتحفظت مسودة", "Draft saved"), tone: "success" });
              if (!campaignId) navigate(`/marketing/campaigns/${s.id}/edit`, { replace: true });
            }}>
              {L("احفظ مسودة", "Save draft")}
            </Button>
            <Button size="lg" icon={when === "now" ? <Send className="size-5 flip-rtl" /> : <CalendarClock className="size-5" />} loading={sending} disabled={!can("marketing.manage") || !reach.eligible || (c.variants.length > 1 && totalShare !== 100) || (when === "later" && !c.scheduledAt)} onClick={go}>
              {when === "now" ? L(`ابعت لـ ${reach.eligible}`, `Send to ${reach.eligible}`) : L("جدول", "Schedule")}
            </Button>
          </div>
          <p className="mt-3 text-[12.5px] text-muted">{L("واتساب: لحد ما الـ Cloud API يتوصل، الرسايل بتتسجل وكل واحدة ليها لينك wa.me تبعته بضغطة. رسايل التسويق لازم تكون بقالب marketing متوافق عليه من Meta، ومابتتبعتش في ساعات الهدوء.", "WhatsApp: until the Cloud API is connected, messages are logged with a wa.me link each. Marketing messages need an approved Meta marketing template and respect quiet hours.")}</p>
        </Section>
      </div>

      <div className="xl:sticky xl:top-4 xl:self-start">
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
            <span className="grid size-9 place-items-center rounded-full bg-white/20 font-bold">{restaurant ? loc(restaurant.name).slice(0, 1) : "S"}</span>
            <div>
              <p className="font-semibold">{restaurant ? loc(restaurant.name) : "Sufra"}</p>
              <p className="text-[12px] opacity-75">{L("حساب تجاري", "Business account")}</p>
            </div>
          </div>
          <div className="grid gap-3 bg-[#ece5dd] p-4 dark:bg-[#0b141a]" style={{ minHeight: 320 }}>
            {c.variants.map((v) => (
              <div key={v.id} className="max-w-[85%] justify-self-start rounded-2xl rounded-ss-sm bg-white px-3.5 py-2.5 text-[14.5px] leading-relaxed text-[#111b21] shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]" dir={lang === "ar" ? "rtl" : "ltr"}>
                {c.variants.length > 1 ? <p className="mb-1 text-[11px] font-bold text-[#075e54] dark:text-[#25d366]">{L("نسخة", "Variant")} {v.label} · {v.share}%</p> : null}
                <p className="whitespace-pre-wrap">{preview(v)}</p>
                <p className="mt-1 text-end text-[11px] text-[#667781]">21:04 ✓✓</p>
              </div>
            ))}
          </div>
          <p className="px-4 py-3 text-[12.5px] text-muted">{L("معاينة لـ", "Preview for")} {sample?.name ?? "—"}</p>
        </Card>
      </div>
    </div>
  );
}

function Fact({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`rounded-2xl px-2 py-3 ${strong ? "bg-primary-soft text-primary" : "bg-surface-2"}`}>
      <p className="text-[12px] opacity-80">{label}</p>
      <p className="num text-[24px] font-semibold">{value}</p>
    </div>
  );
}

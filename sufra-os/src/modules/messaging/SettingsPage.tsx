/**
 * Settings → Messaging: channel (off / click-to-chat / Cloud API / BSP), sender, automatic order stages,
 * closed-hours auto-reply, feedback request, quiet hours, rate card, test send, and the Meta setup guide.
 * No secrets are entered here — the WhatsApp token lives in Vercel env vars / Supabase Vault (docs/WHATSAPP-SETUP.md).
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  BadgeCheck, Bell, Building2, CheckCircle2, CircleOff, Clock, Copy, ExternalLink, KeyRound, MessageCircle, MoonStar, MousePointerClick, Phone, RotateCcw, Save, Send, ServerCog, Star,
  Wallet, Webhook, XCircle,
} from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useRepo } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { loadRaw, saveRaw } from "@/lib/storage";
import { clickToChatUrl, toE164, type PriceCategory } from "@/lib/notify/core";
import { apiAuth } from "@/lib/notify/register";
import { API_KEY_STORAGE, DEFAULT_MESSAGING, messagingSettingsOf, type BspProvider, type MessagingMode, type MessagingSettings } from "@/lib/notify/settings";
import type { NotifyStage } from "@/modules/guest/notify/templates";
import { PageHeader } from "@/shell/PageHeader";
import { Badge, Button, Card, CardHeader, Input, Select, Switch, Textarea, useToast } from "@/ui";
import { SettingsNav } from "../settings/SettingsNav";
import { useMessagingSettings } from "./useMessaging";

const WEBHOOK_URL = "https://sufra-planet-crm.vercel.app/api/whatsapp-webhook";

const MODES: { v: MessagingMode; icon: ReactNode; ar: string; en: string; dAr: string; dEn: string; tag?: { ar: string; en: string } }[] = [
  { v: "off", icon: <CircleOff />, ar: "مقفول", en: "Off", dAr: "مفيش رسايل للزباين خالص", dEn: "No customer messages at all" },
  {
    v: "click_to_chat", icon: <MousePointerClick />, ar: "إرسال بالضغط (wa.me)", en: "Click-to-chat (wa.me)",
    dAr: "شغال النهارده من غير حساب Meta: الرسالة بتتفتح جاهزة في واتساب الجهاز والموظف يدوس إرسال. مجاني.",
    dEn: "Works today with no Meta account: the message opens ready in this device's WhatsApp and staff tap send. Free.",
    tag: { ar: "ابدأ بيه", en: "Start here" },
  },
  {
    v: "cloud", icon: <ServerCog />, ar: "واتساب Cloud API", en: "WhatsApp Cloud API",
    dAr: "إرسال أوتوماتيك من رقم البيزنس، حالات وصلت/اتقرت، صندوق وارد مشترك. محتاج توثيق Meta وقوالب معتمدة.",
    dEn: "Automatic sending from your business number, delivered/read ticks, shared inbox. Needs Meta verification and approved templates.",
  },
  {
    v: "bsp", icon: <Building2 />, ar: "عن طريق BSP", en: "Through a BSP",
    dAr: "Unifonic أو Infobip أو 360dialog أو Twilio — لو عندك عقد معاهم. (360dialog شغال بنفس الـ API؛ الباقي قريب)",
    dEn: "Unifonic, Infobip, 360dialog or Twilio — if you have a contract. (360dialog works through the same API; others coming)",
  },
];

const BSPS: { v: BspProvider; label: string; note: { ar: string; en: string } }[] = [
  { v: "360dialog", label: "360dialog", note: { ar: "متوافق مع Cloud API — اضبط WHATSAPP_PROVIDER=360dialog و D360_API_KEY", en: "Cloud-API compatible — set WHATSAPP_PROVIDER=360dialog and D360_API_KEY" } },
  { v: "unifonic", label: "Unifonic", note: { ar: "الرياض + مكتب في مصر — الربط لسه (stub)", en: "Riyadh + Egypt office — adapter is a stub" } },
  { v: "infobip", label: "Infobip", note: { ar: "الربط لسه (stub)", en: "Adapter is a stub" } },
  { v: "twilio", label: "Twilio", note: { ar: "القوالب عندهم اسمها Content — الربط لسه (stub)", en: "Templates are Twilio Content — adapter is a stub" } },
];

const STAGES: { s: NotifyStage; ar: string; en: string }[] = [
  { s: "received", ar: "الطلب وصل", en: "Order received" },
  { s: "accepted", ar: "اتقبل وبيتجهز + الوقت المتوقع", en: "Accepted / preparing + ETA" },
  { s: "ready_pickup", ar: "جاهز للاستلام (تيك أواي)", en: "Ready for pickup (takeaway)" },
  { s: "out_for_delivery", ar: "خرج مع الطيار (الاسم والرقم واللينك)", en: "Out for delivery (driver name, phone, link)" },
  { s: "arriving", ar: "الطيار وصل عند الباب", en: "Driver arriving" },
  { s: "delivered", ar: "اتسلّم + الإيصال + التقييم", en: "Delivered + receipt + rating" },
  { s: "delayed", ar: "متأخر (السبب والوقت الجديد)", en: "Delayed (reason, new time)" },
  { s: "cancelled", ar: "اتلغى (السبب والفلوس)", en: "Cancelled (reason, refund)" },
];

type ServerStatus = { configured: boolean; platformDefault: boolean; storage: string; auth: string; webhook: { verifyToken: boolean; appSecret: boolean }; provider: string } | "unreachable" | null;

export default function MessagingSettingsPage() {
  const { L, lang } = useT();
  const db = useDb();
  const repo = useRepo();
  const { toast } = useToast();
  const { can, restaurant } = useSession();
  const { row } = useMessagingSettings();
  const [s, setS] = useState<MessagingSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [server, setServer] = useState<ServerStatus>(null);
  const [apiKey, setApiKey] = useState(() => loadRaw(API_KEY_STORAGE) ?? "");
  const [testing, setTesting] = useState(false);
  const editable = can("settings.edit");

  useEffect(() => {
    if (row && !s) setS({ ...messagingSettingsOf(row), country: row.messaging?.country ?? restaurant?.country ?? "EG" });
  }, [row, s, restaurant]);
  useEffect(() => {
    let off = false;
    fetch("/api/whatsapp-send", { headers: { accept: "application/json" } })
      .then(async (r) => {
        const j = await r.json();
        if (!off) setServer(typeof j?.configured === "boolean" ? j : "unreachable");
      })
      .catch(() => !off && setServer("unreachable"));
    return () => {
      off = true;
    };
  }, []);

  if (!s || !row) return null;
  const saved = messagingSettingsOf(row);
  const dirty = JSON.stringify(saved) !== JSON.stringify(s);
  const set = (p: Partial<MessagingSettings>) => setS((x) => (x ? { ...x, ...p } : x));

  const save = async () => {
    setSaving(true);
    try {
      await db.update("settings", row.id, { messaging: s });
      await db.audit("settings.messaging", "settings", row.id, { mode: s.mode, bsp: s.bsp, autoStages: s.autoStages });
      toast({ title: L("إعدادات الرسايل اتحفظت", "Messaging settings saved"), tone: "success" });
    } finally {
      setSaving(false);
    }
  };

  const testSend = async () => {
    const to = toE164(s.testNumber, s.country);
    if (!to) return toast({ title: L("اكتب رقمك الأول", "Enter your number first"), tone: "warn" });
    const text = L(`رسالة تجربة من ${restaurant?.name.ar ?? "سُفرة"} ✅ الرسايل شغالة.`, `Test message from ${restaurant?.name.en ?? "Sufra"} ✅ messaging works.`);
    if (s.mode === "click_to_chat" || s.mode === "off") {
      window.open(clickToChatUrl(to, text), "_blank", "noopener,noreferrer");
      return;
    }
    setTesting(true);
    try {
      // hello_world exists (approved) on every new WABA — a safe first test outside the 24h window
      const r = await fetch("/api/whatsapp-send", { method: "POST", headers: { "content-type": "application/json", ...(await apiAuth(repo)()) }, body: JSON.stringify({ restaurantId: db.restaurantId, to, country: s.country, template: { name: "hello_world", lang: "en_US" } }) });
      const j = (await r.json().catch(() => ({}))) as { id?: string; error?: string; message?: string };
      if (r.ok && j.id) toast({ title: L("اتبعتت ✅ شوف واتساب بتاعك", "Sent ✅ check your WhatsApp"), description: j.id, tone: "success" });
      else toast({ title: L("التجربة فشلت", "Test failed"), description: j.message ?? j.error ?? `HTTP ${r.status}`, tone: "error", duration: 9000 });
    } catch {
      toast({ title: L("السيرفر مش متاح", "Server unreachable"), description: L("الـ API بيشتغل على Vercel بس (مش في npm run dev)", "The API runs on Vercel only (not in npm run dev)"), tone: "error" });
    } finally {
      setTesting(false);
    }
  };

  const copy = (t: string) => void navigator.clipboard?.writeText(t).then(() => toast({ title: L("اتنسخ", "Copied"), tone: "success" }));
  const rate = (c: "EG" | "SA", k: PriceCategory, v: string) => set({ rates: { ...s.rates, [c]: { ...s.rates[c], [k]: Math.max(0, Number(v) || 0) } } });

  return (
    <div className="grid gap-6 pb-24">
      <PageHeader icon={<MessageCircle />} title={L("الإعدادات", "Settings")} subtitle={L("واتساب ورسايل الزباين", "WhatsApp and customer messages")} />
      <SettingsNav />

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="grid content-start gap-6">
          {/* channel */}
          <Card>
            <CardHeader icon={<Send />} title={L("طريقة الإرسال", "How messages are sent")} subtitle={L("تقدر تبدأ بالضغط النهارده وتنقل لـ Cloud API بعد توثيق Meta", "Start with click-to-chat today, move to the Cloud API after Meta verification")} />
            <div className="grid gap-2.5 px-5 pb-5 sm:grid-cols-2" role="radiogroup" aria-label={L("طريقة الإرسال", "How messages are sent")}>
              {MODES.map((m) => (
                <button
                  key={m.v}
                  type="button"
                  role="radio"
                  aria-checked={s.mode === m.v}
                  disabled={!editable}
                  onClick={() => set({ mode: m.v, bsp: m.v === "bsp" ? (s.bsp ?? "360dialog") : s.bsp })}
                  className={cn("relative flex gap-3 rounded-2xl border p-4 text-start transition-colors [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:shrink-0", s.mode === m.v ? "border-primary bg-primary-soft/50 shadow-[var(--sf-glow)]" : "border-line hover:border-line-strong")}
                >
                  {m.icon}
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 font-semibold">
                      {L(m.ar, m.en)}
                      {m.tag ? <Badge size="sm" tone="brass">{L(m.tag.ar, m.tag.en)}</Badge> : null}
                    </span>
                    <span className="mt-0.5 block text-[13px] text-muted">{L(m.dAr, m.dEn)}</span>
                  </span>
                </button>
              ))}
            </div>
            {s.mode === "bsp" ? (
              <div className="grid gap-2 border-t border-line px-5 py-4 sm:grid-cols-[220px_1fr] sm:items-end">
                <Select label={L("الـ BSP", "BSP")} value={s.bsp ?? "360dialog"} onChange={(e) => set({ bsp: e.target.value as BspProvider })} options={BSPS.map((b) => ({ value: b.v, label: b.label }))} disabled={!editable} />
                <p className="pb-2.5 text-[13px] text-muted">{L(BSPS.find((b) => b.v === (s.bsp ?? "360dialog"))!.note.ar, BSPS.find((b) => b.v === (s.bsp ?? "360dialog"))!.note.en)}</p>
              </div>
            ) : null}
            <div className="grid gap-3 border-t border-line px-5 py-4 sm:grid-cols-3">
              <Input label={L("رقم واتساب البيزنس", "WhatsApp business number")} icon={<Phone />} value={s.senderNumber} onChange={(e) => set({ senderNumber: e.target.value })} dir="ltr" placeholder="+20 100 000 0000" disabled={!editable} hint={L("للعرض بس", "Display only")} />
              <Input label={L("الاسم الظاهر", "Display name")} value={s.displayName} onChange={(e) => set({ displayName: e.target.value })} placeholder={restaurant?.name[lang]} disabled={!editable} hint={L("لازم Meta توافق عليه", "Meta must approve it")} />
              <Select label={L("بلد الأرقام", "Phone country")} value={s.country} onChange={(e) => set({ country: e.target.value as "EG" | "SA" })} options={[{ value: "EG", label: L("مصر (+20)", "Egypt (+20)") }, { value: "SA", label: L("السعودية (+966)", "Saudi Arabia (+966)") }]} disabled={!editable} />
            </div>
          </Card>

          {/* stages */}
          <Card>
            <CardHeader icon={<Bell />} title={L("رسايل حالة الطلب الأوتوماتيك", "Automatic order-status messages")} subtitle={L("قوالب Utility — كل مرحلة بتتبعت مرة واحدة للطلب", "Utility templates — each stage is sent once per order")} />
            <div className="grid gap-x-6 px-5 pb-4 sm:grid-cols-2">
              {STAGES.map((x) => (
                <Switch key={x.s} label={L(x.ar, x.en)} checked={s.autoStages.includes(x.s)} disabled={!editable} onChange={(on) => set({ autoStages: on ? [...new Set([...s.autoStages, x.s])] : s.autoStages.filter((y) => y !== x.s) })} />
              ))}
            </div>
            {s.mode === "click_to_chat" ? <p className="border-t border-line px-5 py-3 text-[12.5px] text-muted">{L("في الإرسال بالضغط الرسايل دي بتستنى في «للإرسال» في صندوق الوارد لحد ما حد يدوس عليها.", "With click-to-chat these wait under “To send” in the inbox until someone taps them.")}</p> : null}
          </Card>

          {/* feedback */}
          <Card>
            <CardHeader icon={<Star />} title={L("طلب التقييم", "Feedback request")} subtitle={L("بعد التوصيل أو بعد ما الزبون يدفع في الصالة — بلينك صفحة التقييم", "After delivery or after a paid visit — with the rating page link")} />
            <div className="grid gap-x-6 px-5 pb-5 sm:grid-cols-2">
              <Switch label={L("ابعت طلب تقييم", "Send a feedback request")} checked={s.feedback.enabled} disabled={!editable} onChange={(v) => set({ feedback: { ...s.feedback, enabled: v } })} />
              <Input type="number" min={0} max={1440} label={L("بعد كام دقيقة", "Delay (minutes)")} value={String(s.feedback.delayMin)} disabled={!editable || !s.feedback.enabled} onChange={(e) => set({ feedback: { ...s.feedback, delayMin: Math.max(0, Math.min(1440, Number(e.target.value) || 0)) } })} />
              <Switch label={L("بعد التوصيل", "After delivery")} checked={s.feedback.afterDelivery} disabled={!editable || !s.feedback.enabled} onChange={(v) => set({ feedback: { ...s.feedback, afterDelivery: v } })} />
              <Switch label={L("بعد الزيارة (الحساب اتدفع)", "After a visit (check paid)")} checked={s.feedback.afterVisit} disabled={!editable || !s.feedback.enabled} onChange={(v) => set({ feedback: { ...s.feedback, afterVisit: v } })} />
            </div>
          </Card>

          {/* hours */}
          <Card>
            <CardHeader icon={<Clock />} title={L("رد تلقائي برّه مواعيد العمل", "Auto-reply outside business hours")} subtitle={L("مرة واحدة كل ١٢ ساعة للمحادثة — في Cloud API بس", "Once per conversation per 12h — Cloud API only")} />
            <div className="grid gap-3 px-5 pb-5">
              <div className="grid gap-x-6 sm:grid-cols-2">
                <Switch label={L("شغّال", "Enabled")} checked={s.businessHours.enabled} disabled={!editable} onChange={(v) => set({ businessHours: { ...s.businessHours, enabled: v } })} />
                <Switch label={L("استخدم مواعيد الفرع", "Use the branch hours")} checked={s.businessHours.useBranchHours} disabled={!editable} onChange={(v) => set({ businessHours: { ...s.businessHours, useBranchHours: v } })} />
              </div>
              {!s.businessHours.useBranchHours ? (
                <div className="grid grid-cols-2 gap-3">
                  <Input type="time" label={L("بنفتح", "Open")} value={s.businessHours.open} onChange={(e) => set({ businessHours: { ...s.businessHours, open: e.target.value } })} disabled={!editable} />
                  <Input type="time" label={L("بنقفل", "Close")} value={s.businessHours.close} onChange={(e) => set({ businessHours: { ...s.businessHours, close: e.target.value } })} disabled={!editable} />
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Textarea label="العربي" rows={3} dir="rtl" value={s.businessHours.reply.ar} onChange={(e) => set({ businessHours: { ...s.businessHours, reply: { ...s.businessHours.reply, ar: e.target.value } } })} disabled={!editable} />
                <Textarea label="English" rows={3} dir="ltr" value={s.businessHours.reply.en} onChange={(e) => set({ businessHours: { ...s.businessHours, reply: { ...s.businessHours.reply, en: e.target.value } } })} disabled={!editable} />
              </div>
            </div>
          </Card>

          {/* quiet hours + rates */}
          <Card>
            <CardHeader icon={<MoonStar />} title={L("ساعات الهدوء وحدود التسويق", "Quiet hours & marketing limits")} />
            <div className="grid gap-3 px-5 pb-5 sm:grid-cols-4 sm:items-end">
              <div className="sm:col-span-4"><Switch label={L("ماتبعتش تسويق في ساعات الهدوء (بيتأجل)", "No marketing in quiet hours (postponed)")} checked={s.quietHours.enabled} disabled={!editable} onChange={(v) => set({ quietHours: { ...s.quietHours, enabled: v } })} /></div>
              <Input type="time" label={L("من", "From")} value={s.quietHours.start} onChange={(e) => set({ quietHours: { ...s.quietHours, start: e.target.value } })} disabled={!editable} />
              <Input type="time" label={L("لحد", "Until")} value={s.quietHours.end} onChange={(e) => set({ quietHours: { ...s.quietHours, end: e.target.value } })} disabled={!editable} />
              <Input type="number" min={0} max={14} label={L("رسايل تسويق للزبون في الأسبوع", "Marketing per customer / week")} value={String(s.marketingCapPerWeek)} onChange={(e) => set({ marketingCapPerWeek: Math.max(0, Math.min(14, Number(e.target.value) || 0)) })} disabled={!editable} wrapClassName="sm:col-span-2" />
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Wallet />} title={L("أسعار Meta (تقديري)", "Meta rates (estimate)")} subtitle={L("دولار لكل رسالة اتسلّمت — حدّثها من جدول أسعار Meta", "USD per delivered message — update from Meta's rate card")} action={<Button size="sm" variant="ghost" icon={<RotateCcw />} disabled={!editable} onClick={() => set({ rates: DEFAULT_MESSAGING.rates })}>{L("الافتراضي", "Defaults")}</Button>} />
            <div className="overflow-x-auto px-5 pb-5">
              <table className="w-full min-w-[420px] text-[13.5px]">
                <thead>
                  <tr className="text-muted">
                    <th className="py-1.5 text-start font-semibold" />
                    {(["utility", "marketing", "authentication", "service"] as PriceCategory[]).map((k) => (
                      <th key={k} className="py-1.5 text-start font-semibold">{{ utility: L("خدمة", "Utility"), marketing: L("تسويق", "Marketing"), authentication: L("تحقق", "Auth"), service: L("رد", "Service") }[k]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(["EG", "SA"] as const).map((c) => (
                    <tr key={c}>
                      <th className="py-1.5 pe-3 text-start font-semibold">{c === "EG" ? L("🇪🇬 مصر", "🇪🇬 Egypt") : L("🇸🇦 السعودية", "🇸🇦 KSA")}</th>
                      {(["utility", "marketing", "authentication", "service"] as PriceCategory[]).map((k) => (
                        <td key={k} className="py-1.5 pe-2">
                          <input aria-label={`${c} ${k}`} type="number" step="0.0001" min={0} value={s.rates[c][k]} disabled={!editable} onChange={(e) => rate(c, k, e.target.value)} className="num h-10 w-24 rounded-lg border border-line bg-surface px-2 text-[13.5px]" dir="ltr" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[12px] text-muted">{L("من ١ أكتوبر ٢٠٢٦ قوالب الـ Utility جوه نافذة الـ ٢٤ ساعة بقت بفلوس، والردود فوق ١٠٠٠ في الشهر كمان.", "Since 1 Oct 2026 Utility templates inside the 24h window are charged, and so are service replies beyond 1,000/month.")}</p>
            </div>
          </Card>
        </div>

        {/* side column */}
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader icon={<ServerCog />} title={L("حالة السيرفر", "Server status")} subtitle="/api/whatsapp-send" />
            <div className="grid gap-2 px-5 pb-5 text-[13.5px]">
              {server === null ? <p className="text-muted">{L("بنشيك…", "Checking…")}</p> : server === "unreachable" ? (
                <p className="text-muted">{L("الـ API مش متاح هنا (بيشتغل على Vercel). الإرسال بالضغط شغال عادي.", "The API isn't reachable here (it runs on Vercel). Click-to-chat works regardless.")}</p>
              ) : (
                <>
                  <StatusLine ok={server.configured} label={L("بيانات واتساب (توكن + رقم)", "WhatsApp credentials (token + number)")} />
                  <StatusLine ok={server.webhook.verifyToken && server.webhook.appSecret} label={L("الـ Webhook (verify token + app secret)", "Webhook (verify token + app secret)")} />
                  <StatusLine ok={server.auth !== "none"} label={`${L("التحقق", "Auth")}: ${server.auth}`} />
                  <StatusLine ok={server.storage === "supabase"} label={`${L("التخزين", "Storage")}: ${server.storage}`} />
                </>
              )}
            </div>
            {repo.kind === "local" ? (
              <div className="grid gap-2 border-t border-line px-5 py-4">
                <Input label={<span className="inline-flex items-center gap-1.5"><KeyRound className="size-4" />SUFRA_API_KEY</span>} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} dir="ltr" autoComplete="off" hint={L("للتشغيل من غير Supabase بس — بيتحفظ على الجهاز ده ومش بيتبعت لحد غير السيرفر بتاعك", "Only for deployments without Supabase — kept on this device and sent only to your server")} />
                <Button size="sm" variant="soft" onClick={() => { saveRaw(API_KEY_STORAGE, apiKey.trim() || null); toast({ title: L("اتحفظ على الجهاز", "Saved on this device"), tone: "success" }); }}>{L("احفظ المفتاح", "Save key")}</Button>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader icon={<Send />} title={L("تجربة إرسال لرقمي", "Test send to my number")} />
            <div className="grid gap-2.5 px-5 pb-5">
              <Input value={s.testNumber} onChange={(e) => set({ testNumber: e.target.value })} dir="ltr" inputMode="tel" placeholder="01xxxxxxxxx" aria-label={L("رقمي", "My number")} />
              <Button icon={<Send />} loading={testing} onClick={() => void testSend()} disabled={s.mode === "off"}>
                {s.mode === "cloud" || s.mode === "bsp" ? L("ابعت hello_world", "Send hello_world") : L("افتح في واتساب", "Open in WhatsApp")}
              </Button>
              <p className="text-[12px] text-muted">{s.mode === "cloud" || s.mode === "bsp" ? L("قالب hello_world معتمد في أي حساب جديد — أضمن أول تجربة.", "hello_world is pre-approved on every new account — the safest first test.") : L("هيفتح واتساب برسالة تجربة لرقمك.", "Opens WhatsApp with a test message to your number.")}</p>
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Webhook />} title="Webhook" subtitle={L("الصقه في إعدادات تطبيق Meta", "Paste into your Meta app settings")} />
            <div className="grid gap-2 px-5 pb-5">
              <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
                <code className="min-w-0 flex-1 truncate font-mono text-[12px]" dir="ltr">{WEBHOOK_URL}</code>
                <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => copy(WEBHOOK_URL)}>{L("انسخ", "Copy")}</Button>
              </div>
              <p className="text-[12px] text-muted">{L("Verify token = قيمة WHATSAPP_VERIFY_TOKEN على Vercel. اشترك في حقل messages.", "Verify token = your WHATSAPP_VERIFY_TOKEN on Vercel. Subscribe to the messages field.")}</p>
            </div>
          </Card>

          <MetaGuide />
        </div>
      </div>

      {editable && dirty ? (
        <div className="fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 md:bottom-6">
          <div className="flex items-center gap-3 rounded-full border border-line bg-surface px-4 py-2 shadow-sf-lg">
            <span className="text-[13.5px] font-semibold">{L("في تغييرات مش محفوظة", "Unsaved changes")}</span>
            <Button size="sm" variant="ghost" onClick={() => setS(saved)}>{L("تراجع", "Discard")}</Button>
            <Button size="sm" icon={<Save />} loading={saving} onClick={() => void save()}>{L("احفظ", "Save")}</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatusLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? <CheckCircle2 className="size-4 text-ok" aria-hidden /> : <XCircle className="size-4 text-faint" aria-hidden />}
      <span className={ok ? "" : "text-muted"}>{label}</span>
    </div>
  );
}

/** The Meta onboarding steps, in Arabic first (owner-facing) with English. */
function MetaGuide() {
  const { L } = useT();
  const steps: { ar: string; en: string; link?: string }[] = [
    { ar: "افتح Meta Business Suite (business.facebook.com) واعمل «محفظة أعمال» باسم المطعم الرسمي.", en: "Open Meta Business Suite (business.facebook.com) and create a Business Portfolio with the restaurant's legal name.", link: "https://business.facebook.com/" },
    { ar: "وثّق النشاط (Business verification): سجل تجاري، بطاقة ضريبية، فاتورة مرافق أو كشف حساب بنفس العنوان، ودومين/موقع باسم المطعم. بياخد من يوم لكام يوم.", en: "Business verification: commercial register, tax card, a utility bill or bank statement with the same address, and a domain/website in the restaurant's name. Takes a day to a few days.", link: "https://business.facebook.com/settings/security" },
    { ar: "اعمل تطبيق في developers.facebook.com (نوع Business) وضيف منتج WhatsApp — كده اتعمل حساب WhatsApp Business (WABA).", en: "Create an app at developers.facebook.com (type Business) and add the WhatsApp product — this creates your WhatsApp Business Account (WABA).", link: "https://developers.facebook.com/apps/" },
    { ar: "ضيف رقم موبايل مخصوص للبيزنس مش متفعّل على تطبيق واتساب (أو امسحه منه الأول)، وأكّده بكود SMS، واختار الاسم الظاهر (Meta بتراجعه).", en: "Add a dedicated number that is NOT active in the WhatsApp app (or delete it there first), verify it by SMS, and choose the display name (Meta reviews it)." },
    { ar: "ضيف وسيلة دفع على الـ WABA (كارت) — الرسايل بتتحاسب لكل رسالة اتسلّمت حسب الفئة والبلد.", en: "Add a payment method to the WABA — Meta charges per delivered message by category and country." },
    { ar: "من Business Settings ← System users اعمل System user (Admin)، اديله صلاحية على التطبيق والـ WABA، وطلّع توكن دائم بصلاحيات whatsapp_business_messaging و whatsapp_business_management.", en: "Business Settings → System users: create an Admin system user, assign the app and the WABA, and generate a permanent token with whatsapp_business_messaging + whatsapp_business_management." },
    { ar: "على Vercel حط: WHATSAPP_TOKEN (التوكن) و WHATSAPP_PHONE_NUMBER_ID (من صفحة API Setup — مش رقم الموبايل) و WHATSAPP_VERIFY_TOKEN (أي كلمة سر) و WHATSAPP_APP_SECRET (App settings ← Basic).", en: "On Vercel set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID (from API Setup — not the phone number), WHATSAPP_VERIFY_TOKEN (any random string) and WHATSAPP_APP_SECRET (App settings → Basic)." },
    { ar: "في WhatsApp ← Configuration الصق رابط الـ Webhook ونفس الـ Verify token، واشترك في messages.", en: "In WhatsApp → Configuration paste the webhook URL and the same verify token, then subscribe to messages." },
    { ar: "من «القوالب» هنا انسخ الـ JSON لكل قالب وابعته للمراجعة (دقايق لـ ٢٤ ساعة). قوالب الخدمة من غير كلام ترويجي.", en: "From Templates here, copy each template's JSON and submit it for review (minutes to 24h). Keep Utility templates free of promotional wording." },
    { ar: "غيّر طريقة الإرسال لـ «واتساب Cloud API» وجرّب «ابعت hello_world» لرقمك.", en: "Switch the mode to “WhatsApp Cloud API” and try “Send hello_world” to your number." },
  ];
  return (
    <Card>
      <CardHeader icon={<BadgeCheck />} title={L("دليل تجهيز واتساب من Meta", "Meta WhatsApp setup guide")} subtitle={L("١٠ خطوات — صاحب المطعم بيعملها مرة واحدة", "10 steps — the owner does this once")} />
      <ol className="grid gap-2.5 px-5 pb-5">
        {steps.map((st, i) => (
          <li key={i} className="flex gap-3 text-[13.5px] leading-relaxed">
            <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-[12px] font-bold text-primary">{i + 1}</span>
            <span>
              {L(st.ar, st.en)}
              {st.link ? (
                <a href={st.link} target="_blank" rel="noreferrer" className="ms-1 inline-flex items-center gap-0.5 font-semibold text-primary">
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      <p className="border-t border-line px-5 py-3 text-[12px] text-muted">{L("لحد ما ده يخلص: استخدم «الإرسال بالضغط» — شغال من غير أي حساب.", "Until then: use click-to-chat — it needs no account at all.")}</p>
    </Card>
  );
}

/**
 * Settings → Payments (/settings/payments): gateway per country, test/live, methods, fees (absorb or surcharge),
 * pay-link expiry, webhook URLs to paste into the provider dashboard and step-by-step onboarding.
 * Keys are NEVER typed here: they live in Vercel env vars / Supabase Vault; /api/pay-status reports which are present.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, CircleX, Copy, CreditCard, ExternalLink, KeyRound, RotateCcw, Save, Server, ShieldCheck, Webhook } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive, useRepo } from "@/data/hooks";
import type { OnlineMethod, PaymentSettings } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { major } from "@/lib/money";
import { PageHeader } from "@/shell/PageHeader";
import { Badge, Button, Card, CardHeader, Input, Segmented, Switch, useToast } from "@/ui";
import { SettingsNav } from "@/modules/settings/SettingsNav";
import { fetchPayServerStatus, type PayServerStatus } from "./api";
import { callbackUrl, DEFAULT_PAYMENT_SETTINGS, METHOD_LABEL, paySettingsOf, providerInfo, providersFor, webhookUrl } from "./config";
import { unitsDecimal } from "./reconcile";

export default function PaymentsSettings() {
  const { L, loc, lang } = useT();
  const db = useDb();
  const repo = useRepo();
  const { toast } = useToast();
  const { can } = useSession();
  const settings = useLive("settings").data[0] ?? null;
  const [ps, setPs] = useState<PaymentSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [server, setServer] = useState<PayServerStatus | null | undefined>(undefined);
  const editable = can("settings.edit");

  useEffect(() => {
    if (settings && !ps) setPs(paySettingsOf(settings));
  }, [settings, ps]);
  useEffect(() => {
    let alive = true;
    // local dev / preview has no /api functions — don't ask (avoids a 404 in the console)
    if (repo.kind === "local" && /^(localhost|127\.|0\.0\.0\.0)/.test(window.location.hostname)) setServer(null);
    else fetchPayServerStatus().then((s) => alive && setServer(s));
    return () => {
      alive = false;
    };
  }, [repo]);

  if (!settings || !ps) return null;
  const saved = paySettingsOf(settings);
  const dirty = JSON.stringify(saved) !== JSON.stringify(ps);
  const set = (p: Partial<PaymentSettings>) => setPs((x) => (x ? { ...x, ...p } : x));
  const info = providerInfo(ps.provider, ps.country);
  const base = server?.publicBaseUrl ?? "https://sufra-planet-crm.vercel.app";
  const keyState = info && info.status === "integrated" && server ? server.providers[info.id as "paymob" | "kashier" | "moyasar"] : null;

  const save = async () => {
    setSaving(true);
    try {
      await db.update("settings", settings.id, { payments: ps });
      await db.audit("settings.payments", "settings", settings.id, { provider: ps.provider, mode: ps.mode, methods: ps.methods, absorbFees: ps.absorbFees, surchargeBp: ps.surchargeBp });
      toast({ title: L("إعدادات الدفع اتحفظت", "Payment settings saved"), tone: "success" });
    } finally {
      setSaving(false);
    }
  };
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast({ title: L("اتنسخ", "Copied"), tone: "success" });
    } catch {
      toast({ title: v });
    }
  };
  const pickCountry = (c: "EG" | "SA") => {
    const first = providersFor(c).find((p) => p.status === "integrated")!;
    set({ country: c, provider: first.id, methods: first.methods.filter((m) => (c === "SA" ? ["mada", "card", "applepay"] : ["card", "wallet"]).includes(m)) });
  };
  const toggleMethod = (m: OnlineMethod, on: boolean) => set({ methods: on ? [...new Set([...ps.methods, m])] : ps.methods.filter((x) => x !== m) });
  const actions = (
    <>
      <Button variant="ghost" icon={<RotateCcw className="size-4" />} disabled={!dirty} onClick={() => setPs(saved)}>
        {L("تراجع", "Discard")}
      </Button>
      <Button icon={<Save className="size-4" />} disabled={!dirty || !editable} loading={saving} onClick={save}>
        {L("حفظ", "Save")}
      </Button>
    </>
  );
  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v.trim() !== "" ? Number(v) : fallback);

  return (
    <div className="grid gap-6">
      <SettingsNav />
      <PageHeader
        icon={<CreditCard />}
        title={L("الدفع الأونلاين", "Online payments")}
        subtitle={L("بوابة الدفع، طرق الدفع، الرسوم ولينكات الدفع", "Gateway, methods, fees and pay links")}
        actions={<div className="hidden gap-2 sm:flex">{actions}</div>}
      />
      <div className="-mt-3 flex gap-2 sm:hidden">{actions}</div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader icon={<CreditCard />} title={L("بوابة الدفع", "Payment gateway")} subtitle={L("اختار البلد والبوابة اللي معاك عقد معاها", "Pick the country and the gateway you have a contract with")} />
            <div className="grid gap-4 px-5 pb-5">
              <Segmented label={L("البلد", "Country")} value={ps.country} onChange={pickCountry} options={[{ value: "EG", label: L("🇪🇬 مصر", "🇪🇬 Egypt") }, { value: "SA", label: L("🇸🇦 السعودية", "🇸🇦 Saudi Arabia") }]} />
              <div role="radiogroup" aria-label={L("البوابة", "Gateway")} className="grid gap-2 sm:grid-cols-2">
                {providersFor(ps.country).map((p) => {
                  const on = ps.provider === p.id;
                  const ready = p.status === "integrated";
                  return (
                    <button
                      key={`${p.country}-${p.id}`}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={!ready}
                      onClick={() => set({ provider: p.id, methods: ps.methods.filter((m) => p.methods.includes(m)).length ? ps.methods.filter((m) => p.methods.includes(m)) : p.methods.slice(0, 2) })}
                      className={cn("grid gap-1 rounded-2xl border-2 p-3.5 text-start transition-colors", on ? "border-primary bg-primary-soft" : "border-line bg-surface hover:border-line-strong", !ready && "cursor-not-allowed opacity-60")}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[15px] font-bold">{p.name}</span>
                        {ready ? <Badge size="sm" tone={on ? "primary" : "ok"}>{L("مربوطة", "Integrated")}</Badge> : <Badge size="sm">{L("الموجة الجاية", "Next wave")}</Badge>}
                      </span>
                      <span className="text-[12.5px] text-muted">{p.methods.map((m) => loc(METHOD_LABEL[m]).split(" (")[0]).join(" · ")}</span>
                      {p.note ? <span className="text-[12px] text-muted">{loc(p.note)}</span> : null}
                    </button>
                  );
                })}
              </div>
              <div className="grid gap-1.5">
                <span className="text-[13px] font-semibold text-muted">{L("الوضع", "Mode")}</span>
                <Segmented label={L("الوضع", "Mode")} value={ps.mode} onChange={(mode) => set({ mode })} options={[{ value: "test", label: L("تجربة (Test)", "Test") }, { value: "live", label: L("حقيقي (Live)", "Live") }]} />
                {ps.mode === "live" ? <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">{L("في وضع Live الفلوس حقيقية — اتأكد إن المفاتيح اللي على السيرفر هي مفاتيح Live.", "Live mode charges real money — make sure the server keys are the live ones.")}</p> : null}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title={L("طرق الدفع اللي تظهر للضيف", "Methods shown to guests")} subtitle={L("الضيف يختار منها قبل صفحة الدفع", "Guests choose before the checkout page")} />
            <div className="grid gap-1 px-5 sm:grid-cols-2">
              {(info?.methods ?? []).map((m) => (
                <Switch key={m} checked={ps.methods.includes(m)} onChange={(v) => toggleMethod(m, v)} label={loc(METHOD_LABEL[m])} description={m === "applepay" ? L("يظهر على أجهزة آبل بس؛ محتاج تفعيل من البوابة", "Shows on Apple devices only; enable it with the gateway") : m === "mada" ? L("لازم لأي متجر في السعودية", "Expected by every Saudi shopper") : undefined} disabled={!editable} />
              ))}
            </div>
            <p className="mt-3 px-5 pb-5 text-[12.5px] text-muted">{L("الكروت المحفوظة (Tokenization) جاية بعدين — الـ API جاهز لها (saveCard).", "Saved cards (tokenization) come later — the API leaves room for it (saveCard).")}</p>
          </Card>

          <Card>
            <CardHeader title={L("الرسوم ولينكات الدفع", "Fees and pay links")} />
            <div className="grid gap-4 px-5 pb-5">
              <Switch checked={ps.absorbFees} onChange={(v) => set({ absorbFees: v, surchargeBp: v ? 0 : ps.surchargeBp || 250 })} label={L("المطعم بيتحمل رسوم البوابة", "The restaurant absorbs gateway fees")} description={L("لو قفلتها، بنزود نسبة على الدفع الأونلاين (اتأكد إن ده مسموح في عقدك وفي قانون حماية المستهلك).", "If off, a surcharge is added to online payments (check your contract and consumer rules allow it).")} disabled={!editable} />
              <div className="grid gap-3 sm:grid-cols-2">
                {!ps.absorbFees ? <Input label={L("نسبة الإضافة ٪", "Surcharge %")} inputMode="decimal" dir="ltr" value={String(ps.surchargeBp / 100)} onChange={(e) => set({ surchargeBp: Math.max(0, Math.min(1000, Math.round(num(e.target.value, 0) * 100))) })} /> : null}
                <Input label={L("مدة لينك الدفع (دقايق)", "Pay-link lifetime (minutes)")} inputMode="numeric" dir="ltr" value={String(ps.linkExpiryMin)} onChange={(e) => set({ linkExpiryMin: Math.max(5, Math.min(10080, Math.round(num(e.target.value, 60)))) })} />
                <Input label={L("رسوم البوابة التقديرية ٪", "Estimated gateway fee %")} hint={L("للتسويات لحد ما البوابة تبعت الرسوم الفعلية", "For settlements until the gateway reports the real fee")} inputMode="decimal" dir="ltr" value={String(ps.feeBp / 100)} onChange={(e) => set({ feeBp: Math.max(0, Math.min(1000, Math.round(num(e.target.value, 2.75) * 100))) })} />
                <Input label={L("رسوم ثابتة لكل عملية", "Fixed fee per payment")} inputMode="decimal" dir="ltr" value={unitsDecimal(ps.feeFixed)} onChange={(e) => { try { set({ feeFixed: major(e.target.value || "0") }); } catch { /* typing */ } }} />
                <Input label={L("التحويل للبنك بعد (أيام)", "Payout after (days)")} inputMode="numeric" dir="ltr" value={String(ps.payoutDays)} onChange={(e) => set({ payoutDays: Math.max(0, Math.min(30, Math.round(num(e.target.value, 2)))) })} />
              </div>
            </div>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader icon={<Server />} title={L("المفاتيح على السيرفر", "Keys on the server")} subtitle={L("بنعرض موجود ولا لأ بس — عمرنا ما بنعرض القيمة", "We only show present / missing — never the value")} />
            <div className="px-5 pb-5">
            {server === undefined ? (
              <p className="text-[13px] text-muted">{L("بنسأل السيرفر…", "Asking the server…")}</p>
            ) : server === null ? (
              <p className="rounded-xl bg-info-soft px-3 py-2 text-[13px] text-info">
                {repo.kind === "local" ? L("وضع الديمو: الدفع بيشتغل بالبوابة التجريبية. على Vercel الصفحة دي هتوريك المفاتيح الموجودة.", "Demo mode: payments use the demo gateway. On Vercel this shows which keys are set.") : L("ماقدرناش نوصل لـ /api/pay-status — اتأكد إن الـ functions اتنشرت.", "Couldn't reach /api/pay-status — check the functions are deployed.")}
              </p>
            ) : (
              <ul className="grid gap-1.5">
                <KeyRow name="SUPABASE_SERVICE_ROLE_KEY" ok={server.supabase} />
                {info?.env.map((e) => <KeyRow key={e.name} name={e.name} ok={!!keyState?.keys[e.name]} optional={!keyState || !keyState.missing.includes(e.name) && !keyState.keys[e.name]} />)}
              </ul>
            )}
            {keyState ? <div className="mt-3">{keyState.configured ? <Badge tone="ok" icon={<CheckCircle2 />}>{L("جاهزة للدفع", "Ready to take payments")}</Badge> : <Badge tone="warn">{L("ناقص مفاتيح", "Keys missing")}</Badge>}</div> : null}
            </div>
          </Card>

          {info?.webhook ? (
            <Card>
              <CardHeader icon={<Webhook />} title={L("روابط تحطها في لوحة البوابة", "URLs for the gateway dashboard")} />
              <div className="grid gap-3 px-5 pb-5">
                {[{ k: L("Webhook (إشعار الدفع)", "Webhook (payment notification)"), v: webhookUrl(info.id, base) }, { k: L("رابط الرجوع (Redirect / Response callback)", "Return URL (redirect / response callback)"), v: callbackUrl(base) }].map((x) => (
                  <div key={x.k} className="grid gap-1">
                    <span className="text-[12.5px] font-semibold text-muted">{x.k}</span>
                    <div className="flex items-center gap-2">
                      <code dir="ltr" className="min-w-0 flex-1 truncate rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[12.5px]">{x.v}</code>
                      <Button size="sm" variant="secondary" icon={<Copy className="size-4" />} onClick={() => copy(x.v)}>
                        {L("انسخ", "Copy")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {info ? (
            <Card>
              <CardHeader icon={<KeyRound />} title={L(`تجهيز ${info.name} خطوة بخطوة`, `Setting up ${info.name}`)} action={<a href={info.docs} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary">{L("الدوكيومنتيشن", "Docs")} <ExternalLink className="size-3.5" /></a>} />
              <div className="px-5 pb-5">
              <ol className="grid gap-2.5">
                {info.steps.map((s, i) => (
                  <li key={i} className="flex gap-3 text-[14px] leading-relaxed">
                    <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-[12px] font-bold text-primary">{i + 1}</span>
                    <span>{loc(s)}</span>
                  </li>
                ))}
              </ol>
              {info.env.length ? (
                <div className="mt-4 grid gap-1.5">
                  <span className="text-[12.5px] font-semibold text-muted">{L("متغيرات البيئة (Vercel → Environment Variables)", "Environment variables (Vercel → Environment Variables)")}</span>
                  {info.env.map((e) => (
                    <div key={e.name} className="flex items-start justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2 text-[13px]">
                      <code dir="ltr" className="font-semibold">{e.name}</code>
                      <span className="text-end text-muted">
                        {loc(e.hint)} {e.secret ? <Badge size="sm" tone="danger" className="ms-1">{L("سري", "secret")}</Badge> : null}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-[12.5px] text-muted">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />
                {lang === "ar" ? "المفاتيح السرية عمرها ما تتكتب هنا ولا توصل للمتصفح. مطاعم كتير على نفس النشر؟ خزّن مفاتيح كل مطعم في Supabase Vault واربطها بـ payment_accounts." : "Secret keys are never typed here and never reach the browser. Many restaurants on one deployment? Store each one's keys in Supabase Vault, linked from payment_accounts."}
              </p>
              </div>
            </Card>
          ) : null}
          <p className="text-[12px] text-faint">{L("الافتراضي: ", "Defaults: ")}{DEFAULT_PAYMENT_SETTINGS.provider} · {DEFAULT_PAYMENT_SETTINGS.mode}</p>
        </div>
      </div>
    </div>
  );
}

function KeyRow({ name, ok, optional }: { name: string; ok: boolean; optional?: boolean }) {
  const { L } = useT();
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2 text-[13px]">
      <code dir="ltr">{name}</code>
      {ok ? (
        <span className="inline-flex items-center gap-1 font-semibold text-ok"><CheckCircle2 className="size-4" />{L("موجود", "set")}</span>
      ) : optional ? (
        <span className="text-faint">{L("اختياري", "optional")}</span>
      ) : (
        <span className="inline-flex items-center gap-1 font-semibold text-danger"><CircleX className="size-4" />{L("ناقص", "missing")}</span>
      )}
    </li>
  );
}

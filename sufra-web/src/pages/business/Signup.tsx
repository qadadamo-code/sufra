import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Building2, CreditCard, Landmark, PartyPopper, Smartphone, Wallet } from "lucide-react";
import { ProgressBar } from "@/components/ui/progress-bar";
import { LoadingButton } from "@/components/ui/loading-button";
import { useLang } from "@/lib/i18n";
import { notify } from "@/lib/notify";
import type { Route } from "@/lib/router";
import { load, save } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { BizPage, Field, Money, Segmented, Toggle, useArrow } from "@/components/business/kit";
import { quotePlan } from "@/data/business/billing";
import { PERIODS, PLANS, TRIAL_DAYS, type PeriodId, type PlanId } from "@/data/business/plans";
import { ZONE_NAMES } from "@/data/business/suppliers";
import { validRin } from "@/data/business/tax";

interface Draft {
  name: string;
  nameEn: string;
  kind: string;
  owner: string;
  phone: string;
  email: string;
  rin: string;
  vat: boolean;
  activity: "5610" | "5630";
  branch: string;
  area: string;
  address: string;
  tables: number;
  plan: PlanId;
  period: PeriodId;
  pay: "card" | "instapay" | "bank" | "later";
}
const EMPTY: Draft = { name: "", nameEn: "", kind: "restaurant", owner: "", phone: "", email: "", rin: "", vat: true, activity: "5610", branch: "", area: "zamalek", address: "", tables: 12, plan: "pro", period: "yearly", pay: "later" };
const KEY = "sufra.biz.signup";

const validPhone = (v: string) => /^01[0125]\d{8}$/.test(v.replace(/\s/g, ""));

export default function Signup({ route }: { route: Route }) {
  const { L, lang } = useLang();
  const Arrow = useArrow();
  const reduced = useReducedMotion();
  const [d, setD] = useState<Draft>(() => {
    const saved = load<Partial<Draft>>(KEY, {});
    const plan = route.query.get("plan") as PlanId | null;
    const period = route.query.get("period") as PeriodId | null;
    return { ...EMPTY, ...saved, ...(plan && PLANS.some((p) => p.id === plan) ? { plan } : {}), ...(period && PERIODS.some((p) => p.id === period) ? { period } : {}) };
  });
  const [step, setStep] = useState(0);
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => save(KEY, d), [d]);
  const up = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const steps = [L("المطعم", "Restaurant"), L("الضرايب", "Tax"), L("الفرع", "Branch"), L("الباقة", "Plan"), L("الدفع", "Payment")];
  const errors: Record<number, string[]> = {
    0: [!d.name.trim() && L("اكتب اسم المطعم", "Enter the restaurant name"), !d.owner.trim() && L("اكتب اسم المسؤول", "Enter the owner's name"), !validPhone(d.phone) && L("رقم موبايل مصري صحيح (01xxxxxxxxx)", "A valid Egyptian mobile (01xxxxxxxxx)")].filter(Boolean) as string[],
    1: [d.vat && !validRin(d.rin) && L("رقم التسجيل الضريبي 9 أرقام", "Tax registration number must be 9 digits")].filter(Boolean) as string[],
    2: [!d.branch.trim() && L("اكتب اسم الفرع", "Enter a branch name")].filter(Boolean) as string[],
    3: [],
    4: [],
  };
  const next = () => {
    if (errors[step].length) return setTried(true);
    setTried(false);
    setStep((s) => Math.min(steps.length - 1, s + 1));
  };
  const q = quotePlan(d.plan, d.period);
  const finish = () => {
    save(KEY, EMPTY);
    setDone(true);
    notify({ title: L("اتسجلت بنجاح", "You're in"), detail: L("حساب تجريبي جاهز", "Demo account ready"), tone: "primary", icon: "check" });
  };
  const err = tried ? errors[step] : [];

  if (done) {
    return (
      <BizPage kind="business" path={route.path}>
        <section className="wrap gutter grid min-h-[60vh] place-items-center py-16 text-center">
          <div className="max-w-lg">
            <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-brass-soft text-brass"><PartyPopper className="size-8" aria-hidden /></span>
            <h1 className="mt-5 text-4xl font-bold">{L(`أهلًا بيك في سُفرة يا ${d.owner.split(" ")[0] || "فندم"}!`, `Welcome to Sufra, ${d.owner.split(" ")[0] || "chef"}!`)}</h1>
            <p className="mt-3 text-muted-foreground">{L(`تجربتك المجانية ${TRIAL_DAYS} يوم بدأت. ده حساب تجريبي — مفيش أي دفع حقيقي اتعمل.`, `Your ${TRIAL_DAYS}-day trial has started. This is a demo account — no real payment was taken.`)}</p>
            <a href="#/business/dashboard" className="sf-btn sf-btn-primary mt-6">{L("افتح لوحة التحكم", "Open the dashboard")}<Arrow className="size-4" aria-hidden /></a>
          </div>
        </section>
      </BizPage>
    );
  }

  return (
    <BizPage kind="business" path={route.path}>
      <section className="wrap gutter grid gap-8 py-10 lg:grid-cols-[1fr_340px] lg:py-14">
        <div className="min-w-0">
          <p className="sf-kicker">{L(`تجربة مجانية ${TRIAL_DAYS} يوم`, `${TRIAL_DAYS}-day free trial`)}</p>
          <h1 className="mt-1 text-[34px] font-bold leading-tight sm:text-[44px]">{L("سجّل مطعمك", "Set up your restaurant")}</h1>
          <div className="mt-6 max-w-xl">
            <ProgressBar value={step + 1} max={steps.length} label={L(`الخطوة ${step + 1} من ${steps.length}: ${steps[step]}`, `Step ${step + 1} of ${steps.length}: ${steps[step]}`)} pendingLabel="…" completeLabel={L("جاهز", "Ready")} />
            <ol className="mt-3 flex flex-wrap gap-1.5">
              {steps.map((s, i) => (
                <li key={s}>
                  <button type="button" disabled={i > step} onClick={() => setStep(i)} className={cn("rounded-full px-3 py-1 text-[12.5px] font-semibold", i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground")} aria-current={i === step ? "step" : undefined}>
                    <span className="num">{i + 1}</span> · {s}
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <form
            className="mt-8 max-w-xl"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              next();
            }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.fieldset key={step} initial={reduced ? { opacity: 0 } : { opacity: 0, x: lang === "ar" ? -24 : 24 }} animate={{ opacity: 1, x: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, x: lang === "ar" ? 24 : -24 }} transition={{ duration: 0.25 }} className="grid gap-4">
                <legend className="sr-only">{steps[step]}</legend>
                {step === 0 ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label={L("اسم المطعم (عربي)", "Restaurant name (Arabic)")}><input className="sf-input" value={d.name} onChange={(e) => up("name", e.target.value)} autoComplete="organization" /></Field>
                      <Field label={L("الاسم بالإنجليزي", "Name in English")}><input className="sf-input" dir="ltr" value={d.nameEn} onChange={(e) => up("nameEn", e.target.value)} /></Field>
                    </div>
                    <Field label={L("النشاط", "Type")}>
                      <select className="sf-input" value={d.kind} onChange={(e) => up("kind", e.target.value)}>
                        <option value="restaurant">{L("مطعم", "Restaurant")}</option>
                        <option value="cafe">{L("كافيه", "Café")}</option>
                        <option value="cloud">{L("مطبخ سحابي (توصيل بس)", "Cloud kitchen (delivery only)")}</option>
                        <option value="bakery">{L("مخبز وحلواني", "Bakery & sweets")}</option>
                        <option value="ahwa">{L("قهوة بلدي", "Ahwa")}</option>
                      </select>
                    </Field>
                    <Field label={L("اسم المسؤول", "Owner / manager name")}><input className="sf-input" value={d.owner} onChange={(e) => up("owner", e.target.value)} autoComplete="name" /></Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label={L("الموبايل", "Mobile")}><input className="sf-input num" dir="ltr" inputMode="tel" placeholder="01xxxxxxxxx" value={d.phone} onChange={(e) => up("phone", e.target.value)} autoComplete="tel" /></Field>
                      <Field label={L("الإيميل (اختياري)", "Email (optional)")}><input className="sf-input" dir="ltr" type="email" value={d.email} onChange={(e) => up("email", e.target.value)} autoComplete="email" /></Field>
                    </div>
                  </>
                ) : null}
                {step === 1 ? (
                  <>
                    <Toggle checked={d.vat} onChange={(v) => up("vat", v)} label={L("مسجّل في ضريبة القيمة المضافة", "VAT registered")} sub={L("لو مسجّل، هنطلّع إيصالات إلكترونية ETA وإقرار شهري.", "If registered we issue ETA e-receipts and a monthly return.")} />
                    {d.vat ? (
                      <Field label={L("رقم التسجيل الضريبي (RIN)", "Tax registration number (RIN)")} hint={L("9 أرقام زي اللي على البطاقة الضريبية", "9 digits, as on your tax card")}>
                        <input className="sf-input num" dir="ltr" inputMode="numeric" maxLength={11} placeholder="123-456-789" value={d.rin} onChange={(e) => up("rin", e.target.value.replace(/[^\d-]/g, ""))} aria-invalid={tried && !validRin(d.rin)} />
                      </Field>
                    ) : null}
                    <Field label={L("كود النشاط (ISIC)", "Activity code (ISIC)")}>
                      <Segmented label={L("كود النشاط", "Activity code")} value={d.activity} onChange={(v) => up("activity", v)} options={[{ id: "5610", label: L("5610 · مطاعم", "5610 · Restaurants") }, { id: "5630", label: L("5630 · مشروبات/كافيهات", "5630 · Beverages/cafés") }]} />
                    </Field>
                  </>
                ) : null}
                {step === 2 ? (
                  <>
                    <Field label={L("اسم الفرع", "Branch name")}><input className="sf-input" placeholder={L("مثلًا: فرع الزمالك", "e.g. Zamalek branch")} value={d.branch} onChange={(e) => up("branch", e.target.value)} /></Field>
                    <Field label={L("المنطقة", "Area")}>
                      <select className="sf-input" value={d.area} onChange={(e) => up("area", e.target.value)}>
                        {Object.entries(ZONE_NAMES).map(([id, z]) => <option key={id} value={id}>{lang === "ar" ? z.ar : z.en}</option>)}
                      </select>
                    </Field>
                    <Field label={L("العنوان", "Address")}><input className="sf-input" value={d.address} onChange={(e) => up("address", e.target.value)} autoComplete="street-address" /></Field>
                    <Field label={L("عدد الترابيزات", "Number of tables")} hint={L("هنرسم لك صالة مبدئية تعدّلها بعدين", "We'll sketch a starting floor you can edit")}>
                      <input className="sf-input num" type="number" min={0} max={300} dir="ltr" value={d.tables} onChange={(e) => up("tables", Math.max(0, Math.min(300, Number(e.target.value) || 0)))} />
                    </Field>
                  </>
                ) : null}
                {step === 3 ? (
                  <>
                    <Segmented label={L("مدة الدفع", "Billing period")} value={d.period} onChange={(v) => up("period", v)} options={PERIODS.map((p) => ({ id: p.id, label: lang === "ar" ? p.ar : p.en }))} />
                    <div className="grid gap-2" role="radiogroup" aria-label={L("الباقة", "Plan")}>
                      {PLANS.map((p) => {
                        const pq = quotePlan(p.id, d.period);
                        return (
                          <label key={p.id} className={cn("flex cursor-pointer items-center gap-3 rounded-2xl border bg-card p-4 transition-colors", d.plan === p.id && "border-primary ring-1 ring-primary")}>
                            <input type="radio" name="plan" className="size-4 accent-[var(--sf-primary)]" checked={d.plan === p.id} onChange={() => up("plan", p.id)} />
                            <span className="min-w-0 flex-1">
                              <span className="block font-bold">{lang === "ar" ? p.ar : p.en}</span>
                              <span className="block truncate text-[13px] text-muted-foreground">{lang === "ar" ? p.taglineAr : p.taglineEn}</span>
                            </span>
                            <span className="text-end">
                              <Money v={d.period === "lifetime" ? pq.net : pq.perMonth} className="font-bold" />
                              <span className="block text-[11px] text-muted-foreground">{d.period === "lifetime" ? L("مرة واحدة", "one-time") : L("/شهر", "/mo")}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                ) : null}
                {step === 4 ? (
                  <>
                    <p className="rounded-2xl bg-brass-soft p-4 text-[14px] text-accent-foreground">{L(`مش هتدفع حاجة دلوقتي. أول ${TRIAL_DAYS} يوم ببلاش، وده نموذج تجريبي — مفيش دفع حقيقي.`, `Nothing is charged now. The first ${TRIAL_DAYS} days are free, and this is a demo — no real payments.`)}</p>
                    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={L("طريقة الدفع بعد التجربة", "Payment method after the trial")}>
                      {[
                        { id: "later" as const, Icon: Wallet, t: L("أقرر بعد التجربة", "Decide after the trial") },
                        { id: "card" as const, Icon: CreditCard, t: L("كارت (فيزا/ميزة)", "Card (Visa/Meeza)") },
                        { id: "instapay" as const, Icon: Smartphone, t: L("إنستاباي / محفظة", "InstaPay / wallet") },
                        { id: "bank" as const, Icon: Landmark, t: L("تحويل بنكي بفاتورة", "Bank transfer, invoiced") },
                      ].map((m) => (
                        <label key={m.id} className={cn("flex cursor-pointer items-center gap-3 rounded-2xl border bg-card p-4", d.pay === m.id && "border-primary ring-1 ring-primary")}>
                          <input type="radio" name="pay" className="sr-only" checked={d.pay === m.id} onChange={() => up("pay", m.id)} />
                          <m.Icon className="size-5 text-primary" aria-hidden />
                          <span className="font-semibold">{m.t}</span>
                        </label>
                      ))}
                    </div>
                    {d.pay === "card" ? (
                      <div className="grid gap-3 rounded-2xl border border-dashed p-4 opacity-70" aria-disabled>
                        <Field label={L("رقم الكارت (معطّل في النسخة التجريبية)", "Card number (disabled in the demo)")}><input className="sf-input" disabled placeholder="•••• •••• •••• ••••" dir="ltr" /></Field>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </motion.fieldset>
            </AnimatePresence>

            {err.length ? (
              <ul role="alert" className="mt-4 grid gap-1 rounded-xl bg-danger-soft p-3 text-[14px] text-danger">
                {err.map((e) => <li key={e}>• {e}</li>)}
              </ul>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center gap-2">
              {step > 0 ? (
                <button type="button" className="sf-btn sf-btn-ghost" onClick={() => setStep((s) => s - 1)}>
                  {L("رجوع", "Back")}
                </button>
              ) : null}
              {step < steps.length - 1 ? (
                <button type="submit" className="sf-btn sf-btn-primary">
                  {L("التالي", "Next")}
                  <Arrow className="size-4" aria-hidden />
                </button>
              ) : (
                <LoadingButton
                  onAction={async () => {
                    await new Promise<void>((r) => setTimeout(r, 900));
                    window.setTimeout(finish, 700);
                  }}
                  pendingLabel={L("بنجهّز حسابك…", "Setting up…")}
                  successLabel={L("تمام!", "Done!")}
                >
                  {L("ابدأ التجربة المجانية", "Start free trial")}
                </LoadingButton>
              )}
            </div>
          </form>
        </div>

        <aside className="h-max rounded-[24px] border bg-card p-5 lg:sticky lg:top-24">
          <p className="flex items-center gap-2 font-semibold"><Building2 className="size-4 text-primary" aria-hidden />{d.name || L("مطعمك", "Your restaurant")}</p>
          <dl className="mt-4 grid gap-2 text-[14px]">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{L("الباقة", "Plan")}</dt><dd className="font-semibold">{PLANS.find((p) => p.id === d.plan)![lang === "ar" ? "ar" : "en"]}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{L("المدة", "Period")}</dt><dd>{PERIODS.find((p) => p.id === d.period)![lang === "ar" ? "ar" : "en"]}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{L("قبل الضريبة", "Before VAT")}</dt><dd><Money v={q.net} /></dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{L("ضريبة 14%", "VAT 14%")}</dt><dd><Money v={q.vat} /></dd></div>
            <div className="flex justify-between gap-3 border-t pt-2 font-bold"><dt>{L("بعد التجربة", "After the trial")}</dt><dd><Money v={q.gross} /></dd></div>
            <div className="flex justify-between gap-3 text-ok"><dt>{L("النهارده", "Today")}</dt><dd><Money v={0} /></dd></div>
          </dl>
        </aside>
      </section>
    </BizPage>
  );

}


import { useState } from "react";
import { PartyPopper } from "lucide-react";
import { ProgressBar } from "@/components/ui/progress-bar";
import { LoadingButton } from "@/components/ui/loading-button";
import { useLang } from "@/lib/i18n";
import type { Route } from "@/lib/router";
import { cn } from "@/lib/utils";
import { BizPage, Field, Money, Toggle, useArrow } from "@/components/business/kit";
import { SUPPLIER_PLANS, type SupplierPlanId } from "@/data/business/supplier-plans";
import { CATEGORIES, DAY_NAMES, ZONE_NAMES, type SupplyCategory } from "@/data/business/suppliers";
import { validRin } from "@/data/business/tax";

export default function SupplierSignup({ route }: { route: Route }) {
  const { L, lang } = useLang();
  const Arrow = useArrow();
  const [step, setStep] = useState(0);
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [rin, setRin] = useState("");
  const [eInvoice, setEInvoice] = useState(true);
  const [cats, setCats] = useState<SupplyCategory[]>([]);
  const [zones, setZones] = useState<string[]>(["zamalek", "maadi"]);
  const [days, setDays] = useState<number[]>([0, 2, 4]);
  const [plan, setPlan] = useState<SupplierPlanId>(() => (SUPPLIER_PLANS.some((p) => p.id === route.query.get("plan")) ? (route.query.get("plan") as SupplierPlanId) : "growth"));
  const steps = [L("الشركة", "Company"), L("الأقسام", "Categories"), L("التوصيل", "Delivery"), L("الباقة", "Plan")];
  const errs: string[][] = [
    [!name.trim() && L("اكتب اسم الشركة", "Enter the company name"), !/^01[0125]\d{8}$/.test(phone) && L("رقم موبايل صحيح", "A valid mobile number"), !validRin(rin) && L("رقم تسجيل ضريبي 9 أرقام", "A 9-digit tax registration number")].filter(Boolean) as string[],
    [!cats.length && L("اختار قسم واحد على الأقل", "Pick at least one category")].filter(Boolean) as string[],
    [!zones.length && L("اختار منطقة توصيل", "Pick a delivery area"), !days.length && L("اختار يوم توصيل", "Pick a delivery day")].filter(Boolean) as string[],
    [],
  ];
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const next = () => {
    if (errs[step].length) return setTried(true);
    setTried(false);
    setStep((s) => s + 1);
  };

  if (done)
    return (
      <BizPage kind="suppliers" path={route.path}>
        <section className="wrap gutter grid min-h-[60vh] place-items-center py-16 text-center">
          <div className="max-w-lg">
            <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-brass-soft text-brass"><PartyPopper className="size-8" aria-hidden /></span>
            <h1 className="mt-5 text-4xl font-bold">{L("طلبك وصلنا!", "Application received!")}</h1>
            <p className="mt-3 text-muted-foreground">{L("هنراجع البيانات خلال يوم عمل. لحد ما، جرّب بوابة المورّد بالبيانات التجريبية.", "We'll review it within a business day. Meanwhile, try the supplier portal with sample data.")}</p>
            <a href="#/suppliers/portal" className="sf-btn sf-btn-primary mt-6">{L("افتح بوابة المورّد", "Open the supplier portal")}<Arrow className="size-4" aria-hidden /></a>
          </div>
        </section>
      </BizPage>
    );

  return (
    <BizPage kind="suppliers" path={route.path}>
      <section className="wrap gutter max-w-2xl py-10 sm:py-14">
        <h1 className="text-[34px] font-bold sm:text-[44px]">{L("سجّل كمورّد", "Join as a supplier")}</h1>
        <ProgressBar className="mt-6" value={step + 1} max={steps.length} label={L(`الخطوة ${step + 1} من ${steps.length}: ${steps[step]}`, `Step ${step + 1} of ${steps.length}: ${steps[step]}`)} pendingLabel="…" />
        <form className="mt-8 grid gap-4" noValidate onSubmit={(e) => { e.preventDefault(); next(); }}>
          {step === 0 ? (
            <>
              <Field label={L("اسم الشركة", "Company name")}><input className="sf-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" /></Field>
              <Field label={L("الموبايل", "Mobile")}><input className="sf-input num" dir="ltr" inputMode="tel" placeholder="01xxxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} /></Field>
              <Field label={L("رقم التسجيل الضريبي", "Tax registration number")}><input className="sf-input num" dir="ltr" inputMode="numeric" placeholder="123-456-789" value={rin} onChange={(e) => setRin(e.target.value.replace(/[^\d-]/g, ""))} /></Field>
              <Toggle checked={eInvoice} onChange={setEInvoice} label={L("مسجّل في منظومة الفاتورة الإلكترونية", "Registered for ETA e-invoicing")} sub={L("هنطلّع فاتورة B2B لكل طلب", "We'll issue a B2B e-invoice for each order")} />
            </>
          ) : null}
          {step === 1 ? (
            <fieldset>
              <legend className="sf-label">{L("بتبيع إيه؟", "What do you sell?")}</legend>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button key={c.id} type="button" className="sf-chip" aria-pressed={cats.includes(c.id)} onClick={() => setCats(toggle(cats, c.id))}>{lang === "ar" ? c.ar : c.en}</button>
                ))}
              </div>
            </fieldset>
          ) : null}
          {step === 2 ? (
            <>
              <fieldset>
                <legend className="sf-label">{L("مناطق التوصيل", "Delivery areas")}</legend>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(ZONE_NAMES).map(([id, z]) => (
                    <button key={id} type="button" className="sf-chip" aria-pressed={zones.includes(id)} onClick={() => setZones(toggle(zones, id))}>{lang === "ar" ? z.ar : z.en}</button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="sf-label">{L("أيام التوصيل", "Delivery days")}</legend>
                <div className="flex flex-wrap gap-2">
                  {DAY_NAMES[lang].map((d, i) => (
                    <button key={d} type="button" className="sf-chip" aria-pressed={days.includes(i)} onClick={() => setDays(toggle(days, i))}>{d}</button>
                  ))}
                </div>
              </fieldset>
            </>
          ) : null}
          {step === 3 ? (
            <div className="grid gap-2" role="radiogroup" aria-label={L("الباقة", "Plan")}>
              {SUPPLIER_PLANS.map((p) => (
                <label key={p.id} className={cn("flex cursor-pointer items-center gap-3 rounded-2xl border bg-card p-4", plan === p.id && "border-primary ring-1 ring-primary")}>
                  <input type="radio" name="splan" className="size-4 accent-[var(--sf-primary)]" checked={plan === p.id} onChange={() => setPlan(p.id)} />
                  <span className="min-w-0 flex-1"><span className="block font-bold">{lang === "ar" ? p.ar : p.en}</span><span className="block text-[13px] text-muted-foreground">{lang === "ar" ? p.taglineAr : p.taglineEn}</span></span>
                  <span className="text-end text-[13px]">{p.monthly ? <Money v={p.monthly} className="font-bold" /> : L("ببلاش", "Free")}<span className="block text-primary">+{p.commissionPct}%</span></span>
                </label>
              ))}
            </div>
          ) : null}
          {tried && errs[step].length ? <ul role="alert" className="rounded-xl bg-danger-soft p-3 text-[14px] text-danger">{errs[step].map((e) => <li key={e}>• {e}</li>)}</ul> : null}
          <div className="flex gap-2">
            {step > 0 ? <button type="button" className="sf-btn sf-btn-ghost" onClick={() => setStep((s) => s - 1)}>{L("رجوع", "Back")}</button> : null}
            {step < steps.length - 1 ? (
              <button type="submit" className="sf-btn sf-btn-primary">{L("التالي", "Next")}<Arrow className="size-4" aria-hidden /></button>
            ) : (
              <LoadingButton onAction={async () => { await new Promise((r) => setTimeout(r, 800)); window.setTimeout(() => setDone(true), 600); }} pendingLabel={L("بنبعت…", "Sending…")} successLabel={L("تمام!", "Done!")}>
                {L("ابعت الطلب", "Submit application")}
              </LoadingButton>
            )}
          </div>
        </form>
      </section>
    </BizPage>
  );
}

import { useState } from "react";
import { Check, Minus, Server } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useLang } from "@/lib/i18n";
import type { Route } from "@/lib/router";
import { cn } from "@/lib/utils";
import { AnimatedMoney, BizPage, Faq, Money, Pill, Segmented, SectionTitle, Toggle, useArrow } from "@/components/business/kit";
import { breakEvenMonths, quoteAddon, quotePlan } from "@/data/business/billing";
import { ADDONS, COMPARE, COMPARE_EN, LIFETIME, PERIODS, PLANS, PRICING_FAQ, TRIAL_DAYS, VAT_RATE, type PeriodId } from "@/data/business/plans";
import { loadRaw, saveRaw } from "@/lib/storage";

export function PeriodSwitch({ value, onChange }: { value: PeriodId; onChange: (p: PeriodId) => void }) {
  const { L, lang } = useLang();
  return <Segmented label={L("مدة الدفع", "Billing period")} value={value} onChange={onChange} wrap options={PERIODS.map((p) => ({ id: p.id, label: lang === "ar" ? p.ar : p.en, badge: p.badgeAr ? (lang === "ar" ? p.badgeAr : p.badgeEn) : undefined }))} />;
}

export default function Pricing({ route }: { route: Route }) {
  const { L, lang } = useLang();
  const Arrow = useArrow();
  const reduced = useReducedMotion();
  const [period, setPeriodState] = useState<PeriodId>(() => {
    const q = route.query.get("period") as PeriodId | null;
    const v = q ?? (loadRaw("sufra.biz.period") as PeriodId | null);
    return PERIODS.some((p) => p.id === v) ? (v as PeriodId) : "yearly";
  });
  const setPeriod = (p: PeriodId) => {
    setPeriodState(p);
    saveRaw("sufra.biz.period", p);
  };
  const [onPrem, setOnPrem] = useState(false);
  const lifetime = period === "lifetime";
  const per = PERIODS.find((p) => p.id === period)!;
  const unitLabel = (u: string) => (u === "month" ? L("/شهر", "/mo") : u === "pack" ? L("/باقة", "/pack") : L("مرة واحدة", "one-time"));
  const groups = [...new Set(COMPARE.map((r) => (lang === "ar" ? r.groupAr : r.groupEn)))];
  const cell = (v: boolean | string) =>
    v === true ? <Check className="mx-auto size-5 text-primary" aria-label={L("متاح", "Included")} /> : v === false ? <Minus className="mx-auto size-4 text-muted-foreground/50" aria-label={L("مش متاح", "Not included")} /> : <span className="text-[13px] font-semibold">{lang === "ar" ? v : COMPARE_EN[v] ?? v}</span>;

  return (
    <BizPage kind="business" path={route.path}>
      <section className="wrap gutter pt-12 pb-6 text-center sm:pt-16">
        <p className="sf-kicker">{L("الأسعار", "Pricing")}</p>
        <h1 className="mx-auto mt-2 max-w-3xl text-[38px] font-bold leading-tight sm:text-[54px]">{L("باقة على مقاس مطعمك", "A plan that fits your restaurant")}</h1>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">{L(`اشترك شهري أو سنوي أو 3 سنين، أو اشتري السستم مرة واحدة. ${TRIAL_DAYS} يوم تجربة ببلاش على أي باقة.`, `Subscribe monthly, yearly or for 3 years — or buy the system outright. ${TRIAL_DAYS}-day free trial on any plan.`)}</p>
        <div className="mt-7 flex justify-center">
          <PeriodSwitch value={period} onChange={setPeriod} />
        </div>
        <p className="mt-3 text-[13px] text-muted-foreground">{L(`كل الأسعار بالجنيه المصري قبل ضريبة القيمة المضافة ${Math.round(VAT_RATE * 100)}%`, `All prices in EGP, before ${Math.round(VAT_RATE * 100)}% VAT`)}</p>
      </section>

      <section className="wrap gutter">
        {lifetime ? (
          <div className="mx-auto mb-5 grid max-w-3xl gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <Toggle checked={onPrem} onChange={setOnPrem} label={L("تركيب على سيرفرك (On-prem)", "Install on your own server (on-prem)")} sub={L(`تركيب وإعداد مرة واحدة ${"⁨"}${(LIFETIME.onPremSetup / 100).toLocaleString("en-US")} ج.م${"⁩"} — البيانات عندك`, `One-time setup EGP ${(LIFETIME.onPremSetup / 100).toLocaleString("en-US")} — your data stays with you`)} />
            <p className="text-[13px] text-muted-foreground sm:max-w-[240px]">{L("أول سنة صيانة وتحديثات مجانًا، وبعدها صيانة سنوية اختيارية.", "First year of maintenance & updates included; optional yearly maintenance after.")}</p>
          </div>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-3">
          {PLANS.map((p, i) => {
            const q = quotePlan(p.id, period, { onPrem });
            return (
              <motion.article
                key={p.id}
                initial={reduced ? false : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06, duration: 0.5 }}
                className={cn("relative flex flex-col rounded-[28px] border bg-card p-6", p.highlight && "border-primary shadow-sf ring-1 ring-primary")}
              >
                {p.highlight ? <span className="absolute -top-3 start-6 rounded-full bg-primary px-3 py-1 text-[12px] font-bold text-primary-foreground">{L("الأكثر اختيارًا", "Most popular")}</span> : null}
                <h2 className="text-2xl font-bold">{lang === "ar" ? p.ar : p.en}</h2>
                <p className="mt-1 min-h-[3em] text-[14px] text-muted-foreground">{lang === "ar" ? p.taglineAr : p.taglineEn}</p>
                <div className="mt-4 min-h-[112px]">
                  {lifetime ? (
                    <>
                      <p className="text-[13px] text-muted-foreground">{L("شراء كامل للسستم", "Buy the full system")}</p>
                      <AnimatedMoney v={q.net} className="font-display text-[34px] font-bold" />
                      <p className="text-[13px] text-muted-foreground">
                        {L("صيانة سنوية بعد أول سنة:", "Yearly maintenance after year 1:")} <Money v={q.maintenancePerYear} className="font-semibold text-foreground" />
                      </p>
                      <p className="text-[12px] text-muted-foreground">{L(`أرخص من الشهري بعد ${breakEvenMonths(p.id)} شهر`, `Beats monthly after ${breakEvenMonths(p.id)} months`)}</p>
                    </>
                  ) : (
                    <>
                      <p className="flex items-baseline gap-1">
                        <AnimatedMoney v={q.perMonth} className="font-display text-[38px] font-bold" />
                        <span className="text-muted-foreground">{L("/شهر", "/mo")}</span>
                      </p>
                      <p className="text-[13px] text-muted-foreground">
                        {period === "monthly" ? L("بيتجدد كل شهر · الغي وقت ما تحب", "Renews monthly · cancel anytime") : (
                          <>
                            {L(`بتدفع ${lang === "ar" ? per.ar : per.en}:`, `Billed ${per.en.toLowerCase()}:`)} <Money v={q.net} className="font-semibold text-foreground" />
                          </>
                        )}
                      </p>
                      {q.saving > 0 ? (
                        <Pill tone="ok" className="mt-1">
                          {L("وفّرت", "You save")} <Money v={q.saving} />
                        </Pill>
                      ) : null}
                    </>
                  )}
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    {L("شامل الضريبة:", "Incl. VAT:")} <Money v={q.gross} />
                  </p>
                </div>
                <a href={`#/business/signup?plan=${p.id}&period=${period}`} className={cn("sf-btn mt-5", p.highlight ? "sf-btn-primary" : "sf-btn-ghost")}>
                  {lifetime ? L("اطلب عرض شراء", "Request a purchase quote") : L(`جرّب ${TRIAL_DAYS} يوم ببلاش`, `Try ${TRIAL_DAYS} days free`)}
                  <Arrow className="size-4" aria-hidden />
                </a>
                <ul className="mt-6 grid gap-2 border-t pt-5">
                  <li className="flex items-center gap-2 text-[14px] font-semibold">
                    <Server className="size-4 text-brass" aria-hidden />
                    {L(`${p.branches} فرع · ${p.posDevices} جهاز كاشير · ${p.users ?? "∞"} مستخدم`, `${p.branches} branch${p.branches > 1 ? "es" : ""} · ${p.posDevices} POS · ${p.users ?? "∞"} users`)}
                  </li>
                  {(lang === "ar" ? p.featuresAr : p.featuresEn).map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[14px]">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>
              </motion.article>
            );
          })}
        </div>
      </section>

      {/* Comparison table */}
      <section className="wrap gutter mt-20">
        <SectionTitle kicker={L("مقارنة", "Compare")} title={L("قارن الباقات بالتفصيل", "Compare plans in detail")} />
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[620px] text-[14px]">
            <caption className="sr-only">{L("مقارنة مميزات الباقات", "Plan feature comparison")}</caption>
            <thead className="sticky top-0 bg-card">
              <tr className="border-b">
                <th scope="col" className="p-3 text-start font-semibold text-muted-foreground">{L("الميزة", "Feature")}</th>
                {PLANS.map((p) => (
                  <th key={p.id} scope="col" className={cn("w-[18%] p-3 text-center font-bold", p.highlight && "text-primary")}>{lang === "ar" ? p.ar : p.en}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows key={g} g={g} lang={lang} cell={cell} />
              ))}
              <tr className="border-t bg-surface-2">
                <th scope="row" className="p-3 text-start">{L(`السعر (${lang === "ar" ? per.ar : per.en})`, `Price (${per.en})`)}</th>
                {PLANS.map((p) => {
                  const q = quotePlan(p.id, period, { onPrem });
                  return (
                    <td key={p.id} className="p-3 text-center font-semibold">
                      <Money v={lifetime ? q.net : q.perMonth} />
                      {!lifetime ? <span className="text-[12px] font-normal text-muted-foreground">{L("/شهر", "/mo")}</span> : null}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Add-ons */}
      <section className="wrap gutter mt-20">
        <SectionTitle kicker={L("إضافات", "Add-ons")} title={L("زوّد اللي محتاجه بس", "Add only what you need")} sub={lifetime ? L("مع الشراء الكامل، الإضافات الشهرية بتتحاسب سنويًا.", "With an owned licence, monthly add-ons are billed yearly.") : undefined} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ADDONS.map((a) => {
            const total = quoteAddon(a.id, period);
            return (
              <article key={a.id} className="sf-card flex flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[17px] font-bold">{lang === "ar" ? a.ar : a.en}</h3>
                  {a.includedIn ? <Pill tone="primary">{L("ببلاش في المؤسسات", "Free on Enterprise")}</Pill> : null}
                </div>
                <p className="mt-1 text-[13.5px] text-muted-foreground">{lang === "ar" ? a.descAr : a.descEn}</p>
                <p className="mt-auto pt-4">
                  <Money v={a.price} className="font-display text-xl font-bold" /> <span className="text-[13px] text-muted-foreground">{unitLabel(a.unit)}</span>
                </p>
                {a.unit === "month" && period !== "monthly" ? (
                  <p className="text-[12px] text-muted-foreground">
                    {lifetime ? L("سنويًا:", "Yearly:") : L(`لمدة ${lang === "ar" ? per.ar : per.en}:`, `For ${per.en.toLowerCase()}:`)} <Money v={total} />
                  </p>
                ) : null}
                {a.plans ? <p className="text-[12px] text-muted-foreground">{L("متاح مع: ", "Available on: ")}{a.plans.map((id) => PLANS.find((p) => p.id === id)![lang === "ar" ? "ar" : "en"]).join(L("، ", ", "))}</p> : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="wrap gutter mt-20 grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
        <SectionTitle kicker={L("أسئلة", "FAQ")} title={L("أسئلة بتتسأل كتير", "Frequently asked")} />
        <Faq items={PRICING_FAQ.map((f) => ({ q: lang === "ar" ? f.qAr : f.qEn, a: lang === "ar" ? f.aAr : f.aEn }))} />
      </section>

      <section className="wrap gutter mt-16 text-center">
        <a href="#/business/signup" className="sf-btn sf-btn-primary h-14 px-8 text-[17px]">
          {L(`ابدأ تجربة مجانية ${TRIAL_DAYS} يوم`, `Start your ${TRIAL_DAYS}-day free trial`)}
        </a>
        <p className="mt-2 text-[13px] text-muted-foreground">{L("من غير كارت · الغي وقت ما تحب", "No card · cancel anytime")}</p>
      </section>
    </BizPage>
  );
}

function GroupRows({ g, lang, cell }: { g: string; lang: "ar" | "en"; cell: (v: boolean | string) => React.ReactNode }) {
  const rows = COMPARE.filter((r) => (lang === "ar" ? r.groupAr : r.groupEn) === g);
  return (
    <>
      <tr className="bg-surface-2/60">
        <th colSpan={4} scope="colgroup" className="px-3 pt-4 pb-2 text-start text-[12px] font-bold text-brass">{g}</th>
      </tr>
      {rows.map((r) => (
        <tr key={r.en} className="border-b last:border-0 hover:bg-surface-2/50">
          <th scope="row" className="p-3 text-start font-medium">{lang === "ar" ? r.ar : r.en}</th>
          <td className="p-3 text-center">{cell(r.basic)}</td>
          <td className="p-3 text-center">{cell(r.pro)}</td>
          <td className="p-3 text-center">{cell(r.enterprise)}</td>
        </tr>
      ))}
    </>
  );
}

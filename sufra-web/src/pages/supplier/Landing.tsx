import { useEffect, useMemo, useState } from "react";
import { BarChart3, Check, FileText, MapPinned, PackageSearch, Store, Wallet, Star } from "lucide-react";
import { Reveal } from "@/components/sufra/Reveal";
import { useLang } from "@/lib/i18n";
import type { Route } from "@/lib/router";
import { cn } from "@/lib/utils";
import { BizPage, Card, Faq, Field, Money, Pill, SectionTitle, useArrow } from "@/components/business/kit";
import { MockFrame } from "@/components/business/Mockups";
import { supplierStatement } from "@/data/business/billing";
import { egp } from "@/data/business/plans";
import { PAYMENT_COLLECTION_PCT, SUPPLIER_FAQ, SUPPLIER_PLANS } from "@/data/business/supplier-plans";
import { SUPPLIERS } from "@/data/business/suppliers";

function PortalMock() {
  const { L } = useLang();
  const rows = [
    { r: L("مطعم كورنيش النيل", "Nile Corniche"), v: egp(4820), s: L("جديد", "New"), t: "brass" as const },
    { r: L("جرين بول — المعادي", "Green Bowl"), v: egp(1960), s: L("اتأكد", "Confirmed"), t: "primary" as const },
    { r: L("بيتزا الفرن البلدي", "Baladi Oven"), v: egp(3375), s: L("خرج للتوصيل", "Out"), t: "warn" as const },
    { r: L("كافيه الشرفة", "Balcony Café"), v: egp(890), s: L("اتفوتر", "Invoiced"), t: "ok" as const },
  ];
  return (
    <MockFrame title={L("بوابة المورّد · طلبات النهارده", "Supplier portal · today's orders")}>
      <div className="grid grid-cols-3 gap-1.5 text-center">
        {[[L("طلبات", "Orders"), "14"], [L("مبيعات", "Sales"), "38.2K"], [L("تقييم", "Rating"), "4.7"]].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-surface-2 py-1.5"><p className="num text-[16px] font-bold">{v}</p><p className="text-[10.5px] text-muted-foreground">{k}</p></div>
        ))}
      </div>
      <ul className="mt-2 grid gap-1.5">
        {rows.map((x) => (
          <li key={x.r} className="flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5">
            <span className="truncate font-semibold">{x.r}</span>
            <span className="flex shrink-0 items-center gap-2"><Money v={x.v} /><Pill tone={x.t}>{x.s}</Pill></span>
          </li>
        ))}
      </ul>
    </MockFrame>
  );
}

export default function SupplierLanding({ route }: { route: Route }) {
  const { L, lang } = useLang();
  const Arrow = useArrow();
  const [gmv, setGmv] = useState(150000);
  const [orders, setOrders] = useState(60);
  useEffect(() => {
    if (route.query.get("s") === "pricing") document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [route]);
  const quotes = useMemo(() => {
    const n = Math.max(1, Math.round(orders));
    const per = Math.round((Math.max(0, gmv) * 100) / n);
    const list = Array.from({ length: n }, (_, k) => ({ id: String(k), net: per, status: "delivered" as const }));
    return SUPPLIER_PLANS.map((p) => ({ p, s: supplierStatement(p.id, list) }));
  }, [gmv, orders]);
  const best = quotes.reduce((a, b) => (b.s.feesNet < a.s.feesNet ? b : a));
  const benefits = [
    { Icon: Store, t: L("اوصل لمطاعم القاهرة", "Reach Cairo's restaurants"), d: L("مطاعم سُفرة بتطلب خاماتها من جوه السستم — وإنت قدامهم لما المخزون يقل.", "Sufra restaurants order supplies in-app — and you're there when their stock runs low.") },
    { Icon: PackageSearch, t: L("كتالوج أونلاين", "Online catalogue"), d: L("منتجات بوحدات وعبوات وأسعار وضريبة ومخزون وأقل كمية.", "Products with units, packs, prices, VAT, stock and minimums.") },
    { Icon: MapPinned, t: L("مناطق وأيام توصيل", "Delivery areas & days"), d: L("حدد بتوصّل فين وإمتى وآخر ميعاد للطلب.", "Set where and when you deliver, and the order cut-off.") },
    { Icon: FileText, t: L("طلبات وفواتير إلكترونية", "Orders & e-invoices"), d: L("من جديد لحد اتفوتر، وفاتورة B2B (نوع i) لمصلحة الضرايب.", "From new to invoiced, with a B2B e-invoice (type i) to the ETA.") },
    { Icon: Wallet, t: L("تحصيل الفلوس", "Get paid"), d: L(`سُفرة تحصّل من المطعم وتحوّلك أسبوعيًا (رسوم ${PAYMENT_COLLECTION_PCT}%).`, `Sufra collects from restaurants and pays you weekly (${PAYMENT_COLLECTION_PCT}% fee).`) },
    { Icon: BarChart3, t: L("تحليلات", "Analytics"), d: L("أكتر منتجات بتتباع، أحسن عملاء، ومقارنة أسعارك بالسوق.", "Top products, best customers and how your prices compare.") },
  ];
  return (
    <BizPage kind="suppliers" path={route.path}>
      <section className="border-b paper-grain">
        <div className="wrap gutter grid items-center gap-10 py-12 lg:grid-cols-[1.1fr_1fr] lg:py-20">
          <Reveal>
            <p className="sf-kicker">{L("سُفرة للموردين · القاهرة", "Sufra for suppliers · Cairo")}</p>
            <h1 className="mt-3 text-[40px] font-bold leading-[1.08] sm:text-[58px]">
              {L("بيع لمطاعم القاهرة", "Sell to Cairo's restaurants")}
              <br />
              <span className="text-primary">{L("من غير لف", "without the runaround")}</span>
            </h1>
            <p className="mt-4 max-w-lg text-[17px] text-muted-foreground">{L(`كتالوج، طلبات، فواتير إلكترونية وتحصيل في مكان واحد. اشتراك شهري بسيط + عمولة على اللي بيتسلّم بس. ${SUPPLIERS.length} مورّد تجريبي في الديمو.`, `Catalogue, orders, e-invoices and collection in one place. A simple monthly plan + commission only on what's delivered. ${SUPPLIERS.length} sample suppliers in the demo.`)}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <a href="#/suppliers/signup" className="sf-btn sf-btn-primary">{L("سجّل كمورّد", "Join as a supplier")}<Arrow className="size-4" aria-hidden /></a>
              <a href="#/suppliers/portal" className="sf-btn sf-btn-ghost">{L("جرّب بوابة المورّد", "Try the supplier portal")}</a>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <PortalMock />
          </Reveal>
        </div>
      </section>

      <section className="wrap gutter py-16">
        <SectionTitle kicker={L("ليه سُفرة", "Why Sufra")} title={L("كل اللي محتاجه عشان تبيع للمطاعم", "Everything you need to sell to restaurants")} />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {benefits.map((b, i) => (
            <Reveal key={b.t} delay={i * 0.04}>
              <li className="sf-card h-full list-none p-5">
                <span className="grid size-11 place-items-center rounded-2xl bg-brass-soft text-brass"><b.Icon className="size-5" aria-hidden /></span>
                <h3 className="mt-3 text-[19px] font-bold">{b.t}</h3>
                <p className="mt-1 text-[14.5px] text-muted-foreground">{b.d}</p>
              </li>
            </Reveal>
          ))}
        </ul>
      </section>

      <section id="pricing" className="scroll-mt-20 border-y bg-card/50 py-16">
        <div className="wrap gutter">
          <SectionTitle kicker={L("الأسعار", "Pricing")} title={L("اشتراك شهري + عمولة على كل بيعة", "Monthly plan + commission per sale")} sub={L("العمولة على قيمة الطلب المسلّم قبل الضريبة. الملغي والمرتجع مش بيتحسب. كل الأسعار قبل ضريبة 14%.", "Commission on delivered order value before VAT. Cancellations and returns aren't charged. All prices before 14% VAT.")} />
          <div className="grid gap-4 lg:grid-cols-3">
            {SUPPLIER_PLANS.map((p) => (
              <article key={p.id} className={cn("relative flex flex-col rounded-[28px] border bg-card p-6", p.highlight && "border-primary ring-1 ring-primary")}>
                {p.highlight ? <span className="absolute -top-3 start-6 rounded-full bg-primary px-3 py-1 text-[12px] font-bold text-primary-foreground">{L("الأنسب لمعظم الموردين", "Best for most")}</span> : null}
                <h3 className="text-2xl font-bold">{lang === "ar" ? p.ar : p.en}</h3>
                <p className="text-[14px] text-muted-foreground">{lang === "ar" ? p.taglineAr : p.taglineEn}</p>
                <p className="mt-4 flex items-baseline gap-1">
                  {p.monthly ? <Money v={p.monthly} className="font-display text-[34px] font-bold" /> : <span className="font-display text-[34px] font-bold">{L("ببلاش", "Free")}</span>}
                  <span className="text-muted-foreground">{L("/شهر", "/mo")}</span>
                </p>
                <p className="text-[15px] font-semibold text-primary">
                  + <span className="num">{p.commissionPct}%</span> {L("عمولة", "commission")}
                </p>
                <p className="text-[12.5px] text-muted-foreground">
                  {p.minCommission ? <>{L("أقل عمولة", "Min")} <Money v={p.minCommission} /> {L("للطلب", "per order")}</> : L("من غير حد أدنى", "No minimum")}
                  {p.maxCommission ? <> · {L("بحد أقصى", "capped at")} <Money v={p.maxCommission} /></> : null}
                </p>
                <ul className="mt-5 grid gap-2 border-t pt-4">
                  {(lang === "ar" ? p.featuresAr : p.featuresEn).map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[14px]"><Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{f}</li>
                  ))}
                </ul>
                <div className="mt-auto pt-6"><a href={`#/suppliers/signup?plan=${p.id}`} className={cn("sf-btn w-full", p.highlight ? "sf-btn-primary" : "sf-btn-ghost")}>{L("اختار", "Choose")}</a></div>
              </article>
            ))}
          </div>

          <Card className="mt-8">
            <h3 className="font-sans text-[17px] font-bold">{L("احسب رسومك", "Estimate your fees")}</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-[220px_220px_1fr]">
              <Field label={L("مبيعات شهرية (ج.م قبل الضريبة)", "Monthly sales (EGP, pre-VAT)")}><input type="number" min={0} step={5000} className="sf-input num" dir="ltr" value={gmv} onChange={(e) => setGmv(Math.max(0, Number(e.target.value) || 0))} /></Field>
              <Field label={L("عدد الطلبات", "Number of orders")}><input type="number" min={1} className="sf-input num" dir="ltr" value={orders} onChange={(e) => setOrders(Math.max(1, Number(e.target.value) || 1))} /></Field>
              <div className="overflow-x-auto sm:col-span-2 lg:col-span-1">
                <table className="w-full min-w-[420px] text-[14px]">
                  <caption className="sr-only">{L("رسوم كل باقة", "Fees per plan")}</caption>
                  <thead><tr className="text-[12px] text-muted-foreground"><th scope="col" className="p-2 text-start">{L("الباقة", "Plan")}</th><th scope="col" className="p-2 text-end">{L("اشتراك", "Plan")}</th><th scope="col" className="p-2 text-end">{L("عمولة", "Commission")}</th><th scope="col" className="p-2 text-end">{L("الإجمالي + ضريبة", "Total incl. VAT")}</th></tr></thead>
                  <tbody>
                    {quotes.map(({ p, s }) => (
                      <tr key={p.id} className={cn("border-t", best.p.id === p.id && "bg-primary-soft")}>
                        <th scope="row" className="p-2 text-start font-semibold">{lang === "ar" ? p.ar : p.en} {best.p.id === p.id ? <Pill tone="primary" className="ms-1">{L("الأوفر", "Cheapest")}</Pill> : null}</th>
                        <td className="p-2 text-end"><Money v={s.subscription} /></td>
                        <td className="p-2 text-end"><Money v={s.commission} /></td>
                        <td className="p-2 text-end font-bold"><Money v={s.feesGross} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section className="wrap gutter mt-16 grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
        <SectionTitle kicker={L("أسئلة", "FAQ")} title={L("أسئلة الموردين", "Supplier questions")} />
        <Faq items={SUPPLIER_FAQ.map((f) => ({ q: lang === "ar" ? f.qAr : f.qEn, a: lang === "ar" ? f.aAr : f.aEn }))} />
      </section>

      <section className="wrap gutter mt-16">
        <div className="relative overflow-hidden rounded-[32px] bg-primary p-8 text-primary-foreground sm:p-12">
          <div className="relative flex flex-wrap items-end justify-between gap-6">
            <div>
              <h2 className="text-[30px] font-bold leading-tight sm:text-[42px]">{L("ابدأ تبيع الأسبوع ده", "Start selling this week")}</h2>
              <p className="mt-2 flex items-center gap-1.5 text-primary-foreground/80"><Star className="size-4 fill-current" aria-hidden />{L("التسجيل 10 دقايق، ومراجعة الحساب في يوم عمل.", "Sign-up takes 10 minutes; review within one business day.")}</p>
            </div>
            <a href="#/suppliers/signup" className="sf-btn sf-btn-brass">{L("سجّل كمورّد", "Join as a supplier")}</a>
          </div>
        </div>
      </section>
    </BizPage>
  );
}

import { useEffect, useState } from "react";
import { BadgeDollarSign, Boxes, Building, Coins, CreditCard, Crown, Gift, HandCoins, LineChart, Megaphone, MonitorSmartphone, Rocket, Store, Ticket, Truck, Wrench } from "lucide-react";
import { useLang } from "@/lib/i18n";
import type { Route } from "@/lib/router";
import { load, save } from "@/lib/storage";
import { BizPage, Card, Field, Money, Pill, SectionTitle } from "@/components/business/kit";
import { Meter } from "@/components/business/charts";
import { projectRevenue, type RevenueInputs } from "@/data/business/billing";

const KEY = "sufra.biz.revenue.v1";
const DEFAULTS: RevenueInputs = { restaurants: 250, avgPlanEgp: 2600, ordersPerRestaurant: 450, avgOrderEgp: 380, orderFeePct: 2, suppliers: 40, avgSupplierPlanEgp: 1490, supplierGmvEgp: 6_000_000, supplierCommissionPct: 3, promotedPct: 12, promotedEgp: 1500 };

export default function Revenue({ route }: { route: Route }) {
  const { L } = useLang();
  const [i, setI] = useState<RevenueInputs>(() => ({ ...DEFAULTS, ...load<Partial<RevenueInputs>>(KEY, {}) }));
  useEffect(() => save(KEY, i), [i]);
  const r = projectRevenue(i);
  const up = (k: keyof RevenueInputs) => (e: React.ChangeEvent<HTMLInputElement>) => setI((x) => ({ ...x, [k]: Math.max(0, Number(e.target.value) || 0) }));

  const streams: { Icon: typeof Store; who: "r" | "s" | "c"; t: string; d: string }[] = [
    { Icon: BadgeDollarSign, who: "r", t: L("اشتراكات السستم", "System subscriptions"), d: L("شهري/سنوي/3 سنين أو شراء كامل + صيانة سنوية.", "Monthly/yearly/3-year or one-time licence + yearly maintenance.") },
    { Icon: Ticket, who: "r", t: L("رسوم الحجز والطلب", "Booking & order fees"), d: L("نسبة صغيرة على كل طلب أونلاين أو رسم ثابت على الحجز من سُفرة.", "A small % per online order or a flat fee per Sufra booking.") },
    { Icon: Megaphone, who: "r", t: L("ظهور مميز", "Promoted listings"), d: L("المطعم يظهر أول في البحث والخريطة والصفحة الرئيسية.", "Top placement in search, map and home.") },
    { Icon: CreditCard, who: "r", t: L("هامش الدفع الإلكتروني", "Payment processing margin"), d: L("فرق بسيط بين رسوم بوابة الدفع والسعر للمطعم.", "A small spread between gateway cost and the merchant rate.") },
    { Icon: MonitorSmartphone, who: "r", t: L("إعادة بيع الأجهزة", "Hardware resale"), d: L("باقات كاشير وطابعات وشاشات مطبخ واستاندات QR.", "POS, printers, kitchen screens, QR stands.") },
    { Icon: Wrench, who: "r", t: L("رسوم التهيئة والإعداد", "Onboarding & setup fees"), d: L("إدخال المنيو، رسم الصالة، تدريب، وتركيب On-prem.", "Menu entry, floor drawing, training, on-prem install.") },
    { Icon: Store, who: "s", t: L("اشتراك المورّد", "Supplier subscription"), d: L("باقات بداية/نمو/موزّع بحسب حجم الكتالوج.", "Starter/Growth/Distributor by catalogue size.") },
    { Icon: HandCoins, who: "s", t: L("عمولة على كل بيعة", "Commission per sale"), d: L("نسبة على الطلبات المسلّمة بحد أدنى وأقصى.", "A % of delivered orders with a floor and a cap.") },
    { Icon: Rocket, who: "s", t: L("مكان مميز للمورّد", "Featured supplier placement"), d: L("أول الكتالوج وفي تنبيهات نقص المخزون عند المطاعم.", "Top of the catalogue and in restaurants' low-stock prompts.") },
    { Icon: Building, who: "s", t: L("إحالات تمويل", "Financing referrals"), d: L("عمولة إحالة لتمويل المخزون وأجهزة المطاعم مع البنوك وشركات التمويل.", "Referral fees for stock & equipment financing with banks/fintechs.") },
    { Icon: LineChart, who: "s", t: L("بيانات وتحليلات للبراندات", "Data insights for brands"), d: L("تقارير مجمّعة ومجهّلة عن الطلب على المنتجات والأسعار.", "Aggregated, anonymised demand & price insights.") },
    { Icon: Crown, who: "c", t: L("عضوية سُفرة بلس", "Sufra Plus membership"), d: L("اشتراك للضيف: خصومات وتوصيل مجاني وحجز أولوية.", "Guest subscription: discounts, free delivery, priority booking.") },
    { Icon: Gift, who: "c", t: L("كروت هدايا وتجارب", "Gift cards & experiences"), d: L("كروت هدايا وتجارب أكل؛ ربح من الهامش والرصيد غير المستخدم.", "Gift cards & dining experiences; margin plus breakage.") },
    { Icon: Truck, who: "c", t: L("رسوم التوصيل", "Delivery fees"), d: L("جزء من رسوم التوصيل لما سُفرة تدير الطيارين.", "A share of delivery fees when Sufra runs the riders.") },
  ];
  const who = { r: L("مطاعم", "Restaurants"), s: L("موردين", "Suppliers"), c: L("ضيوف", "Guests") };
  const tone = { r: "primary", s: "brass", c: "ok" } as const;
  const parts = [
    { k: L("اشتراكات المطاعم", "Restaurant subscriptions"), v: r.subscriptions },
    { k: L("رسوم الطلبات", "Order fees"), v: r.orderFees },
    { k: L("ظهور مميز", "Promoted listings"), v: r.promoted },
    { k: L("اشتراكات الموردين", "Supplier subscriptions"), v: r.supplierSubscriptions },
    { k: L("عمولة الموردين", "Supplier commission"), v: r.supplierCommission },
  ];
  const num = (k: keyof RevenueInputs, label: string, hint?: string, step = 1) => (
    <Field label={label} hint={hint}>
      <input type="number" min={0} step={step} className="sf-input num" dir="ltr" value={i[k] ?? 0} onChange={up(k)} />
    </Field>
  );

  return (
    <BizPage kind="business" path={route.path}>
      <section className="wrap gutter py-10 sm:py-14">
        <Pill tone="brass">{L("صفحة داخلية للمالك", "Internal — owner only")}</Pill>
        <h1 className="mt-3 text-[34px] font-bold leading-tight sm:text-[48px]">{L("سُفرة بتكسب منين؟", "How Sufra makes money")}</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">{L("مصادر الدخل من المطاعم والموردين والضيوف، وحاسبة بسيطة للإيراد الشهري المتوقع.", "Revenue streams from restaurants, suppliers and guests, plus a simple monthly revenue projection.")}</p>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {streams.map((s) => (
            <li key={s.t} className="sf-card flex gap-3 p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brass-soft text-brass"><s.Icon className="size-5" aria-hidden /></span>
              <span className="min-w-0">
                <Pill tone={tone[s.who]} className="mb-1">{who[s.who]}</Pill>
                <span className="block font-bold">{s.t}</span>
                <span className="block text-[13px] text-muted-foreground">{s.d}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="wrap gutter">
        <SectionTitle kicker={L("حاسبة", "Calculator")} title={L("الإيراد الشهري المتوقع", "Projected monthly revenue")} />
        <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          <Card>
            <div className="grid gap-4 sm:grid-cols-2">
              {num("restaurants", L("عدد المطاعم", "Restaurants"))}
              {num("avgPlanEgp", L("متوسط الباقة (ج.م/شهر)", "Avg plan (EGP/mo)"))}
              {num("ordersPerRestaurant", L("طلبات أونلاين/مطعم/شهر", "Online orders / restaurant / mo"))}
              {num("avgOrderEgp", L("متوسط الطلب (ج.م)", "Avg order (EGP)"))}
              {num("orderFeePct", L("رسوم الطلب %", "Order fee %"), undefined, 0.5)}
              {num("promotedPct", L("% مطاعم بظهور مميز", "% restaurants promoted"))}
              {num("promotedEgp", L("سعر الظهور المميز (ج.م/شهر)", "Promoted price (EGP/mo)"))}
              {num("suppliers", L("عدد الموردين", "Suppliers"))}
              {num("avgSupplierPlanEgp", L("متوسط اشتراك المورّد", "Avg supplier plan (EGP)"))}
              {num("supplierGmvEgp", L("مبيعات الموردين/شهر (GMV ج.م)", "Supplier GMV / mo (EGP)"), undefined, 100000)}
              {num("supplierCommissionPct", L("عمولة الموردين %", "Supplier commission %"), undefined, 0.5)}
            </div>
            <button type="button" className="sf-btn sf-btn-ghost sf-btn-sm mt-4" onClick={() => setI(DEFAULTS)}>{L("القيم الافتراضية", "Reset defaults")}</button>
          </Card>
          <Card className="h-max lg:sticky lg:top-24">
            <p className="text-[13px] text-muted-foreground">{L("إيراد شهري", "Monthly revenue")}</p>
            <Money v={r.monthly} className="font-display text-[36px] font-bold" />
            <p className="text-[13px] text-muted-foreground">{L("سنويًا", "Yearly")} <Money v={r.yearly} className="font-semibold text-foreground" /></p>
            <ul className="mt-5 grid gap-3">
              {parts.map((p) => (
                <li key={p.k} className="grid gap-1">
                  <div className="flex justify-between gap-2 text-[14px]"><span>{p.k}</span><Money v={p.v} className="font-semibold" /></div>
                  <Meter value={p.v} max={Math.max(1, r.monthly)} label={p.k} />
                </li>
              ))}
            </ul>
            <p className="mt-4 flex items-start gap-1.5 text-[12px] text-muted-foreground"><Coins className="mt-0.5 size-3.5 shrink-0" aria-hidden />{L("قبل الضريبة وقبل تكلفة بوابات الدفع والتسويق. أرقام تقديرية للتخطيط بس.", "Before VAT, payment gateway and marketing costs. Planning estimates only.")}</p>
            <p className="mt-1 flex items-start gap-1.5 text-[12px] text-muted-foreground"><Boxes className="mt-0.5 size-3.5 shrink-0" aria-hidden />{L("مش داخل: الأجهزة، التهيئة، سُفرة بلس، كروت الهدايا، والتمويل.", "Not included: hardware, onboarding, Sufra Plus, gift cards, financing.")}</p>
          </Card>
        </div>
      </section>
    </BizPage>
  );
}

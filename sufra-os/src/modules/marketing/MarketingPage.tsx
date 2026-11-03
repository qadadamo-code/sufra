import { lazy, Suspense, useMemo } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { BarChart3, BadgePercent, Coins, Gift, LayoutDashboard, Megaphone, Rocket, Sparkles, Star, Workflow } from "lucide-react";
import { useSession } from "@/auth/session";
import { useLive } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { formatMoney, sumUnits } from "@/lib/money";
import { liability } from "@/lib/promo";
import { Skeleton, StatTile } from "@/ui";
import { PageHeader } from "@/shell/PageHeader";
import { RouteTabs, Section, Stars } from "./ui";
import { useCrm } from "@/modules/customers/useCrm";

const LoyaltyPage = lazy(() => import("./LoyaltyPage"));
const PromotionsPage = lazy(() => import("./PromotionsPage"));
const GiftCardsPage = lazy(() => import("./GiftCardsPage"));
const CampaignsPage = lazy(() => import("./CampaignsPage"));
const CampaignComposer = lazy(() => import("./CampaignComposer"));
const CampaignResults = lazy(() => import("./CampaignResults"));
const JourneysPage = lazy(() => import("./JourneysPage"));
const OwnPromosPage = lazy(() => import("./OwnPromosPage"));
const ReviewsPage = lazy(() => import("./ReviewsPage"));
const ReportsPage = lazy(() => import("./ReportsPage"));
const AdsPage = lazy(() => import("./AdsPage"));

export default function MarketingPage() {
  const { L } = useT();
  const pending = useLive("adBookings", { where: { status: "requested" } }).data.length;
  return (
    <div className="grid gap-5">
      <PageHeader icon={<Megaphone />} title={L("التسويق والولاء", "Marketing & loyalty")} subtitle={L("خلّي الزبون يرجع: نقاط، عروض، رسايل في وقتها، وإعلانات", "Bring guests back: points, offers, timely messages and ads")} />
      <RouteTabs
        label={L("أقسام التسويق", "Marketing sections")}
        items={[
          { to: "/marketing", end: true, label: L("نظرة عامة", "Overview"), icon: <LayoutDashboard /> },
          { to: "/marketing/loyalty", label: L("الولاء", "Loyalty"), icon: <Coins /> },
          { to: "/marketing/promotions", label: L("العروض والكوبونات", "Offers & coupons"), icon: <BadgePercent /> },
          { to: "/marketing/gift-cards", label: L("كروت الهدايا", "Gift cards"), icon: <Gift /> },
          { to: "/marketing/campaigns", label: L("الحملات", "Campaigns"), icon: <Megaphone /> },
          { to: "/marketing/journeys", label: L("رسايل تلقائية", "Journeys"), icon: <Workflow /> },
          { to: "/marketing/promos", label: L("إعلاناتك", "Your promos"), icon: <Sparkles /> },
          { to: "/marketing/reviews", label: L("التقييمات", "Reviews"), icon: <Star /> },
          { to: "/marketing/reports", label: L("تقارير", "Reports"), icon: <BarChart3 /> },
          { to: "/marketing/ads", label: L("اشتري إعلان", "Buy an ad"), icon: <Rocket />, count: pending || null },
        ]}
      />
      <Suspense fallback={<Skeleton className="h-96" rounded="rounded-[20px]" />}>
        <Routes>
          <Route index element={<Overview />} />
          <Route path="loyalty" element={<LoyaltyPage />} />
          <Route path="promotions" element={<PromotionsPage />} />
          <Route path="gift-cards" element={<GiftCardsPage />} />
          <Route path="campaigns" element={<CampaignsPage />} />
          <Route path="campaigns/new" element={<CampaignComposer />} />
          <Route path="campaigns/:campaignId/edit" element={<CampaignComposer />} />
          <Route path="campaigns/:campaignId" element={<CampaignResults />} />
          <Route path="journeys" element={<JourneysPage />} />
          <Route path="promos" element={<OwnPromosPage />} />
          <Route path="reviews" element={<ReviewsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="ads" element={<AdsPage />} />
        </Routes>
      </Suspense>
    </div>
  );
}

function Overview() {
  const { L, lang, loc } = useT();
  const { restaurant } = useSession();
  const crm = useCrm();
  const promos = useLive("promotions").data;
  const cards = useLive("giftCards").data;
  const campaigns = useLive("campaigns").data;
  const feedback = useLive("guestFeedback").data;
  const reds = useLive("promoRedemptions", { where: { status: "redeemed" } }).data;
  const since = useMemo(() => new Date(Date.now() - 30 * 86_400_000).toISOString(), []);
  const members = crm.customers.filter((c) => c.loyaltyPoints > 0 || c.lifetimePoints).length;
  const pointsLiability = sumUnits(crm.customers.map((c) => c.loyaltyPoints)) * crm.rules.pointValue;
  const gcLiability = liability(cards.map((c) => ({ ...c })));
  const recent = reds.filter((r) => r.at >= since);
  const camp30 = campaigns.filter((c) => (c.sentAt ?? "") >= since);
  const rating = feedback.length ? feedback.reduce((a, f) => a + f.stars, 0) / feedback.length : 0;
  const slug = restaurant?.slug ?? "sufra-zamalek";
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} tone="brass" icon={<Coins />} label={L("أعضاء الولاء", "Loyalty members")} value={members} sub={L(`التزام نقاط ${formatMoney(pointsLiability, { lang, whole: true })}`, `points liability ${formatMoney(pointsLiability, { lang, whole: true })}`)} />
        <StatTile index={1} tone="primary" icon={<BadgePercent />} label={L("استخدام عروض (٣٠ يوم)", "Offer redemptions (30d)")} value={recent.length} sub={L(`خصومات ${formatMoney(sumUnits(recent.map((r) => r.discount + r.deliveryDiscount)), { lang, whole: true })}`, `discounts ${formatMoney(sumUnits(recent.map((r) => r.discount + r.deliveryDiscount)), { lang, whole: true })}`)} />
        <StatTile index={2} tone="ok" icon={<Megaphone />} label={L("إيراد الحملات (٣٠ يوم)", "Campaign revenue (30d)")} value={formatMoney(sumUnits(camp30.map((c) => c.stats.revenue)), { lang, whole: true })} sub={L(`${camp30.length} حملة · تكلفة ${formatMoney(sumUnits(camp30.map((c) => c.stats.cost)), { lang, whole: true })}`, `${camp30.length} campaigns · cost ${formatMoney(sumUnits(camp30.map((c) => c.stats.cost)), { lang, whole: true })}`)} />
        <StatTile index={3} tone="info" icon={<Gift />} label={L("رصيد كروت الهدايا", "Gift card balance")} value={formatMoney(gcLiability, { lang, whole: true })} sub={L("التزام على المطعم (٢٢٠٤)", "liability (2204)")} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={L("عروض شغالة", "Live offers")} icon={<BadgePercent />} className="lg:col-span-2" action={<Link to="/marketing/promotions" className="text-[13px] font-semibold text-primary">{L("الكل", "All")}</Link>}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {promos.filter((p) => p.active).slice(0, 8).map((p) => (
              <li key={p.id} className="rounded-2xl border border-line px-3 py-2.5">
                <p className="truncate font-semibold">{loc(p.name)}</p>
                <p className="text-[12.5px] text-muted">{p.kind === "coupon" ? (p.code ? `${L("كود", "code")} ${p.code}` : L("أكواد شخصية", "personal codes")) : L("تلقائي", "automatic")} · {L(`${p.uses} استخدام`, `${p.uses} uses`)}</p>
              </li>
            ))}
          </ul>
        </Section>
        <Section title={L("رأي الزباين", "Guest rating")} icon={<Star />} action={<Link to="/marketing/reviews" className="text-[13px] font-semibold text-primary">{L("التفاصيل", "Details")}</Link>}>
          <p className="num font-display text-[44px] font-semibold leading-none">{rating.toFixed(1)}</p>
          <Stars value={rating} className="mt-2" />
          <p className="mt-2 text-[13px] text-muted">{L(`من ${feedback.length} تقييم`, `from ${feedback.length} reviews`)}</p>
        </Section>
      </div>
      <Section title={L("صفحات الزبون", "Guest pages")} icon={<Sparkles />}>
        <div className="flex flex-wrap gap-2 text-[14px]">
          <a className="rounded-full border border-line px-3 py-2 font-semibold hover:bg-surface-2" href={`${import.meta.env.BASE_URL}r/${slug}/me`} target="_blank" rel="noreferrer">{L("كارت الولاء", "Loyalty card")} ↗</a>
          <a className="rounded-full border border-line px-3 py-2 font-semibold hover:bg-surface-2" href={`${import.meta.env.BASE_URL}r/${slug}/gift`} target="_blank" rel="noreferrer">{L("اشتري كارت هدية", "Buy a gift card")} ↗</a>
          <a className="rounded-full border border-line px-3 py-2 font-semibold hover:bg-surface-2" href={`${import.meta.env.BASE_URL}r/${slug}`} target="_blank" rel="noreferrer">{L("المنيو أونلاين بالعروض", "Online menu with offers")} ↗</a>
          <a className="rounded-full border border-line px-3 py-2 font-semibold hover:bg-surface-2" href={`${import.meta.env.BASE_URL}r/${slug}/t/ZM05`} target="_blank" rel="noreferrer">{L("منيو QR (ترابيزة ٥)", "QR menu (table 5)")} ↗</a>
        </div>
      </Section>
    </div>
  );
}

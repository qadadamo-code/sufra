import { lazy, Suspense } from "react";
import { BarChart3, LayoutDashboard, Settings2, ShoppingBasket, UtensilsCrossed, Users } from "lucide-react";
import { useLang } from "@/lib/i18n";
import type { Route } from "@/lib/router";
import { ProgressBar } from "@/components/ui/progress-bar";
import { BizPage, RouteTabs, SampleBadge } from "@/components/business/kit";
import { DEMO_RESTAURANT } from "@/data/business/store";
import Overview from "./dashboard/Overview";

const Reports = lazy(() => import("./dashboard/Reports"));
const Staff = lazy(() => import("./dashboard/Staff"));
const MenuManager = lazy(() => import("./dashboard/MenuManager"));
const Settings = lazy(() => import("./dashboard/Settings"));
const Marketplace = lazy(() => import("@/components/business/Marketplace"));

export default function Dashboard({ route }: { route: Route }) {
  const { L, lang } = useLang();
  const tab = route.query.get("tab") ?? "overview";
  const tabs = [
    { id: "overview", label: L("نظرة عامة", "Overview"), icon: <LayoutDashboard className="size-4" aria-hidden /> },
    { id: "reports", label: L("تقارير المبيعات", "Sales reports"), icon: <BarChart3 className="size-4" aria-hidden /> },
    { id: "purchasing", label: L("اطلب من الموردين", "Order supplies"), icon: <ShoppingBasket className="size-4" aria-hidden /> },
    { id: "menu", label: L("المنيو", "Menu"), icon: <UtensilsCrossed className="size-4" aria-hidden /> },
    { id: "staff", label: L("الموظفين", "Staff"), icon: <Users className="size-4" aria-hidden /> },
    { id: "settings", label: L("الإعدادات", "Settings"), icon: <Settings2 className="size-4" aria-hidden /> },
  ];
  const active = tabs.some((t) => t.id === tab) ? tab : "overview";
  const today = new Date().toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "long" });
  return (
    <BizPage kind="business" path={route.path} cta={{ href: "#/business/pricing", label: L("الباقات", "Plans") }}>
      <div className="wrap gutter py-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] text-muted-foreground">{today}</p>
            <h1 className="truncate text-[26px] font-bold sm:text-[34px]">{lang === "ar" ? DEMO_RESTAURANT.ar : DEMO_RESTAURANT.en}</h1>
          </div>
          <SampleBadge />
        </div>
        <div className="mt-5">
          <RouteTabs base="/business/dashboard" tabs={tabs} active={active} label={L("أقسام لوحة التحكم", "Dashboard sections")} />
        </div>
        <div className="mt-6">
          <Suspense fallback={<div className="max-w-xs py-10"><ProgressBar value={null} label={L("بنحمّل…", "Loading…")} pendingLabel="…" /></div>}>
            {active === "overview" ? <Overview /> : active === "reports" ? <Reports /> : active === "staff" ? <Staff /> : active === "menu" ? <MenuManager /> : active === "settings" ? <Settings /> : <Marketplace key={route.query.get("key") ?? ""} initialKey={route.query.get("key") ?? undefined} />}
          </Suspense>
        </div>
      </div>
    </BizPage>
  );
}

import { lazy, Suspense, useEffect } from "react";
import { MotionConfig } from "motion/react";
import { LangProvider } from "@/lib/i18n";
import { useRoute } from "@/lib/router";
import { useTheme } from "@/lib/theme";
import { BottomNav, Footer, Header, Notifications } from "@/components/sufra/Shell";
import { CartDrawer } from "@/components/sufra/CartDrawer";
import { ProgressBar } from "@/components/ui/progress-bar";
import Gateway from "@/pages/Gateway";
import Home from "@/pages/Home";

const Explore = lazy(() => import("@/pages/Explore"));
const RestaurantPage = lazy(() => import("@/pages/Restaurant"));
const Checkout = lazy(() => import("@/pages/Checkout"));
const Track = lazy(() => import("@/pages/Track"));
const Account = lazy(() => import("@/pages/Account"));
const Plan = lazy(() => import("@/pages/Plan"));
const About = lazy(() => import("@/pages/About"));
const ComingSoon = lazy(() => import("@/pages/ComingSoon"));

function Loading() {
  return (
    <div className="wrap gutter grid min-h-[50vh] place-items-center">
      <div className="w-full max-w-xs">
        <ProgressBar value={null} label="سُفرة" pendingLabel="…" />
      </div>
    </div>
  );
}

function Routes() {
  const route = useRoute();
  useTheme(); // applies the stored theme + follows the OS
  const { path, parts } = route;
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [path]);

  if (path === "/" || path === "") return <Gateway />;
  if (path === "/business" || path === "/suppliers")
    return (
      <Suspense fallback={<Loading />}>
        <ComingSoon kind={path === "/business" ? "business" : "suppliers"} />
      </Suspense>
    );

  let page: React.ReactNode;
  switch (parts[0]) {
    case "home":
      page = <Home />;
      break;
    case "explore":
      page = <Explore key={route.query.toString()} route={route} />;
      break;
    case "r":
      page = <RestaurantPage slug={parts[1] ?? ""} route={route} />;
      break;
    case "checkout":
      page = <Checkout />;
      break;
    case "order":
      page = <Track id={parts[1] ?? ""} />;
      break;
    case "account":
      page = <Account route={route} />;
      break;
    case "plan":
      page = <Plan id={parts[1] ?? ""} route={route} />;
      break;
    case "invite":
      page = <Account route={route} invite={parts[1]} />;
      break;
    case "about":
      page = <About />;
      break;
    default:
      page = <Home />;
  }
  return (
    <>
      <a href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }} className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-card focus:px-4 focus:py-2">
        تخطّى للمحتوى · Skip to content
      </a>
      <Header path={path} />
      <main id="main" tabIndex={-1} className="outline-none">
        <Suspense fallback={<Loading />}>{page}</Suspense>
      </main>
      <Footer />
      <BottomNav path={path} />
      <CartDrawer />
    </>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <LangProvider>
        <Routes />
        <Notifications />
      </LangProvider>
    </MotionConfig>
  );
}

import { ArrowLeft, ArrowRight, ChefHat, Truck } from "lucide-react";
import { Logo } from "@/components/sufra/Logo";
import { LangToggle, ThemeToggle } from "@/components/sufra/Shell";
import { Reveal } from "@/components/sufra/Reveal";
import { useLang } from "@/lib/i18n";

export default function ComingSoon({ kind }: { kind: "business" | "suppliers" }) {
  const { L, dir } = useLang();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  const biz = kind === "business";
  const Icon = biz ? ChefHat : Truck;
  const points = biz
    ? [L("حجوزات وطلبات في مكان واحد", "Bookings and orders in one place"), L("منيو بالصور وأسعار قبل الضريبة", "Photo menus, pre-tax prices"), L("عروض لعملاء سُفرة", "Offers for Sufra guests"), L("لوحة تحكم بالأرقام", "A dashboard with your numbers")]
    : [L("اوصل لمطاعم القاهرة", "Reach Cairo's kitchens"), L("طلبات توريد منتظمة", "Recurring supply orders"), L("فواتير وتحصيل أسهل", "Simpler invoicing & collection"), L("تقييمات من المطاعم", "Ratings from restaurants")];
  return (
    <div className="min-h-[100svh] bg-background">
      <div className="wrap gutter flex items-center justify-between pt-5">
        <a href="#/" className="rounded-lg">
          <Logo />
        </a>
        <div className="flex gap-2">
          <LangToggle />
          <ThemeToggle />
        </div>
      </div>
      <main className="wrap gutter py-16 sm:py-24">
        <a href="#/" className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
          <Back className="size-4" aria-hidden />
          {L("ارجع للبوابة", "Back to the gateway")}
        </a>
        <Reveal>
          <span className="mt-8 grid size-16 place-items-center rounded-3xl bg-brass-soft text-brass">
            <Icon className="size-8" aria-hidden />
          </span>
          <p className="sf-kicker mt-6">{L("قريب جدًا", "Coming next")}</p>
          <h1 className="mt-2 max-w-3xl text-5xl font-bold leading-tight sm:text-7xl">{biz ? L("سُفرة للمطاعم", "Sufra for restaurants") : L("سُفرة للموردين", "Sufra for suppliers")}</h1>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground">
            {biz ? L("بنجهّز لوحة تحكم المطاعم: الحجوزات، الطلبات، المنيو، والعروض. هتكون هنا قريب.", "We're building the restaurant dashboard: bookings, orders, menu and offers. It lands here soon.") : L("بنجهّز بوابة الموردين عشان توصل لمطاعم القاهرة مباشرة. قريب.", "We're building the supplier portal to connect you with Cairo's kitchens. Soon.")}
          </p>
        </Reveal>
        <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {points.map((p, i) => (
            <Reveal key={p} delay={i * 0.06}>
              <li className="sf-card h-full list-none p-5">
                <span className="num text-xs text-brass">0{i + 1}</span>
                <p className="mt-2 font-display text-lg font-semibold">{p}</p>
              </li>
            </Reveal>
          ))}
        </ul>
        <a href="#/home" className="sf-btn sf-btn-ghost mt-10">{L("أنا زبون — وريني المطاعم", "I'm a guest — show me restaurants")}</a>
      </main>
    </div>
  );
}

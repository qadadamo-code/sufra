import { Compass, Home, Languages, Map as MapIcon, Monitor, Moon, ShoppingBag, Sun, User } from "lucide-react";
import { Blobatar } from "@blobatar/react";
import { useLang } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { cartCount, useAccount, useStore } from "@/lib/store";
import { setUI } from "@/lib/ui-state";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";
import { useNotifications, dismiss } from "@/lib/notify";
import { MatteStackFeedback } from "@/components/ui/matte-stack-feedback";

export function LangToggle({ className }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === "ar" ? "en" : "ar")}
      className={cn("inline-flex h-10 items-center gap-1.5 rounded-full border bg-card/70 px-3 text-sm font-semibold backdrop-blur hover:bg-card", className)}
      aria-label={lang === "ar" ? "Switch to English" : "التحويل للعربي"}
    >
      <Languages className="size-4" aria-hidden />
      <span lang={lang === "ar" ? "en" : "ar"}>{lang === "ar" ? "EN" : "ع"}</span>
    </button>
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const { L } = useLang();
  const { pref, set } = useTheme();
  const next = pref === "system" ? "light" : pref === "light" ? "dark" : "system";
  const Icon = pref === "system" ? Monitor : pref === "light" ? Sun : Moon;
  const name = { system: L("حسب الجهاز", "System"), light: L("فاتح", "Light"), dark: L("غامق", "Dark") };
  return (
    <button
      type="button"
      onClick={() => set(next)}
      className={cn("grid size-10 place-items-center rounded-full border bg-card/70 backdrop-blur hover:bg-card", className)}
      aria-label={L(`الثيم: ${name[pref]} — غيّر لـ ${name[next]}`, `Theme: ${name[pref]} — switch to ${name[next]}`)}
      title={name[pref]}
    >
      <Icon className="size-[18px]" aria-hidden />
    </button>
  );
}

function CartButton({ className }: { className?: string }) {
  const { L } = useLang();
  const n = useStore(cartCount);
  return (
    <button
      type="button"
      onClick={() => setUI({ cartOpen: true })}
      className={cn("relative grid size-10 place-items-center rounded-full border bg-card/70 backdrop-blur hover:bg-card", className)}
      aria-label={L(`السلة، ${n} صنف`, `Cart, ${n} items`)}
    >
      <ShoppingBag className="size-[18px]" aria-hidden />
      {n > 0 ? <span className="num absolute -end-1 -top-1 grid min-w-5 place-items-center rounded-full bg-brass px-1 text-[11px] font-bold text-brass-ink">{n}</span> : null}
    </button>
  );
}

export function Header({ path }: { path: string }) {
  const { L } = useLang();
  const acc = useAccount();
  const links = [
    { href: "#/home", label: L("الرئيسية", "Home"), active: path === "/home" },
    { href: "#/explore", label: L("استكشف", "Explore"), active: path.startsWith("/explore") },
    { href: "#/explore?view=map", label: L("الخريطة", "Map"), active: false },
    { href: "#/account", label: L("حسابي", "Account"), active: path.startsWith("/account") || path.startsWith("/plan") },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="wrap gutter flex h-16 items-center gap-3">
        <a href="#/home" className="rounded-lg" aria-label={L("سُفرة — الرئيسية", "Sufra — home")}>
          <Logo />
        </a>
        <nav className="ms-6 hidden items-center gap-1 md:flex" aria-label={L("التنقل الرئيسي", "Main")}>
          {links.map((l) => (
            <a key={l.href} href={l.href} aria-current={l.active ? "page" : undefined} className={cn("rounded-full px-4 py-2 text-[15px] font-medium transition-colors hover:bg-card", l.active && "bg-card text-primary shadow-sm")}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <LangToggle />
          <ThemeToggle />
          <CartButton />
          <a href="#/account" className="hidden size-10 overflow-hidden rounded-full border bg-card sm:grid sm:place-items-center" aria-label={acc ? acc.profile.name : L("تسجيل الدخول", "Sign in")}>
            {acc ? <Blobatar name={acc.profile.phone} animate="hover" background="circle" className="size-10" aria-hidden /> : <User className="size-[18px]" aria-hidden />}
          </a>
        </div>
      </div>
    </header>
  );
}

export function BottomNav({ path }: { path: string }) {
  const { L } = useLang();
  const n = useStore(cartCount);
  const items = [
    { href: "#/home", label: L("الرئيسية", "Home"), Icon: Home, active: path === "/home" },
    { href: "#/explore", label: L("استكشف", "Explore"), Icon: Compass, active: path.startsWith("/explore") && !location.hash.includes("view=map") },
    { href: "#/explore?view=map", label: L("الخريطة", "Map"), Icon: MapIcon, active: location.hash.includes("view=map") },
    { href: "#/account", label: L("حسابي", "Account"), Icon: User, active: path.startsWith("/account") },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden" aria-label={L("التنقل", "Navigation")}>
      <div className="grid grid-cols-5">
        {items.slice(0, 2).map((it) => (
          <a key={it.href} href={it.href} aria-current={it.active ? "page" : undefined} className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground", it.active && "text-primary")}>
            <it.Icon className="size-5" aria-hidden />
            {it.label}
          </a>
        ))}
        <button type="button" onClick={() => setUI({ cartOpen: true })} className="relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground">
          <span className="relative grid size-11 -translate-y-3 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background">
            <ShoppingBag className="size-5" aria-hidden />
            {n > 0 ? <span className="num absolute -end-1 -top-1 grid min-w-5 place-items-center rounded-full bg-brass px-1 text-[11px] font-bold text-brass-ink">{n}</span> : null}
          </span>
          <span className="-mt-3">{L("السلة", "Cart")}</span>
        </button>
        {items.slice(2).map((it) => (
          <a key={it.href} href={it.href} aria-current={it.active ? "page" : undefined} className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground", it.active && "text-primary")}>
            <it.Icon className="size-5" aria-hidden />
            {it.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

export function Footer() {
  const { L } = useLang();
  return (
    <footer className="mt-24 border-t bg-card/40 pb-24 md:pb-0">
      <div className="wrap gutter grid gap-8 py-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">{L("سُفرة بتجمعلك مطاعم وكافيهات القاهرة: اكتشف، احجز ترابيزة، واطلب أكلك — من غير لف.", "Sufra brings Cairo's restaurants and cafés together: discover, book a table and order — no runaround.")}</p>
          <p className="mt-3 text-xs text-muted-foreground">{L("نسخة تجريبية — كل المطاعم والبيانات خيالية.", "Demo build — all restaurants and data are fictional.")}</p>
        </div>
        <div className="grid content-start gap-2 text-sm">
          <p className="font-semibold">{L("اكتشف", "Discover")}</p>
          <a className="text-muted-foreground hover:text-foreground" href="#/explore">{L("كل المطاعم", "All restaurants")}</a>
          <a className="text-muted-foreground hover:text-foreground" href="#/explore?open=1">{L("مفتوح دلوقتي", "Open now")}</a>
          <a className="text-muted-foreground hover:text-foreground" href="#/explore?offer=1">{L("عروض وخصومات", "Offers")}</a>
          <a className="text-muted-foreground hover:text-foreground" href="#/explore?view=map">{L("الخريطة", "Map")}</a>
        </div>
        <div className="grid content-start gap-2 text-sm">
          <p className="font-semibold">{L("حسابك", "Your account")}</p>
          <a className="text-muted-foreground hover:text-foreground" href="#/account">{L("الملف الشخصي", "Profile")}</a>
          <a className="text-muted-foreground hover:text-foreground" href="#/account?tab=history">{L("حجوزاتي وطلباتي", "Bookings & orders")}</a>
          <a className="text-muted-foreground hover:text-foreground" href="#/account?tab=invite">{L("ادعي صحابك", "Invite friends")}</a>
        </div>
        <div className="grid content-start gap-2 text-sm">
          <p className="font-semibold">{L("سُفرة", "Sufra")}</p>
          <a className="text-muted-foreground hover:text-foreground" href="#/business">{L("للمطاعم", "For restaurants")}</a>
          <a className="text-muted-foreground hover:text-foreground" href="#/suppliers">{L("للموردين", "For suppliers")}</a>
          <a className="text-muted-foreground hover:text-foreground" href="#/about">{L("عن سُفرة وحقوق الصور", "About & photo credits")}</a>
          <a className="text-muted-foreground hover:text-foreground" href="#/">{L("البوابة", "Gateway")}</a>
        </div>
      </div>
    </footer>
  );
}

export function Notifications() {
  const { L } = useLang();
  const items = useNotifications();
  return <MatteStackFeedback items={items} onDismiss={dismiss} closeLabel={L("إغلاق", "Dismiss")} regionLabel={L("الإشعارات", "Notifications")} counter={(v, q) => L(`${v} ظاهرين · ${q} مستنيين`, `${v} visible · ${q} queued`)} />;
}

/** Small shared pieces for the B2B pages (restaurant + supplier). Sufra tokens only. */
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, FlaskConical, Menu, X } from "lucide-react";
import { Logo } from "@/components/sufra/Logo";
import { LangToggle, ThemeToggle } from "@/components/sufra/Shell";
import { useLang } from "@/lib/i18n";
import { formatMoney } from "@/lib/pricing";
import { cn } from "@/lib/utils";

export function useMoney() {
  const { lang } = useLang();
  return (p: number) => formatMoney(p, lang);
}

/** Splits "1,208 ج.م" / "EGP 1,208" so the digits use the mono face and the currency the text face, smaller. */
function MoneyParts({ text, lang }: { text: string; lang: "ar" | "en" }) {
  const cur = lang === "ar" ? "ج.م" : "EGP";
  const num = text.replace(cur, "").trim();
  const c = <span className="font-sans text-[0.72em] font-medium opacity-80">{cur}</span>;
  return lang === "ar" ? (
    <>
      <span dir="ltr" className="[unicode-bidi:isolate]">{num}</span> {c}
    </>
  ) : (
    <>
      {c} <span dir="ltr" className="[unicode-bidi:isolate]">{num}</span>
    </>
  );
}

/** EGP amount: integer piastres, mono digits, isolated so it reads correctly inside either language. */
export function Money({ v, className }: { v: number; className?: string }) {
  const { lang } = useLang();
  return (
    <span className={cn("num whitespace-nowrap [unicode-bidi:isolate]", className)} dir={lang === "ar" ? "rtl" : "ltr"}>
      <MoneyParts text={formatMoney(v, lang)} lang={lang} />
    </span>
  );
}

/** Number that rolls to its new value (respects reduced motion). */
export function AnimatedMoney({ v, className }: { v: number; className?: string }) {
  const { lang } = useLang();
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(v);
  useEffect(() => {
    if (reduced) return setShown(v);
    const from = shown;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 520);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(from + (v - from) * e));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, reduced]);
  return (
    <span className={cn("num whitespace-nowrap [unicode-bidi:isolate]", className)} dir={lang === "ar" ? "rtl" : "ltr"} aria-live="polite">
      <MoneyParts text={formatMoney(Math.round(shown / 100) * 100, lang)} lang={lang} />
    </span>
  );
}

export function SampleBadge({ className }: { className?: string }) {
  const { L } = useLang();
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-brass/40 bg-brass-soft px-2.5 py-1 text-[12px] font-semibold text-accent-foreground", className)}>
      <FlaskConical className="size-3.5" aria-hidden />
      {L("بيانات تجريبية", "Sample data")}
    </span>
  );
}

export function Pill({ tone = "muted", children, className }: { tone?: "muted" | "ok" | "warn" | "danger" | "primary" | "brass"; children: ReactNode; className?: string }) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
    primary: "bg-primary-soft text-primary",
    brass: "bg-brass-soft text-accent-foreground",
  };
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold", tones[tone], className)}>{children}</span>;
}

/** Segmented control (radio group) with a sliding thumb. */
export function Segmented<T extends string>({ value, onChange, options, label, className, size = "md", wrap = false }: { value: T; onChange: (v: T) => void; options: { id: T; label: ReactNode; badge?: ReactNode }[]; label: string; className?: string; size?: "sm" | "md"; wrap?: boolean }) {
  const reduced = useReducedMotion();
  const group = label.replace(/\W+/g, "");
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex max-w-full gap-1 rounded-full border bg-card p-1", wrap ? "flex-wrap justify-center max-sm:rounded-[24px]" : "overflow-x-auto no-scrollbar", className)}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={cn("relative inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold transition-colors", size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm", on ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {on ? <motion.span layoutId={`seg-${group}`} className="absolute inset-0 rounded-full bg-primary" transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36 }} /> : null}
            <span className="relative">{o.label}</span>
            {o.badge ? <span className={cn("relative rounded-full px-1.5 py-px text-[10px] font-bold", on ? "bg-white/20" : "bg-brass-soft text-accent-foreground")}>{o.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Tabs bound to `?tab=` in the hash route. */
export function RouteTabs({ base, tabs, active, label }: { base: string; tabs: { id: string; label: string; icon?: ReactNode }[]; active: string; label: string }) {
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 no-scrollbar md:mx-0 md:px-0">
      <div className="flex w-max gap-1 rounded-full border bg-card p-1">
        {tabs.map((t) => (
          <a key={t.id} href={`#${base}?tab=${t.id}`} aria-current={t.id === active ? "page" : undefined} className={cn("inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors", t.id === active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground")}>
            {t.icon}
            {t.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

export function Stat({ label, value, sub, tone, className }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "warn" | "danger"; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="truncate text-[13px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-display text-2xl font-bold">{value}</p>
      {sub ? <p className={cn("truncate text-[12px]", tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-muted-foreground")}>{sub}</p> : null}
    </div>
  );
}

export function Card({ children, className, as: Tag = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" | "li" }) {
  return <Tag className={cn("sf-card p-4 sm:p-5", className)}>{children}</Tag>;
}

export function Faq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="grid gap-2">
      {items.map((f) => (
        <details key={f.q} className="group sf-card px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
            {f.q}
            <span className="grid size-7 shrink-0 place-items-center rounded-full border text-lg leading-none transition-transform group-open:rotate-45" aria-hidden>
              +
            </span>
          </summary>
          <p className="mt-2 text-muted-foreground">{f.a}</p>
        </details>
      ))}
    </div>
  );
}

export function useArrow() {
  const { dir } = useLang();
  return dir === "rtl" ? ArrowLeft : ArrowRight;
}

type NavItem = { href: string; label: string; active?: boolean };

/** Header for the B2B side: logo + "for restaurants/suppliers" tag, nav, language/theme, CTA. */
export function BizHeader({ kind, nav, cta }: { kind: "business" | "suppliers"; nav: NavItem[]; cta?: { href: string; label: string } }) {
  const { L } = useLang();
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    const on = () => setOpen(false);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-xl">
      <div className="wrap gutter flex h-16 items-center gap-3">
        <a href={kind === "business" ? "#/business" : "#/suppliers"} className="flex shrink-0 items-center gap-2 rounded-lg" aria-label={kind === "business" ? L("سُفرة للمطاعم", "Sufra for restaurants") : L("سُفرة للموردين", "Sufra for suppliers")}>
          <Logo />
          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[12px] font-semibold text-primary">{kind === "business" ? L("للمطاعم", "Business") : L("للموردين", "Suppliers")}</span>
        </a>
        <nav className="ms-4 hidden items-center gap-1 lg:flex" aria-label={L("التنقل", "Navigation")}>
          {nav.map((n) => (
            <a key={n.href} href={n.href} aria-current={n.active ? "page" : undefined} className={cn("rounded-full px-3.5 py-2 text-[14px] font-medium transition-colors hover:bg-card", n.active && "bg-card text-primary shadow-sm")}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <LangToggle className="hidden sm:inline-flex" />
          <ThemeToggle />
          {cta ? (
            <a href={cta.href} className="sf-btn sf-btn-primary sf-btn-sm hidden sm:inline-flex">
              {cta.label}
            </a>
          ) : null}
          <button type="button" className="grid size-10 place-items-center rounded-full border bg-card/70 lg:hidden" aria-expanded={open} aria-controls="biz-menu" aria-label={open ? L("اقفل القائمة", "Close menu") : L("افتح القائمة", "Open menu")} onClick={() => setOpen((v) => !v)}>
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.nav id="biz-menu" aria-label={L("القائمة", "Menu")} className="overflow-hidden border-t lg:hidden" initial={reduced ? { opacity: 0 } : { height: 0 }} animate={reduced ? { opacity: 1 } : { height: "auto" }} exit={reduced ? { opacity: 0 } : { height: 0 }}>
            <div className="wrap gutter grid gap-1 py-3">
              {nav.map((n) => (
                <a key={n.href} href={n.href} aria-current={n.active ? "page" : undefined} className={cn("rounded-xl px-3 py-3 font-medium hover:bg-card", n.active && "bg-card text-primary")}>
                  {n.label}
                </a>
              ))}
              <div className="mt-2 flex items-center gap-2">
                <LangToggle />
                {cta ? (
                  <a href={cta.href} className="sf-btn sf-btn-primary sf-btn-sm flex-1">
                    {cta.label}
                  </a>
                ) : null}
              </div>
            </div>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </header>
  );
}

export function businessNav(L: (a: string, e: string) => string, path: string): NavItem[] {
  return [
    { href: "#/business", label: L("المميزات", "Features"), active: path === "/business" },
    { href: "#/business/pricing", label: L("الأسعار", "Pricing"), active: path === "/business/pricing" },
    { href: "#/business/dashboard", label: L("لوحة التحكم (تجربة)", "Dashboard demo"), active: path.startsWith("/business/dashboard") },
    { href: "#/business/revenue", label: L("نموذج الإيرادات", "Revenue model"), active: path === "/business/revenue" },
    { href: "#/suppliers", label: L("للموردين", "For suppliers") },
  ];
}
export function supplierNav(L: (a: string, e: string) => string, path: string): NavItem[] {
  return [
    { href: "#/suppliers", label: L("ليه سُفرة", "Why Sufra"), active: path === "/suppliers" },
    { href: "#/suppliers?s=pricing", label: L("الأسعار", "Pricing") },
    { href: "#/suppliers/portal", label: L("بوابة المورّد (تجربة)", "Supplier portal demo"), active: path.startsWith("/suppliers/portal") },
    { href: "#/business", label: L("للمطاعم", "For restaurants") },
  ];
}

export function BizFooter() {
  const { L } = useLang();
  return (
    <footer className="mt-24 border-t bg-card/40">
      <div className="wrap gutter grid gap-8 py-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">{L("سستم مطاعم كامل من القاهرة: كاشير، صالة، مطبخ، مخزن، ضرايب وموردين.", "A complete restaurant system from Cairo: POS, floor, kitchen, stock, tax and suppliers.")}</p>
          <p className="mt-3 text-xs text-muted-foreground">{L("نسخة تجريبية — كل الأسماء والأرقام والموردين خيالية.", "Demo build — all names, numbers and suppliers are fictional.")}</p>
        </div>
        <div className="grid content-start gap-2 text-sm">
          <p className="font-semibold">{L("للمطاعم", "Restaurants")}</p>
          <a className="text-muted-foreground hover:text-foreground" href="#/business">{L("المميزات", "Features")}</a>
          <a className="text-muted-foreground hover:text-foreground" href="#/business/pricing">{L("الأسعار", "Pricing")}</a>
          <a className="text-muted-foreground hover:text-foreground" href="#/business/signup">{L("ابدأ تجربة مجانية", "Start free trial")}</a>
          <a className="text-muted-foreground hover:text-foreground" href="#/business/dashboard">{L("لوحة التحكم", "Dashboard")}</a>
        </div>
        <div className="grid content-start gap-2 text-sm">
          <p className="font-semibold">{L("للموردين", "Suppliers")}</p>
          <a className="text-muted-foreground hover:text-foreground" href="#/suppliers">{L("ليه سُفرة", "Why Sufra")}</a>
          <a className="text-muted-foreground hover:text-foreground" href="#/suppliers/signup">{L("سجّل كمورّد", "Join as a supplier")}</a>
          <a className="text-muted-foreground hover:text-foreground" href="#/suppliers/portal">{L("بوابة المورّد", "Supplier portal")}</a>
        </div>
        <div className="grid content-start gap-2 text-sm">
          <p className="font-semibold">{L("سُفرة", "Sufra")}</p>
          <a className="text-muted-foreground hover:text-foreground" href="#/home">{L("للزباين", "For guests")}</a>
          <a className="text-muted-foreground hover:text-foreground" href="#/business/revenue">{L("نموذج الإيرادات", "Revenue model")}</a>
          <a className="text-muted-foreground hover:text-foreground" href="#/">{L("البوابة", "Gateway")}</a>
        </div>
      </div>
    </footer>
  );
}

/** Full page wrapper for B2B pages (they render their own chrome). */
export function BizPage({ kind, path, children, cta }: { kind: "business" | "suppliers"; path: string; children: ReactNode; cta?: { href: string; label: string } }) {
  const { L } = useLang();
  const nav = kind === "business" ? businessNav(L, path) : supplierNav(L, path);
  return (
    <div className="min-h-[100svh] bg-background">
      <a href="#biz-main" onClick={(e) => { e.preventDefault(); document.getElementById("biz-main")?.focus(); }} className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-card focus:px-4 focus:py-2">
        {L("تخطّى للمحتوى", "Skip to content")}
      </a>
      <BizHeader kind={kind} nav={nav} cta={cta ?? (kind === "business" ? { href: "#/business/signup", label: L("جرّب ببلاش", "Free trial") } : { href: "#/suppliers/signup", label: L("سجّل كمورّد", "Join") })} />
      <main id="biz-main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <BizFooter />
    </div>
  );
}

export function SectionTitle({ kicker, title, sub, className, center }: { kicker?: string; title: string; sub?: string; className?: string; center?: boolean }) {
  return (
    <div className={cn("mb-8", center && "mx-auto max-w-2xl text-center", className)}>
      {kicker ? <p className="sf-kicker mb-2">{kicker}</p> : null}
      <h2 className="text-[30px] font-bold leading-tight sm:text-[42px]">{title}</h2>
      {sub ? <p className="mt-3 max-w-2xl text-[17px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="sf-label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[12px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-2xl border bg-card px-4 py-3">
      <span className="min-w-0">
        <span className="block font-semibold">{label}</span>
        {sub ? <span className="block text-[13px] text-muted-foreground">{sub}</span> : null}
      </span>
      <span className="relative mt-1 inline-flex shrink-0">
        <input type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring" />
        <span className="absolute top-0.5 size-5 rounded-full bg-white shadow transition-[inset-inline-start] [inset-inline-start:2px] peer-checked:[inset-inline-start:22px]" />
      </span>
    </label>
  );
}

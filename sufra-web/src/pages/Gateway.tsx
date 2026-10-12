import { ArrowLeft, ArrowRight, ChefHat, Truck, UtensilsCrossed } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { CrowdCanvas } from "@/components/ui/skiper39";
import { Logo } from "@/components/sufra/Logo";
import { LangToggle, ThemeToggle } from "@/components/sufra/Shell";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export default function Gateway() {
  const { L, dir } = useLang();
  const reduced = useReducedMotion();
  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;
  const choices = [
    { href: "#/home", n: "01", title: L("زبون", "Guest"), sub: L("عايز أكتشف مكان، أحجز ترابيزة أو أطلب أكل", "Find a place, book a table or order food"), Icon: UtensilsCrossed, main: true },
    { href: "#/business", n: "02", title: L("مطعم", "Restaurant"), sub: L("عايز أستقبل حجوزات وطلبات وأدير المكان", "Take bookings & orders, run the floor"), Icon: ChefHat },
    { href: "#/suppliers", n: "03", title: L("مورّد", "Supplier"), sub: L("عايز أبيع خامات ومنتجات للمطاعم", "Sell produce & supplies to restaurants"), Icon: Truck },
  ];
  return (
    <div className="relative min-h-[100svh] overflow-hidden bg-background">
      {/* the walking crowd (Open Peeps, CC0) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[46svh] min-h-[280px] sm:h-[52svh]" aria-hidden>
        <CrowdCanvas src="./open-peeps.png" rows={15} cols={7} className="absolute bottom-0 h-full w-full opacity-90 dark:opacity-75 dark:invert" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background to-transparent" />
      </div>
      <div className="relative z-10 wrap gutter flex items-center justify-between pt-5">
        <Logo size="lg" />
        <div className="flex items-center gap-2">
          <LangToggle />
          <ThemeToggle />
        </div>
      </div>
      <main className="relative z-10 wrap gutter pb-[48svh] pt-10 sm:pt-14">
        <motion.p className="sf-kicker" initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          {L("أهلًا بيك في سُفرة · القاهرة", "Welcome to Sufra · Cairo")}
        </motion.p>
        <h1 className="mt-2 font-display text-[56px] font-bold leading-[1.05] sm:text-[96px]">
          {[L("إنت", "Who"), L("مين؟", "are you?")].map((w, i) => (
            <span key={i} className="inline-block overflow-hidden pb-2 align-bottom">
              <motion.span className={cn("inline-block", i === 1 && "text-primary")} initial={reduced ? false : { y: "105%" }} animate={{ y: 0 }} transition={{ duration: 1, delay: 0.1 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}>
                {w}
              </motion.span>
              {i === 0 ? " " : null}
            </span>
          ))}
        </h1>
        <nav className="mt-8 grid gap-3 md:grid-cols-3 md:gap-4" aria-label={L("اختار نوع حسابك", "Choose who you are")}>
          {choices.map((c, i) => (
            <motion.a
              key={c.href}
              href={c.href}
              initial={reduced ? false : { opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                "group relative flex items-center gap-4 overflow-hidden rounded-[26px] border p-5 backdrop-blur-md transition-[transform,box-shadow,background-color] duration-300 hover:-translate-y-1 hover:shadow-sf sm:p-6 md:flex-col md:items-start",
                c.main ? "border-primary bg-primary text-primary-foreground" : "bg-card/85",
              )}
            >
              <span className={cn("grid size-12 shrink-0 place-items-center rounded-2xl md:size-14", c.main ? "bg-white/15" : "bg-brass-soft text-brass")}>
                <c.Icon className="size-6" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("num block text-xs opacity-70")}>{c.n}</span>
                <span className="block font-display text-3xl font-bold leading-tight md:text-4xl">{c.title}</span>
                <span className={cn("mt-1 block text-sm", c.main ? "text-primary-foreground/80" : "text-muted-foreground")}>{c.sub}</span>
              </span>
              <span className={cn("grid size-11 shrink-0 place-items-center rounded-full border transition-transform duration-300 group-hover:-translate-x-1 rtl:group-hover:translate-x-[-4px] md:absolute md:end-5 md:top-5", c.main ? "border-white/30" : "")}>
                <Arrow className="size-5" aria-hidden />
              </span>
            </motion.a>
          ))}
        </nav>
      </main>
    </div>
  );
}

import { Car, Footprints, Heart, Star, Tag } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { areaName, cuisineName, hasGoogle, type Restaurant } from "@/lib/data";
import { fmtKm, haversineKm, travel } from "@/lib/geo";
import { fmtTime, openState } from "@/lib/hours";
import { useLang } from "@/lib/i18n";
import { notify } from "@/lib/notify";
import { navigate } from "@/lib/router";
import { toggleFavourite, useAccount, useHome } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Photo } from "./Photo";

export function OpenBadge({ r, now, className, long = false }: { r: Restaurant; now: Date; className?: string; long?: boolean }) {
  const { L, lang } = useLang();
  const st = openState(r.hours, now);
  const tone = st.open ? (st.closingSoon ? "text-warn" : "text-ok") : "text-danger";
  const label = st.open ? (st.closingSoon ? L("بيقفل قريب", "Closing soon") : L("مفتوح", "Open")) : L("مقفول", "Closed");
  const more = st.at == null ? "" : st.open ? L(` · لحد ${fmtTime(st.at, lang)}`, ` · until ${fmtTime(st.at, lang)}`) : L(` · يفتح ${fmtTime(st.at, lang)}`, ` · opens ${fmtTime(st.at, lang)}`);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-medium", tone, className)}>
      <span className={cn("size-2 rounded-full", st.open ? (st.closingSoon ? "bg-warn" : "bg-ok") : "bg-danger")} aria-hidden />
      {label}
      {long || more ? <span className="font-normal text-muted-foreground">{more}</span> : null}
    </span>
  );
}

export function PriceLevel({ level, className }: { level: number; className?: string }) {
  const { L } = useLang();
  return (
    <span className={cn("num inline-flex text-[13px] tracking-tight", className)} aria-label={L(`مستوى السعر ${level} من 4`, `Price level ${level} of 4`)} dir="ltr">
      {[1, 2, 3, 4].map((i) => (
        <span key={i} aria-hidden className={i <= level ? "text-foreground" : "text-muted-foreground/35"}>
          $
        </span>
      ))}
    </span>
  );
}

export function Ratings({ r, className }: { r: Restaurant; className?: string }) {
  const { L } = useLang();
  return (
    <span className={cn("inline-flex items-center gap-2 text-[13px]", className)}>
      <span className="inline-flex items-center gap-1 font-semibold" title={L("تقييم سُفرة", "Sufra rating")}>
        <Star className="size-3.5 fill-brass text-brass" aria-hidden />
        <span className="num">{r.rating.toFixed(1)}</span>
        <span className="sr-only">{L("على سُفرة", "on Sufra")}</span>
      </span>
      {hasGoogle(r) ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground" title={L("تقييم جوجل", "Google rating")}>
          <span className="grid size-4 place-items-center rounded-full border text-[9px] font-bold" aria-hidden>
            G
          </span>
          <span className="num">{r.google.toFixed(1)}</span>
          <span className="sr-only">{L("على جوجل", "on Google")}</span>
        </span>
      ) : null}
    </span>
  );
}

export function Distance({ r, className }: { r: Restaurant; className?: string; compact?: boolean }) {
  const { L, lang } = useLang();
  const { home } = useHome();
  const km = haversineKm(home, r);
  const t = travel(km);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted-foreground", className)}>
      <span className="num text-foreground">{fmtKm(km, lang)}</span>
      <span className="inline-flex items-center gap-1">
        <Car className="size-3.5" aria-hidden />
        <span className="num">{t.car}</span>
        {L(" د", " min")}
        <span className="sr-only">{L("بالعربية", "by car")}</span>
      </span>
      {t.walk ? (
        <span className="inline-flex items-center gap-1">
          <Footprints className="size-3.5" aria-hidden />
          <span className="num">{t.walk}</span>
          {L(" د", " min")}
          <span className="sr-only">{L("مشي", "walking")}</span>
        </span>
      ) : null}
    </span>
  );
}

export function FavButton({ r, className }: { r: Restaurant; className?: string }) {
  const { L, lang } = useLang();
  const acc = useAccount();
  const reduced = useReducedMotion();
  const on = !!acc?.favourites.includes(r.id);
  return (
    <motion.button
      type="button"
      whileTap={reduced ? undefined : { scale: 0.85 }}
      aria-pressed={on}
      aria-label={on ? L(`شيل ${r.ar} من المفضلة`, `Remove ${r.en} from favourites`) : L(`ضيف ${r.ar} للمفضلة`, `Add ${r.en} to favourites`)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const res = toggleFavourite(r.id);
        if (res === null) {
          notify({ title: L("سجّل دخول الأول", "Sign in first"), detail: L("عشان نحفظ المفضلة بتاعتك.", "So we can keep your favourites."), tone: "brass", icon: "bell" });
          navigate("/account");
        } else notify({ title: res ? L("اتضاف للمفضلة", "Added to favourites") : L("اتشال من المفضلة", "Removed from favourites"), detail: r[lang], ttl: 2600 });
      }}
      className={cn("grid size-10 place-items-center rounded-full bg-card/90 shadow-sm backdrop-blur transition-colors hover:bg-card", className)}
    >
      <Heart className={cn("size-[18px] transition-colors", on ? "fill-danger text-danger" : "text-foreground")} aria-hidden />
    </motion.button>
  );
}

export function OfferBadge({ r, className }: { r: Restaurant; className?: string }) {
  const { lang } = useLang();
  const o = r.offers[0];
  if (!o) return null;
  const short = o.kind === "percent" || o.kind === "happy-hour" || o.kind === "first-visit" || o.kind === "plus" || o.kind === "group" ? `−${o.value}%` : null;
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full bg-brass px-2.5 py-1 text-[12px] font-semibold text-brass-ink shadow-sm", className)}>
      <Tag className="size-3 shrink-0" aria-hidden />
      {short ? <span className="num" dir="ltr">{short}</span> : null}
      <span className="truncate">{o[lang]}</span>
    </span>
  );
}

export function RestaurantCard({ r, now, layout = "grid", className, eager }: { r: Restaurant; now: Date; layout?: "grid" | "list" | "rail"; className?: string; eager?: boolean }) {
  const { L, lang } = useLang();
  const href = `#/r/${r.slug}`;
  if (layout === "list") {
    return (
      <a href={href} className={cn("group flex gap-3 rounded-2xl border bg-card p-2.5 transition-shadow hover:shadow-sf focus-visible:shadow-sf sm:gap-4", className)}>
        <div className="relative w-28 shrink-0 sm:w-40">
          <Photo k={r.cover} label={r[lang]} className="aspect-[4/3] rounded-xl" eager={eager} />
          {r.isNew ? <span className="absolute start-1.5 top-1.5 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">{L("جديد", "New")}</span> : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-[17px] font-semibold">{r[lang]}</h3>
            <PriceLevel level={r.price} className="shrink-0" />
          </div>
          <p className="truncate text-[13px] text-muted-foreground">
            {cuisineName(r.cuisine, lang)} · {areaName(r.area, lang)}
          </p>
          <OpenBadge r={r} now={now} />
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1">
            <Ratings r={r} />
            <Distance r={r} compact />
          </div>
          {r.offers[0] ? <OfferBadge r={r} className="mt-1 self-start" /> : null}
        </div>
      </a>
    );
  }
  return (
    <div className={cn("group relative", layout === "rail" && "w-[78vw] max-w-[320px] sm:w-[300px]", className)}>
    <a href={href} className="block rounded-[22px] focus-visible:outline-offset-4">
      <div className="relative">
        <Photo k={r.cover} label={r[lang]} className="aspect-[4/3] rounded-[20px]" imgClassName="transition-transform duration-700 ease-[cubic-bezier(.16,1,.3,1)] group-hover:scale-[1.04]" eager={eager} />
        <div className="absolute inset-x-2.5 top-2.5 flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            {r.isNew ? <span className="rounded-full bg-primary px-2.5 py-1 text-[12px] font-semibold text-primary-foreground">{L("جديد في سُفرة", "New on Sufra")}</span> : null}
            {r.offers[0] ? <OfferBadge r={r} className="max-w-[200px]" /> : null}
          </div>
        </div>
      </div>
      <div className="px-1 pt-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-[18px] font-semibold">{r[lang]}</h3>
          <PriceLevel level={r.price} className="mt-1 shrink-0" />
        </div>
        <p className="truncate text-[13px] text-muted-foreground">
          {cuisineName(r.cuisine, lang)} · {areaName(r.area, lang)} · <span className="num">{r.avg}</span> {L("ج.م للفرد", "EGP pp")}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <OpenBadge r={r} now={now} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Ratings r={r} />
          <Distance r={r} compact />
        </div>
      </div>
    </a>
    <FavButton r={r} className="absolute end-2.5 top-2.5" />
    </div>
  );
}

export function SectionHead({ kicker, title, action, className }: { kicker?: string; title: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-5 flex items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {kicker ? <p className="sf-kicker mb-1">{kicker}</p> : null}
        <h2 className="text-[26px] font-bold leading-tight sm:text-[34px]">{title}</h2>
      </div>
      {action}
    </div>
  );
}

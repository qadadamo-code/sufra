import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarPlus, ChefHat, Copy, ExternalLink, Flame, Leaf, MapPin, Minus, Phone, Plus, Search, Share2, ShoppingBag, Sparkles, Star, Users, Wallet } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { LensZoomCarousel } from "@/components/ui/lens-zoom-carousel";
import { ShinyButton } from "@/components/ui/shiny-button";
import { VoxelStoryVideoCard } from "@/components/ui/voxel-story-video-card";
import { CairoMap } from "@/components/sufra/CairoMap";
import { BookingDialog } from "@/components/sufra/BookingDialog";
import { Distance, FavButton, OpenBadge, PriceLevel, Ratings, RestaurantCard } from "@/components/sufra/bits";
import { Photo } from "@/components/sufra/Photo";
import { Reveal } from "@/components/sufra/Reveal";
import { amenityById, areaName, bySlug, cuisineName, DAYS_AR, DAYS_EN, moodById, restaurants, serviceRateOf, TAGS, type ItemTag } from "@/lib/data";
import { haversineKm } from "@/lib/geo";
import { fmtRange, openState } from "@/lib/hours";
import { useNow } from "@/lib/hooks";
import { useLang } from "@/lib/i18n";
import { imgUrl, videoUrl, allVideos } from "@/lib/media";
import { copyText } from "@/lib/copy";
import { notify } from "@/lib/notify";
import { egp, formatMoney, priceBreakdown } from "@/lib/pricing";
import { norm } from "@/lib/recommend";
import { navigate, shareUrl, type Route } from "@/lib/router";
import { cartAdd, pushRecent, updateAccount, useAccount, useHome, useStore } from "@/lib/store";
import { setUI } from "@/lib/ui-state";
import { cn } from "@/lib/utils";

const TAG_STYLE: Record<ItemTag, string> = {
  veg: "bg-ok-soft text-ok",
  spicy: "bg-danger-soft text-danger",
  new: "bg-primary-soft text-primary",
  best: "bg-brass-soft text-brass",
  share: "bg-muted text-muted-foreground",
};

export default function RestaurantPage({ slug, route }: { slug: string; route: Route }) {
  const { L, lang, dir } = useLang();
  const r = bySlug[slug];
  const now = useNow();
  const acc = useAccount();
  const { home } = useHome();
  const cart = useStore((s) => s.cart);
  const [bookOpen, setBookOpen] = useState(route.query.get("book") === "1");
  const [menuQ, setMenuQ] = useState("");
  const [activeSec, setActiveSec] = useState(0);
  const secRefs = useRef<(HTMLElement | null)[]>([]);
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  useEffect(() => {
    if (r) pushRecent(r.id);
  }, [r]);

  // highlight the menu tab of the section in view
  useEffect(() => {
    const els = secRefs.current.filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setActiveSec(Number((vis.target as HTMLElement).dataset.idx));
      },
      { rootMargin: "-140px 0px -60% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [r, menuQ]);

  const similar = useMemo(() => (r ? restaurants.filter((x) => x.id !== r.id && (x.cuisine === r.cuisine || x.area === r.area)).sort((a, b) => b.rating - a.rating).slice(0, 8) : []), [r]);

  if (!r) {
    return (
      <div className="wrap gutter grid min-h-[50vh] place-items-center text-center">
        <div>
          <p className="font-display text-3xl font-bold">{L("المكان ده مش موجود", "We couldn't find that place")}</p>
          <a href="#/explore" className="sf-btn sf-btn-primary mt-5">{L("استكشف المطاعم", "Explore restaurants")}</a>
        </div>
      </div>
    );
  }

  const st = openState(r.hours, now);
  const today = now.getDay();
  const km = haversineKm(home, r);
  const qn = norm(menuQ);
  const sections = r.menu
    .map((s, idx) => ({ ...s, idx, items: s.items.filter((i) => !qn || norm(`${i.ar} ${i.en} ${i.descAr} ${i.descEn}`).includes(qn)) }))
    .filter((s) => s.items.length);
  const qtyOf = (id: string) => (cart?.rid === r.id ? (cart.lines.find((l) => l.itemId === id)?.qty ?? 0) : 0);
  const cartHere = cart?.rid === r.id ? cart.lines : [];
  const cartSub = priceBreakdown({ lines: cartHere.map((l) => ({ unitPrice: egp(r.menu.flatMap((s) => s.items).find((i) => i.id === l.itemId)?.price ?? 0), qty: l.qty })), mode: "pickup", vatRate: 0 }).subtotal;
  const cartN = cartHere.reduce((a, l) => a + l.qty, 0);

  const add = (itemId: string, delta: number) => {
    if (delta > 0 && cart && cart.rid !== r.id && cart.lines.length) notify({ title: L("بدأنا سلة جديدة", "Started a new cart"), detail: L(`السلة القديمة اتشالت — الطلب يكون من مطعم واحد.`, "Your previous cart was cleared — one restaurant per order."), tone: "brass", icon: "bell" });
    cartAdd(r.id, itemId, delta);
  };

  const share = async () => {
    const url = shareUrl(`/r/${r.slug}`);
    try {
      if (navigator.share) {
        await navigator.share({ title: r[lang], text: r[lang === "ar" ? "descAr" : "descEn"], url });
        return;
      }
    } catch {
      /* fall back to copy */
    }
    const ok = await copyText(url);
    notify({ title: ok ? L("اللينك اتنسخ", "Link copied") : L("مقدرناش ننسخ", "Couldn't copy"), detail: url, ttl: 3500 });
  };

  const saveOffer = async (code: string, offerId: string) => {
    const ok = await copyText(code);
    if (acc) updateAccount((a) => (a.wallet.some((w) => w.offerId === offerId) ? a : { ...a, wallet: [{ offerId, rid: r.id, code, savedAt: Date.now() }, ...a.wallet] }));
    notify({ title: ok ? L(`الكود ${code} اتنسخ`, `Code ${code} copied`) : code, detail: acc ? L("واتحفظ في محفظة العروض.", "And saved to your offers wallet.") : undefined, tone: "brass", ttl: 3500 });
  };

  const slides = r.gallery.map((k, i) => ({ image: imgUrl(k) ?? undefined, title: r[lang], caption: i === 0 ? `${cuisineName(r.cuisine, lang)} · ${areaName(r.area, lang)}` : r[lang === "ar" ? "descAr" : "descEn"] }));
  const hour = now.getHours();
  const busyNow = r.busy[hour];
  const busyLabel = busyNow > 75 ? L("زحمة جدًا", "Very busy") : busyNow > 45 ? L("زحمة متوسطة", "Moderately busy") : L("هادي", "Not busy");
  const dishVideo = videoUrl(allVideos.find((v) => v.includes(r.cuisine)) ?? allVideos[0]);
  const bestDish = r.menu.flatMap((s) => s.items).find((i) => i.tags.includes("best")) ?? r.menu[0]?.items[0];
  const starDist = [5, 4, 3, 2, 1].map((n) => ({ n, c: r.reviews.filter((x) => x.stars === n).length }));
  const gmaps = `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`;

  return (
    <div className="pb-28">
      {/* gallery hero */}
      <div className="relative">
        <LensZoomCarousel
          slides={slides}
          height="min(68svh, 640px)"
          rtl={dir === "rtl"}
          ariaLabel={L(`صور ${r.ar}`, `Photos of ${r.en}`)}
          labels={{ prev: L("السابقة", "Previous"), next: L("التالية", "Next"), slide: L("صورة", "Photo"), of: L("من", "of") }}
          className="min-h-[420px] [&_.lz-nav]:!bottom-16 [&_.lz-text]:!bottom-[124px] [&_.lz-track]:!bottom-[86px] sm:[&_.lz-nav]:!bottom-20 sm:[&_.lz-track]:!bottom-[100px]"
        >
          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4" onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => (history.length > 1 ? history.back() : navigate("/explore"))} className="grid size-10 place-items-center rounded-full bg-card/90 text-foreground shadow backdrop-blur" aria-label={L("رجوع", "Back")}>
              <Back className="size-5" aria-hidden />
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={share} className="grid size-10 place-items-center rounded-full bg-card/90 text-foreground shadow backdrop-blur" aria-label={L("شارك", "Share")}>
                <Share2 className="size-[18px]" aria-hidden />
              </button>
              <FavButton r={r} />
            </div>
          </div>
        </LensZoomCarousel>
      </div>

      <div className="wrap gutter">
        {/* title block */}
        <div className="relative -mt-6 rounded-[28px] border bg-card p-5 shadow-sf sm:-mt-10 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">
                {cuisineName(r.cuisine, lang)} · {areaName(r.area, lang)} · {L(`من ${r.since}`, `since ${r.since}`)}
              </p>
              <h1 className="mt-1 text-[34px] font-bold leading-tight sm:text-[48px]">{r[lang]}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                <Ratings r={r} className="text-[15px]" />
                <span className="text-sm text-muted-foreground">
                  <span className="num">{r.ratingCount.toLocaleString("en-US")}</span> {L("تقييم", "reviews")}
                </span>
                <PriceLevel level={r.price} />
                <span className="text-sm text-muted-foreground">
                  ~<span className="num">{r.avg}</span> {L("ج.م للفرد", "EGP per person")}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <OpenBadge r={r} now={now} long />
                <span className="text-sm text-muted-foreground">
                  {L("النهارده", "Today")}: <span className="num">{fmtRange(r.hours[today], lang)}</span>
                </span>
              </div>
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <ShinyButton label={L("احجز ترابيزة", "Book a table")} size="md" onClick={() => setBookOpen(true)} className="flex-1 sm:flex-none">
                <CalendarPlus className="size-[18px]" aria-hidden />
                {L("احجز ترابيزة", "Book a table")}
              </ShinyButton>
              <a href="#menu" onClick={(e) => { e.preventDefault(); document.getElementById("menu")?.scrollIntoView({ behavior: "smooth" }); }} className="sf-btn sf-btn-ghost flex-1 bg-card sm:flex-none">
                <ShoppingBag className="size-[18px]" aria-hidden />
                {r.delivery ? L("اطلب دليفري أو تيك أواي", "Order delivery / pickup") : L("اطلب تيك أواي", "Order pickup")}
              </a>
              <button type="button" onClick={() => navigate(`/plan/new?r=${r.slug}`)} className="sf-btn sf-btn-ghost flex-1 bg-card sm:flex-none">
                <Users className="size-[18px]" aria-hidden />
                {L("خطّط مع صحابك", "Plan with friends")}
              </button>
            </div>
          </div>
          <nav className="no-scrollbar -mx-5 mt-5 flex gap-1 overflow-x-auto border-t px-5 pt-3 sm:mx-0 sm:px-0" aria-label={L("أقسام الصفحة", "Page sections")}>
            {[
              ["about", L("نظرة عامة", "Overview")],
              ["menu", L("المنيو", "Menu")],
              ["reviews", L("التقييمات", "Reviews")],
              ["location", L("المكان والمواعيد", "Location & hours")],
            ].map(([id, label]) => (
              <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); }} className="shrink-0 rounded-full px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                {label}
              </a>
            ))}
          </nav>
        </div>

        {/* overview */}
        <section id="about" className="mt-10 grid scroll-mt-24 gap-6 lg:grid-cols-[1.3fr_1fr]">
          <div className="grid content-start gap-6">
            <Reveal>
              <p className="font-display text-[22px] leading-relaxed sm:text-[26px]">{r[lang === "ar" ? "descAr" : "descEn"]}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {r.moods.map((m) => (
                  <a key={m} href={`#/explore?mood=${m}`} className="rounded-full bg-primary-soft px-3 py-1 text-[13px] font-medium text-primary">
                    {moodById[m][lang]}
                  </a>
                ))}
              </div>
            </Reveal>
            <Reveal>
              <h2 className="text-xl font-bold">{L("المميزات", "Amenities")}</h2>
              <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {r.amenities.map((a) => (
                  <li key={a} className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm">
                    <span className="size-1.5 rounded-full bg-brass" aria-hidden />
                    {amenityById[a][lang]}
                  </li>
                ))}
              </ul>
            </Reveal>
            {r.offers.length ? (
              <Reveal>
                <h2 className="text-xl font-bold">{L("العروض", "Offers")}</h2>
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {r.offers.map((o) => (
                    <li key={o.id} className="relative overflow-hidden rounded-2xl border border-brass/40 bg-brass-soft/60 p-4">
                      <span aria-hidden className="absolute -start-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-background" />
                      <span aria-hidden className="absolute -end-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-background" />
                      <p className="num text-2xl font-bold text-brass" dir="ltr">
                        {o.kind === "free-delivery" ? L("توصيل ببلاش", "Free delivery") : o.kind === "bogo" ? "1 + 1" : `−${o.value}%`}
                      </p>
                      <p className="font-semibold">{o[lang]}</p>
                      <p className="text-xs text-muted-foreground">
                        {o.days.length === 7 ? L("كل يوم", "Every day") : o.days.map((d) => (lang === "ar" ? DAYS_AR : DAYS_EN)[d].slice(0, lang === "ar" ? 6 : 3)).join(lang === "ar" ? "، " : ", ")} · {L(`باقي ${o.endsInDays} يوم`, `${o.endsInDays} days left`)}
                      </p>
                      <button type="button" onClick={() => saveOffer(o.code, o.id)} className="mt-3 inline-flex items-center gap-2 rounded-full border border-dashed border-brass bg-card px-3 py-1.5 text-sm font-semibold text-brass hover:bg-brass hover:text-brass-ink" aria-label={L(`انسخ الكود ${o.code}`, `Copy code ${o.code}`)}>
                        <span className="num">{o.code}</span>
                        <Copy className="size-3.5" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </Reveal>
            ) : null}
          </div>
          <Reveal>
            <div className="rounded-[24px] border bg-card p-5">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-xl font-bold">{L("أوقات الزحمة النهارده", "Popular times today")}</h2>
                <span className={cn("text-sm font-semibold", busyNow > 75 ? "text-danger" : busyNow > 45 ? "text-warn" : "text-ok")}>
                  {L("دلوقتي:", "Now:")} {busyLabel}
                </span>
              </div>
              <PopularTimes busy={r.busy} hour={hour} />
            </div>
          </Reveal>
        </section>

        {/* from the kitchen */}
        <section className="mt-16" aria-label={L("من المطبخ", "From the kitchen")}>
          <Reveal>
            <VoxelStoryVideoCard
              badgeText={L("من المطبخ", "From the kitchen")}
              badgeIcon={ChefHat}
              title={bestDish ? L(`${bestDish.ar}: الطبق اللي الناس بترجع عشانه`, `${bestDish.en}: the dish people come back for`) : r[lang]}
              description={L(`في ${r.ar} بيحضّروا كل حاجة طازة يوميًا من ${r.since}. ده اللي بيحصل ورا الباب.`, `At ${r.en} everything is made fresh daily since ${r.since}. Here's what happens behind the pass.`)}
              tags={[L("خامات طازة كل يوم", "Fresh produce daily"), L("مطبخ مفتوح", "Open kitchen"), L("مراجعة نظافة سُفرة", "Sufra hygiene check")]}
              videoSrc={dishVideo}
              posterSrc={imgUrl(bestDish?.img) ?? imgUrl(r.cover)}
              videoBadgeText={dishVideo ? L("لايف من المطبخ", "Live from the kitchen") : L("من المطبخ", "From the kitchen")}
              muteLabels={{ off: L("الصوت", "Audio"), on: L("شغّال", "Playing") }}
              fallback={<Photo k={r.cover} label={r[lang]} className="absolute inset-0" />}
            />
          </Reveal>
        </section>

        {/* menu */}
        <section id="menu" className="mt-16 scroll-mt-20" aria-labelledby="menu-title">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="menu-title" className="text-[30px] font-bold sm:text-[38px]">{L("المنيو", "Menu")}</h2>
              <p className="text-sm text-muted-foreground">{L("الأسعار قبل ضريبة القيمة المضافة 14٪ والخدمة.", "Prices exclude 14% VAT and service.")} {r.delivery ? L(`توصيل ${r.delivery.fee} ج.م · حوالي ${r.delivery.eta} دقيقة · أقل طلب ${r.delivery.min} ج.م`, `Delivery EGP ${r.delivery.fee} · ~${r.delivery.eta} min · min. order EGP ${r.delivery.min}`) : L("المطعم ده تيك أواي بس (مفيش توصيل).", "Pickup only (no delivery).")}</p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <label htmlFor="menu-q" className="sr-only">{L("دوّر في المنيو", "Search the menu")}</label>
              <input id="menu-q" type="search" value={menuQ} onChange={(e) => setMenuQ(e.target.value)} placeholder={L("دوّر في المنيو…", "Search the menu…")} className="sf-input h-11 rounded-full ps-10" />
            </div>
          </div>
          <nav className="no-scrollbar sticky top-16 z-20 -mx-4 mt-4 flex gap-2 overflow-x-auto border-b border-border/60 bg-background/90 px-4 py-3 backdrop-blur-xl md:-mx-8 md:px-8" aria-label={L("أقسام المنيو", "Menu sections")}>
            {sections.map((s) => (
              <button
                key={s.idx}
                type="button"
                aria-current={activeSec === s.idx ? "true" : undefined}
                onClick={() => secRefs.current[s.idx]?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className={cn("sf-chip h-9 shrink-0 text-[13px]", activeSec === s.idx && "!border-primary !bg-primary !text-primary-foreground")}
              >
                {s[lang]}
                <span className="num text-[11px] opacity-70">{s.items.length}</span>
              </button>
            ))}
          </nav>
          {!sections.length ? <p className="mt-6 rounded-2xl border border-dashed p-6 text-center text-muted-foreground">{L("مفيش أصناف بالاسم ده.", "No dishes match that.")}</p> : null}
          {sections.map((s) => (
            <section key={s.idx} ref={(el) => void (secRefs.current[s.idx] = el)} data-idx={s.idx} className="scroll-mt-36 pt-8" aria-labelledby={`sec-${s.idx}`}>
              <h3 id={`sec-${s.idx}`} className="text-2xl font-bold">{s[lang]}</h3>
              <ul className="mt-4 grid gap-3 md:grid-cols-2">
                {s.items.map((it) => {
                  const q = qtyOf(it.id);
                  return (
                    <li key={it.id} className="flex gap-3 rounded-2xl border bg-card p-3">
                      <Photo k={it.img} label={it[lang]} className="size-24 shrink-0 rounded-xl sm:size-28" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <p className="font-semibold leading-snug">{it[lang]}</p>
                        {(lang === "ar" ? it.descAr : it.descEn) ? <p className="line-clamp-2 text-[13px] text-muted-foreground">{lang === "ar" ? it.descAr : it.descEn}</p> : null}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {it.tags.map((t) => (
                            <span key={t} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", TAG_STYLE[t])}>
                              {t === "veg" ? <Leaf className="size-3" aria-hidden /> : t === "spicy" ? <Flame className="size-3" aria-hidden /> : t === "best" ? <Star className="size-3" aria-hidden /> : t === "new" ? <Sparkles className="size-3" aria-hidden /> : null}
                              {TAGS[t][lang]}
                            </span>
                          ))}
                          <span className="num rounded-full px-1.5 py-0.5 text-[11px] text-muted-foreground">{it.kcal} kcal</span>
                        </div>
                        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                          <span className="num font-semibold">{formatMoney(egp(it.price), lang)}</span>
                          {q === 0 ? (
                            <button type="button" onClick={() => add(it.id, 1)} className="inline-flex h-9 items-center gap-1 rounded-full bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:brightness-110" aria-label={L(`ضيف ${it.ar} للسلة`, `Add ${it.en} to cart`)}>
                              <Plus className="size-4" aria-hidden />
                              {L("ضيف", "Add")}
                            </button>
                          ) : (
                            <div className="flex items-center gap-1 rounded-full border bg-background p-0.5">
                              <button type="button" onClick={() => add(it.id, -1)} className="grid size-8 place-items-center rounded-full hover:bg-muted" aria-label={L(`قلل ${it.ar}`, `Remove one ${it.en}`)}>
                                <Minus className="size-4" aria-hidden />
                              </button>
                              <span className="num w-6 text-center font-semibold">{q}</span>
                              <button type="button" onClick={() => add(it.id, 1)} className="grid size-8 place-items-center rounded-full hover:bg-muted" aria-label={L(`زوّد ${it.ar}`, `Add one ${it.en}`)}>
                                <Plus className="size-4" aria-hidden />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </section>

        {/* reviews */}
        <section id="reviews" className="mt-16 scroll-mt-24" aria-labelledby="rev-title">
          <h2 id="rev-title" className="text-[30px] font-bold sm:text-[38px]">{L("التقييمات", "Reviews")}</h2>
          <div className="mt-5 grid gap-6 lg:grid-cols-[320px_1fr]">
            <div className="grid content-start gap-3">
              <div className="rounded-2xl border bg-card p-5">
                <p className="text-sm text-muted-foreground">{L("تقييم سُفرة", "Sufra score")}</p>
                <p className="num mt-1 text-5xl font-semibold">{r.rating.toFixed(1)}</p>
                <div className="mt-1 flex" aria-hidden>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} className={cn("size-4", i <= Math.round(r.rating) ? "fill-brass text-brass" : "text-border")} />
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground"><span className="num">{r.ratingCount.toLocaleString("en-US")}</span> {L("تقييم على سُفرة", "Sufra reviews")}</p>
                <ul className="mt-4 grid gap-1.5" aria-label={L("توزيع النجوم في آخر التقييمات", "Star distribution in recent reviews")}>
                  {starDist.map(({ n, c }) => (
                    <li key={n} className="flex items-center gap-2 text-xs">
                      <span className="num w-3">{n}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <span className="block h-full rounded-full bg-brass" style={{ width: `${(c / Math.max(1, r.reviews.length)) * 100}%` }} />
                      </span>
                      <span className="num w-4 text-muted-foreground">{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex items-center gap-4 rounded-2xl border bg-card p-5">
                <span className="grid size-12 place-items-center rounded-full border text-lg font-bold" aria-hidden>G</span>
                <div>
                  <p className="text-sm text-muted-foreground">{L("تقييم جوجل", "Google score")}</p>
                  <p className="num text-2xl font-semibold">{r.google.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">/ 5 · {r.googleCount.toLocaleString("en-US")}</span></p>
                </div>
              </div>
            </div>
            <ul className="grid content-start gap-3 sm:grid-cols-2">
              {r.reviews.map((rv, i) => (
                <li key={i} className="rounded-2xl border bg-card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{rv.name}</p>
                    <span className="flex" aria-label={L(`${rv.stars} من 5`, `${rv.stars} of 5`)}>
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star key={s} className={cn("size-3.5", s <= rv.stars ? "fill-brass text-brass" : "text-border")} aria-hidden />
                      ))}
                    </span>
                  </div>
                  <p className="mt-2 text-[15px]" lang="ar" dir="rtl">{rv.text}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{L(`من ${rv.daysAgo} يوم`, `${rv.daysAgo} days ago`)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* location & hours */}
        <section id="location" className="mt-16 scroll-mt-24" aria-labelledby="loc-title">
          <h2 id="loc-title" className="text-[30px] font-bold sm:text-[38px]">{L("المكان والمواعيد", "Location & hours")}</h2>
          <div className="mt-5 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <CairoMap points={[{ id: r.id, lat: r.lat, lng: r.lng, label: r[lang], tone: "open" }]} selectedId={r.id} home={home} center={{ lat: r.lat, lng: r.lng }} className="h-[340px]" />
              <div className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-2xl border bg-card p-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold">
                    <MapPin className="size-4 shrink-0 text-brass" aria-hidden />
                    {lang === "ar" ? r.addressAr : r.addressEn}
                  </p>
                  <Distance r={r} className="mt-1" />
                  <p className="mt-1 text-xs text-muted-foreground">{km < 2 ? L("قريب كفاية تتمشى.", "Close enough to walk.") : L("الوقت بالعربية تقديري حسب زحمة القاهرة.", "Car time is an estimate for Cairo traffic.")}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={gmaps} target="_blank" rel="noopener noreferrer" className="sf-btn sf-btn-primary sf-btn-sm">
                    <ExternalLink className="size-4" aria-hidden />
                    {L("افتح في خرائط جوجل", "Open in Google Maps")}
                  </a>
                  <a href={`tel:${r.phone}`} className="sf-btn sf-btn-ghost sf-btn-sm bg-card">
                    <Phone className="size-4" aria-hidden />
                    <span className="num" dir="ltr">{r.phone}</span>
                  </a>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border bg-card p-5">
              <h3 className="text-lg font-bold">{L("مواعيد الأسبوع", "Opening hours")}</h3>
              <table className="mt-3 w-full text-sm">
                <caption className="sr-only">{L("مواعيد الأسبوع", "Weekly hours")}</caption>
                <tbody>
                  {[6, 0, 1, 2, 3, 4, 5].map((d) => (
                    <tr key={d} className={cn("border-b last:border-0", d === today && "font-semibold text-primary")}>
                      <th scope="row" className="py-2.5 text-start font-medium">
                        {(lang === "ar" ? DAYS_AR : DAYS_EN)[d]}
                        {d === today ? <span className="ms-2 rounded-full bg-primary-soft px-2 py-0.5 text-[11px]">{L("النهارده", "Today")}</span> : null}
                      </th>
                      <td className="num py-2.5 text-end">{fmtRange(r.hours[d], lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted-foreground">{st.open ? L("مفتوح دلوقتي.", "Open now.") : L("مقفول دلوقتي.", "Closed now.")} {r.instagram}</p>
            </div>
          </div>
        </section>

        {/* similar */}
        <section className="mt-16" aria-labelledby="sim-title">
          <h2 id="sim-title" className="text-[26px] font-bold">{L("أماكن شبهه", "Similar places")}</h2>
          <div className="scroll-row -mx-4 mt-4 px-4 md:-mx-8 md:px-8">
            {similar.map((x) => (
              <RestaurantCard key={x.id} r={x} now={now} layout="rail" />
            ))}
          </div>
        </section>
      </div>

      {/* floating cart bar */}
      <AnimatePresence>
        {cartN > 0 ? (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} className="fixed inset-x-0 bottom-[76px] z-30 px-4 md:bottom-6">
            <button type="button" onClick={() => setUI({ cartOpen: true })} className="mx-auto flex w-full max-w-lg items-center gap-3 rounded-full bg-primary py-2 pe-5 ps-2 text-primary-foreground shadow-2xl">
              <span className="num grid size-10 place-items-center rounded-full bg-brass font-bold text-brass-ink">{cartN}</span>
              <span className="flex-1 text-start font-semibold">{L("شوف السلة", "View cart")}</span>
              <span className="num font-semibold">{formatMoney(cartSub, lang)}</span>
              <Wallet className="size-4 opacity-70" aria-hidden />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <BookingDialog r={r} open={bookOpen} onClose={() => setBookOpen(false)} />
      <span className="sr-only">{L(`نسبة الخدمة في المطعم ده ${Math.round(serviceRateOf(r) * 100)}٪`, `Service charge here: ${Math.round(serviceRateOf(r) * 100)}%`)}</span>
    </div>
  );
}

function PopularTimes({ busy, hour }: { busy: number[]; hour: number }) {
  const { L, lang } = useLang();
  const hours = Array.from({ length: 20 }, (_, i) => (6 + i) % 24); // 6 AM → 1 AM
  const label = (h: number) => (lang === "ar" ? `${h % 12 || 12}${h < 12 ? "ص" : "م"}` : `${h % 12 || 12}${h < 12 ? "a" : "p"}`);
  const peak = hours.reduce((m, h) => (busy[h] > busy[m] ? h : m), hours[0]);
  return (
    <figure className="mt-4">
      <div className="flex h-40 items-end gap-[3px]" role="img" aria-label={L(`أوقات الزحمة: الذروة حوالي ${label(peak)}، ودلوقتي ${busy[hour]}٪`, `Popular times: peak around ${label(peak)}; now ${busy[hour]}%`)} dir="ltr">
        {hours.map((h) => (
          <div key={h} className="group relative flex h-full flex-1 flex-col justify-end">
            <div
              className={cn("w-full rounded-t-[4px] transition-colors", h === hour ? "bg-brass" : "bg-primary/55 group-hover:bg-primary")}
              style={{ height: `${Math.max(3, busy[h])}%` }}
            />
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] text-background group-hover:block">
              <span className="num">{label(h)} · {busy[h]}%</span>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground" dir="ltr" aria-hidden>
        {hours.filter((_, i) => i % 3 === 0).map((h) => (
          <span key={h} className="num">{label(h)}</span>
        ))}
      </div>
      <figcaption className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><i className="size-2 rounded-sm bg-brass" aria-hidden />{L("دلوقتي", "Now")}</span>
        <span>{L("مبني على زيارات مستخدمين سُفرة في الأسابيع اللي فاتت.", "Based on Sufra visits over recent weeks.")}</span>
      </figcaption>
    </figure>
  );
}

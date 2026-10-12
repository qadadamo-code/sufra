import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, MapPin, Search, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { TiltedGridHero } from "@/components/ui/tilted-grid-hero";
import MorphOrb, { type Phase } from "@/components/ui/morph-orb";
import { PolaroidLineCarousel } from "@/components/ui/polaroid-line-carousel";
import { ShinyButton } from "@/components/ui/shiny-button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { BigTitle, ParallaxStrip, Reveal } from "@/components/sufra/Reveal";
import { OpenBadge, RestaurantCard, SectionHead } from "@/components/sufra/bits";
import { Photo } from "@/components/sufra/Photo";
import { areaName, areas, cuisineName, cuisines, GROUPS, MOODS, restaurants, type CuisineGroup, type Mood, type Restaurant } from "@/lib/data";
import { haversineKm } from "@/lib/geo";
import { isOpenNow } from "@/lib/hours";
import { useMediaQuery, useNow } from "@/lib/hooks";
import { useLang } from "@/lib/i18n";
import { allImages, imgUrl } from "@/lib/media";
import { personalScore, recommend, type Answer } from "@/lib/recommend";
import { navigate } from "@/lib/router";
import { setGuestArea, useAccount, useHome, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

function Rail({ title, kicker, items, now, more, empty }: { title: string; kicker?: string; items: Restaurant[]; now: Date; more?: string; empty?: string }) {
  const { L, dir } = useLang();
  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;
  return (
    <section className="wrap gutter mt-16 sm:mt-24">
      <Reveal>
        <SectionHead
          kicker={kicker}
          title={title}
          action={
            more ? (
              <a href={more} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary hover:underline">
                {L("شوف الكل", "See all")}
                <Arrow className="size-4" aria-hidden />
              </a>
            ) : null
          }
        />
      </Reveal>
      {items.length ? (
        <div className="scroll-row -mx-4 px-4 md:-mx-8 md:px-8">
          {items.map((r, i) => (
            <Reveal key={r.id} delay={Math.min(i, 5) * 0.05} y={18}>
              <RestaurantCard r={r} now={now} layout="rail" />
            </Reveal>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed p-6 text-center text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

export default function Home() {
  const { L, lang, dir } = useLang();
  const now = useNow();
  const acc = useAccount();
  const { home, areaId, isUser } = useHome();
  const guestArea = useStore((s) => s.guestArea);
  const [q, setQ] = useState("");
  const [mood, setMood] = useState<Mood>("work");
  const [group, setGroup] = useState<CuisineGroup>("eastern");
  const [cuisine, setCuisine] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seed, setSeed] = useState<{ text: string; n: number } | undefined>();
  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;
  const narrow = useMediaQuery("(max-width: 640px)");
  // "مقترح ليك" is computed locally; a short visible step makes the personalisation legible.
  const [suggestProgress, setSuggestProgress] = useState(0);
  const suggestReady = suggestProgress >= 100;
  useEffect(() => {
    if (suggestReady) return;
    const id = window.setTimeout(() => setSuggestProgress((p) => Math.min(100, p + 34)), 260);
    return () => window.clearTimeout(id);
  }, [suggestProgress, suggestReady]);

  const heroImages = useMemo(() => {
    const dishes = allImages.filter((k) => k.startsWith("dish-"));
    const venues = allImages.filter((k) => k.startsWith("venue-"));
    const out: { src: string; alt: string }[] = [];
    for (let i = 0; i < Math.max(dishes.length, venues.length) && out.length < 28; i++) {
      if (venues[i]) out.push({ src: imgUrl(venues[i])!, alt: "" });
      if (dishes[i]) out.push({ src: imgUrl(dishes[i])!, alt: "" });
    }
    return out;
  }, []);

  const withKm = useMemo(() => restaurants.map((r) => ({ r, km: haversineKm(home, r) })), [home]);
  const openNow = useMemo(() => withKm.filter((x) => isOpenNow(x.r, now)).sort((a, b) => a.km - b.km).slice(0, 12).map((x) => x.r), [withKm, now]);
  const nearest = useMemo(() => [...withKm].sort((a, b) => a.km - b.km).slice(0, 12).map((x) => x.r), [withKm]);
  const visited = useMemo(() => [...restaurants].sort((a, b) => b.visits - a.visits).slice(0, 12), []);
  const google = useMemo(() => [...restaurants].sort((a, b) => b.google - a.google || b.googleCount - a.googleCount).slice(0, 12), []);
  const sufra = useMemo(() => [...restaurants].sort((a, b) => b.rating - a.rating || b.ratingCount - a.ratingCount).slice(0, 12), []);
  const offers = useMemo(() => restaurants.filter((r) => r.offers.length).sort((a, b) => b.offers[0].value - a.offers[0].value).slice(0, 12), []);
  const fresh = useMemo(() => restaurants.filter((r) => r.isNew), []);
  const forMood = useMemo(() => withKm.filter((x) => x.r.moods.includes(mood)).sort((a, b) => b.r.rating - a.r.rating - (a.km - b.km) * 0.05).slice(0, 12).map((x) => x.r), [withKm, mood]);
  const groupCuisines = useMemo(() => Object.entries(cuisines).filter(([, c]) => c.group === group).map(([id]) => id), [group]);
  const forCuisine = useMemo(() => {
    const ids = cuisine ? [cuisine] : groupCuisines;
    return restaurants.filter((r) => ids.includes(r.cuisine)).sort((a, b) => b.rating - a.rating).slice(0, 12);
  }, [cuisine, groupCuisines]);
  const suggested = useMemo(() => {
    if (!acc) return [];
    const favCuisines = [...acc.favourites, ...acc.orders.map((o) => o.rid)].map((id) => restaurants.find((r) => r.id === id)?.cuisine).filter(Boolean) as string[];
    const ctx = { home, likedMoods: acc.profile.moods, favCuisines, favourites: acc.favourites };
    return [...restaurants].sort((a, b) => personalScore(b, ctx) - personalScore(a, ctx)).slice(0, 12);
  }, [acc, home]);
  const picks = useMemo(() => {
    const ids = ["r003", "r008", "r012", "r021", "r030", "r042", "r055", "r067", "r079", "r090"];
    return ids.map((id) => restaurants.find((r) => r.id === id)).filter(Boolean) as Restaurant[];
  }, []);

  const examples = [
    L("كافيه هادي فيه واي فاي في الزمالك أشتغل منه", "A quiet café with Wi-Fi in Zamalek to work from"),
    L("خروجة مع صحابي في التجمع، حاجة مش غالية", "Night out with friends in New Cairo, not pricey"),
    L("عشا رومانسي على النيل", "Romantic dinner on the Nile"),
    L("فطار مصري مفتوح دلوقتي قريب مني", "Egyptian breakfast open now near me"),
  ];

  const onAsk = (text: string) => {
    const a = recommend(text, { home, lang, now: new Date(), favourites: acc?.favourites, likedMoods: acc?.profile.moods });
    setAnswer(a);
    return a.text;
  };

  return (
    <div>
      {/* ───────── hero ───────── */}
      <TiltedGridHero images={heroImages} className="h-[min(74svh,640px)] min-h-[540px] border-b sm:h-[min(82svh,860px)] sm:min-h-[600px]" aspectRatio={narrow ? 1.15 : 16 / 9} tileHeight={narrow ? 32 : 26} axis={narrow ? 52 : 54} curve={narrow ? 60 : 70} speed={4.5}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_55%_at_50%_54%,transparent_55%,var(--background)_100%)]" aria-hidden />
        <div className="absolute inset-x-0 top-0 z-10 px-4 pt-10 text-center sm:pt-14">
          <p className="sf-kicker">{L("اكتشف · احجز · اطلب — في القاهرة", "Discover · book · order — in Cairo")}</p>
          <h1 className="mx-auto mt-3 max-w-4xl font-display text-[40px] font-bold leading-[1.1] sm:text-[72px]">
            {L("القاهرة كلها", "All of Cairo,")} <span className="text-primary">{L("على سُفرة واحدة", "on one table")}</span>
          </h1>
        </div>
        <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-8 sm:pb-12">
          <form
            role="search"
            className="mx-auto flex w-full max-w-2xl items-center gap-2 rounded-full border bg-card/95 p-2 shadow-sf backdrop-blur"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/explore${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
            }}
          >
            <Search className="ms-3 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <label htmlFor="hero-q" className="sr-only">
              {L("دوّر على مطعم أو أكلة أو منطقة", "Search a restaurant, dish or area")}
            </label>
            <input id="hero-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("مطعم، أكلة، أو منطقة…", "Restaurant, dish or area…")} className="h-12 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground" />
            <button type="submit" className="sf-btn sf-btn-primary h-12 shrink-0 px-5 sm:px-7">
              {L("دوّر", "Search")}
            </button>
          </form>
          <div className="mx-auto mt-3 flex max-w-2xl items-center justify-center gap-2 text-sm text-muted-foreground">
            <MapPin className="size-4 text-brass" aria-hidden />
            {isUser ? (
              <span>
                {L("المسافات من بيتك في", "Distances from your home in")} <a href="#/account?tab=profile" className="font-semibold text-foreground underline-offset-4 hover:underline">{areaName(areaId, lang)}</a>
              </span>
            ) : (
              <label className="inline-flex items-center gap-2">
                {L("أنا في", "I'm in")}
                <select value={guestArea} onChange={(e) => setGuestArea(e.target.value)} className="rounded-full border bg-card px-3 py-1 font-semibold text-foreground">
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a[lang]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
      </TiltedGridHero>

      {/* ───────── ask sufra ───────── */}
      <section className="relative mt-14 overflow-hidden sm:mt-20" aria-labelledby="ask-title">
        <div className="wrap gutter text-center">
          <Reveal>
            <p className="sf-kicker inline-flex items-center gap-1.5">
              <Sparkles className="size-3.5" aria-hidden />
              {L("الكونسيرج بتاعك", "Your concierge")}
            </p>
            <h2 id="ask-title" className="mt-2 text-[34px] font-bold sm:text-[52px]">
              {L("اسأل سُفرة", "Ask Sufra")}
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-muted-foreground">{L("قول اللي في دماغك بالمصري: المنطقة، المزاج، الميزانية… وأنا أرشحلك.", "Say what you're after — area, mood, budget — and get picks with reasons.")}</p>
          </Reveal>
        </div>
        <MorphOrb
          onSubmit={onAsk}
          minThinkMs={1900}
          onPhase={(p) => {
            setPhase(p);
            if (p === "reset") setAnswer(null);
          }}
          seed={seed}
          copy={{
            placeholder: L("مثلًا: كافيه هادي في الزمالك للشغل…", "e.g. a quiet café in Zamalek to work…"),
            labels: L("بفكّر|بدوّر|بقارن|بكتب", "Thinking|Searching|Comparing|Writing").split("|"),
            done: L("خلصت", "Done"),
            answerTitle: L("ترشيحات سُفرة", "Sufra's picks"),
            reset: L("سؤال جديد", "New question"),
            send: L("ابعت", "Send"),
            ready: L("الترشيحات جاهزة: ", "Picks ready: "),
          }}
        />
        <div className="wrap gutter">
          {phase === "idle" ? (
            <div className="mx-auto -mt-2 flex max-w-3xl flex-wrap justify-center gap-2">
              {examples.map((ex, i) => (
                <button key={i} type="button" className="sf-chip h-auto py-1.5 text-[13px] whitespace-normal text-start" onClick={() => setSeed({ text: ex, n: Date.now() })}>
                  {ex}
                </button>
              ))}
            </div>
          ) : null}
          <AnimatePresence>
            {answer && (phase === "answered" || phase === "unfold") ? (
              <motion.ul className="mx-auto mt-6 grid max-w-5xl gap-3 md:grid-cols-3" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.5, delay: 0.3 }}>
                {answer.picks.map((p, i) => (
                  <li key={p.r.id}>
                    <a href={`#/r/${p.r.slug}`} className="flex h-full gap-3 rounded-2xl border bg-card p-3 transition-shadow hover:shadow-sf">
                      <Photo k={p.r.cover} label={p.r[lang]} className="size-20 shrink-0 rounded-xl" />
                      <div className="min-w-0">
                        <p className="num text-xs text-brass">0{i + 1}</p>
                        <p className="truncate font-display text-lg font-semibold">{p.r[lang]}</p>
                        <p className="text-xs text-muted-foreground">
                          {cuisineName(p.r.cuisine, lang)} · {areaName(p.r.area, lang)}
                        </p>
                        <ul className="mt-1.5 grid gap-0.5 text-[13px]">
                          {p.reasons.slice(0, 3).map((why) => (
                            <li key={why} className="flex gap-1.5">
                              <span className="mt-[9px] size-1 shrink-0 rounded-full bg-brass" aria-hidden />
                              <span>{why}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </a>
                  </li>
                ))}
              </motion.ul>
            ) : null}
          </AnimatePresence>
        </div>
      </section>

      {/* ───────── moods ───────── */}
      <section className="wrap gutter mt-20 sm:mt-28" aria-labelledby="mood-title">
        <Reveal>
          <p className="sf-kicker">{L("على حسب المزاج", "By mood")}</p>
          <BigTitle text={L("إيه المزاج النهارده؟", "What's the mood today?")} className="mt-1 text-[38px] font-bold leading-tight sm:text-[64px]" />
        </Reveal>
        <div className="no-scrollbar -mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" role="group" aria-labelledby="mood-title">
          {MOODS.map((m) => (
            <button key={m.id} type="button" aria-pressed={mood === m.id} onClick={() => setMood(m.id)} className="sf-chip h-11 shrink-0 px-4 text-[15px]">
              {m[lang]}
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {lang === "ar" ? MOODS.find((m) => m.id === mood)!.hintAr : MOODS.find((m) => m.id === mood)!.hintEn} ·{" "}
          <a className="font-semibold text-primary hover:underline" href={`#/explore?mood=${mood}`}>
            {L("كل الأماكن", "All places")}
          </a>
        </p>
        <div className="scroll-row -mx-4 mt-5 px-4 md:-mx-8 md:px-8">
          {forMood.map((r) => (
            <RestaurantCard key={r.id} r={r} now={now} layout="rail" />
          ))}
        </div>
      </section>

      <Rail kicker={L("دلوقتي حالًا", "Right now")} title={L("مفتوح دلوقتي", "Open now")} items={openNow} now={now} more="#/explore?open=1&sort=distance" empty={L("كل حاجة مقفولة دلوقتي — ارجع الصبح!", "Everything's closed right now — check back in the morning!")} />
      <Rail kicker={L("على بعد خطوات", "Steps away")} title={L("الأقرب ليك", "Closest to you")} items={nearest} now={now} more="#/explore?sort=distance" />

      {/* parallax strip */}
      <section className="mt-24 sm:mt-32" aria-hidden>
        <div className="wrap gutter">
          <p className="max-w-5xl font-display text-[44px] font-bold leading-[1.05] sm:text-[88px]">
            {L("من الكشري", "From koshari")} <span className="text-brass">{L("للسوشي،", "to sushi,")}</span> {L("ومن الفطار للسهر.", "from breakfast to late.")}
          </p>
        </div>
        <ParallaxStrip className="mt-8" distance={180}>
          {allImages.filter((k) => k.startsWith("dish-")).slice(0, 12).map((k) => (
            <img key={k} src={imgUrl(k)!} alt="" loading="lazy" className="h-40 w-56 rounded-2xl object-cover sm:h-56 sm:w-80" />
          ))}
        </ParallaxStrip>
        <ParallaxStrip className="mt-3" distance={-180}>
          {allImages.filter((k) => k.startsWith("venue-")).slice(0, 12).map((k) => (
            <img key={k} src={imgUrl(k)!} alt="" loading="lazy" className="h-40 w-56 rounded-2xl object-cover sm:h-56 sm:w-80" />
          ))}
        </ParallaxStrip>
      </section>

      <Rail kicker={L("الناس رايحة فين", "Where people go")} title={L("الأكثر زيارة", "Most visited")} items={visited} now={now} more="#/explore?sort=visits" />
      <Rail kicker="Google" title={L("الأعلى تقييمًا على جوجل", "Top rated on Google")} items={google} now={now} more="#/explore?sort=google" />
      <Rail kicker={L("رأي مستخدمين سُفرة", "Sufra diners say")} title={L("الأعلى تقييمًا على سُفرة", "Top rated on Sufra")} items={sufra} now={now} more="#/explore?sort=rating" />
      {acc && !suggestReady ? (
        <section className="wrap gutter mt-16 sm:mt-24">
          <SectionHead kicker={L("من ذوقك ومفضلتك", "From your taste")} title={L("مقترح ليك", "Suggested for you")} />
          <div className="max-w-md">
            <ProgressBar value={suggestProgress} label={L("بنجهزلك الترشيحات من تاريخك ومزاجك", "Tailoring picks from your history and moods")} pendingLabel={L("لحظة", "One sec")} completeLabel={L("جاهز", "Ready")} />
          </div>
        </section>
      ) : acc ? (
        <Rail kicker={L("من ذوقك ومفضلتك", "From your taste")} title={L("مقترح ليك", "Suggested for you")} items={suggested} now={now} more="#/explore?sort=foryou" />
      ) : (
        <section className="wrap gutter mt-16 sm:mt-24">
          <div className="sf-card flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
            <div className="flex-1">
              <h2 className="text-2xl font-bold">{L("مقترح ليك", "Suggested for you")}</h2>
              <p className="text-muted-foreground">{L("سجّل برقم موبايلك ونرشحلك على حسب مزاجك ومفضلتك.", "Sign in with your mobile and we'll tailor picks to your moods and favourites.")}</p>
            </div>
            <ShinyButton label={L("سجّل دخول", "Sign in")} size="md" onClick={() => navigate("/account")} />
          </div>
        </section>
      )}

      {/* offers */}
      <section className="mt-16 bg-brass-soft/60 py-14 sm:mt-24 sm:py-20">
        <div className="wrap gutter">
          <Reveal>
            <SectionHead kicker={L("وفّر", "Save")} title={L("عروض وخصومات", "Offers & deals")} action={<a href="#/explore?offer=1" className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary hover:underline">{L("شوف الكل", "See all")}<Arrow className="size-4" aria-hidden /></a>} />
          </Reveal>
          <div className="scroll-row -mx-4 px-4 md:-mx-8 md:px-8">
            {offers.map((r) => (
              <a key={r.id} href={`#/r/${r.slug}`} className="w-[78vw] max-w-[320px] overflow-hidden rounded-[22px] border border-brass/30 bg-card transition-shadow hover:shadow-sf sm:w-[300px]">
                <div className="relative">
                  <Photo k={r.cover} label={r[lang]} className="aspect-[16/9]" />
                  <span className="num absolute start-3 top-3 rounded-full bg-brass px-3 py-1 text-sm font-bold text-brass-ink" dir="ltr">
                    {r.offers[0].kind === "free-delivery" ? L("توصيل ببلاش", "Free delivery") : r.offers[0].kind === "bogo" ? "1+1" : `−${r.offers[0].value}%`}
                  </span>
                </div>
                <div className="p-4">
                  <p className="font-display text-lg font-semibold">{r[lang]}</p>
                  <p className="text-sm text-muted-foreground">{r.offers[0][lang]}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <OpenBadge r={r} now={now} />
                    <span className="num rounded-md border border-dashed border-brass/60 px-2 py-0.5 text-xs text-brass">{r.offers[0].code}</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* cuisines */}
      <section className="wrap gutter mt-16 sm:mt-24" aria-labelledby="cui-title">
        <Reveal>
          <p className="sf-kicker">{L("على حسب الأكل", "By cuisine")}</p>
          <h2 id="cui-title" className="text-[30px] font-bold sm:text-[40px]">
            {L("شرقي ولا غربي؟", "Eastern or Western?")}
          </h2>
        </Reveal>
        <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label={L("مجموعة المطبخ", "Cuisine group")}>
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              aria-pressed={group === g.id}
              onClick={() => {
                setGroup(g.id);
                setCuisine(null);
              }}
              className="sf-chip h-11 px-5 text-[15px]"
            >
              {g[lang]}
            </button>
          ))}
        </div>
        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0" role="group" aria-label={L("المطبخ", "Cuisine")}>
          <button type="button" aria-pressed={cuisine === null} onClick={() => setCuisine(null)} className={cn("sf-chip shrink-0 border-dashed", cuisine === null && "!border-brass !bg-brass !text-brass-ink")}>
            {L("الكل", "All")}
          </button>
          {groupCuisines.map((c) => (
            <button key={c} type="button" aria-pressed={cuisine === c} onClick={() => setCuisine(c)} className={cn("sf-chip shrink-0", cuisine === c && "!border-brass !bg-brass !text-brass-ink")}>
              {cuisineName(c, lang)}
            </button>
          ))}
        </div>
        <div className="scroll-row -mx-4 mt-5 px-4 md:-mx-8 md:px-8">
          {forCuisine.map((r) => (
            <RestaurantCard key={r.id} r={r} now={now} layout="rail" />
          ))}
        </div>
        <a href={`#/explore?${cuisine ? `cuisine=${cuisine}` : `group=${group}`}`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
          {L("كل المطاعم دي", "All of these")}
          <Arrow className="size-4" aria-hidden />
        </a>
      </section>

      <Rail kicker={L("لسه فاتحين", "Just opened")} title={L("جديد في سُفرة", "New on Sufra")} items={fresh} now={now} more="#/explore?new=1" />

      {/* editor's picks */}
      <section className="mt-20 sm:mt-28" aria-labelledby="picks-title">
        <div className="wrap gutter">
          <Reveal>
            <p className="sf-kicker">{L("مختارة بإيد فريقنا", "Hand-picked by our team")}</p>
            <h2 id="picks-title" className="text-[30px] font-bold sm:text-[40px]">
              {L("اختيارات سُفرة", "Sufra's picks")}
            </h2>
            <p className="mt-1 text-muted-foreground">{L("اسحب الخيط أو استخدم الأسهم — دوس على الصورة اللي في النص تفتح المكان.", "Drag the line or use the arrows — tap the centre print to open it.")}</p>
          </Reveal>
        </div>
        <PolaroidLineCarousel
          slides={picks.map((r) => ({ image: imgUrl(r.cover) ?? undefined, title: r[lang], caption: `${cuisineName(r.cuisine, lang)} · ${areaName(r.area, lang)} — ${r[lang === "ar" ? "descAr" : "descEn"]}` }))}
          height="min(620px, 92svh)"
          cardWidth={280}
          rtl={dir === "rtl"}
          string="var(--sf-brass)"
          background="transparent"
          ink="var(--foreground)"
          ariaLabel={L("اختيارات سُفرة", "Sufra's picks")}
          labels={{ prev: L("السابق", "Previous"), next: L("التالي", "Next"), print: L("صورة", "Print"), of: L("من", "of") }}
          onOpen={(i) => navigate(`/r/${picks[i].slug}`)}
        />
      </section>

      {/* closing CTA */}
      <section className="wrap gutter mt-16">
        <div className="relative overflow-hidden rounded-[32px] bg-primary px-6 py-12 text-primary-foreground sm:px-12 sm:py-16">
          <div aria-hidden className="absolute -end-16 -top-16 size-72 rounded-full border-[18px] border-brass/40" />
          <div aria-hidden className="absolute -end-2 top-6 size-40 rounded-full bg-brass/30" />
          <div className="relative max-w-2xl">
            <h2 className="text-[34px] font-bold leading-tight sm:text-[52px]">{L("الخروجة الجاية عليك… والتخطيط علينا", "You bring the friends, we'll plan the night")}</h2>
            <p className="mt-3 text-primary-foreground/80">{L("اعمل أوضة تخطيط، رشّح 3 أماكن، وصحابك يصوتوا. اللي يكسب نحجزله.", "Open a planning room, shortlist 3 places, let friends vote. We book the winner.")}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <ShinyButton label={L("خروجة مع الأصحاب", "Plan with friends")} fillColor="var(--sf-brass)" labelColor="var(--sf-brass-ink)" accentColor="#ffffff" accentSoftColor="#fff3d6" onClick={() => navigate("/plan/new")} />
              <a href="#/explore" className="sf-btn border-white/30 text-primary-foreground hover:bg-white/10">{L("استكشف المطاعم", "Explore restaurants")}</a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

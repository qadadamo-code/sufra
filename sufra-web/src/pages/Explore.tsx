import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, List, Map as MapIcon, Search, SlidersHorizontal, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CairoMap, type MapPoint } from "@/components/sufra/CairoMap";
import { RestaurantCard } from "@/components/sufra/bits";
import { AMENITIES, areaName, areas, cuisineName, cuisines, GROUPS, MOODS, restaurants, type Amenity, type CuisineGroup, type Mood, type Restaurant } from "@/lib/data";
import { haversineKm } from "@/lib/geo";
import { DAY_PARTS, isOpenNow, openDuring, type DayPart } from "@/lib/hours";
import { useNow } from "@/lib/hooks";
import { useLang } from "@/lib/i18n";
import { norm, personalScore } from "@/lib/recommend";
import type { Route } from "@/lib/router";
import { useAccount, useHome } from "@/lib/store";
import { cn } from "@/lib/utils";

type Sort = "distance" | "visits" | "foryou" | "google" | "rating" | "price-asc" | "price-desc";
type ViewMode = "grid" | "list" | "map";
interface F {
  q: string;
  group: CuisineGroup | "";
  cuisine: string;
  areas: string[];
  prices: number[];
  open: boolean;
  part: DayPart | "";
  mood: Mood | "";
  amenities: Amenity[];
  minRating: number;
  offer: boolean;
  delivery: boolean;
  reservations: boolean;
  isNew: boolean;
  maxKm: number;
}
const EMPTY: F = { q: "", group: "", cuisine: "", areas: [], prices: [], open: false, part: "", mood: "", amenities: [], minRating: 0, offer: false, delivery: false, reservations: false, isNew: false, maxKm: 0 };

function fromQuery(q: URLSearchParams): { f: F; sort: Sort; view: ViewMode } {
  const list = (k: string) => (q.get(k) ? q.get(k)!.split(",").filter(Boolean) : []);
  return {
    f: {
      ...EMPTY,
      q: q.get("q") ?? "",
      group: (q.get("group") as CuisineGroup) ?? "",
      cuisine: q.get("cuisine") ?? "",
      areas: list("area"),
      prices: list("price").map(Number),
      open: q.get("open") === "1",
      part: (q.get("part") as DayPart) ?? "",
      mood: (q.get("mood") as Mood) ?? "",
      amenities: list("am") as Amenity[],
      minRating: Number(q.get("rating") ?? 0),
      offer: q.get("offer") === "1",
      delivery: q.get("delivery") === "1",
      reservations: q.get("res") === "1",
      isNew: q.get("new") === "1",
      maxKm: Number(q.get("km") ?? 0),
    },
    sort: (q.get("sort") as Sort) || "distance",
    view: (q.get("view") as ViewMode) || "grid",
  };
}
function toQuery(f: F, sort: Sort, view: ViewMode) {
  const q = new URLSearchParams();
  if (f.q) q.set("q", f.q);
  if (f.group) q.set("group", f.group);
  if (f.cuisine) q.set("cuisine", f.cuisine);
  if (f.areas.length) q.set("area", f.areas.join(","));
  if (f.prices.length) q.set("price", f.prices.join(","));
  if (f.open) q.set("open", "1");
  if (f.part) q.set("part", f.part);
  if (f.mood) q.set("mood", f.mood);
  if (f.amenities.length) q.set("am", f.amenities.join(","));
  if (f.minRating) q.set("rating", String(f.minRating));
  if (f.offer) q.set("offer", "1");
  if (f.delivery) q.set("delivery", "1");
  if (f.reservations) q.set("res", "1");
  if (f.isNew) q.set("new", "1");
  if (f.maxKm) q.set("km", String(f.maxKm));
  if (sort !== "distance") q.set("sort", sort);
  if (view !== "grid") q.set("view", view);
  return q.toString();
}

const searchable = new Map(restaurants.map((r) => [r.id, norm([r.ar, r.en, cuisines[r.cuisine]?.ar, cuisines[r.cuisine]?.en, areaName(r.area, "ar"), areaName(r.area, "en"), ...r.menu.flatMap((s) => s.items.flatMap((i) => [i.ar, i.en]))].join(" "))]));

export default function Explore({ route }: { route: Route }) {
  const { L, lang } = useLang();
  const now = useNow();
  const acc = useAccount();
  const { home } = useHome();
  const reduced = useReducedMotion();
  const init = useMemo(() => fromQuery(route.query), [route.query]);
  const [f, setF] = useState<F>(init.f);
  const [sort, setSort] = useState<Sort>(init.sort);
  const [view, setView] = useState<ViewMode>(init.view);
  const [sheet, setSheet] = useState(false);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    const qs = toQuery(f, sort, view);
    try {
      window.history.replaceState(null, "", `#/explore${qs ? "?" + qs : ""}`);
    } catch {
      /* ignore */
    }
  }, [f, sort, view]);

  const set = <K extends keyof F>(k: K, v: F[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggle = <K extends "areas" | "prices" | "amenities">(k: K, v: F[K][number]) =>
    setF((x) => {
      const arr = x[k] as unknown[];
      return { ...x, [k]: arr.includes(v) ? arr.filter((y) => y !== v) : [...arr, v] };
    });

  const results = useMemo(() => {
    const qn = norm(f.q);
    const day = now.getDay();
    const favCuisines = acc ? ([...acc.favourites, ...acc.orders.map((o) => o.rid)].map((id) => restaurants.find((r) => r.id === id)?.cuisine).filter(Boolean) as string[]) : [];
    const ctx = { home, likedMoods: acc?.profile.moods ?? [], favCuisines, favourites: acc?.favourites ?? [] };
    const list = restaurants
      .map((r) => ({ r, km: haversineKm(home, r) }))
      .filter(({ r, km }) => {
        if (qn && !qn.split(" ").every((w) => searchable.get(r.id)!.includes(w))) return false;
        if (f.group && cuisines[r.cuisine]?.group !== f.group) return false;
        if (f.cuisine && r.cuisine !== f.cuisine) return false;
        if (f.areas.length && !f.areas.includes(r.area)) return false;
        if (f.prices.length && !f.prices.includes(r.price)) return false;
        if (f.open && !isOpenNow(r, now)) return false;
        if (f.part && !openDuring(r.hours, f.part, day)) return false;
        if (f.mood && !r.moods.includes(f.mood)) return false;
        if (f.amenities.length && !f.amenities.every((a) => r.amenities.includes(a))) return false;
        if (f.minRating && r.rating < f.minRating) return false;
        if (f.offer && !r.offers.length) return false;
        if (f.delivery && !r.delivery) return false;
        if (f.reservations && !r.amenities.includes("reservations")) return false;
        if (f.isNew && !r.isNew) return false;
        if (f.maxKm && km > f.maxKm) return false;
        return true;
      });
    const cmp: Record<Sort, (a: { r: Restaurant; km: number }, b: { r: Restaurant; km: number }) => number> = {
      distance: (a, b) => a.km - b.km,
      visits: (a, b) => b.r.visits - a.r.visits,
      foryou: (a, b) => personalScore(b.r, ctx) - personalScore(a.r, ctx),
      google: (a, b) => (b.r.google ?? 0) - (a.r.google ?? 0) || (b.r.googleCount ?? 0) - (a.r.googleCount ?? 0),
      rating: (a, b) => b.r.rating - a.r.rating || b.r.ratingCount - a.r.ratingCount,
      "price-asc": (a, b) => a.r.avg - b.r.avg,
      "price-desc": (a, b) => b.r.avg - a.r.avg,
    };
    return list.sort(cmp[sort]).map((x) => x.r);
  }, [f, sort, now, home, acc]);

  const activeCount =
    (f.group ? 1 : 0) + (f.cuisine ? 1 : 0) + f.areas.length + f.prices.length + +f.open + (f.part ? 1 : 0) + (f.mood ? 1 : 0) + f.amenities.length + (f.minRating ? 1 : 0) + +f.offer + +f.delivery + +f.reservations + +f.isNew + (f.maxKm ? 1 : 0);

  const points: MapPoint[] = useMemo(
    () => results.map((r) => ({ id: r.id, lat: r.lat, lng: r.lng, label: r[lang], tone: r.offers.length ? "offer" : isOpenNow(r, now) ? "open" : "closed" })),
    [results, lang, now],
  );
  const selected = sel ? results.find((r) => r.id === sel) : null;

  const sorts: { id: Sort; label: string }[] = [
    { id: "distance", label: L("الأقرب", "Closest") },
    { id: "visits", label: L("الأكثر زيارة", "Most visited") },
    { id: "foryou", label: L("الأنسب ليك", "Best for you") },
    { id: "google", label: L("تقييم جوجل", "Google rating") },
    { id: "rating", label: L("تقييم سُفرة", "Sufra rating") },
    { id: "price-asc", label: L("الأرخص", "Price: low → high") },
    { id: "price-desc", label: L("الأغلى", "Price: high → low") },
  ];

  const filters = (
    <div>
      <Group title={L("المطبخ", "Cuisine")}>
        <Chip on={!f.group && !f.cuisine} onClick={() => setF((x) => ({ ...x, group: "", cuisine: "" }))}>
          {L("الكل", "All")}
        </Chip>
        {GROUPS.map((g) => (
          <Chip key={g.id} on={f.group === g.id} onClick={() => setF((x) => ({ ...x, group: x.group === g.id ? "" : g.id, cuisine: "" }))}>
            {g[lang]}
          </Chip>
        ))}
        <label className="w-full">
          <span className="sr-only">{L("نوع الأكل", "Cuisine type")}</span>
          <select className="sf-input mt-1 h-10 text-sm" value={f.cuisine} onChange={(e) => set("cuisine", e.target.value)}>
            <option value="">{L("كل أنواع الأكل", "Any cuisine")}</option>
            {Object.entries(cuisines)
              .filter(([, c]) => !f.group || c.group === f.group)
              .map(([id, c]) => (
                <option key={id} value={id}>
                  {c[lang]}
                </option>
              ))}
          </select>
        </label>
      </Group>
      <Group title={L("المنطقة", "Area")}>
        {areas.map((a) => (
          <Chip key={a.id} on={f.areas.includes(a.id)} onClick={() => toggle("areas", a.id)}>
            {a[lang]}
          </Chip>
        ))}
      </Group>
      <Group title={L("السعر", "Price")}>
        {[1, 2, 3, 4].map((p) => (
          <Chip key={p} on={f.prices.includes(p)} onClick={() => toggle("prices", p)}>
            <span className="num" dir="ltr">{"$".repeat(p)}</span>
          </Chip>
        ))}
      </Group>
      <Group title={L("المواعيد", "Hours")}>
        <Chip on={f.open} onClick={() => set("open", !f.open)}>
          <span className="size-2 rounded-full bg-ok" aria-hidden />
          {L("مفتوح دلوقتي", "Open now")}
        </Chip>
        {DAY_PARTS.map((p) => (
          <Chip key={p.id} on={f.part === p.id} onClick={() => set("part", f.part === p.id ? "" : p.id)}>
            {p[lang]}
          </Chip>
        ))}
      </Group>
      <Group title={L("المزاج / الغرض", "Mood / purpose")}>
        {MOODS.map((m) => (
          <Chip key={m.id} on={f.mood === m.id} onClick={() => set("mood", f.mood === m.id ? "" : m.id)}>
            {m[lang]}
          </Chip>
        ))}
      </Group>
      <Group title={L("المميزات", "Amenities")}>
        {AMENITIES.map((a) => (
          <Chip key={a.id} on={f.amenities.includes(a.id)} onClick={() => toggle("amenities", a.id)}>
            {a[lang]}
          </Chip>
        ))}
      </Group>
      <Group title={L("أقل تقييم", "Minimum rating")}>
        {[0, 3.5, 4, 4.5].map((v) => (
          <Chip key={v} on={f.minRating === v} onClick={() => set("minRating", v)}>
            {v ? <span className="num">★ {v}+</span> : L("أي تقييم", "Any")}
          </Chip>
        ))}
      </Group>
      <Group title={L("المسافة من بيتك", "Distance from home")}>
        {[0, 2, 5, 10, 20].map((v) => (
          <Chip key={v} on={f.maxKm === v} onClick={() => set("maxKm", v)}>
            {v ? <span className="num">{L(`أقل من ${v} كم`, `< ${v} km`)}</span> : L("أي مسافة", "Any")}
          </Chip>
        ))}
      </Group>
      <Group title={L("كمان", "More")}>
        <Chip on={f.offer} onClick={() => set("offer", !f.offer)}>{L("عليه عرض", "Has an offer")}</Chip>
        <Chip on={f.delivery} onClick={() => set("delivery", !f.delivery)}>{L("بيوصّل", "Delivers")}</Chip>
        <Chip on={f.reservations} onClick={() => set("reservations", !f.reservations)}>{L("بيقبل حجز", "Reservations")}</Chip>
        <Chip on={f.isNew} onClick={() => set("isNew", !f.isNew)}>{L("جديد", "New")}</Chip>
      </Group>
    </div>
  );

  const views: { id: ViewMode; label: string; Icon: typeof List }[] = [
    { id: "grid", label: L("شبكة", "Grid"), Icon: LayoutGrid },
    { id: "list", label: L("قائمة", "List"), Icon: List },
    { id: "map", label: L("خريطة", "Map"), Icon: MapIcon },
  ];

  return (
    <div className="wrap gutter pb-10 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="sf-kicker">{L("استكشف القاهرة", "Explore Cairo")}</p>
          <h1 className="text-[32px] font-bold leading-tight sm:text-[44px]">{L("كل الأماكن", "Every place")}</h1>
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          <span className="num font-semibold text-foreground">{results.length}</span> {L("مكان", "places")}
        </p>
      </div>

      {/* toolbar */}
      <div className="sticky top-16 z-30 -mx-4 mt-4 flex flex-wrap items-center gap-2 border-b border-border/60 bg-background/85 px-4 py-3 backdrop-blur-xl md:-mx-8 md:px-8">
        <div className="relative min-w-0 flex-[1_1_220px]">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <label htmlFor="ex-q" className="sr-only">{L("دوّر", "Search")}</label>
          <input id="ex-q" type="search" value={f.q} onChange={(e) => set("q", e.target.value)} placeholder={L("مطعم، أكلة، منطقة…", "Restaurant, dish, area…")} className="sf-input h-11 rounded-full ps-10" />
        </div>
        <button type="button" onClick={() => setSheet(true)} className="sf-btn sf-btn-ghost h-11 bg-card lg:hidden" aria-haspopup="dialog">
          <SlidersHorizontal className="size-4" aria-hidden />
          {L("فلاتر", "Filters")}
          {activeCount ? <span className="num grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] text-primary-foreground">{activeCount}</span> : null}
        </button>
        <label className="flex items-center gap-2">
          <span className="sr-only">{L("ترتيب حسب", "Sort by")}</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="sf-input h-11 w-auto rounded-full pe-9 text-sm font-medium">
            {sorts.map((s) => (
              <option key={s.id} value={s.id}>
                {L("ترتيب: ", "Sort: ") + s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex rounded-full border bg-card p-1" role="group" aria-label={L("طريقة العرض", "View")}>
          {views.map((v) => (
            <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => setView(v.id)} className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium", view === v.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              <v.Icon className="size-4" aria-hidden />
              <span className="hidden sm:inline">{v.label}</span>
              <span className="sr-only sm:hidden">{v.label}</span>
            </button>
          ))}
        </div>
      </div>

      {activeCount ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {f.open ? <ActiveChip label={L("مفتوح دلوقتي", "Open now")} onClear={() => set("open", false)} /> : null}
          {f.group ? <ActiveChip label={GROUPS.find((g) => g.id === f.group)![lang]} onClear={() => set("group", "")} /> : null}
          {f.cuisine ? <ActiveChip label={cuisineName(f.cuisine, lang)} onClear={() => set("cuisine", "")} /> : null}
          {f.areas.map((a) => <ActiveChip key={a} label={areaName(a, lang)} onClear={() => toggle("areas", a)} />)}
          {f.prices.map((p) => <ActiveChip key={p} label={"$".repeat(p)} onClear={() => toggle("prices", p)} />)}
          {f.part ? <ActiveChip label={DAY_PARTS.find((p) => p.id === f.part)![lang]} onClear={() => set("part", "")} /> : null}
          {f.mood ? <ActiveChip label={MOODS.find((m) => m.id === f.mood)![lang]} onClear={() => set("mood", "")} /> : null}
          {f.amenities.map((a) => <ActiveChip key={a} label={AMENITIES.find((x) => x.id === a)![lang]} onClear={() => toggle("amenities", a)} />)}
          {f.minRating ? <ActiveChip label={`★ ${f.minRating}+`} onClear={() => set("minRating", 0)} /> : null}
          {f.maxKm ? <ActiveChip label={L(`< ${f.maxKm} كم`, `< ${f.maxKm} km`)} onClear={() => set("maxKm", 0)} /> : null}
          {f.offer ? <ActiveChip label={L("عليه عرض", "Offer")} onClear={() => set("offer", false)} /> : null}
          {f.delivery ? <ActiveChip label={L("بيوصّل", "Delivers")} onClear={() => set("delivery", false)} /> : null}
          {f.reservations ? <ActiveChip label={L("بيقبل حجز", "Reservations")} onClear={() => set("reservations", false)} /> : null}
          {f.isNew ? <ActiveChip label={L("جديد", "New")} onClear={() => set("isNew", false)} /> : null}
          <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setF({ ...EMPTY, q: f.q })}>
            {L("امسح الكل", "Clear all")}
          </button>
        </div>
      ) : null}

      <div className="mt-5 grid gap-8 lg:grid-cols-[280px_1fr]">
        <aside className="hidden lg:block" aria-label={L("الفلاتر", "Filters")}>
          <div className="sticky top-[140px] max-h-[calc(100svh-160px)] overflow-y-auto rounded-2xl border bg-card px-4 no-scrollbar">{filters}</div>
        </aside>

        <section aria-label={L("النتائج", "Results")} className="min-w-0">
          {!results.length ? (
            <div className="grid place-items-center rounded-3xl border border-dashed p-12 text-center">
              <p className="font-display text-2xl font-semibold">{L("مفيش أماكن بالفلاتر دي", "No places match these filters")}</p>
              <p className="mt-1 text-muted-foreground">{L("جرّب تشيل فلتر أو اتنين.", "Try removing a filter or two.")}</p>
              <button type="button" className="sf-btn sf-btn-primary mt-5" onClick={() => setF(EMPTY)}>
                {L("امسح الفلاتر", "Clear filters")}
              </button>
            </div>
          ) : view === "map" ? (
            <div className="relative">
              <CairoMap points={points} selectedId={sel} onSelect={setSel} home={home} className="h-[min(72svh,720px)] min-h-[460px]" />
              <AnimatePresence>
                {selected ? (
                  <motion.div
                    key={selected.id}
                    initial={reduced ? { opacity: 0 } : { opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute inset-x-3 bottom-12 z-20 mx-auto max-w-lg"
                  >
                    <div className="relative">
                      <RestaurantCard r={selected} now={now} layout="list" className="shadow-xl" />
                      <button type="button" onClick={() => setSel(null)} className="absolute -top-3 end-3 grid size-8 place-items-center rounded-full border bg-card shadow" aria-label={L("اقفل", "Close")}>
                        <X className="size-4" aria-hidden />
                      </button>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
              <p className="mt-2 text-xs text-muted-foreground">{L("خريطة توضيحية مرسومة لسُفرة — المواقع تقريبية.", "Illustrated Sufra map — locations are approximate.")}</p>
            </div>
          ) : view === "list" ? (
            <div className="grid gap-3 xl:grid-cols-2">
              {results.map((r, i) => (
                <RestaurantCard key={r.id} r={r} now={now} layout="list" eager={i < 4} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((r, i) => (
                <RestaurantCard key={r.id} r={r} now={now} eager={i < 6} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* mobile filter sheet */}
      <AnimatePresence>
        {sheet ? (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={L("الفلاتر", "Filters")}>
            <motion.div className="absolute inset-0 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSheet(false)} />
            <motion.div
              className="absolute inset-x-0 bottom-0 flex max-h-[88svh] flex-col rounded-t-[28px] bg-background shadow-2xl"
              initial={reduced ? { opacity: 0 } : { y: "100%" }}
              animate={reduced ? { opacity: 1 } : { y: 0 }}
              exit={reduced ? { opacity: 0 } : { y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
            >
              <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-border" aria-hidden />
              <div className="flex items-center justify-between px-4 pb-2 pt-3">
                <h2 className="text-xl font-bold">{L("الفلاتر", "Filters")}</h2>
                <button type="button" onClick={() => setSheet(false)} className="grid size-10 place-items-center rounded-full hover:bg-card" aria-label={L("اقفل", "Close")}>
                  <X className="size-5" aria-hidden />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4">{filters}</div>
              <div className="flex gap-2 border-t p-4">
                <button type="button" className="sf-btn sf-btn-ghost" onClick={() => setF({ ...EMPTY, q: f.q })}>
                  {L("امسح", "Clear")}
                </button>
                <button type="button" className="sf-btn sf-btn-primary flex-1" onClick={() => setSheet(false)}>
                  {L(`وريني ${results.length} مكان`, `Show ${results.length} places`)}
                </button>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <fieldset className="border-b py-4 last:border-0">
      <legend className="mb-2.5 text-sm font-semibold">{title}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" aria-pressed={on} onClick={onClick} className="sf-chip h-9 px-3 text-[13px]">
      {children}
    </button>
  );


function ActiveChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button type="button" onClick={onClear} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary-soft px-3 text-[13px] font-medium text-primary">
      {label}
      <X className="size-3.5" aria-hidden />
      <span className="sr-only">✕</span>
    </button>
  );
}

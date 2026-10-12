/**
 * Tool implementations for the "اسأل سُفرة" concierge (/api/ask). They run the SAME filtering and scoring code as
 * the website (recommend.ts) on the bundled data, so Claude's picks match what the user sees.
 * Pure + relative imports only: bundled into the Vercel edge function and unit-tested with vitest.
 */
import { AMENITIES, areaById, areas, byId, cuisines, isSample, MOODS, restaurants, type Amenity, type Lang, type Mood, type Restaurant } from "./data";
import { haversineKm, travel, type LatLng } from "./geo";
import { fmtRange, fmtTime, openState } from "./hours";
import { diversify, findByName, scoreRelaxed, type Filters, type Pick } from "./recommend";

export interface AskContext {
  origin: LatLng;
  originLabel?: string | null;
  /** ISO time from the user's device; Cairo local time is derived from it */
  now: Date;
  lang: Lang;
  favourites: string[];
  recent: string[];
}

const MOOD_IDS = MOODS.map((m) => m.id);
const AMENITY_IDS = AMENITIES.map((a) => a.id);
const str = (v: unknown, max = 80) => (typeof v === "string" ? v.slice(0, max) : undefined);
const strs = (v: unknown, allowed?: string[]) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && (!allowed || allowed.includes(x))).slice(0, 8) : []);
const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
const bool = (v: unknown) => v === true;

/** Compact, model-friendly view of a place (ids/slugs so it can deep-link). */
export function brief(r: Restaurant, ctx: AskContext, why?: string[]) {
  const km = haversineKm(ctx.origin, r);
  const t = travel(km);
  const st = openState(r.hours, ctx.now);
  return {
    id: r.id,
    link: `#/r/${r.slug}`,
    name_ar: r.ar,
    name_en: r.en,
    cuisine: r.cuisine,
    area: r.area,
    km: Math.round(km * 10) / 10,
    minutes_by_car: t.car,
    minutes_walking: t.walk,
    open_now: st.open,
    [st.open ? "closes_at" : "opens_at"]: st.at != null ? fmtTime(st.at, "en") : null,
    hours_are_estimated: r.hoursSource === "estimated",
    price_level: r.price,
    avg_egp_per_person: r.avg,
    prices_are_sample: isSample(r, "price"),
    sufra_rating: r.rating,
    rating_is_sample: isSample(r, "ratings"),
    moods: r.moods,
    amenities: r.amenities,
    offer: r.offers[0] ? { en: r.offers[0].en, ar: r.offers[0].ar, sample: isSample(r, "offers") } : null,
    delivers: !!r.delivery,
    osm_verified: !!r.verified,
    ...(why?.length ? { why } : {}),
  };
}

/** Validate + normalise the model's search_restaurants input into the site's Filters. */
export function toFilters(input: Record<string, unknown>, pool: Restaurant[] = restaurants): Filters & { limit: number } {
  const like = str(input.like_restaurant, 60);
  const likeR = like ? (byId[like] ?? findByName(like, pool)) : null;
  const price = input.price === "cheap" || input.price === "pricey" ? input.price : null;
  return {
    query: str(input.query, 80),
    areas: strs(input.areas, areas.map((a) => a.id)),
    cuisines: strs(input.cuisines, Object.keys(cuisines)),
    moods: strs(input.moods, MOOD_IDS) as Mood[],
    amenities: strs(input.amenities, AMENITY_IDS) as Amenity[],
    price,
    maxAvg: num(input.max_avg_egp, 20, 5000) ?? null,
    openNow: bool(input.open_now),
    near: bool(input.near_me),
    walk: bool(input.walkable),
    delivery: bool(input.delivery),
    offer: bool(input.has_offer),
    maxKm: num(input.max_km, 0.2, 60) ?? null,
    likeId: likeR?.id ?? null,
    limit: Math.round(num(input.limit, 1, 8) ?? 6),
  };
}

export function searchRestaurants(input: Record<string, unknown>, ctx: AskContext) {
  const f = toFilters(input);
  const { picks, relax } = scoreRelaxed(f, { home: ctx.origin, lang: ctx.lang, now: ctx.now, favourites: ctx.favourites });
  const out: Pick[] = diversify(picks, f.limit, !!f.cuisines?.length);
  return {
    matched: picks.length,
    relaxed_filters: relax > 0 ? ["open/price/delivery/distance", "area", "cuisine"].slice(0, relax) : [],
    similar_to: f.likeId ? byId[f.likeId]?.en : undefined,
    results: out.map((p) => brief(p.r, ctx, p.reasons.slice(0, 3))),
  };
}

export function getRestaurant(input: Record<string, unknown>, ctx: AskContext) {
  const id = str(input.id, 60) ?? "";
  const r = byId[id] ?? findByName(id);
  if (!r) return { error: `No restaurant with id "${id}". Use search_restaurants first.` };
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const h = ctx.now.getHours();
  return {
    ...brief(r, ctx),
    address_ar: r.addressAr,
    address_en: r.addressEn,
    phone: r.phone || null,
    website: r.website ?? null,
    description_en: r.descEn,
    description_is_sample: isSample(r, "description"),
    hours: Object.fromEntries(r.hours.map((x, i) => [days[i], fmtRange(x, "en")])),
    hours_source: r.hoursSource ?? "unknown",
    busy_now_pct: r.busy?.[h] ?? null,
    busy_is_estimate: isSample(r, "busy"),
    menu_is_sample: isSample(r, "menu"),
    popular_dishes: r.menu.flatMap((s) => s.items).filter((i) => i.tags.includes("best")).slice(0, 5).map((i) => ({ en: i.en, ar: i.ar, egp: i.price })),
    offers: r.offers.map((o) => ({ en: o.en, ar: o.ar, code: o.code })),
    area_name: areaById[r.area]?.en,
  };
}

export function openNow(input: Record<string, unknown>, ctx: AskContext) {
  const ids = strs(input.ids);
  const at = str(input.at_time, 5);
  let when = ctx.now;
  const m = at?.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    when = new Date(ctx.now);
    when.setHours(Number(m[1]), Number(m[2]), 0, 0);
  }
  if (ids.length) {
    return {
      at: fmtTime(when.getHours() * 60 + when.getMinutes(), "en"),
      places: ids.map((id) => byId[id]).filter(Boolean).map((r) => {
        const st = openState(r.hours, when);
        return { id: r.id, name_en: r.en, open: st.open, [st.open ? "closes_at" : "opens_at"]: st.at != null ? fmtTime(st.at, "en") : null, hours_are_estimated: r.hoursSource === "estimated" };
      }),
    };
  }
  const open = restaurants.filter((r) => openState(r.hours, when).open).map((r) => ({ r, km: haversineKm(ctx.origin, r) })).sort((a, b) => a.km - b.km);
  return { at: fmtTime(when.getHours() * 60 + when.getMinutes(), "en"), open_count: open.length, nearest_open: open.slice(0, 8).map((x) => brief(x.r, ctx)) };
}

/** The final picks the model wants to show (validated: real ids, 1–4 of them, short reasons). */
export function validatePicks(input: unknown): { id: string; reasons: string[] }[] | null {
  const picks = (input as { picks?: unknown })?.picks;
  if (!Array.isArray(picks)) return null;
  const out = picks
    .map((p) => ({ id: str((p as { id?: unknown }).id, 60) ?? "", reasons: strs((p as { reasons?: unknown }).reasons).map((x) => x.slice(0, 140)).slice(0, 3) }))
    .filter((p) => byId[p.id])
    .slice(0, 4);
  return out.length ? out : null;
}

/** One line per place — the cached catalogue in the system prompt (stable order → stable cache prefix). */
export function catalogue(): string {
  return restaurants
    .map((r) => [r.id, r.en, r.ar, r.cuisine, r.area, "$".repeat(r.price), r.moods.join(","), r.verified ? "osm✓" : ""].join(" | "))
    .join("\n");
}

/**
 * Instant search across restaurants, dishes, areas and cuisines — Arabic-normalised, synonym- and typo-tolerant.
 * Recent searches live in this browser only; "trending" is derived from the data (popular dishes/places + time of day).
 */
import { useSyncExternalStore } from "react";
import { areas, cuisines, restaurants, type Area, type MenuItem, type Restaurant } from "./data";
import { bestTokenScore, fuzzyScore, norm, tokens } from "./arabic";
import { haversineKm, type LatLng } from "./geo";
import { load, save } from "./storage";

interface Doc {
  r: Restaurant;
  name: string[];
  all: string[];
}
let docs: Doc[] | null = null;
const index = () =>
  (docs ??= restaurants.map((r) => ({
    r,
    name: tokens(`${r.ar} ${r.en} ${r.brand ?? ""}`),
    all: tokens([r.ar, r.en, r.brand ?? "", cuisines[r.cuisine]?.ar, cuisines[r.cuisine]?.en, areas.find((a) => a.id === r.area)?.ar, areas.find((a) => a.id === r.area)?.en, ...r.menu.flatMap((s) => s.items.flatMap((i) => [i.ar, i.en]))].join(" ")),
  })));

/** Does a restaurant match a free-text query? Every word must hit something (name, cuisine, area or a dish). */
export function matchScore(r: Restaurant, q: string): number {
  const qs = tokens(q);
  if (!qs.length) return 1;
  const d = index().find((x) => x.r.id === r.id);
  if (!d) return 0;
  let sum = 0;
  for (const w of qs) {
    const s = Math.max(bestTokenScore(w, d.name) * 1.15, bestTokenScore(w, d.all));
    if (!s) return 0;
    sum += s;
  }
  return sum / qs.length;
}

export interface SearchResults {
  places: { r: Restaurant; score: number; km: number | null }[];
  dishes: { item: MenuItem; r: Restaurant; score: number }[];
  areas: { a: Area; count: number }[];
  cuisines: { id: string; count: number }[];
}

export function searchAll(q: string, opts: { origin?: LatLng; limit?: number } = {}): SearchResults {
  const lim = opts.limit ?? 6;
  const empty: SearchResults = { places: [], dishes: [], areas: [], cuisines: [] };
  if (!norm(q)) return empty;
  const places = index()
    .map((d) => {
      const nameS = fuzzyScore(q, d.name);
      return { r: d.r, score: nameS ? nameS * 1.2 : matchScore(d.r, q) * 0.8, km: opts.origin ? haversineKm(opts.origin, d.r) : null };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.km ?? 0) - (b.km ?? 0) || b.r.rating - a.r.rating)
    .slice(0, lim);
  const dishes: SearchResults["dishes"] = [];
  const seen = new Set<string>();
  for (const r of restaurants)
    for (const s of r.menu)
      for (const it of s.items) {
        const sc = Math.max(fuzzyScore(q, it.ar), fuzzyScore(q, it.en));
        if (sc >= 0.6) {
          const key = norm(it.ar);
          if (seen.has(key) && dishes.length > 3) continue;
          seen.add(key);
          dishes.push({ item: it, r, score: sc + r.rating * 0.02 - (opts.origin ? Math.min(haversineKm(opts.origin, r), 30) * 0.004 : 0) });
        }
      }
  dishes.sort((a, b) => b.score - a.score);
  const areaHits = areas
    .map((a) => ({ a, s: Math.max(fuzzyScore(q, a.ar), fuzzyScore(q, a.en)) }))
    .filter((x) => x.s >= 0.6)
    .sort((a, b) => b.s - a.s)
    .map((x) => ({ a: x.a, count: restaurants.filter((r) => r.area === x.a.id).length }));
  const cuiHits = Object.entries(cuisines)
    .map(([id, c]) => ({ id, s: Math.max(fuzzyScore(q, c.ar), fuzzyScore(q, c.en)) }))
    .filter((x) => x.s >= 0.6)
    .sort((a, b) => b.s - a.s)
    .map((x) => ({ id: x.id, count: restaurants.filter((r) => r.cuisine === x.id).length }));
  return { places, dishes: dishes.slice(0, 4), areas: areaHits.slice(0, 3), cuisines: cuiHits.slice(0, 3) };
}

/* ── recent searches (this browser) ── */
const KEY = "sufra.searches.v1";
let recent: string[] = load<string[]>(KEY, []).filter((x) => typeof x === "string").slice(0, 8);
const ls = new Set<() => void>();
export function pushSearch(q: string) {
  const t = q.trim();
  if (t.length < 2) return;
  recent = [t, ...recent.filter((x) => norm(x) !== norm(t))].slice(0, 8);
  save(KEY, recent);
  ls.forEach((l) => l());
}
export function clearSearches() {
  recent = [];
  save(KEY, recent);
  ls.forEach((l) => l());
}
export const getSearches = () => recent;
export function useRecentSearches() {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => recent,
    () => recent,
  );
}

/** Trending: dishes marked "most ordered" at the most-visited places, tuned to the time of day. */
export function trending(now = new Date(), lang: "ar" | "en" = "ar"): string[] {
  const h = now.getHours();
  const timely =
    h >= 6 && h < 11
      ? lang === "ar" ? ["فطار", "فول وطعمية", "قهوة"] : ["breakfast", "ful & falafel", "coffee"]
      : h >= 23 || h < 3
        ? lang === "ar" ? ["سهر", "شاورما", "حلويات"] : ["late night", "shawarma", "desserts"]
        : h >= 15 && h < 18
          ? lang === "ar" ? ["قهوة", "حلويات", "كافيه هادي"] : ["coffee", "desserts", "quiet café"]
          : lang === "ar" ? ["كشري", "مشويات", "بيتزا"] : ["koshari", "grills", "pizza"];
  const counts = new Map<string, number>();
  for (const r of [...restaurants].sort((a, b) => b.visits - a.visits).slice(0, 80))
    for (const s of r.menu)
      for (const it of s.items)
        if (it.tags.includes("best")) {
          const k = lang === "ar" ? it.ar : it.en;
          counts.set(k, (counts.get(k) ?? 0) + r.visits);
        }
  const dishes = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return [...new Set([...timely, ...dishes])].slice(0, 8);
}

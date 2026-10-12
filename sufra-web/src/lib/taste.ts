/**
 * A small client-side taste model. Inputs (all local): favourites, bookings, orders, recently viewed places,
 * recent searches, the profile's moods, and the time of day. Output: a per-place affinity added to rankings
 * ("مقترح ليك"), a "because you liked X" reason, and a time-aware theme for the home page.
 * Nothing leaves the browser except as context the user sends to the concierge.
 */
import { byId, cuisines, type Mood, type Restaurant } from "./data";
import { tokens } from "./arabic";
import { similarity } from "./recommend";

export interface TasteInput {
  favourites: string[];
  bookings: { rid: string; status: string }[];
  orders: { rid: string }[];
  recent: string[];
  searches: string[];
  moods: Mood[];
}

export interface Taste {
  cuisine: Record<string, number>;
  mood: Partial<Record<Mood, number>>;
  area: Record<string, number>;
  price: number | null;
  /** places the user has shown love for, strongest first */
  liked: { r: Restaurant; w: number }[];
  /** how much signal there is (0 = cold start) */
  strength: number;
}

const CUISINE_HINTS: Record<string, string[]> = {
  cafe: ["قهوه", "كافيه", "coffee", "latte"], egyptian: ["كشري", "فول", "طعميه", "koshari"], levant: ["شاورما", "shawarma"],
  grill: ["مشويات", "كباب", "grill"], italian: ["بيتزا", "باستا", "pizza", "pasta"], burger: ["برجر", "burger"],
  asian: ["سوشي", "sushi", "رامن"], seafood: ["سمك", "fish"], dessert: ["حلويات", "كنافه", "dessert"], bakery: ["مخبوزات", "كرواسون"],
};

export function buildTaste(t: TasteInput): Taste {
  const cuisine: Record<string, number> = {};
  const mood: Partial<Record<Mood, number>> = {};
  const area: Record<string, number> = {};
  const likedW = new Map<string, number>();
  let priceSum = 0;
  let priceW = 0;
  const add = (rid: string, w: number) => {
    const r = byId[rid];
    if (!r) return;
    likedW.set(rid, (likedW.get(rid) ?? 0) + w);
    cuisine[r.cuisine] = (cuisine[r.cuisine] ?? 0) + w;
    area[r.area] = (area[r.area] ?? 0) + w * 0.5;
    for (const m of r.moods) mood[m] = (mood[m] ?? 0) + w * 0.25;
    priceSum += r.price * w;
    priceW += w;
  };
  t.favourites.forEach((id) => add(id, 3));
  t.bookings.filter((b) => b.status !== "cancelled").forEach((b) => add(b.rid, 2));
  t.orders.forEach((o) => add(o.rid, 2.5));
  t.recent.slice(0, 8).forEach((id, i) => add(id, 0.8 - i * 0.07));
  for (const m of t.moods) mood[m] = (mood[m] ?? 0) + 2;
  for (const q of t.searches.slice(0, 8)) {
    const ws = tokens(q);
    for (const [c, hints] of Object.entries(CUISINE_HINTS)) if (hints.some((h) => ws.includes(tokens(h)[0]))) cuisine[c] = (cuisine[c] ?? 0) + 0.6;
  }
  const liked = [...likedW.entries()].sort((a, b) => b[1] - a[1]).map(([id, w]) => ({ r: byId[id], w }));
  const strength = [...likedW.values()].reduce((a, b) => a + b, 0) + t.moods.length;
  return { cuisine, mood, area, price: priceW ? priceSum / priceW : null, liked, strength };
}

const norm01 = (rec: Record<string, number | undefined>) => {
  const max = Math.max(1, ...Object.values(rec).map((v) => v ?? 0));
  return (k: string) => (rec[k] ?? 0) / max;
};

/** Affinity in roughly −1..+3 for ranking; 0 at cold start. */
export function affinityFn(taste: Taste, now = new Date()): (r: Restaurant) => number {
  if (!taste.strength) return (r) => timeBoost(r, now);
  const c = norm01(taste.cuisine);
  const m = norm01(taste.mood as Record<string, number>);
  const a = norm01(taste.area);
  return (r) => {
    let s = c(r.cuisine) * 1.6 + r.moods.reduce((acc, x) => acc + m(x), 0) * 0.35 + a(r.area) * 0.4;
    if (taste.price != null) s -= Math.abs(r.price - taste.price) * 0.35;
    // a place very like one you love
    const best = taste.liked.slice(0, 6).reduce((acc, l) => (l.r.id === r.id ? acc : Math.max(acc, similarity(l.r, r))), 0);
    s += Math.max(0, best - 2) * 0.35;
    return s + timeBoost(r, now);
  };
}

/** "عشان حبيت X" — the liked place this one most resembles (only when the resemblance is real). */
export function becauseFn(taste: Taste, lang: "ar" | "en"): (r: Restaurant) => string | null {
  return (r) => {
    let best: Restaurant | null = null;
    let bs = 2.8;
    for (const l of taste.liked.slice(0, 8)) {
      if (l.r.id === r.id) continue;
      const s = similarity(l.r, r);
      if (s > bs) {
        bs = s;
        best = l.r;
      }
    }
    return best ? (lang === "ar" ? `عشان حبيت ${best.ar}` : `Because you liked ${best.en}`) : null;
  };
}

/* ── time of day ── */
export type DayMoment = "breakfast" | "lunch" | "afternoon" | "dinner" | "late";
export function dayMoment(now = new Date()): DayMoment {
  const h = now.getHours();
  if (h >= 23 || h < 4) return "late";
  if (h < 11) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 18) return "afternoon";
  return "dinner";
}
export const MOMENT: Record<DayMoment, { mood: Mood; cuisines: string[]; ar: string; en: string; kickerAr: string; kickerEn: string }> = {
  breakfast: { mood: "breakfast", cuisines: ["egyptian", "bakery", "cafe"], ar: "فطار الصبح", en: "Morning breakfast", kickerAr: "صباح الفل", kickerEn: "Good morning" },
  lunch: { mood: "eat", cuisines: ["egyptian", "grill", "levant", "italian"], ar: "غدا النهارده", en: "Lunch today", kickerAr: "وقت الغدا", kickerEn: "Lunchtime" },
  afternoon: { mood: "drinks", cuisines: ["cafe", "dessert", "bakery"], ar: "قهوة وحاجة حلوة", en: "Coffee & something sweet", kickerAr: "بعد الضهر", kickerEn: "Afternoon" },
  dinner: { mood: "friends", cuisines: ["grill", "italian", "asian", "seafood", "levant"], ar: "عشا الليلة", en: "Dinner tonight", kickerAr: "بالليل", kickerEn: "Tonight" },
  late: { mood: "late", cuisines: ["levant", "egyptian", "dessert", "shisha", "burger"], ar: "سهرانين؟ مفتوح لسه", en: "Still up? Open late", kickerAr: "بعد 11 بالليل", kickerEn: "After 11pm" },
};

function timeBoost(r: Restaurant, now: Date): number {
  const mo = MOMENT[dayMoment(now)];
  let s = 0;
  if (r.moods.includes(mo.mood)) s += 0.5;
  if (mo.cuisines.includes(r.cuisine)) s += 0.3;
  if (dayMoment(now) === "late" && !r.hours.some(([, c]) => c > 1440 + 30)) s -= 0.6;
  return s;
}

export const cuisineLabel = (id: string, lang: "ar" | "en") => cuisines[id]?.[lang] ?? id;

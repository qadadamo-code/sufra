/**
 * "اسأل سُفرة" — the LOCAL recommender (offline fallback for /api/ask, and the engine behind its tools).
 * It parses Arabic (Egyptian/Levantine) and English intent out of a free-text question, filters/scores the dataset
 * and explains its picks. Relative imports only: api/ask.ts bundles this file for the edge runtime.
 */
import { areaById, areas, cuisines, hasGoogle, restaurants as ALL, amenityById, moodById, type Amenity, type Lang, type Mood, type Restaurant } from "./data";
import { haversineKm, travel, fmtKm, type LatLng } from "./geo";
import { fmtTime, openState } from "./hours";
import { canon, editDistance, fuzzyScore, hasPhrase, norm, tokens } from "./arabic";

export { norm } from "./arabic";

const AREA_WORDS: Record<string, string[]> = {
  zamalek: ["زمالك", "zamalek"],
  "garden-city": ["جاردن سيتي", "جاردن", "garden city"],
  downtown: ["وسط البلد", "داون تاون", "التحرير", "downtown", "wust el balad"],
  dokki: ["دقي", "الدقي", "dokki"],
  mohandessin: ["مهندسين", "المهندسين", "mohandessin", "mohandeseen"],
  maadi: ["معادي", "المعادي", "maadi"],
  heliopolis: ["مصر الجديده", "الكوربه", "هليوبوليس", "heliopolis", "korba"],
  "nasr-city": ["مدينه نصر", "nasr city", "nasr"],
  "new-cairo": ["التجمع", "تجمع", "القاهره الجديده", "new cairo", "tagamoa", "5th settlement"],
  rehab: ["الرحاب", "رحاب", "rehab"],
  zayed: ["زايد", "الشيخ زايد", "sheikh zayed", "zayed"],
  october: ["اكتوبر", "6 اكتوبر", "october"],
};

const CUISINE_WORDS: Record<string, string[]> = {
  cafe: ["كافيه", "كافي", "قهوه", "قهوة مختصه", "سبشلتي", "لاتيه", "كابتشينو", "cafe", "coffee", "latte"],
  egyptian: ["مصري", "كشري", "فول", "طعميه", "فلافل", "ملوخيه", "محشي", "فطير", "حواوشي", "كبده", "egyptian", "koshari", "ful"],
  levant: ["شامي", "لبناني", "سوري", "شاورما", "فتوش", "حمص", "lebanese", "levant", "syrian", "shawarma"],
  grill: ["مشويات", "مشوي", "كباب", "كفته", "فراخ مشويه", "grill", "kebab", "kofta", "bbq"],
  italian: ["ايطالي", "بيتزا", "باستا", "مكرونه", "italian", "pizza", "pasta"],
  burger: ["برجر", "امريكي", "فرايز", "burger", "american", "fries"],
  asian: ["اسيوي", "سوشي", "صيني", "ياباني", "تايلندي", "رامن", "asian", "sushi", "chinese", "japanese", "thai", "ramen"],
  seafood: ["سمك", "اسماك", "جمبري", "سي فود", "مأكولات بحريه", "seafood", "fish", "shrimp"],
  dessert: ["حلويات", "كنافه", "بسبوسه", "ايس كريم", "تشيز كيك", "dessert", "sweets", "cake", "ice cream"],
  bakery: ["مخبوزات", "مخبز", "كرواسون", "bakery", "croissant", "pastry"],
  healthy: ["صحي", "دايت", "سلطه", "كيتو", "فيجن", "healthy", "salad", "vegan", "keto", "diet"],
  gulf: ["خليجي", "مندي", "كبسه", "gulf", "mandi", "kabsa"],
  shisha: ["قهوه بلدي", "شيشه", "ارجيله", "معسل", "ahwa", "shisha", "hookah"],
  indian: ["هندي", "برياني", "كاري", "indian", "curry", "biryani"],
  mexican: ["مكسيكي", "تاكو", "بوريتو", "mexican", "tacos", "burrito"],
};

const MOOD_WORDS: Record<Mood, string[]> = {
  work: ["شغل", "اشتغل", "مذاكره", "اذاكر", "لابتوب", "ميتنج", "اجتماع", "work", "study", "laptop", "meeting", "remote"],
  eat: ["اكل", "اتغدي", "غدا", "عشا", "اتعشي", "جعان", "eat", "lunch", "dinner", "hungry", "meal"],
  drinks: ["مشروب", "عصير", "اشرب", "drinks", "juice", "drink"],
  friends: ["اصحاب", "صحاب", "صحابي", "اصحابي", "شله", "الشله", "ربع", "friends", "group", "gang", "buddies"],
  family: ["عيله", "عائله", "العيله", "اطفال", "عيال", "ولادي", "الاولاد", "family", "kids", "children", "parents"],
  date: ["رومانسي", "ديت", "خطيبتي", "خطيبي", "مراتي", "جوزي", "حبيبتي", "romantic", "date", "anniversary", "wife", "husband", "girlfriend", "boyfriend"],
  celebrate: ["احتفال", "احتفل", "عيد ميلاد", "مناسبه", "نجاح", "celebrate", "birthday", "party", "celebration"],
  quick: ["سريع", "بسرعه", "علي الماشي", "quick", "fast", "grab"],
  late: ["سهر", "سهره", "متاخر", "بعد نص الليل", "طول الليل", "late", "late night", "midnight", "after midnight"],
  breakfast: ["فطار", "فطور", "الصبح", "بريكفاست", "breakfast", "brunch", "morning"],
};

const AMENITY_WORDS: Partial<Record<Amenity, string[]>> = {
  wifi: ["واي فاي", "وايفاي", "انترنت", "wifi", "wi fi", "internet"],
  outlets: ["فيش", "شاحن", "اشحن", "outlets", "plugs", "charging"],
  quiet: ["هادي", "هاديه", "هدوء", "هادئ", "quiet", "calm", "peaceful"],
  parking: ["ركنه", "باركنج", "اركن", "parking"],
  outdoor: ["برا", "في الهوا", "اوت دور", "outdoor", "outside", "terrace", "garden"],
  kids: ["اطفال", "عيال", "kids", "children"],
  wheelchair: ["كرسي متحرك", "wheelchair", "accessible"],
  shisha: ["شيشه", "shisha", "hookah"],
  "live-music": ["مزيكا", "موسيقي لايف", "لايف", "live music", "band"],
  prayer: ["مصلي", "اصلي", "prayer"],
  "sports-screens": ["ماتش", "ماتشات", "كوره", "الدوري", "match", "football", "sports"],
  "pet-friendly": ["كلبي", "قطتي", "حيوانات", "pet", "dog", "cat"],
  valet: ["فاليه", "valet"],
  "nile-view": ["النيل", "نيل", "فيو", "nile", "view"],
  rooftop: ["روف", "سطح", "rooftop", "roof"],
};

const CHEAP = ["رخيص", "رخيصه", "مش غالي", "اقتصادي", "علي قد الايد", "ميزانيه", "cheap", "budget", "affordable", "inexpensive"];
const PRICEY = ["غالي", "فاخر", "فخم", "شيك", "راقي", "fancy", "luxury", "upscale", "fine dining", "expensive", "classy"];
const OPEN_NOW = ["مفتوح دلوقتي", "مفتوح", "دلوقتي", "حالا", "النهارده", "هلق", "open now", "now", "open", "tonight", "right now"];
const NEAR = ["قريب", "جنبي", "قريب مني", "جمبي", "حوالين", "near", "nearby", "close", "closest", "around me"];
const WALK = ["مشي", "علي رجلي", "walking", "walk"];
const DELIVERY = ["دليفري", "توصيل", "اطلب", "اوردر", "delivery", "deliver", "order in"];
const OFFER = ["عرض", "عروض", "خصم", "خصومات", "اوفر", "offer", "deal", "discount", "promo"];
const BOOK = ["احجز", "حجز", "ترابيزه", "book", "reserve", "reservation", "table"];
/** "زي <مطعم>" / "مثل" / "شبه" / "like X" / "similar to X" */
const LIKE_RE = /(?:^|\s)(?:زي|زيه|مثل|شبه|نفس|زي مطعم|similar to|like|same as)\s+(.{2,40})$/u;

export interface Intent {
  areas: string[];
  cuisines: string[];
  moods: Mood[];
  amenities: Amenity[];
  price: "cheap" | "pricey" | null;
  maxAvg: number | null;
  openNow: boolean;
  near: boolean;
  walk: boolean;
  delivery: boolean;
  offer: boolean;
  book: boolean;
  /** "زي <restaurant>": the id of the place the user wants something similar to */
  likeId: string | null;
  /** free words left over (dish names etc.) */
  words: string[];
  understood: string[];
}

const any = (t: string, ws: string[]) => ws.some((w) => hasPhrase(t, w));

/** Best-matching restaurant for a typed name (fuzzy, Arabic-normalised). */
export function findByName(text: string, pool: Restaurant[] = ALL): Restaurant | null {
  const q = norm(text);
  if (!q) return null;
  let best: Restaurant | null = null;
  let bs = 0;
  for (const r of pool) {
    const s = Math.max(fuzzyScore(q, r.ar), fuzzyScore(q, r.en), r.brand ? fuzzyScore(q, r.brand) : 0);
    if (s > bs) {
      bs = s;
      best = r;
    }
  }
  return bs >= 0.6 ? best : null;
}

export function parseIntent(q: string, pool: Restaurant[] = ALL): Intent {
  const t = norm(q);
  const it: Intent = {
    areas: [], cuisines: [], moods: [], amenities: [], price: null, maxAvg: null,
    openNow: false, near: false, walk: false, delivery: false, offer: false, book: false, likeId: null, words: [], understood: [],
  };
  // "زي <restaurant>" first, so the restaurant's own name isn't read as cuisine/area words
  let rest = t;
  const lm = t.match(LIKE_RE);
  if (lm) {
    const hit = findByName(lm[1], pool) ?? findByName(lm[1].split(" ").slice(0, 3).join(" "), pool);
    if (hit) {
      it.likeId = hit.id;
      rest = t.slice(0, lm.index ?? 0);
    }
  }
  for (const [id, ws] of Object.entries(AREA_WORDS)) if (any(rest, ws)) it.areas.push(id);
  for (const a of areas) if (!it.areas.includes(a.id) && (hasPhrase(rest, a.ar) || hasPhrase(rest, a.en))) it.areas.push(a.id);
  for (const [id, ws] of Object.entries(CUISINE_WORDS)) if (any(rest, ws)) it.cuisines.push(id);
  for (const [id, ws] of Object.entries(MOOD_WORDS) as [Mood, string[]][]) if (any(rest, ws)) it.moods.push(id);
  for (const [id, ws] of Object.entries(AMENITY_WORDS) as [Amenity, string[]][]) if (any(rest, ws)) it.amenities.push(id);
  // "قهوة بلدي" is an ahwa, not a specialty café
  if (it.cuisines.includes("shisha") && it.cuisines.includes("cafe") && hasPhrase(rest, "بلدي")) it.cuisines = it.cuisines.filter((c) => c !== "cafe");
  if (any(rest, CHEAP)) it.price = "cheap";
  else if (any(rest, PRICEY)) it.price = "pricey";
  const m = rest.match(/(?:تحت|اقل من|مش اكتر من|under|below|less than|max)\s*(\d{2,4})/);
  if (m) it.maxAvg = Number(m[1]);
  it.openNow = any(rest, OPEN_NOW);
  it.near = any(rest, NEAR);
  it.walk = any(rest, WALK);
  it.delivery = any(rest, DELIVERY);
  it.offer = any(rest, OFFER);
  it.book = any(rest, BOOK);
  const n = [it.areas.length, it.cuisines.length, it.moods.length, it.amenities.length, it.price ? 1 : 0, it.maxAvg ? 1 : 0, +it.openNow, +it.near, +it.walk, +it.delivery, +it.offer, it.likeId ? 1 : 0];
  it.understood = n.some(Boolean) ? ["ok"] : [];
  return it;
}

export interface Pick {
  r: Restaurant;
  score: number;
  km: number;
  reasons: string[];
}

export interface Answer {
  picks: Pick[];
  text: string;
  intent: Intent;
  relaxed: boolean;
}

/** Structured filters — what the UI's search and the /api/ask `search_restaurants` tool both speak. */
export interface Filters {
  query?: string;
  areas?: string[];
  cuisines?: string[];
  moods?: Mood[];
  amenities?: Amenity[];
  price?: "cheap" | "pricey" | null;
  maxAvg?: number | null;
  openNow?: boolean;
  near?: boolean;
  walk?: boolean;
  delivery?: boolean;
  offer?: boolean;
  maxKm?: number | null;
  likeId?: string | null;
}

export interface ScoreCtx {
  home: LatLng;
  lang: Lang;
  now?: Date;
  favourites?: string[];
  likedMoods?: Mood[];
  /** extra per-place affinity from the taste model (≈ −2..+3) */
  affinity?: (r: Restaurant) => number;
  /** label for "because you liked X" reasons */
  because?: (r: Restaurant) => string | null;
}

const lateOpen = (r: Restaurant) => r.hours.some(([, c]) => c > 1440 + 30);

/** How similar two places are (0..~6): same cuisine, shared moods/amenities, close price, same area. */
export function similarity(a: Restaurant, b: Restaurant): number {
  let s = 0;
  if (a.cuisine === b.cuisine) s += 2.5;
  else if (cuisines[a.cuisine]?.group && cuisines[a.cuisine]?.group === cuisines[b.cuisine]?.group) s += 1;
  s += a.moods.filter((m) => b.moods.includes(m)).length * 0.4;
  s += a.amenities.filter((m) => b.amenities.includes(m)).length * 0.15;
  s -= Math.abs(a.price - b.price) * 0.5;
  if (a.area === b.area) s += 0.4;
  return s;
}

const dishIndex = new Map<string, string[]>();
function bagOf(r: Restaurant): string[] {
  let b = dishIndex.get(r.id);
  if (!b) {
    b = tokens([r.ar, r.en, r.brand ?? "", cuisines[r.cuisine]?.ar, cuisines[r.cuisine]?.en, areaById[r.area]?.ar, areaById[r.area]?.en, ...r.menu.flatMap((s) => s.items.flatMap((i) => [i.ar, i.en]))].join(" "));
    dishIndex.set(r.id, b);
  }
  return b;
}

/**
 * The shared filter + scorer. Hard filters are applied at `relax` level 0; higher levels drop them in order
 * (open/price/delivery → area → cuisine). Returns the pool sorted best-first with human reasons.
 */
export function scorePlaces(f: Filters, ctx: ScoreCtx, pool: Restaurant[] = ALL, relax = 0): Pick[] {
  const { home, lang } = ctx;
  const now = ctx.now ?? new Date();
  const L = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const like = f.likeId ? ALL.find((r) => r.id === f.likeId) ?? null : null;
  const qWords = f.query ? tokens(f.query) : [];

  const hard = (r: Restaurant, km: number) => {
    if (like && r.id === like.id) return false;
    if (f.areas?.length && relax < 2 && !f.areas.includes(r.area)) return false;
    if (f.cuisines?.length && relax < 3 && !f.cuisines.includes(r.cuisine)) return false;
    if (f.openNow && relax < 1 && !openState(r.hours, now).open) return false;
    if (f.delivery && relax < 1 && !r.delivery) return false;
    if (f.price === "cheap" && relax < 1 && r.price > 2) return false;
    if (f.price === "pricey" && relax < 1 && r.price < 3) return false;
    if (f.maxAvg && relax < 1 && r.avg > f.maxAvg) return false;
    if (f.walk && relax < 1 && km > 2) return false;
    if (f.maxKm && relax < 1 && km > f.maxKm) return false;
    if (qWords.length && relax < 1) {
      const bag = bagOf(r);
      if (!qWords.every((w) => bag.some((t) => t === w || t.startsWith(w) || (w.length > 4 && editDistance(w, t, 1) <= 1)))) return false;
    }
    return true;
  };

  const out: Pick[] = [];
  for (const r of pool) {
    const km = haversineKm(home, r);
    if (!hard(r, km)) continue;
    const st = openState(r.hours, now);
    const reasons: string[] = [];
    let s = r.rating * 1.2 + (hasGoogle(r) ? r.google : r.rating) * 0.8 + Math.log10(r.visits + 10) * 0.6;
    if (r.verified) s += 0.3;
    const moodHits = (f.moods ?? []).filter((m) => r.moods.includes(m));
    s += moodHits.length * 2.4;
    if (moodHits.length) reasons.push(moodHits.map((m) => moodById[m][lang]).join(L("، ", ", ")));
    if (f.moods?.includes("late") && lateOpen(r)) s += 1.5;
    if (f.moods?.includes("work")) {
      if (r.amenities.includes("wifi")) s += 1;
      if (r.amenities.includes("outlets")) s += 0.6;
    }
    if (f.moods?.includes("family") && r.amenities.includes("kids")) s += 1;
    const am = f.amenities ?? [];
    const amHits = am.filter((a) => r.amenities.includes(a));
    s += amHits.length * 1.8 - (am.length - amHits.length) * 0.8;
    if (amHits.length) reasons.push(amHits.map((a) => amenityById[a][lang]).join(L("، ", ", ")));
    if (f.cuisines?.includes(r.cuisine)) s += 2;
    if (f.areas?.includes(r.area)) s += 2;
    if (like) {
      const sim = similarity(like, r);
      s += sim * 1.4;
      if (sim > 2) reasons.unshift(L(`شبه ${like.ar}`, `Similar to ${like.en}`));
    }
    if (qWords.length) s += 2 * Math.max(fuzzyScore(f.query!, r.ar), fuzzyScore(f.query!, r.en), 0.5);
    if (ctx.likedMoods?.length) s += r.moods.filter((m) => ctx.likedMoods!.includes(m)).length * 0.3;
    if (ctx.favourites?.includes(r.id)) s += 0.8;
    if (ctx.affinity) s += ctx.affinity(r);
    const because = ctx.because?.(r);
    if (because) reasons.push(because);
    const distW = f.near || f.walk ? 1.2 : f.areas?.length ? 0.05 : 0.25;
    s -= Math.min(km, 40) * distW;
    if (f.offer) s += r.offers.length ? 2 : -1;
    if (f.price === "cheap") s += (3 - r.price) * 0.5;
    if (f.price === "pricey") s += (r.price - 2) * 0.5;
    if (st.open) s += f.openNow ? 1 : 0.3;
    const tr = travel(km);
    reasons.push(
      tr.walk ? L(`${fmtKm(km, lang)} — ${tr.walk} دقيقة مشي`, `${fmtKm(km, lang)} — ${tr.walk} min walk`) : L(`${fmtKm(km, lang)} — حوالي ${tr.car} دقيقة بالعربية`, `${fmtKm(km, lang)} — about ${tr.car} min by car`),
    );
    if (st.open && st.at != null) reasons.push(L(`مفتوح لحد ${fmtTime(st.at, lang)}`, `open till ${fmtTime(st.at, lang)}`));
    else if (!st.open && st.at != null) reasons.push(L(`بيفتح ${fmtTime(st.at, lang)}`, `opens ${fmtTime(st.at, lang)}`));
    if (f.offer && r.offers[0]) reasons.push(r.offers[0][lang]);
    if (f.price || f.maxAvg) reasons.push(L(`حوالي ${r.avg} ج.م للفرد`, `about EGP ${r.avg} per person`));
    reasons.push(L(`تقييم ${r.rating} على سُفرة`, `rated ${r.rating} on Sufra`));
    out.push({ r, score: s, km, reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Relax hard filters until at least `min` places qualify. */
export function scoreRelaxed(f: Filters, ctx: ScoreCtx, pool: Restaurant[] = ALL, min = 2): { picks: Pick[]; relax: number } {
  let relax = 0;
  let picks = scorePlaces(f, ctx, pool, 0);
  while (picks.length < min && relax < 3) {
    relax++;
    picks = scorePlaces(f, ctx, pool, relax);
  }
  return { picks, relax };
}

/** Keep variety: no more than two of the same cuisine unless the user asked for one. */
export function diversify(scored: Pick[], n: number, cuisineAsked: boolean): Pick[] {
  const picks: Pick[] = [];
  for (const p of scored) {
    if (picks.length >= n) break;
    if (!cuisineAsked && picks.filter((x) => x.r.cuisine === p.r.cuisine).length >= 2) continue;
    picks.push(p);
  }
  return picks;
}

export const intentToFilters = (it: Intent): Filters => ({
  areas: it.areas, cuisines: it.cuisines, moods: it.moods, amenities: it.amenities, price: it.price, maxAvg: it.maxAvg,
  openNow: it.openNow, near: it.near, walk: it.walk, delivery: it.delivery, offer: it.offer, likeId: it.likeId,
});

export function recommend(q: string, ctx: ScoreCtx, pool: Restaurant[] = ALL): Answer {
  const it = parseIntent(q, pool);
  const { picks: scored, relax } = scoreRelaxed(intentToFilters(it), ctx, pool);
  const picks = diversify(scored, 3, it.cuisines.length > 0);
  const text = explain(picks, it, relax > 0, ctx.lang);
  return { picks, text, intent: it, relaxed: relax > 0 };
}

function explain(picks: Pick[], it: Intent, relaxed: boolean, lang: Lang): string {
  const L = (ar: string, en: string) => (lang === "ar" ? ar : en);
  if (!picks.length) return L("مش لاقي حاجة مناسبة بالظبط. جرّب تقولّي المنطقة أو نوع الأكل.", "I couldn't find a match. Try telling me an area or a cuisine.");
  const names = picks.map((p) => p.r[lang]);
  const list = lang === "ar" ? names.slice(0, -1).join("، ") + (names.length > 1 ? " و" : "") + names[names.length - 1] : names.slice(0, -1).join(", ") + (names.length > 1 ? " and " : "") + names[names.length - 1];
  const bits: string[] = [];
  const like = it.likeId ? ALL.find((r) => r.id === it.likeId) : null;
  if (like) bits.push(L(`قريبين من ${like.ar}`, `close in spirit to ${like.en}`));
  if (it.areas.length) bits.push(L("في " + it.areas.map((a) => areaById[a]?.ar ?? a).join(" و"), "in " + it.areas.map((a) => areaById[a]?.en ?? a).join(" & ")));
  if (it.cuisines.length) bits.push(it.cuisines.map((c) => cuisines[c]?.[lang] ?? c).join(L(" و", " & ")));
  if (it.openNow) bits.push(L("مفتوحين دلوقتي", "open now"));
  const lead = !it.understood.length ? L("ما فهمتش قوي، بس دي أكتر أماكن الناس بتحبها قريب منك:", "Not sure what you meant, but these are crowd favourites near you:") : relaxed ? L("مفيش تطابق كامل، فوسّعت الدايرة شوية:", "No exact match, so I widened the search a bit:") : L("لقيتلك:", "Here's what I found:");
  return `${lead} ${list}${bits.length ? " — " + bits.join(L("، ", ", ")) : ""}. ${L("التفاصيل والسبب تحت.", "Details and why below.")}`;
}

/** "Best for you" score for sorting and the "مقترح ليك" rail (the taste model adds its affinity on top). */
export function personalScore(r: Restaurant, ctx: { home: LatLng; likedMoods: Mood[]; favCuisines: string[]; favourites: string[]; affinity?: (r: Restaurant) => number }): number {
  const km = haversineKm(ctx.home, r);
  let s = r.rating * 1.5 + (hasGoogle(r) ? r.google : r.rating) * 0.5;
  s += r.moods.filter((m) => ctx.likedMoods.includes(m)).length * 0.9;
  if (ctx.favCuisines.includes(r.cuisine)) s += 1.2;
  if (ctx.favourites.includes(r.id)) s -= 0.6; // you already know it; surface new ones
  s -= Math.min(km, 30) * 0.12;
  if (r.isNew) s += 0.3;
  if (ctx.affinity) s += ctx.affinity(r);
  return s;
}

/** canonical-token helper re-exported for tests */
export { canon };

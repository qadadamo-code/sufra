/**
 * "اسأل سُفرة" — a small LOCAL recommender. No network: it parses Arabic (Egyptian/Levantine) and English intent
 * words out of a free-text question, filters/scores the dataset and explains its picks.
 */
import { areaById, areas, cuisines, type Amenity, type Lang, type Mood, type Restaurant, restaurants as ALL, amenityById, moodById } from "./data";
import { haversineKm, travel, fmtKm, type LatLng } from "./geo";
import { fmtTime, openState } from "./hours";

/** Normalise Arabic for matching: strip tashkeel/tatweel, unify alef/yaa/taa marbuta, lowercase Latin. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const AREA_WORDS: Record<string, string[]> = {
  zamalek: ["زمالك", "zamalek"],
  "garden-city": ["جاردن سيتي", "جاردن", "garden city"],
  downtown: ["وسط البلد", "وسط البلد", "داون تاون", "التحرير", "downtown"],
  dokki: ["دقي", "الدقي", "dokki"],
  mohandessin: ["مهندسين", "المهندسين", "mohandessin", "mohandeseen"],
  maadi: ["معادي", "المعادي", "maadi"],
  heliopolis: ["مصر الجديده", "الكوربه", "هليوبوليس", "heliopolis", "korba"],
  "nasr-city": ["مدينه نصر", "مدينة نصر", "nasr city", "nasr"],
  "new-cairo": ["التجمع", "تجمع", "القاهره الجديده", "new cairo", "tagamoa", "5th settlement"],
  rehab: ["الرحاب", "رحاب", "rehab"],
  zayed: ["زايد", "الشيخ زايد", "sheikh zayed", "zayed"],
  october: ["اكتوبر", "٦ اكتوبر", "6 اكتوبر", "october"],
};

const CUISINE_WORDS: Record<string, string[]> = {
  cafe: ["كافيه", "كافي", "قهوه", "قهوة مختصه", "سبشلتي", "لاتيه", "كابتشينو", "cafe", "coffee", "latte"],
  egyptian: ["مصري", "كشري", "فول", "طعميه", "فلافل", "ملوخيه", "محشي", "فطير", "حواوشي", "egyptian", "koshari", "ful"],
  levant: ["شامي", "لبناني", "سوري", "شاورما", "فتوش", "حمص", "lebanese", "levant", "syrian", "shawarma"],
  grill: ["مشويات", "مشوي", "كباب", "كفته", "فراخ مشويه", "grill", "kebab", "kofta", "bbq"],
  italian: ["ايطالي", "بيتزا", "باستا", "مكرونه", "italian", "pizza", "pasta"],
  burger: ["برجر", "برجر", "امريكي", "فرايز", "burger", "american", "fries"],
  asian: ["اسيوي", "سوشي", "صيني", "ياباني", "تايلندي", "رامن", "asian", "sushi", "chinese", "japanese", "thai", "ramen"],
  seafood: ["سمك", "اسماك", "جمبري", "سي فود", "مأكولات بحريه", "seafood", "fish", "shrimp"],
  dessert: ["حلويات", "كنافه", "بسبوسه", "ايس كريم", "تشيز كيك", "dessert", "sweets", "cake", "ice cream"],
  bakery: ["مخبوزات", "مخبز", "كرواسون", "عيش", "bakery", "croissant", "pastry"],
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
  friends: ["اصحاب", "صحاب", "صحابي", "اصحابي", "شله", "الشله", "friends", "group", "gang", "buddies"],
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
const OPEN_NOW = ["مفتوح دلوقتي", "مفتوح", "دلوقتي", "حالا", "النهارده", "open now", "now", "open", "tonight", "right now"];
const NEAR = ["قريب", "جنبي", "قريب مني", "جمبي", "حوالين", "near", "nearby", "close", "closest", "around me"];
const WALK = ["مشي", "علي رجلي", "walking", "walk"];
const DELIVERY = ["دليفري", "توصيل", "اطلب", "اوردر", "delivery", "deliver", "order in"];
const OFFER = ["عرض", "عروض", "خصم", "خصومات", "اوفر", "offer", "deal", "discount", "promo"];
const BOOK = ["احجز", "حجز", "ترابيزه", "book", "reserve", "reservation", "table"];

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
  understood: string[];
}

/** Whole-word-ish match on normalised text (Arabic words may carry a "ال" or "و" prefix). */
function has(text: string, word: string): boolean {
  const w = norm(word);
  if (!w) return false;
  const pre = "(?:^|\\s)(?:و|ف|ب|ل|في|بال|وال|لل|ال)?";
  const re = new RegExp(pre + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=$|\\s|ين|ات|ه)", "u");
  return re.test(text);
}
const any = (t: string, ws: string[]) => ws.some((w) => has(t, w));

export function parseIntent(q: string): Intent {
  const t = norm(q);
  const it: Intent = {
    areas: [], cuisines: [], moods: [], amenities: [], price: null, maxAvg: null,
    openNow: false, near: false, walk: false, delivery: false, offer: false, book: false, understood: [],
  };
  for (const [id, ws] of Object.entries(AREA_WORDS)) if (any(t, ws)) it.areas.push(id);
  for (const a of areas) if (!it.areas.includes(a.id) && (has(t, a.ar) || has(t, a.en))) it.areas.push(a.id);
  for (const [id, ws] of Object.entries(CUISINE_WORDS)) if (any(t, ws)) it.cuisines.push(id);
  for (const [id, ws] of Object.entries(MOOD_WORDS) as [Mood, string[]][]) if (any(t, ws)) it.moods.push(id);
  for (const [id, ws] of Object.entries(AMENITY_WORDS) as [Amenity, string[]][]) if (any(t, ws)) it.amenities.push(id);
  // "قهوة بلدي" is an ahwa, not a specialty café
  if (it.cuisines.includes("shisha") && it.cuisines.includes("cafe") && has(t, "بلدي")) it.cuisines = it.cuisines.filter((c) => c !== "cafe");
  if (any(t, CHEAP)) it.price = "cheap";
  else if (any(t, PRICEY)) it.price = "pricey";
  const m = t.match(/(?:تحت|اقل من|under|below|less than|max)\s*(\d{2,4})/);
  if (m) it.maxAvg = Number(m[1]);
  it.openNow = any(t, OPEN_NOW);
  it.near = any(t, NEAR);
  it.walk = any(t, WALK);
  it.delivery = any(t, DELIVERY);
  it.offer = any(t, OFFER);
  it.book = any(t, BOOK);
  if (it.moods.includes("late")) it.openNow = it.openNow || false;
  const n = [it.areas.length, it.cuisines.length, it.moods.length, it.amenities.length, it.price ? 1 : 0, it.maxAvg ? 1 : 0, +it.openNow, +it.near, +it.walk, +it.delivery, +it.offer];
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

const lateOpen = (r: Restaurant) => r.hours.some(([, c]) => c > 1440 + 30);

export function recommend(q: string, ctx: { home: LatLng; lang: Lang; now?: Date; favourites?: string[]; likedMoods?: Mood[] }, pool: Restaurant[] = ALL): Answer {
  const { home, lang } = ctx;
  const now = ctx.now ?? new Date();
  const it = parseIntent(q);
  const L = (ar: string, en: string) => (lang === "ar" ? ar : en);

  const hard = (r: Restaurant, relax: number) => {
    if (it.areas.length && relax < 2 && !it.areas.includes(r.area)) return false;
    if (it.cuisines.length && relax < 3 && !it.cuisines.includes(r.cuisine)) return false;
    if (it.openNow && relax < 1 && !openState(r.hours, now).open) return false;
    if (it.delivery && relax < 1 && !r.delivery) return false;
    if (it.price === "cheap" && relax < 1 && r.price > 2) return false;
    if (it.price === "pricey" && relax < 1 && r.price < 3) return false;
    if (it.maxAvg && relax < 1 && r.avg > it.maxAvg) return false;
    if (it.walk && relax < 1 && haversineKm(home, r) > 2) return false;
    return true;
  };

  let relax = 0;
  let pool2 = pool.filter((r) => hard(r, 0));
  while (pool2.length < 2 && relax < 3) {
    relax++;
    pool2 = pool.filter((r) => hard(r, relax));
  }

  const scored: Pick[] = pool2.map((r) => {
    const km = haversineKm(home, r);
    const st = openState(r.hours, now);
    const reasons: string[] = [];
    let s = r.rating * 1.2 + r.google * 0.8 + Math.log10(r.visits + 10) * 0.6;
    const moodHits = it.moods.filter((m) => r.moods.includes(m));
    s += moodHits.length * 2.4;
    if (moodHits.length) reasons.push(moodHits.map((m) => moodById[m][lang]).join(L("، ", ", ")));
    if (it.moods.includes("late") && lateOpen(r)) {
      s += 1.5;
    }
    if (it.moods.includes("work")) {
      if (r.amenities.includes("wifi")) s += 1;
      if (r.amenities.includes("outlets")) s += 0.6;
    }
    if (it.moods.includes("family") && r.amenities.includes("kids")) s += 1;
    const amHits = it.amenities.filter((a) => r.amenities.includes(a));
    s += amHits.length * 1.8 - (it.amenities.length - amHits.length) * 0.8;
    if (amHits.length) reasons.push(amHits.map((a) => amenityById[a][lang]).join(L("، ", ", ")));
    if (it.cuisines.includes(r.cuisine)) s += 2;
    if (it.areas.includes(r.area)) s += 2;
    if (ctx.likedMoods?.length) s += r.moods.filter((m) => ctx.likedMoods!.includes(m)).length * 0.3;
    if (ctx.favourites?.includes(r.id)) s += 0.8;
    const distW = it.near || it.walk ? 1.2 : it.areas.length ? 0.05 : 0.25;
    s -= km * distW;
    if (it.offer) s += r.offers.length ? 2 : -1;
    if (it.price === "cheap") s += (3 - r.price) * 0.5;
    if (it.price === "pricey") s += (r.price - 2) * 0.5;
    if (st.open) s += it.openNow ? 1 : 0.3;
    // reasons that are always useful
    const tr = travel(km);
    reasons.push(
      tr.walk ? L(`${fmtKm(km, lang)} — ${tr.walk} دقيقة مشي`, `${fmtKm(km, lang)} — ${tr.walk} min walk`) : L(`${fmtKm(km, lang)} — حوالي ${tr.car} دقيقة بالعربية`, `${fmtKm(km, lang)} — about ${tr.car} min by car`),
    );
    if (st.open && st.at != null) reasons.push(L(`مفتوح لحد ${fmtTime(st.at, lang)}`, `open till ${fmtTime(st.at, lang)}`));
    else if (!st.open && st.at != null) reasons.push(L(`بيفتح ${fmtTime(st.at, lang)}`, `opens ${fmtTime(st.at, lang)}`));
    if (it.offer && r.offers[0]) reasons.push(r.offers[0][lang]);
    if (it.price || it.maxAvg) reasons.push(L(`حوالي ${r.avg} ج.م للفرد`, `about EGP ${r.avg} per person`));
    reasons.push(L(`تقييم ${r.rating} على سُفرة`, `rated ${r.rating} on Sufra`));
    return { r, score: s, km, reasons };
  });
  scored.sort((a, b) => b.score - a.score);
  // keep variety: avoid three from the exact same cuisine unless asked
  const picks: Pick[] = [];
  for (const p of scored) {
    if (picks.length >= 3) break;
    if (!it.cuisines.length && picks.filter((x) => x.r.cuisine === p.r.cuisine).length >= 2) continue;
    picks.push(p);
  }

  const text = explain(picks, it, relax > 0, lang);
  return { picks, text, intent: it, relaxed: relax > 0 };
}

function explain(picks: Pick[], it: Intent, relaxed: boolean, lang: Lang): string {
  const L = (ar: string, en: string) => (lang === "ar" ? ar : en);
  if (!picks.length) return L("مش لاقي حاجة مناسبة بالظبط. جرّب تقولّي المنطقة أو نوع الأكل.", "I couldn't find a match. Try telling me an area or a cuisine.");
  const names = picks.map((p) => p.r[lang]);
  const list = lang === "ar" ? names.slice(0, -1).join("، ") + (names.length > 1 ? " و" : "") + names[names.length - 1] : names.slice(0, -1).join(", ") + (names.length > 1 ? " and " : "") + names[names.length - 1];
  const bits: string[] = [];
  if (it.areas.length) bits.push(L("في " + it.areas.map((a) => areaById[a].ar).join(" و"), "in " + it.areas.map((a) => areaById[a].en).join(" & ")));
  if (it.cuisines.length) bits.push(it.cuisines.map((c) => cuisines[c][lang]).join(L(" و", " & ")));
  if (it.openNow) bits.push(L("مفتوحين دلوقتي", "open now"));
  const lead = !it.understood.length ? L("ما فهمتش قوي، بس دي أكتر أماكن الناس بتحبها قريب منك:", "Not sure what you meant, but these are crowd favourites near you:") : relaxed ? L("مفيش تطابق كامل، فوسّعت الدايرة شوية:", "No exact match, so I widened the search a bit:") : L("لقيتلك:", "Here's what I found:");
  return `${lead} ${list}${bits.length ? L(" — ", " — ") + bits.join(L("، ", ", ")) : ""}. ${L("التفاصيل والسبب تحت.", "Details and why below.")}`;
}

/** "Best for you" score for sorting and the "مقترح ليك" rail. */
export function personalScore(r: Restaurant, ctx: { home: LatLng; likedMoods: Mood[]; favCuisines: string[]; favourites: string[] }): number {
  const km = haversineKm(ctx.home, r);
  let s = r.rating * 1.5 + r.google * 0.5;
  s += r.moods.filter((m) => ctx.likedMoods.includes(m)).length * 0.9;
  if (ctx.favCuisines.includes(r.cuisine)) s += 1.2;
  if (ctx.favourites.includes(r.id)) s -= 0.6; // you already know it; surface new ones
  s -= Math.min(km, 30) * 0.12;
  if (r.isNew) s += 0.3;
  return s;
}

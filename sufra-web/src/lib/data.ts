import raw from "../../data/restaurants.json";

export type Lang = "ar" | "en";
export type Mood = "work" | "eat" | "drinks" | "friends" | "family" | "date" | "celebrate" | "quick" | "late" | "breakfast";
export type Amenity =
  | "wifi" | "outlets" | "quiet" | "parking" | "outdoor" | "kids" | "wheelchair" | "shisha" | "live-music"
  | "prayer" | "sports-screens" | "pet-friendly" | "valet" | "nile-view" | "rooftop" | "reservations";
export type CuisineGroup = "eastern" | "western" | "asian" | "sweets" | "drinks";
export type ItemTag = "veg" | "spicy" | "new" | "best" | "share";
export type OfferKind = "percent" | "happy-hour" | "free-delivery" | "first-visit" | "plus" | "bogo" | "group";

export interface Area { id: string; ar: string; en: string; lat: number; lng: number }
export interface Cuisine { ar: string; en: string; group: CuisineGroup }
export interface Offer {
  id: string; kind: OfferKind; value: number; ar: string; en: string; code: string; days: number[]; endsInDays: number;
  from?: number; to?: number;
}
export interface MenuItem { id: string; ar: string; en: string; descAr: string; descEn: string; price: number; img: string; tags: ItemTag[]; kcal: number }
export interface MenuSection { ar: string; en: string; items: MenuItem[] }
export interface Review { name: string; text: string; stars: number; daysAgo: number }
export interface Restaurant {
  id: string; slug: string; ar: string; en: string; cuisine: string; area: string; addressAr: string; addressEn: string;
  lat: number; lng: number; price: 1 | 2 | 3 | 4; avg: number; hours: [number, number][];
  rating: number; ratingCount: number; google: number; googleCount: number; visits: number;
  moods: Mood[]; amenities: Amenity[]; delivery: { fee: number; eta: number; min: number } | null;
  cover: string; gallery: string[]; descAr: string; descEn: string; since: number; isNew: boolean; phone: string; instagram: string;
  offers: Offer[]; busy: number[]; reviews: Review[]; menu: MenuSection[];
  /** optional per-restaurant service charge (defaults below) */
  serviceRate?: number;
}

const data = raw as unknown as { areas: Area[]; cuisines: Record<string, Cuisine>; restaurants: Restaurant[] };

export const areas: Area[] = data.areas;
export const cuisines: Record<string, Cuisine> = data.cuisines;
export const restaurants: Restaurant[] = data.restaurants;

export const areaById: Record<string, Area> = Object.fromEntries(areas.map((a) => [a.id, a]));
export const bySlug: Record<string, Restaurant> = Object.fromEntries(restaurants.map((r) => [r.slug, r]));
export const byId: Record<string, Restaurant> = Object.fromEntries(restaurants.map((r) => [r.id, r]));
export const itemIndex: Record<string, { item: MenuItem; r: Restaurant; section: MenuSection }> = {};
for (const r of restaurants) for (const s of r.menu) for (const it of s.items) itemIndex[it.id] = { item: it, r, section: s };

/** Service charge is configurable per restaurant; counter-service places (cafés, bakeries, ahwas) charge 10 %. */
export function serviceRateOf(r: Restaurant): number {
  if (typeof r.serviceRate === "number") return r.serviceRate;
  return ["cafe", "bakery", "shisha", "dessert"].includes(r.cuisine) ? 0.1 : 0.12;
}

export const GROUPS: { id: CuisineGroup; ar: string; en: string }[] = [
  { id: "eastern", ar: "شرقي", en: "Eastern" },
  { id: "western", ar: "غربي", en: "Western" },
  { id: "asian", ar: "آسيوي", en: "Asian" },
  { id: "sweets", ar: "حلويات ومخبوزات", en: "Sweets & bakery" },
  { id: "drinks", ar: "مشروبات وقهاوي", en: "Drinks & cafés" },
];

export const MOODS: { id: Mood; ar: string; en: string; hintAr: string; hintEn: string }[] = [
  { id: "work", ar: "شغل ومذاكرة", en: "Work & study", hintAr: "واي فاي وفيش وهدوء", hintEn: "Wi-Fi, outlets, calm" },
  { id: "eat", ar: "أكلة حلوة", en: "A proper meal", hintAr: "مطبخ يستاهل المشوار", hintEn: "Kitchens worth the trip" },
  { id: "drinks", ar: "قهوة ومشروبات", en: "Coffee & drinks", hintAr: "قهوة مختصة وعصاير", hintEn: "Specialty coffee, juices" },
  { id: "friends", ar: "خروجة أصحاب", en: "With friends", hintAr: "قعدة طويلة وضحك", hintEn: "Long tables, loud laughs" },
  { id: "family", ar: "عيلة وأطفال", en: "Family & kids", hintAr: "مساحة ومنيو للكل", hintEn: "Room and a menu for all" },
  { id: "date", ar: "ديت رومانسي", en: "Date night", hintAr: "إضاءة هادية وفيو", hintEn: "Low light, a view" },
  { id: "celebrate", ar: "احتفال", en: "Celebrate", hintAr: "أعياد ميلاد ومناسبات", hintEn: "Birthdays & occasions" },
  { id: "quick", ar: "حاجة سريعة", en: "Quick bite", hintAr: "في أقل من نص ساعة", hintEn: "In and out in 30" },
  { id: "late", ar: "سهر", en: "Late night", hintAr: "مفتوح بعد نص الليل", hintEn: "Open past midnight" },
  { id: "breakfast", ar: "فطار", en: "Breakfast", hintAr: "فول وفلافل أو بانكيك", hintEn: "Ful, falafel or pancakes" },
];
export const moodById = Object.fromEntries(MOODS.map((m) => [m.id, m])) as Record<Mood, (typeof MOODS)[number]>;

export const AMENITIES: { id: Amenity; ar: string; en: string }[] = [
  { id: "wifi", ar: "واي فاي", en: "Wi-Fi" },
  { id: "outlets", ar: "فيش كهربا", en: "Power outlets" },
  { id: "quiet", ar: "هادي", en: "Quiet" },
  { id: "parking", ar: "ركنة", en: "Parking" },
  { id: "outdoor", ar: "قعدة برا", en: "Outdoor seating" },
  { id: "kids", ar: "مناسب للأطفال", en: "Kid-friendly" },
  { id: "wheelchair", ar: "مناسب للكراسي المتحركة", en: "Wheelchair access" },
  { id: "shisha", ar: "شيشة", en: "Shisha" },
  { id: "live-music", ar: "مزيكا لايف", en: "Live music" },
  { id: "prayer", ar: "مصلّى", en: "Prayer room" },
  { id: "sports-screens", ar: "شاشات ماتشات", en: "Sports screens" },
  { id: "pet-friendly", ar: "مسموح بالحيوانات", en: "Pet-friendly" },
  { id: "valet", ar: "فاليه", en: "Valet" },
  { id: "nile-view", ar: "فيو على النيل", en: "Nile view" },
  { id: "rooftop", ar: "روف", en: "Rooftop" },
  { id: "reservations", ar: "بيقبل حجز", en: "Takes reservations" },
];
export const amenityById = Object.fromEntries(AMENITIES.map((a) => [a.id, a])) as Record<Amenity, (typeof AMENITIES)[number]>;

export const TAGS: Record<ItemTag, { ar: string; en: string }> = {
  veg: { ar: "نباتي", en: "Vegetarian" },
  spicy: { ar: "حار", en: "Spicy" },
  new: { ar: "جديد", en: "New" },
  best: { ar: "الأكثر طلبًا", en: "Most ordered" },
  share: { ar: "للمشاركة", en: "To share" },
};

export const DAYS_AR = ["الأحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"];
export const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const cuisineName = (id: string, lang: Lang) => cuisines[id]?.[lang] ?? id;
export const areaName = (id: string, lang: Lang) => areaById[id]?.[lang] ?? id;
export const name = (x: { ar: string; en: string }, lang: Lang) => x[lang];

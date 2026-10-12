/**
 * SAMPLE data for the owner dashboard (a fictional restaurant). Everything is generated deterministically so the
 * screenshots are stable; nothing here is real.
 */
import { egp } from "./plans";

export const FLOOR_DEMO_URL = "https://claude.ai/artifact/AWGNREZLHNNnpm2QQwRVno";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DayStat {
  date: string; // YYYY-MM-DD
  orders: number;
  covers: number;
  /** piastres, before VAT */
  sales: number;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A year (365 days ending today) of daily orders: weekends (Thu/Fri) busier, Ramadan-ish dip, summer bump, growth. */
export function yearOfDays(today = new Date()): DayStat[] {
  const r = rng(20261012);
  const out: DayStat[] = [];
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (let i = 364; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const dow = d.getDay();
    const growth = 0.75 + ((364 - i) / 364) * 0.45;
    const weekend = dow === 4 ? 1.35 : dow === 5 ? 1.5 : dow === 6 ? 1.1 : 1;
    const month = d.getMonth();
    const season = month === 2 ? 0.7 : month >= 5 && month <= 7 ? 1.15 : 1;
    const closed = r() < 0.012;
    const orders = closed ? 0 : Math.round((60 + r() * 55) * growth * weekend * season);
    const covers = Math.round(orders * (2.1 + r() * 0.6));
    const avgTicket = 360 + r() * 140;
    out.push({ date: iso(d), orders, covers, sales: egp(Math.round(orders * avgTicket)) });
  }
  return out;
}

export const HOURLY_TODAY = [0, 0, 0, 0, 0, 0, 0, 0, 3, 6, 8, 12, 19, 26, 22, 14, 11, 15, 24, 31, 28, 18, 9, 4];

export interface Staff {
  id: string;
  name: string;
  nameEn: string;
  email: string;
  role: "owner" | "manager" | "cashier" | "waiter" | "chef" | "kitchen" | "host" | "delivery";
  status: "on" | "off" | "break" | "leave";
  lastSeen: string;
  branch: string;
}

export const STAFF: Staff[] = [
  { id: "u-01", name: "كريم عبد الرحمن", nameEn: "Karim Abdelrahman", email: "karim@sufra.demo", role: "owner", status: "on", lastSeen: "الآن", branch: "الزمالك" },
  { id: "u-02", name: "منى السيد", nameEn: "Mona Elsayed", email: "mona@sufra.demo", role: "manager", status: "on", lastSeen: "الآن", branch: "الزمالك" },
  { id: "u-03", name: "أحمد فتحي", nameEn: "Ahmed Fathy", email: "ahmed.f@sufra.demo", role: "cashier", status: "on", lastSeen: "منذ 2 د", branch: "الزمالك" },
  { id: "u-04", name: "سلمى حسن", nameEn: "Salma Hassan", email: "salma@sufra.demo", role: "host", status: "on", lastSeen: "منذ 5 د", branch: "الزمالك" },
  { id: "u-05", name: "الشيف عادل", nameEn: "Chef Adel", email: "adel@sufra.demo", role: "chef", status: "on", lastSeen: "الآن", branch: "الزمالك" },
  { id: "u-06", name: "محمود رجب", nameEn: "Mahmoud Ragab", email: "mahmoud@sufra.demo", role: "kitchen", status: "break", lastSeen: "منذ 14 د", branch: "الزمالك" },
  { id: "u-07", name: "يوسف ماهر", nameEn: "Youssef Maher", email: "youssef@sufra.demo", role: "waiter", status: "on", lastSeen: "الآن", branch: "الزمالك" },
  { id: "u-08", name: "نور الهدى", nameEn: "Nour Elhoda", email: "nour@sufra.demo", role: "waiter", status: "on", lastSeen: "منذ 1 د", branch: "الزمالك" },
  { id: "u-09", name: "حسام علي", nameEn: "Hossam Ali", email: "hossam@sufra.demo", role: "delivery", status: "on", lastSeen: "منذ 8 د", branch: "الزمالك" },
  { id: "u-10", name: "ريهام سعيد", nameEn: "Reham Saeed", email: "reham@sufra.demo", role: "cashier", status: "off", lastSeen: "أمس 11:40 م", branch: "المعادي" },
  { id: "u-11", name: "مصطفى كمال", nameEn: "Moustafa Kamal", email: "moustafa@sufra.demo", role: "kitchen", status: "leave", lastSeen: "منذ 3 أيام", branch: "المعادي" },
  { id: "u-12", name: "دينا وائل", nameEn: "Dina Wael", email: "dina@sufra.demo", role: "waiter", status: "off", lastSeen: "أمس 10:05 م", branch: "المعادي" },
];

export const ROLE_NAMES: Record<Staff["role"], { ar: string; en: string }> = {
  owner: { ar: "مالك", en: "Owner" },
  manager: { ar: "مدير صالة", en: "Manager" },
  cashier: { ar: "كاشير", en: "Cashier" },
  waiter: { ar: "ويتر", en: "Waiter" },
  chef: { ar: "شيف", en: "Head chef" },
  kitchen: { ar: "مطبخ", en: "Kitchen" },
  host: { ar: "استقبال", en: "Host" },
  delivery: { ar: "توصيل", en: "Delivery" },
};

export interface MenuItemDemo {
  id: string;
  ar: string;
  en: string;
  price: number;
  cost: number;
  img: string;
  available: boolean;
}
export interface MenuSectionDemo {
  id: string;
  ar: string;
  en: string;
  items: MenuItemDemo[];
}

const mi = (id: string, ar: string, en: string, price: number, cost: number, img: string, available = true): MenuItemDemo => ({ id, ar, en, price: egp(price), cost: egp(cost), img, available });
export const MENU: MenuSectionDemo[] = [
  { id: "starters", ar: "مقبلات", en: "Starters", items: [mi("m1", "حمص بالطحينة", "Hummus", 85, 22, "dish-hummus"), mi("m2", "بابا غنوج", "Baba ghanoush", 80, 19, "dish-baba-ghanoush"), mi("m3", "فتوش", "Fattoush", 95, 24, "dish-fattoush"), mi("m4", "كبيبة", "Kibbeh", 120, 41, "dish-kibbeh")] },
  { id: "grills", ar: "مشويات", en: "Grills", items: [mi("m5", "كفتة مشوية", "Grilled kofta", 260, 92, "dish-kofta"), mi("m6", "شيش طاووق", "Shish tawook", 230, 71, "dish-shish-tawook"), mi("m7", "مشويات مشكلة", "Mixed grill", 480, 178, "dish-mixed-grill"), mi("m8", "ستيك ريب آي", "Rib-eye steak", 690, 285, "dish-steak", false)] },
  { id: "mains", ar: "أطباق رئيسية", en: "Mains", items: [mi("m9", "فتة لحمة", "Beef fatta", 290, 104, "dish-fattah"), mi("m10", "ملوخية بالفراخ", "Molokhia with chicken", 210, 63, "dish-molokhia"), mi("m11", "محشي مشكل", "Mixed mahshi", 180, 48, "dish-mahshi"), mi("m12", "سمك مشوي", "Grilled fish", 340, 139, "dish-grilled-fish")] },
  { id: "desserts", ar: "حلويات", en: "Desserts", items: [mi("m13", "أم علي", "Om Ali", 95, 26, "dish-om-ali"), mi("m14", "كنافة بالقشطة", "Kunafa", 110, 33, "dish-kunafa"), mi("m15", "بسبوسة", "Basbousa", 70, 15, "dish-basbousa")] },
  { id: "drinks", ar: "مشروبات", en: "Drinks", items: [mi("m16", "ليمون نعناع", "Lemon mint", 65, 12, "dish-lemonade"), mi("m17", "عصير برتقال فريش", "Fresh orange juice", 70, 18, "dish-fresh-juice"), mi("m18", "شاي بالنعناع", "Mint tea", 35, 4, "dish-mint-tea"), mi("m19", "قهوة تركي", "Turkish coffee", 45, 9, "dish-espresso")] },
];

export const TOP_DISHES = [
  { id: "m7", qty: 64 },
  { id: "m5", qty: 58 },
  { id: "m9", qty: 41 },
  { id: "m1", qty: 39 },
  { id: "m14", qty: 33 },
];

export const LOW_STOCK = [
  { ar: "صدور فراخ", en: "Chicken breast", left: 3.5, par: 12, unitAr: "كجم", unitEn: "kg", key: "chicken-breast" },
  { ar: "طحينة", en: "Tahini", left: 1.2, par: 6, unitAr: "كجم", unitEn: "kg", key: "tahini" },
  { ar: "ليمون", en: "Lemons", left: 2, par: 8, unitAr: "كجم", unitEn: "kg", key: "lemon" },
  { ar: "كريمة طبخ", en: "Cooking cream", left: 3, par: 10, unitAr: "لتر", unitEn: "L", key: "cooking-cream" },
];

export const REVIEWS = [
  { name: "مريم ع.", stars: 5, text: "الفتة تحفة والخدمة سريعة جدًا.", textEn: "The fatta was amazing and service was fast.", ago: 2 },
  { name: "Omar K.", stars: 4, text: "مكان حلو بس الدوشة شوية بالليل.", textEn: "Lovely place, a bit loud at night.", ago: 5 },
  { name: "هالة م.", stars: 5, text: "حجزت من سُفرة والترابيزة كانت جاهزة.", textEn: "Booked on Sufra, table was ready.", ago: 9 },
];

export const RESERVATIONS_TODAY = [
  { time: "13:30", name: "أ. شريف", size: 4, table: "T4", status: "seated" as const },
  { time: "14:00", name: "عائلة منصور", size: 8, table: "T9+T10", status: "seated" as const },
  { time: "19:30", name: "Laila H.", size: 2, table: "T2", status: "confirmed" as const },
  { time: "20:00", name: "عيد ميلاد نادين", size: 10, table: "T11+T12", status: "confirmed" as const },
  { time: "20:45", name: "م. هشام", size: 3, table: "T6", status: "pending" as const },
  { time: "21:30", name: "Youssef A.", size: 2, table: "—", status: "waitlist" as const },
];

/** Floor snapshot: 14 tables. */
export const FLOOR = Array.from({ length: 14 }, (_, i) => {
  const states = ["busy", "busy", "free", "busy", "reserved", "free", "bill", "busy", "free", "busy", "busy", "reserved", "free", "busy"] as const;
  return { id: `T${i + 1}`, seats: [2, 2, 4, 4, 4, 6, 4, 2, 4, 6, 4, 6, 2, 4][i], state: states[i] };
});

/** E-receipts queued for the Egyptian Tax Authority (24h submission window). */
export const ERECEIPTS = { pending: 7, submitted: 3, valid: 412, overdue: 0, oldestPendingMin: 18 };

export const CASH_DRAWER = { opening: egp(2000), cashSales: egp(18450), payouts: egp(650), expected: egp(19800), counted: null as number | null };

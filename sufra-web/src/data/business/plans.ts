/**
 * Sufra for restaurants — plans, billing periods and add-ons.
 *
 * THIS IS THE ONE FILE TO EDIT WHEN PRICES CHANGE. Every number on the pricing page, the sign-up wizard and the
 * comparison table is read from here. Money is in integer piastres (1 EGP = 100 piastres); use `egp(…)` to write
 * pounds. Prices are BEFORE VAT; the page adds VAT (`VAT_RATE`) on top.
 */

export const egp = (pounds: number) => Math.round(pounds * 100);

/** Egyptian VAT on software subscriptions. */
export const VAT_RATE = 0.14;
/** Free trial length shown on every CTA. */
export const TRIAL_DAYS = 14;

export type PlanId = "basic" | "pro" | "enterprise";
export type PeriodId = "monthly" | "yearly" | "threeYear" | "lifetime";

export interface Period {
  id: PeriodId;
  ar: string;
  en: string;
  /** months of service the payment covers (0 = lifetime / perpetual) */
  months: number;
  /** months you actually pay for (yearly: 12 months of service for 10 months of price) */
  paidMonths?: number;
  /** extra percentage discount applied on top of paidMonths (3 years) */
  discountPct?: number;
  badgeAr?: string;
  badgeEn?: string;
}

export const PERIODS: Period[] = [
  { id: "monthly", ar: "شهري", en: "Monthly", months: 1, paidMonths: 1 },
  { id: "yearly", ar: "سنوي", en: "Yearly", months: 12, paidMonths: 10, badgeAr: "شهرين ببلاش", badgeEn: "2 months free" },
  { id: "threeYear", ar: "3 سنين", en: "3 years", months: 36, paidMonths: 36, discountPct: 30, badgeAr: "وفّر 30٪", badgeEn: "Save 30%" },
  { id: "lifetime", ar: "شراء كامل", en: "Own it", months: 0, badgeAr: "مرة واحدة", badgeEn: "One-time" },
];

export interface Plan {
  id: PlanId;
  ar: string;
  en: string;
  taglineAr: string;
  taglineEn: string;
  /** monthly list price (piastres, before VAT) */
  monthly: number;
  /** one-time perpetual licence (piastres, before VAT) — "شراء كامل للسستم" */
  lifetime: number;
  /** yearly maintenance & updates after the first year, % of the licence */
  maintenancePct: number;
  branches: number;
  posDevices: number;
  users: number | null; // null = unlimited
  highlight?: boolean;
  featuresAr: string[];
  featuresEn: string[];
}

export const PLANS: Plan[] = [
  {
    id: "basic",
    ar: "أساسي",
    en: "Basic",
    taglineAr: "فرع واحد: كاشير، منيو و QR",
    taglineEn: "One branch: POS, menu & QR",
    monthly: egp(1450),
    lifetime: egp(38000),
    maintenancePct: 18,
    branches: 1,
    posDevices: 1,
    users: 5,
    featuresAr: ["كاشير (POS) بالعربي والإنجليزي", "محرر المنيو بالصور", "منيو QR وطلب من الترابيزة", "تقرير Z والدرج", "ضريبة 14٪ + خدمة 12٪", "يشتغل من غير نت"],
    featuresEn: ["Arabic/English POS", "Photo menu editor", "QR menu & table ordering", "Z-report & cash drawer", "VAT 14% + service 12%", "Works offline"],
  },
  {
    id: "pro",
    ar: "احترافي",
    en: "Pro",
    taglineAr: "الصالة والحجوزات والمخزن والإيصال الإلكتروني",
    taglineEn: "Floor, reservations, inventory & e-receipt",
    monthly: egp(2950),
    lifetime: egp(79000),
    maintenancePct: 18,
    branches: 1,
    posDevices: 3,
    users: 20,
    highlight: true,
    featuresAr: ["كل اللي في الأساسي", "محرر الصالة والترابيزات", "حجوزات + قائمة انتظار", "شاشة المطبخ (KDS)", "المخزن والوصفات بمتوسط التكلفة", "الشراء من الموردين", "الولاء والحملات", "إيصال إلكتروني ETA"],
    featuresEn: ["Everything in Basic", "Floor plan editor", "Reservations + waitlist", "Kitchen display (KDS)", "Inventory & recipes at weighted-average cost", "Purchasing from suppliers", "Loyalty & campaigns", "ETA e-receipt"],
  },
  {
    id: "enterprise",
    ar: "مؤسسات",
    en: "Enterprise",
    taglineAr: "سلاسل وفروع متعددة، API ودعم أولوية",
    taglineEn: "Chains: multi-branch, API, priority support",
    monthly: egp(6900),
    lifetime: egp(189000),
    maintenancePct: 15,
    branches: 3,
    posDevices: 9,
    users: null,
    featuresAr: ["كل اللي في الاحترافي", "فروع متعددة بلوحة واحدة", "أدوار وصلاحيات متقدمة", "API و Webhooks", "فاتورة إلكترونية B2B", "دعم أولوية 24/7", "تهيئة وتدريب مخصص", "مساعد ذكي مدمج"],
    featuresEn: ["Everything in Pro", "Multi-branch in one dashboard", "Advanced roles & permissions", "API & webhooks", "B2B e-invoice", "24/7 priority support", "Dedicated onboarding & training", "AI assistant included"],
  },
];

/** Lifetime licence extras. */
export const LIFETIME = {
  /** install on the restaurant's own server (on-prem) — one-time setup, piastres */
  onPremSetup: egp(15000),
  /** first year of maintenance is included */
  includedMaintenanceYears: 1,
};

export type AddonUnit = "month" | "once" | "pack";
export interface Addon {
  id: string;
  ar: string;
  en: string;
  descAr: string;
  descEn: string;
  price: number;
  unit: AddonUnit;
  /** plans that can buy it (all when omitted) */
  plans?: PlanId[];
  /** plan that already includes it */
  includedIn?: PlanId[];
  group: "capacity" | "ai" | "messaging" | "hardware";
}

export const ADDONS: Addon[] = [
  { id: "branch", ar: "فرع إضافي", en: "Extra branch", descAr: "فرع جديد بنفس المنيو والتقارير", descEn: "Another branch sharing menu & reports", price: egp(1900), unit: "month", plans: ["pro", "enterprise"], group: "capacity" },
  { id: "pos", ar: "جهاز كاشير إضافي", en: "Extra POS device", descAr: "تابلت أو جهاز كاشير زيادة", descEn: "One more tablet or till", price: egp(290), unit: "month", group: "capacity" },
  { id: "kds", ar: "شاشة مطبخ إضافية", en: "Extra kitchen screen", descAr: "شاشة KDS لكل محطة", descEn: "A KDS screen per station", price: egp(190), unit: "month", plans: ["pro", "enterprise"], group: "capacity" },
  { id: "ai", ar: "المساعد الذكي", en: "AI assistant", descAr: "اسأل عن مبيعاتك، اقتراحات منيو وطلبات توريد", descEn: "Ask about sales, menu tips and reorders", price: egp(450), unit: "month", includedIn: ["enterprise"], group: "ai" },
  { id: "sms", ar: "رصيد SMS (1000 رسالة)", en: "SMS credits (1,000)", descAr: "تأكيد حجوزات وحملات", descEn: "Booking confirmations & campaigns", price: egp(380), unit: "pack", group: "messaging" },
  { id: "wa", ar: "رصيد واتساب (1000 محادثة)", en: "WhatsApp credits (1,000)", descAr: "رسائل واتساب بيزنس رسمية", descEn: "Official WhatsApp Business messages", price: egp(950), unit: "pack", group: "messaging" },
  { id: "hw-pos", ar: "باقة كاشير كاملة", en: "POS hardware bundle", descAr: "جهاز تاتش 15″ + طابعة إيصالات + درج فلوس", descEn: "15″ touch terminal + receipt printer + cash drawer", price: egp(18500), unit: "once", group: "hardware" },
  { id: "hw-kds", ar: "باقة شاشة مطبخ", en: "Kitchen screen bundle", descAr: "شاشة 22″ مقاومة للحرارة + حامل", descEn: "22″ heat-resistant screen + mount", price: egp(9800), unit: "once", group: "hardware" },
  { id: "hw-qr", ar: "استاندات QR (20 قطعة)", en: "QR table stands (20)", descAr: "أكريليك بشعارك", descEn: "Acrylic, with your logo", price: egp(2400), unit: "once", group: "hardware" },
  { id: "hw-printer", ar: "طابعة مطبخ", en: "Kitchen printer", descAr: "حرارية 80 مم شبكة", descEn: "80 mm thermal, network", price: egp(4200), unit: "once", group: "hardware" },
];

/** Comparison table rows: value per plan (true/false/text). */
export interface CompareRow {
  groupAr: string;
  groupEn: string;
  ar: string;
  en: string;
  basic: boolean | string;
  pro: boolean | string;
  enterprise: boolean | string;
}
export const COMPARE: CompareRow[] = [
  { groupAr: "التشغيل", groupEn: "Operations", ar: "الفروع", en: "Branches", basic: "1", pro: "1", enterprise: "3+" },
  { groupAr: "التشغيل", groupEn: "Operations", ar: "أجهزة الكاشير", en: "POS devices", basic: "1", pro: "3", enterprise: "9" },
  { groupAr: "التشغيل", groupEn: "Operations", ar: "المستخدمين", en: "Users", basic: "5", pro: "20", enterprise: "∞" },
  { groupAr: "التشغيل", groupEn: "Operations", ar: "كاشير POS", en: "POS / cashier", basic: true, pro: true, enterprise: true },
  { groupAr: "التشغيل", groupEn: "Operations", ar: "يشتغل من غير نت", en: "Offline mode", basic: true, pro: true, enterprise: true },
  { groupAr: "التشغيل", groupEn: "Operations", ar: "منيو QR وطلب الضيف", en: "QR menu & guest ordering", basic: true, pro: true, enterprise: true },
  { groupAr: "التشغيل", groupEn: "Operations", ar: "محرر الصالة ودمج الترابيزات", en: "Floor plan editor & table merge", basic: false, pro: true, enterprise: true },
  { groupAr: "التشغيل", groupEn: "Operations", ar: "الحجوزات وقائمة الانتظار", en: "Reservations & waitlist", basic: false, pro: true, enterprise: true },
  { groupAr: "التشغيل", groupEn: "Operations", ar: "شاشة المطبخ KDS", en: "Kitchen display", basic: false, pro: true, enterprise: true },
  { groupAr: "المخزن والشراء", groupEn: "Stock & purchasing", ar: "المخزن والوصفات", en: "Inventory & recipes", basic: false, pro: true, enterprise: true },
  { groupAr: "المخزن والشراء", groupEn: "Stock & purchasing", ar: "الطلب من الموردين", en: "Supplier ordering", basic: "عرض فقط", pro: true, enterprise: true },
  { groupAr: "العملاء", groupEn: "Guests", ar: "الولاء والحملات", en: "Loyalty & campaigns", basic: false, pro: true, enterprise: true },
  { groupAr: "العملاء", groupEn: "Guests", ar: "المساعد الذكي", en: "AI assistant", basic: "إضافة", pro: "إضافة", enterprise: true },
  { groupAr: "المالية والضرايب", groupEn: "Finance & tax", ar: "دفتر قيد مزدوج", en: "Double-entry ledger", basic: true, pro: true, enterprise: true },
  { groupAr: "المالية والضرايب", groupEn: "Finance & tax", ar: "تقرير Z والدرج", en: "Z-report & cash drawer", basic: true, pro: true, enterprise: true },
  { groupAr: "المالية والضرايب", groupEn: "Finance & tax", ar: "إقرار ضريبة القيمة المضافة", en: "VAT return", basic: true, pro: true, enterprise: true },
  { groupAr: "المالية والضرايب", groupEn: "Finance & tax", ar: "إيصال إلكتروني ETA", en: "ETA e-receipt", basic: false, pro: true, enterprise: true },
  { groupAr: "المالية والضرايب", groupEn: "Finance & tax", ar: "فاتورة إلكترونية B2B", en: "B2B e-invoice", basic: false, pro: false, enterprise: true },
  { groupAr: "المنصة", groupEn: "Platform", ar: "أدوار وصلاحيات", en: "Roles & permissions", basic: "أساسية", pro: true, enterprise: "متقدمة" },
  { groupAr: "المنصة", groupEn: "Platform", ar: "API و Webhooks", en: "API & webhooks", basic: false, pro: false, enterprise: true },
  { groupAr: "المنصة", groupEn: "Platform", ar: "الدعم", en: "Support", basic: "شات", pro: "شات + تليفون", enterprise: "أولوية 24/7" },
  { groupAr: "المنصة", groupEn: "Platform", ar: "تهيئة وتدريب", en: "Onboarding", basic: "فيديوهات", pro: "جلسة أونلاين", enterprise: "مدير حساب مخصص" },
];

/** English text for the few Arabic-only comparison cells. */
export const COMPARE_EN: Record<string, string> = {
  "عرض فقط": "Browse only",
  "إضافة": "Add-on",
  "أساسية": "Basic",
  "متقدمة": "Advanced",
  "شات": "Chat",
  "شات + تليفون": "Chat + phone",
  "أولوية 24/7": "24/7 priority",
  "فيديوهات": "Videos",
  "جلسة أونلاين": "Online session",
  "مدير حساب مخصص": "Dedicated manager",
};

export const PRICING_FAQ: { qAr: string; qEn: string; aAr: string; aEn: string }[] = [
  { qAr: "الأسعار شاملة الضريبة؟", qEn: "Do prices include VAT?", aAr: "لأ، كل الأسعار قبل ضريبة القيمة المضافة 14٪، وبتظهر الضريبة لوحدها في الفاتورة الإلكترونية.", aEn: "No — prices are before 14% VAT, which is shown separately on your e-invoice." },
  { qAr: "التجربة المجانية محتاجة كارت؟", qEn: "Does the free trial need a card?", aAr: `لأ. ${TRIAL_DAYS} يوم كاملين بكل مميزات الاحترافي، ومن غير أي بيانات دفع.`, aEn: `No. ${TRIAL_DAYS} full days of Pro, no payment details.` },
  { qAr: "إيه الفرق بين الاشتراك والشراء الكامل؟", qEn: "Subscription vs. owning it?", aAr: "الشراء الكامل بتدفعه مرة واحدة والسستم ملكك، وممكن نركّبه على سيرفرك. بعد أول سنة فيه صيانة وتحديثات سنوية اختيارية بنسبة من سعر الترخيص.", aEn: "Own-it is a one-time licence; we can install it on your own server. After year one, optional yearly maintenance & updates are a percentage of the licence." },
  { qAr: "أقدر أغيّر الباقة بعدين؟", qEn: "Can I change plans later?", aAr: "أيوه في أي وقت، والفرق بيتحسب بالأيام.", aEn: "Any time — the difference is prorated by day." },
  { qAr: "لو النت قطع؟", qEn: "What if the internet drops?", aAr: "الكاشير والمطبخ بيكملوا شغل عادي، والإيصالات بتستنى في طابور وتتبعت لمصلحة الضرايب أول ما النت يرجع (قبل مهلة الـ24 ساعة).", aEn: "POS and kitchen keep working; e-receipts queue and are sent to the ETA as soon as you're back (inside the 24-hour window)." },
  { qAr: "بتدعموا الإيصال الإلكتروني؟", qEn: "Do you support the ETA e-receipt?", aAr: "أيوه، إيصال إلكتروني بنسخة 1.2 (SC/RC) بسلسلة UUID و QR، وجاهزين للفاتورة الإلكترونية B2B.", aEn: "Yes — ETA e-receipt v1.2 (SC/RC) with a UUID chain and QR, and B2B e-invoice ready." },
  { qAr: "ممكن أشتري الأجهزة منكم؟", qEn: "Can I buy hardware from you?", aAr: "أيوه، فيه باقات أجهزة متجربة مع سُفرة: كاشير، طابعات، شاشات مطبخ واستاندات QR.", aEn: "Yes — tested bundles: terminals, printers, kitchen screens and QR stands." },
];

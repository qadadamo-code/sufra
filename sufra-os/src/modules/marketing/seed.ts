/**
 * Demo CRM / loyalty / marketing / sponsored-ads rows for the seed restaurant (src/data/seed.ts calls this).
 * Deterministic (seeded PRNG + seedId), fictional people and numbers (valid Egyptian mobile formats 010/011/012/015).
 *
 * What it adds
 *  - ~50 more customers (60 in total) with birthdays, consent, sources, tags; the 10 original ones enriched
 *  - a visit history per customer as loyalty ledger "earn" rows (spend + points) → balances, tiers, cohorts
 *  - loyalty program (points, tiers, stamp card, rewards), promotions (happy hour, coupon, free delivery, BOGO, combo,
 *    win-back/birthday/referral unique codes), redemptions, gift cards, segments, campaigns + messages, journeys,
 *    referrals, menu banners, receipt promo block, guest feedback
 *  - Sufra platform: 3 more marketplace restaurants, marketplace profiles, ad slots and sponsored bookings
 */
import { major, type Units } from "@/lib/money";
import { DEFAULT_TIERS, computeBalance, tierFor } from "@/lib/promo/loyalty";
import { referralCode } from "@/lib/promo/referral";
import type {
  AdBooking, AdSlot, Branch, Campaign, CampaignMessage, Check, CouponCode, Customer, GiftCard, GiftCardTxn, GuestFeedback, Journey, Localized, LoyaltyEntry, LoyaltyProgram,
  MarketProfile, MenuCategory, MenuItem, Order, PromoBanner, PromoRedemption, Promotion, Referral, Restaurant, Segment, Settings,
} from "@/data/types";

interface Ctx {
  restaurantId: string;
  branchId: string;
  now: Date;
  T: (minutesAgo: number) => string;
  id: (key: string) => string;
  staffId: (k: string) => string;
  customers: Customer[];
  checks: Check[];
  orders: Order[];
  menuItems: MenuItem[];
  menuCategories: MenuCategory[];
  settings: Settings[];
  created: string;
}

const L = (ar: string, en: string): Localized => ({ ar, en });
const E = major;

/** small deterministic PRNG (mulberry32) */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_M = ["أحمد", "محمد", "محمود", "مصطفى", "عمر", "يوسف", "كريم", "خالد", "طارق", "إسلام", "حسن", "إبراهيم", "علي", "مروان", "زياد", "شادي", "هشام", "وليد", "سامح", "أيمن", "عادل", "رامي", "باسم", "نادر"];
const FIRST_F = ["سارة", "نور", "مريم", "فاطمة", "هبة", "منة", "ريم", "آية", "دعاء", "شيماء", "رحاب", "إيمان", "نهى", "داليا", "هالة", "سلمى", "جنا", "ملك", "رنا", "نادين", "إنجي", "ياسمين", "أسماء", "منى"];
const LAST = ["عبد الرحمن", "السيد", "حسين", "إبراهيم", "فتحي", "الشريف", "سليمان", "منصور", "عبد العزيز", "الجمال", "رشاد", "عثمان", "يوسف", "زكي", "المصري", "حمدي", "شاهين", "النجار", "عزمي", "البنا", "قاسم", "الدسوقي", "فاروق", "مكي"];
const PREFIX = ["010", "011", "012", "015"];
const TAGS = ["vip", "regular", "family", "corporate", "vegetarian", "delivery", "kids", "student", "allergy"];
const SOURCES = ["qr", "online", "pos", "reservation", "wifi", "manual"] as const;

export function demoCrmRows(c: Ctx) {
  const R = c.restaurantId;
  const B = c.branchId;
  const rnd = prng(20261024);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const DAY = 1440;
  const base = (k: string, minutesAgo?: number) => {
    const at = minutesAgo == null ? c.created : c.T(minutesAgo);
    return { id: c.id(k), restaurantId: R, createdAt: at, updatedAt: at };
  };
  const itemId = (k: string) => c.id(`item:${k}`);
  const catId = (k: string) => c.id(`cat:${k}`);

  /* ── loyalty program ── */
  const program: LoyaltyProgram = {
    ...base("loyalty:program"), name: L("نادي سُفرة", "Sufra Club"), enabled: true, earnPoints: 1, earnSpend: E(10), pointValue: E("0.25"), minRedeem: 100,
    expiryDays: 365, tiers: DEFAULT_TIERS,
    stampCards: [{ id: "coffee", name: L("كارت القهوة: اشرب ٩ والعاشرة علينا", "Coffee card: 9 + the 10th free"), itemIds: [itemId("turkish"), itemId("cappuccino"), itemId("nescafe")], categoryIds: [], required: 10, rewardItemId: itemId("turkish"), active: true }],
    rewards: [
      { id: "tea", name: L("شاي مجاني", "Free tea"), cost: 150, kind: "free_item", value: 0, itemId: itemId("tea"), active: true },
      { id: "omali", name: L("أم علي مجانًا", "Free Om Ali"), cost: 500, kind: "free_item", value: 0, itemId: itemId("om-ali"), active: true },
      { id: "50off", name: L("٥٠ ج خصم", "EGP 50 off"), cost: 200, kind: "amount", value: E(50), itemId: null, active: true },
      { id: "10pct", name: L("خصم ١٠٪ على الشيك", "10% off the bill"), cost: 400, kind: "percent", value: 1000, itemId: null, active: true },
    ],
    excludedCategoryIds: [], earnChannels: [], welcomeBonus: 50, birthdayBonus: 100, referrerPoints: 200,
    referralPromotionId: c.id("promo:referral"), referralMonthlyCap: 10,
    terms: L("نقطة على كل ١٠ ج (قبل الضريبة والخدمة). النقطة بـ ٢٥ قرش. النقاط بتنتهي بعد سنة من كسبها.", "1 point per EGP 10 (before VAT and service). A point is worth 25 piastres. Points expire a year after you earn them."),
  };

  /* ── customers ── */
  const used = new Set(c.customers.map((x) => x.phone));
  const phone = () => {
    for (;;) {
      const p = pick(PREFIX) + String(Math.floor(rnd() * 1e8)).padStart(8, "0");
      if (!used.has(p)) {
        used.add(p);
        return p;
      }
    }
  };
  const bday = () => `${1970 + Math.floor(rnd() * 36)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`;
  const customers: Customer[] = c.customers.map((x, i) => ({
    ...x,
    birthday: x.birthday ?? (i === 2 ? `1994-${String(c.now.getMonth() + 1).padStart(2, "0")}-${String(Math.min(28, c.now.getDate() + 5)).padStart(2, "0")}` : bday()),
    gender: (["f", "m", "f", "m", "f", "m", "f", "m", "f", "m"] as const)[i] ?? null,
    source: (["reservation", "pos", "qr", "reservation", "online", "pos", "qr", "online", "wifi", "pos"] as const)[i] ?? "pos",
    consent: { whatsapp: i !== 4, sms: i % 3 === 0, email: false, push: false, at: c.T(60 * DAY), via: "pos" },
    referralCode: referralCode(x.id),
    stamps: (i === 5 ? { coffee: 7 } : i === 0 ? { coffee: 3 } : {}) as Record<string, number>,
    allergies: i === 6 ? "مكسرات" : "",
    noShows: i === 8 ? 1 : 0,
  }));
  const NEW = 50;
  for (let i = 0; i < NEW; i++) {
    const female = rnd() < 0.48;
    const name = `${pick(female ? FIRST_F : FIRST_M)} ${pick(LAST)}`;
    const k = `crm:${i + 1}`;
    const joinedDays = 5 + Math.floor(rnd() * 330);
    const tags = rnd() < 0.35 ? [pick(TAGS)] : [];
    const src = pick(SOURCES);
    customers.push({
      ...base(`customer:${k}`, joinedDays * DAY), phone: phone(), name, email: rnd() < 0.2 ? `guest${i + 11}@example.com` : null, visits: 0, lastVisitAt: null, totalSpent: 0, loyaltyPoints: 0,
      tags: src === "online" ? [...tags, "online"] : tags, notes: "", birthday: rnd() < 0.8 ? bday() : null,
      addresses: src === "online" ? [{ address: `${10 + Math.floor(rnd() * 80)} ${pick(["شارع ٢٦ يوليو", "شارع الجبلاية", "شارع حسن صبري", "شارع المرعشلي", "شارع البرازيل"])}`, area: pick(["الزمالك", "المهندسين", "الدقي"]), notes: "", lat: null, lng: null }] : [],
      gender: female ? "f" : "m", source: src, consent: { whatsapp: rnd() < 0.8, sms: rnd() < 0.3, email: false, push: false, at: c.T(joinedDays * DAY), via: src },
      referralCode: null, stamps: {}, allergies: "", noShows: rnd() < 0.08 ? 1 : 0,
    });
  }
  // a duplicate to demo "merge duplicates": same person, typed with +20 and a short name
  customers.push({ ...base("customer:crm:dup", 20 * DAY), phone: "01005551206".replace("010", "010"), name: "حسام رضا", email: null, visits: 1, lastVisitAt: c.T(20 * DAY), totalSpent: E(410), loyaltyPoints: 41, tags: [], notes: "اتسجل من الواي فاي", birthday: null, addresses: [], gender: "m", source: "wifi", consent: { whatsapp: true, sms: false, email: false, push: false, at: c.T(20 * DAY), via: "wifi" }, referralCode: null, stamps: {}, allergies: "", noShows: 0 });
  // phone must be unique: keep the duplicate distinguishable by the +20 prefix the Wi-Fi portal stores
  customers[customers.length - 1].phone = "+201005551206";

  /* ── visit history → loyalty ledger ── */
  const loyaltyLedger: LoyaltyEntry[] = [];
  const favs = [["kofta", "tahini", "tea"], ["mixed-grill", "hummus", "lemon-mint"], ["molokhia", "mixed-mahshi", "om-ali"], ["turkish", "basbousa"], ["fattah", "orzo-soup", "karkade"], ["tawook", "fries", "mango"]];
  const visitPlan = new Map<string, number[]>(); // customer id → visit ages (days)
  customers.forEach((cu, i) => {
    let visits: number;
    let spent: number;
    let lastDays: number;
    if (i < c.customers.length) {
      visits = cu.visits;
      spent = cu.totalSpent;
      lastDays = cu.lastVisitAt ? Math.max(0, Math.round((c.now.getTime() - Date.parse(cu.lastVisitAt)) / 86_400_000)) : 30;
    } else if (cu.id === c.id("customer:crm:dup")) return;
    else {
      const r = rnd();
      // a realistic mix: many one-timers, some regulars, a few champions, some lapsed
      visits = r < 0.3 ? 1 : r < 0.6 ? 2 + Math.floor(rnd() * 3) : r < 0.9 ? 5 + Math.floor(rnd() * 8) : 14 + Math.floor(rnd() * 16);
      const joined = Math.round((c.now.getTime() - Date.parse(cu.createdAt)) / 86_400_000);
      lastDays = rnd() < 0.25 ? Math.min(joined, 60 + Math.floor(rnd() * 150)) : Math.min(joined, Math.floor(rnd() * 35));
      spent = 0;
    }
    const joined = Math.max(lastDays, Math.round((c.now.getTime() - Date.parse(cu.createdAt)) / 86_400_000));
    const ages: number[] = [];
    for (let v = 0; v < visits; v++) ages.push(v === 0 ? lastDays : lastDays + Math.round(((joined - lastDays) * (v / Math.max(1, visits - 1))) * (0.7 + rnd() * 0.3)));
    visitPlan.set(cu.id, ages);
    const avg = spent ? spent / visits : E(250 + Math.floor(rnd() * 700));
    const fav = favs[i % favs.length];
    let total = 0;
    ages.forEach((age, v) => {
      const s = Math.round((avg * (0.6 + rnd() * 0.8)) / 1000) * 1000;
      total += s;
      const at = c.T(age * DAY + 120 + Math.floor(rnd() * 300));
      const pts = Math.floor(s / E(10));
      loyaltyLedger.push({
        ...base(`loy:${cu.id}:${v}`, age * DAY), customerId: cu.id, branchId: B, kind: "earn", points: pts, spend: s, checkId: null, channel: cu.source === "online" ? "online" : cu.source === "qr" ? "qr" : "pos",
        rewardId: null, stamps: {}, expiresAt: new Date(Date.parse(at) + 365 * 86_400_000).toISOString(), note: "", actorId: null, at,
        items: Object.fromEntries(fav.slice(0, 1 + Math.floor(rnd() * fav.length)).map((k) => [itemId(k), 1 + Math.floor(rnd() * 2)])),
      });
    });
    // regulars redeemed some points along the way
    const earned = loyaltyLedger.filter((e) => e.customerId === cu.id).reduce((a, e) => a + e.points, 0);
    if (earned > 600 && ages.length > 3) {
      const red = Math.floor((earned * 0.4) / 50) * 50;
      const age = ages[Math.floor(ages.length / 2)];
      const at = c.T(age * DAY + 60);
      loyaltyLedger.push({ ...base(`loy:${cu.id}:redeem`, age * DAY), customerId: cu.id, branchId: B, kind: "redeem", points: -red, spend: 0, checkId: null, channel: "pos", rewardId: "50off", stamps: {}, expiresAt: null, note: "", actorId: c.staffId("cashier1"), at });
    }
    if (i >= c.customers.length) {
      cu.visits = visits;
      cu.totalSpent = total;
      cu.lastVisitAt = c.T(lastDays * DAY + 120);
    }
    // welcome bonus for loyalty sign-ups
    if (cu.source === "qr") loyaltyLedger.push({ ...base(`loy:${cu.id}:welcome`, joined * DAY), customerId: cu.id, branchId: B, kind: "bonus", points: 50, spend: 0, checkId: null, channel: "qr", rewardId: null, stamps: {}, expiresAt: c.T(joined * DAY - 365 * DAY), note: "welcome", actorId: null, at: c.T(joined * DAY) });
  });
  // balances, lifetime and tiers from the ledger
  for (const cu of customers) {
    const mine = loyaltyLedger.filter((e) => e.customerId === cu.id);
    if (!mine.length) continue;
    const b = computeBalance(mine.map((e) => ({ id: e.id, kind: e.kind, points: e.points, at: e.at, expiresAt: e.expiresAt })), c.now);
    cu.loyaltyPoints = b.balance;
    cu.lifetimePoints = b.lifetime;
    cu.tierId = tierFor(b.lifetime, DEFAULT_TIERS)?.id ?? null;
    if (!cu.tags.includes("loyalty") && cu.source === "qr") cu.tags = [...cu.tags, "loyalty"];
  }

  /* ── promotions ── */
  const P = (k: string, p: Partial<Promotion> & Pick<Promotion, "name" | "type" | "value">): Promotion => ({
    ...base(`promo:${k}`, 40 * DAY), kind: "auto", code: null, channels: [], stackable: true, priority: 10, active: true, uses: 0, createdBy: c.staffId("owner"), campaignId: null, ...p,
  });
  const drinks = { itemIds: [], categoryIds: [catId("hot-drinks"), catId("cold-drinks")] };
  const promotions: Promotion[] = [
    P("happyhour", { name: L("هابي آور: المشروبات ٢٠٪", "Happy hour: 20% off drinks"), description: L("كل يوم من ٥ لـ ٧", "Daily 5–7 pm"), type: "percent", value: 2000, target: drinks, window: { from: "17:00", to: "19:00" }, priority: 1, uses: 214 }),
    P("sufra15", { name: L("كوبون SUFRA15", "Coupon SUFRA15"), description: L("١٥٪ على طلب فوق ٤٠٠ ج (لحد ١٥٠ ج)", "15% off orders over EGP 400 (up to 150)"), kind: "coupon", code: "SUFRA15", type: "percent", value: 1500, minSpend: E(400), maxDiscount: E(150), limits: { total: 500, perCustomer: 2 }, stackable: false, priority: 5, uses: 37, window: { startsAt: c.T(30 * DAY), endsAt: c.T(-30 * DAY) } }),
    P("freedelivery", { name: L("توصيل مجاني فوق ٥٠٠ ج", "Free delivery over EGP 500"), type: "free_delivery", value: 0, minSpend: E(500), channels: ["online", "pos"], modes: ["delivery"], priority: 2, uses: 86 }),
    P("ahlan20", { name: L("أهلًا: ٢٠٪ على أول طلب أونلاين", "Welcome: 20% off your first online order"), kind: "coupon", code: "AHLAN20", type: "percent", value: 2000, maxDiscount: E(120), firstOrderOnly: true, channels: ["online"], stackable: false, priority: 4, uses: 52 }),
    P("coffee-bogo", { name: L("القهوة: التانية بنص التمن (الويك إند)", "Coffee: second one half price (weekends)"), type: "bogo", value: 5000, bogo: { buyQty: 1, getQty: 1 }, target: { itemIds: [itemId("turkish"), itemId("cappuccino"), itemId("nescafe")], categoryIds: [] }, window: { days: [5, 6] }, priority: 3, uses: 61 }),
    P("kofta-combo", { name: L("كومبو الكفتة: كفتة + سلطة + مشروب بـ ٤١٠ ج", "Kofta combo: kofta + salad + drink for EGP 410"), type: "combo", value: E(410), combo: { itemIds: [itemId("kofta"), itemId("baladi"), itemId("lemon-mint")] }, priority: 6, uses: 33 }),
    P("winback", { name: L("وحشتنا: ١٠٠ ج خصم", "We miss you: EGP 100 off"), description: L("كود شخصي — طلب فوق ٤٠٠ ج", "Personal code — orders over EGP 400"), kind: "coupon", type: "amount", value: E(100), minSpend: E(400), limits: { perCustomer: 1 }, stackable: false, priority: 5, uses: 9, campaignId: c.id("campaign:winback") }),
    P("birthday", { name: L("عيد ميلاد سعيد: حلو مجاني", "Happy birthday: a free dessert"), kind: "coupon", type: "free_item", value: 1, target: { itemIds: [], categoryIds: [catId("desserts")] }, limits: { perCustomer: 1 }, priority: 7, uses: 14 }),
    P("referral", { name: L("هدية صاحبك: ٥٠ ج على أول طلب", "Friend's gift: EGP 50 off the first order"), kind: "coupon", type: "amount", value: E(50), minSpend: E(250), firstOrderOnly: true, limits: { perCustomer: 1 }, priority: 8, uses: 6 }),
    P("ramadan", { name: L("سحور رمضان ١٥٪", "Ramadan suhoor 15%"), type: "percent", value: 1500, window: { from: "23:00", to: "03:00" }, active: false, priority: 9, uses: 0 }),
  ];
  const promo = (k: string) => promotions.find((p) => p.id === c.id(`promo:${k}`))!;

  /* ── segments ── */
  const seg = (k: string, name: Localized, color: string, s: Pick<Segment, "match" | "rules">): Segment => ({ ...base(`segment:${k}`, 30 * DAY), name, color, count: 0, ...s });
  const segments: Segment[] = [
    seg("vip", L("كبار الزباين", "Top spenders"), "#b8860b", { match: "all", rules: [{ field: "totalSpent", op: "gte", value: E(10000) }] }),
    seg("winback", L("ماجوش من ٣٠ يوم", "No visit in 30 days"), "#c2412d", { match: "all", rules: [{ field: "lastVisitDays", op: "gt", value: 30 }, { field: "visits", op: "gte", value: 2 }, { field: "consent", op: "has", value: "whatsapp" }] }),
    seg("bday", L("عيد ميلادهم الشهر ده", "Birthday this month"), "#9a3b6b", { match: "all", rules: [{ field: "birthdayMonth", op: "this" }] }),
    seg("grill-fans", L("بيحبوا المشويات", "Grill lovers"), "#0d5a53", { match: "any", rules: [{ field: "item", op: "ordered", value: itemId("mixed-grill") }, { field: "item", op: "ordered", value: itemId("kofta") }] }),
  ];

  /* ── campaigns & messages ── */
  const stats = (s: Partial<Campaign["stats"]>): Campaign["stats"] => ({ targeted: 0, sent: 0, delivered: 0, read: 0, clicked: 0, redeemed: 0, revenue: 0, cost: 0, ...s });
  const campaigns: Campaign[] = [
    {
      ...base("campaign:winback", 21 * DAY), name: "وحشتنا — أكتوبر", segmentId: c.id("segment:winback"), audience: "segment", channel: "whatsapp", status: "sent",
      variants: [
        { id: "a", label: "A", text: L("{name} وحشتنا! 🍢 تعالى سُفرة الأسبوع ده وخد ١٠٠ ج خصم بالكود {code} (على طلب فوق ٤٠٠ ج).", "{name}, we miss you! 🍢 Come to Sufra this week and get EGP 100 off with code {code} (orders over 400)."), share: 50 },
        { id: "b", label: "B", text: L("أهلًا {name} 👋 الكفتة لسه سخنة! كودك {code} = ١٠٠ ج خصم لحد آخر الشهر.", "Hi {name} 👋 the kofta is still hot! Your code {code} = EGP 100 off until month end."), share: 50 },
      ],
      promotionId: promo("winback").id, scheduledAt: null, sentAt: c.T(21 * DAY), costPerMessage: E("3.20"), journeyId: null, createdBy: c.staffId("owner"),
      stats: stats({}),
    },
    {
      ...base("campaign:weekend", 7 * DAY), name: "ويك إند المشويات", segmentId: c.id("segment:grill-fans"), audience: "segment", channel: "whatsapp", status: "sent",
      variants: [{ id: "a", label: "A", text: L("{name}، الويك إند ده المشويات المشكلة + ٢ ليمون نعناع بسعر خاص. احجز من هنا: {link}", "{name}, this weekend: mixed grill + 2 lemon-mint at a special price. Book here: {link}"), share: 100 }],
      promotionId: null, scheduledAt: null, sentAt: c.T(7 * DAY), costPerMessage: E("3.20"), journeyId: null, createdBy: c.staffId("manager"),
      stats: stats({}),
    },
    {
      ...base("campaign:newmenu", 1 * DAY), name: "طواجن الشتا الجديدة", segmentId: null, audience: "all", channel: "whatsapp", status: "scheduled",
      variants: [{ id: "a", label: "A", text: L("{name} 🍲 طواجن الشتا وصلت سُفرة! اطلب أونلاين: {link}", "{name} 🍲 Winter tagines have arrived at Sufra! Order online: {link}"), share: 100 }],
      promotionId: null, scheduledAt: c.T(-2 * DAY), sentAt: null, costPerMessage: E("3.20"), journeyId: null, createdBy: c.staffId("owner"), stats: stats({}),
    },
    {
      ...base("campaign:draft", 60), name: "عرض السحور (مسودة)", segmentId: null, audience: "rfm:loyal", channel: "sms", status: "draft",
      variants: [{ id: "a", label: "A", text: L("سحور سُفرة: ١٥٪ من ١١ بالليل. {link}", "Sufra suhoor: 15% off from 11 pm. {link}"), share: 100 }],
      promotionId: promo("ramadan").id, scheduledAt: null, sentAt: null, costPerMessage: E("0.35"), journeyId: null, createdBy: c.staffId("owner"), stats: stats({}),
    },
  ];
  const campaignMessages: CampaignMessage[] = [];
  const couponCodes: CouponCode[] = [];
  const promoRedemptions: PromoRedemption[] = [];
  const statusFor = (r: number): CampaignMessage["status"] => (r < 0.04 ? "failed" : r < 0.12 ? "sent" : r < 0.35 ? "delivered" : "read");
  const recipientsFor = (filter: (cu: Customer) => boolean, max: number) => customers.filter(filter).slice(0, max);
  const lastDays = (cu: Customer) => (cu.lastVisitAt ? (c.now.getTime() - Date.parse(cu.lastVisitAt)) / 86_400_000 : 999);
  const sendCampaign = (camp: Campaign, recips: Customer[], sentDaysAgo: number, redeemRate: number) => {
    let i = 0;
    for (const cu of recips) {
      const variant = camp.variants[i % camp.variants.length];
      const code = camp.promotionId ? referralCode(`${camp.id}:${cu.id}`, "WB") : null;
      const st = statusFor(rnd());
      const redeemed = st === "read" && rnd() < redeemRate * (variant.id === "b" ? 1.4 : 1);
      const revenue = redeemed ? E(450 + Math.floor(rnd() * 600)) : 0;
      const sentAt = c.T(sentDaysAgo * DAY - i);
      const first = cu.name.split(" ")[0];
      const text = variant.text.ar.replace("{name}", first).replace("{code}", code ?? "").replace("{link}", "sufra.app/r/sufra-zamalek");
      campaignMessages.push({
        ...base(`cmsg:${camp.id}:${cu.id}`, sentDaysAgo * DAY), campaignId: camp.id, variantId: variant.id, customerId: cu.id, to: cu.phone, text, code, status: st,
        link: null, sentAt, readAt: st === "read" ? c.T(sentDaysAgo * DAY - 90 - i) : null, redeemedAt: redeemed ? c.T((sentDaysAgo - 3) * DAY) : null, revenue,
      });
      if (code) couponCodes.push({ ...base(`code:${camp.id}:${cu.id}`, sentDaysAgo * DAY), promotionId: camp.promotionId!, code, customerId: cu.id, campaignId: camp.id, usedAt: redeemed ? c.T((sentDaysAgo - 3) * DAY) : null, checkId: null, expiresAt: c.T((sentDaysAgo - 30) * DAY) });
      if (redeemed && camp.promotionId) {
        const p = promotions.find((x) => x.id === camp.promotionId)!;
        promoRedemptions.push({
          ...base(`red:${camp.id}:${cu.id}`, (sentDaysAgo - 3) * DAY), promotionId: p.id, rewardId: null, code, customerId: cu.id, checkId: null, orderId: null, channel: "pos", status: "redeemed",
          discount: p.type === "amount" ? p.value : E(60), deliveryDiscount: 0, lineDiscounts: {}, revenue, campaignId: camp.id, points: 0, at: c.T((sentDaysAgo - 3) * DAY),
        });
      }
      i++;
    }
    const msgs = campaignMessages.filter((m) => m.campaignId === camp.id);
    camp.stats = stats({
      targeted: recips.length, sent: msgs.filter((m) => m.status !== "failed").length, delivered: msgs.filter((m) => m.status === "delivered" || m.status === "read").length,
      read: msgs.filter((m) => m.status === "read").length, clicked: Math.round(msgs.filter((m) => m.status === "read").length * 0.31), redeemed: msgs.filter((m) => m.redeemedAt).length,
      revenue: msgs.reduce((a, m) => a + m.revenue, 0), cost: camp.costPerMessage * msgs.filter((m) => m.status !== "failed").length,
    });
  };
  sendCampaign(campaigns[0], recipientsFor((cu) => lastDays(cu) > 30 && cu.visits >= 2 && !!cu.consent?.whatsapp, 28), 21, 0.32);
  sendCampaign(campaigns[1], recipientsFor((cu) => cu.visits >= 4 && !!cu.consent?.whatsapp, 34), 7, 0.22);
  // the weekend campaign had no coupon: attribute visits within 5 days of reading as "redeemed"
  promotions.find((p) => p.id === promo("winback").id)!.uses = promoRedemptions.filter((r) => r.promotionId === promo("winback").id).length;

  // shared-code redemptions for the reports (SUFRA15, AHLAN20, happy hour, free delivery)
  const shared: [string, number, number][] = [["sufra15", 18, 95], ["ahlan20", 12, 70], ["happyhour", 30, 18], ["freedelivery", 14, 35], ["coffee-bogo", 10, 35], ["kofta-combo", 8, 28]];
  for (const [k, count, disc] of shared) {
    for (let i = 0; i < count; i++) {
      const cu = customers[Math.floor(rnd() * customers.length)];
      const days = Math.floor(rnd() * 45);
      const p = promo(k);
      promoRedemptions.push({
        ...base(`red:${k}:${i}`, days * DAY), promotionId: p.id, rewardId: null, code: p.code, customerId: cu.id, checkId: null, orderId: null, channel: k === "ahlan20" || k === "freedelivery" ? "online" : "pos",
        status: "redeemed", discount: k === "freedelivery" ? 0 : E(disc + Math.floor(rnd() * disc * 0.5)), deliveryDiscount: k === "freedelivery" ? E(35) : 0, lineDiscounts: {},
        revenue: E(350 + Math.floor(rnd() * 900)), campaignId: null, points: 0, at: c.T(days * DAY),
      });
    }
  }

  /* ── journeys ── */
  const J = (k: Journey["trigger"], name: Localized, delay: number, text: Localized, promotionId: string | null, enabled: boolean, s: Partial<Journey["stats"]>): Journey => ({
    ...base(`journey:${k}`, 50 * DAY), trigger: k, name, enabled, channel: "whatsapp", delay, text, promotionId, stats: { sent: 0, redeemed: 0, revenue: 0, ...s }, lastRunAt: c.T(30),
  });
  const journeys: Journey[] = [
    J("welcome", L("ترحيب بالعضو الجديد", "Welcome new members"), 1, L("أهلًا بيك في نادي سُفرة يا {name}! 🎉 معاك {points} نقطة. كارتك: {link}", "Welcome to Sufra Club, {name}! 🎉 You have {points} points. Your card: {link}"), null, true, { sent: 41, redeemed: 0 }),
    J("birthday", L("عيد ميلاد", "Birthday"), 3, L("كل سنة وانت طيب يا {name} 🎂 حلو مجاني عليك بالكود {code} طول الأسبوع.", "Happy birthday {name} 🎂 a free dessert with code {code} all week."), promo("birthday").id, true, { sent: 19, redeemed: 14, revenue: E(9800) }),
    J("winback", L("رجّع اللي غابوا (٤٥ يوم)", "Win back (45 days)"), 45, L("{name} بقالك كتير! كودك {code} = ١٠٠ ج خصم.", "{name}, it's been a while! Your code {code} = EGP 100 off."), promo("winback").id, true, { sent: 23, redeemed: 5, revenue: E(3900) }),
    J("post_visit", L("رأيك بعد الزيارة", "Post-visit feedback"), 2, L("شكرًا لزيارتك يا {name}! قيّمنا في ثانية: {link}", "Thanks for visiting, {name}! Rate us in a second: {link}"), null, true, { sent: 133 }),
    J("second_visit", L("الزيارة التانية", "Second-visit nudge"), 10, L("{name} ارجعلنا تاني الأسبوع ده وخد نقاط ×٢ 🔥", "{name}, come back this week for double points 🔥"), null, false, {}),
    J("referral", L("هات صاحبك", "Refer a friend"), 0, L("هات صاحبك يا {name}: هو ياخد ٥٠ ج وانت تاخد ٢٠٠ نقطة. كودك {code}", "Refer a friend, {name}: they get EGP 50 and you get 200 points. Your code {code}"), promo("referral").id, true, { sent: 37, redeemed: 6, revenue: E(3400) }),
  ];

  /* ── referrals ── */
  const referrals: Referral[] = [
    { ...base("ref:1", 25 * DAY), referrerId: customers[0].id, refereeId: customers[12].id, code: customers[0].referralCode!, status: "rewarded", refereeCode: "RF-7K2Q9", rewardedAt: c.T(20 * DAY) },
    { ...base("ref:2", 14 * DAY), referrerId: customers[5].id, refereeId: customers[18].id, code: customers[5].referralCode!, status: "rewarded", refereeCode: "RF-M4XA2", rewardedAt: c.T(10 * DAY) },
    { ...base("ref:3", 4 * DAY), referrerId: customers[5].id, refereeId: customers[33].id, code: customers[5].referralCode!, status: "joined", refereeCode: "RF-Q9HT3", rewardedAt: null },
    { ...base("ref:4", 2 * DAY), referrerId: customers[3].id, refereeId: null, code: customers[3].referralCode!, status: "pending", refereeCode: null, rewardedAt: null },
  ];
  customers[12].referredBy = customers[0].id;
  customers[18].referredBy = customers[5].id;
  customers[33].referredBy = customers[5].id;
  for (const r of referrals) if (r.status === "rewarded") loyaltyLedger.push({ ...base(`loy:ref:${r.id}`), customerId: r.referrerId, branchId: B, kind: "bonus", points: 200, spend: 0, checkId: null, channel: null, rewardId: null, stamps: {}, expiresAt: null, note: "referral", actorId: null, at: r.rewardedAt! });

  /* ── gift cards ── */
  const gc = (k: string, code: string, initial: number, balance: number, daysAgo: number, via: GiftCard["soldVia"], purchaser: string, recipient: string | null, status: GiftCard["status"] = "active"): GiftCard => ({
    ...base(`gift:${k}`, daysAgo * DAY), code, initial: E(initial), balance: E(balance), status, expiresAt: c.T((daysAgo - 365) * DAY),
    purchaser: { name: purchaser, phone: customers[(k.charCodeAt(0) * 7) % customers.length].phone }, recipient: recipient ? { name: recipient, phone: "01123456780", message: "كل سنة وانتي طيبة ❤️" } : null,
    soldVia: via, soldBy: via === "pos" ? c.staffId("cashier1") : null, paymentRef: via === "online" ? `DEMO-${100000 + daysAgo}` : null, customerId: null,
  });
  const giftCards: GiftCard[] = [
    gc("a", "GC-7KQ2-M4XA-8", 1000, 1000, 3, "online", "هبة السيد", "نور الشريف"),
    gc("b", "GC-HT39-ZP2W-K", 500, 180, 40, "pos", "عمرو حجازي", null),
    gc("c", "GC-9RFD-2MNV-D", 750, 0, 90, "pos", "شريف البنا", "شركة البنا", "redeemed"),
    gc("d", "GC-AE5S-7Y3B-R", 300, 300, 12, "online", "مريم صلاح", "ليلى منير"),
    gc("e", "GC-W8KD-QS4T-2", 2000, 1450, 25, "pos", "حسام الدين رضا", null),
  ];
  const giftCardTxns: GiftCardTxn[] = [];
  for (const g of giftCards) {
    const days = Math.round((c.now.getTime() - Date.parse(g.createdAt)) / 86_400_000);
    giftCardTxns.push({ ...base(`gtx:${g.id}:issue`, days * DAY), giftCardId: g.id, kind: "issue", amount: g.initial, balanceAfter: g.initial, checkId: null, paymentId: null, actorId: g.soldBy, note: "" });
    if (g.balance < g.initial)
      giftCardTxns.push({ ...base(`gtx:${g.id}:redeem`, Math.max(1, days - 5) * DAY), giftCardId: g.id, kind: "redeem", amount: g.initial - g.balance, balanceAfter: g.balance, checkId: null, paymentId: null, actorId: c.staffId("cashier2"), note: "" });
  }

  /* ── own promos: menu banners + receipt block ── */
  const banner = (k: string, b: Partial<PromoBanner> & Pick<PromoBanner, "title" | "body" | "badge" | "color" | "placements">): PromoBanner => ({
    ...base(`banner:${k}`, 20 * DAY), imageUrl: null, promotionId: null, itemId: null, window: null, modes: [], active: true, sort: 0, stats: { impressions: 0, clicks: 0 }, ...b,
  });
  const promoBanners: PromoBanner[] = [
    banner("hh", { title: L("هابي آور ٥–٧", "Happy hour 5–7 pm"), body: L("كل المشروبات ٢٠٪ خصم — بيتحسب لوحده", "20% off every drink — applied automatically"), badge: "٢٠٪", color: "#2f6f9f", placements: ["menu_top", "table", "online_top"], promotionId: promo("happyhour").id, sort: 1, stats: { impressions: 4120, clicks: 388 } }),
    banner("combo", { title: L("كومبو الكفتة بـ ٤١٠ ج", "Kofta combo EGP 410"), body: L("كفتة + سلطة بلدي + ليمون نعناع", "Kofta + baladi salad + lemon-mint"), badge: "🍢", color: "#c2412d", placements: ["menu_top", "table", "online_top"], promotionId: promo("kofta-combo").id, itemId: itemId("kofta"), sort: 2, stats: { impressions: 3360, clicks: 512 } }),
    banner("delivery", { title: L("التوصيل مجاني فوق ٥٠٠ ج", "Free delivery over EGP 500"), body: L("في الزمالك والمهندسين والدقي", "Zamalek, Mohandessin and Dokki"), badge: "🛵", color: "#0d5a53", placements: ["online_top", "checkout"], promotionId: promo("freedelivery").id, modes: ["delivery"], sort: 3, stats: { impressions: 2210, clicks: 140 } }),
    banner("club", { title: L("انضم لنادي سُفرة", "Join Sufra Club"), body: L("٥٠ نقطة هدية أول ما تسجّل — وحلو مجاني في عيد ميلادك", "50 bonus points when you join — and a free dessert on your birthday"), badge: "🎁", color: "#a8700c", placements: ["table", "checkout"], sort: 4, stats: { impressions: 1890, clicks: 233 } }),
  ];
  const settings = c.settings[0];
  if (settings) {
    settings.invoice = {
      ...settings.invoice,
      promo: {
        enabled: true, title: L("زيارتك الجاية علينا ١٠٪", "10% off your next visit"), body: L("ورّي الكود ده للكاشير في خلال ٣٠ يوم — وامسح الـ QR عشان نقاطك", "Show this code within 30 days — scan the QR for your points"),
        code: "NEXT10", qr: "loyalty", url: null, startsAt: null, endsAt: null,
      },
    };
  }
  promotions.push(P("next10", { name: L("الزيارة الجاية ١٠٪ (من الإيصال)", "Next visit 10% (receipt)"), kind: "coupon", code: "NEXT10", type: "percent", value: 1000, maxDiscount: E(100), limits: { perCustomer: 1 }, stackable: false, priority: 6, uses: 23 }));

  /* ── guest feedback ── */
  const COMMENTS: [number, string, string[]][] = [
    [5, "الكفتة تحفة والخدمة سريعة جدًا", ["food", "speed"]], [5, "أحسن ملوخية في الزمالك 👌", ["food"]], [4, "الأكل حلو بس استنينا الحساب شوية", ["food", "wait"]],
    [5, "أحمد كان لطيف جدًا معانا", ["service"]], [3, "الطاجن وصل فاتر", ["food"]], [5, "", []], [4, "المكان جميل والتراس رايق", ["ambience"]], [2, "الدليفري اتأخر ساعة", ["delivery", "wait"]],
    [5, "أم علي ولا أروع", ["food"]], [4, "", []], [1, "لقينا شعرة في السلطة — محتاجين تهتموا", ["food", "hygiene"]], [5, "تجربة ممتازة، هنرجع أكيد", ["service"]], [4, "القهوة مظبوطة", ["food"]],
    [3, "الصوت عالي شوية بالليل", ["ambience"]], [5, "عيد ميلاد بنتي كان مميز، شكرًا", ["service"]], [4, "المشويات المشكلة كمية كبيرة", ["food", "value"]], [5, "", []], [4, "الأسعار معقولة للمكان", ["value"]],
  ];
  const paid = c.checks.filter((x) => x.status === "paid");
  const guestFeedback: GuestFeedback[] = [];
  for (let i = 0; i < 34; i++) {
    const [stars, comment, tags] = COMMENTS[i % COMMENTS.length];
    const ch = i < paid.length ? paid[i] : null;
    const order = ch ? c.orders.find((o) => o.checkId === ch.id) : null;
    const days = ch ? 0 : 1 + Math.floor((i - paid.length) * 1.7);
    const waiters = ["waiter1", "waiter2", "waiter3"];
    const cu = order?.customerId ?? (rnd() < 0.5 ? customers[Math.floor(rnd() * customers.length)].id : null);
    guestFeedback.push({
      ...base(`fb:${i}`, ch ? Math.max(30, Math.round((c.now.getTime() - Date.parse(ch.closedAt ?? ch.openedAt)) / 60000) - 10) : days * DAY + 200), branchId: B, checkId: ch?.id ?? null, orderId: order?.id ?? null,
      tableId: ch?.tableIds[0] ?? c.id(`table:${1 + (i % 17)}`), customerId: cu, waiterId: order?.waiterId ?? c.staffId(waiters[i % 3]), stars, tags, comment,
      reply: stars <= 2 && i % 2 === 0 ? "متأسفين جدًا — كلمناك على واتساب وبعتنالك كود تعويض" : null, repliedAt: stars <= 2 && i % 2 === 0 ? c.T(days * DAY) : null, repliedBy: stars <= 2 && i % 2 === 0 ? c.staffId("manager") : null,
    });
  }

  /* ── Sufra platform: marketplace restaurants, profiles, slots, sponsored bookings ── */
  const other = (k: string, name: Localized, color: string): { r: Restaurant; b: Branch } => {
    const rid = c.id(`market:${k}`);
    return {
      r: { id: rid, createdAt: c.created, updatedAt: c.created, slug: k, name, ownerUserId: null, country: "EG", currency: "EGP", timezone: "Africa/Cairo", brandColor: color, phone: null, plan: "starter", active: true },
      b: { id: c.id(`market:${k}:branch`), restaurantId: rid, createdAt: c.created, updatedAt: c.created, name: L("الفرع الرئيسي", "Main branch"), slug: "main", address: L("القاهرة", "Cairo"), phone: null, isDefault: true, etaBranchCode: "0", openingHours: { open: "10:00", close: "02:00" } },
    };
  };
  const extra = [
    other("koshary-elzaeem", L("كشري الزعيم", "Koshary El Zaeem"), "#b4531f"),
    other("fish-market-alex", L("سمك أبو العربي – إسكندرية", "Abu El Araby Fish – Alexandria"), "#2f6f9f"),
    other("pizza-sherif", L("بيتزا شريف – المعادي", "Pizza Sherif – Maadi"), "#9a3b6b"),
  ];
  const profile = (rid: string, city: string, area: string, cuisines: string[], priceLevel: MarketProfile["priceLevel"], rating: number): MarketProfile => ({
    id: rid, restaurantId: rid, createdAt: c.created, updatedAt: c.created, city, area, cuisines, priceLevel, rating, listed: true,
  });
  const marketProfiles: MarketProfile[] = [
    profile(R, "cairo", "zamalek", ["egyptian", "grills"], 3, 4.7),
    profile(extra[0].r.id, "cairo", "downtown", ["egyptian", "koshary"], 1, 4.5),
    profile(extra[1].r.id, "alexandria", "anfoushi", ["seafood"], 2, 4.6),
    profile(extra[2].r.id, "cairo", "maadi", ["pizza", "italian"], 2, 4.3),
  ];
  const slot = (k: string, s: Omit<AdSlot, "id" | "createdAt" | "updatedAt">): AdSlot => ({ id: c.id(`adslot:${k}`), createdAt: c.created, updatedAt: c.created, ...s });
  const adSlots: AdSlot[] = [
    slot("home", { type: "home_banner", name: L("بانر الصفحة الرئيسية", "Home banner"), description: L("أول حاجة يشوفها كل زبون في تطبيق سُفرة", "The first thing every guest sees in the Sufra app"), city: null, cuisine: null, capacity: 1, pricing: { model: "day", rate: E(900) }, active: true, sort: 1 }),
    slot("top", { type: "marketplace_top", name: L("أول القائمة", "Top of the marketplace"), description: L("٣ أماكن مُموَّلة فوق نتايج المطاعم", "3 sponsored spots above the restaurant list"), city: null, cuisine: null, capacity: 3, pricing: { model: "cpc", rate: E("4.50") }, active: true, sort: 2 }),
    slot("city", { type: "city_top", name: L("أول المدينة / المنطقة", "Top of a city / area"), description: L("لما الزبون يدوّر في مدينته", "When guests browse their city"), city: null, cuisine: null, capacity: 2, pricing: { model: "day", rate: E(350) }, active: true, sort: 3 }),
    slot("cuisine", { type: "cuisine_top", name: L("أول نوع الأكل", "Top of a cuisine"), description: L("أول نتيجة في «مشويات»، «كشري»، «بيتزا»…", "First result in “grills”, “koshary”, “pizza”…"), city: null, cuisine: null, capacity: 2, pricing: { model: "cpm", rate: E(60) }, active: true, sort: 4 }),
  ];
  const today = c.T(0).slice(0, 10);
  const dayStr = (offset: number) => new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  const daily = (from: number, to: number, imp: number, ctrPct: number, conv: number) => {
    const out: AdBooking["daily"] = {};
    for (let d = from; d <= to; d++) {
      const i = Math.round(imp * (0.75 + rnd() * 0.5));
      const k = Math.round((i * ctrPct) / 100);
      out[dayStr(d)] = { impressions: i, clicks: k, orders: Math.round(k * conv) };
    }
    return out;
  };
  const sum = (d: AdBooking["daily"], revenuePerOrder: Units) => {
    const v = Object.values(d);
    const orders = v.reduce((a, x) => a + x.orders, 0);
    return { impressions: v.reduce((a, x) => a + x.impressions, 0), clicks: v.reduce((a, x) => a + x.clicks, 0), orders, revenue: orders * revenuePerOrder };
  };
  const d1 = daily(-9, 0, 5200, 3.1, 0.12);
  const d2 = daily(-5, 0, 1800, 4.4, 0.18);
  const adBookings: AdBooking[] = [
    {
      ...base("adbooking:zamalek-home", 12 * DAY), slotId: c.id("adslot:home"), startsOn: dayStr(-9), endsOn: dayStr(4), status: "live", targeting: { city: null, cuisine: null },
      pricing: { model: "day", rate: E(900) }, budget: 0, price: E(900) * 14,
      creative: { headline: L("مشويات سُفرة على الفحم — توصيل مجاني فوق ٥٠٠ ج", "Sufra charcoal grills — free delivery over EGP 500"), imageUrl: null, cta: L("اطلب دلوقتي", "Order now") },
      payment: { method: "online", reference: "DEMO-AD-48213", paidAt: c.T(12 * DAY), invoiceNo: null }, stats: sum(d1, E(620)), daily: d1,
      requestedBy: c.staffId("owner"), reviewedBy: c.staffId("platform"), reviewNote: "",
    },
    {
      ...base("adbooking:koshary-city", 8 * DAY), restaurantId: extra[0].r.id, slotId: c.id("adslot:city"), startsOn: dayStr(-5), endsOn: dayStr(9), status: "live", targeting: { city: "cairo", cuisine: null },
      pricing: { model: "day", rate: E(350) }, budget: 0, price: E(350) * 15,
      creative: { headline: L("كشري الزعيم — أكبر طبق في وسط البلد", "Koshary El Zaeem — the biggest bowl downtown"), imageUrl: null, cta: L("شوف المنيو", "See the menu") },
      payment: { method: "invoice", reference: null, paidAt: c.T(7 * DAY), invoiceNo: "SUF-AD-2026-0031" }, stats: sum(d2, E(140)), daily: d2,
      requestedBy: null, reviewedBy: c.staffId("platform"), reviewNote: "",
    },
    {
      ...base("adbooking:zamalek-cuisine", 1 * DAY), slotId: c.id("adslot:cuisine"), startsOn: dayStr(2), endsOn: dayStr(15), status: "requested", targeting: { city: null, cuisine: "grills" },
      pricing: { model: "cpm", rate: E(60) }, budget: E(3000), price: E(3000),
      creative: { headline: L("أحسن كفتة في الزمالك", "The best kofta in Zamalek"), imageUrl: null, cta: L("اطلب", "Order") },
      payment: { method: "invoice", reference: null, paidAt: null, invoiceNo: null }, stats: { impressions: 0, clicks: 0, orders: 0, revenue: 0 }, daily: {},
      requestedBy: c.staffId("owner"), reviewedBy: null, reviewNote: "",
    },
  ];

  return {
    customers,
    restaurants: extra.map((x) => x.r),
    branches: extra.map((x) => x.b),
    rows: {
      loyaltyPrograms: [program], loyaltyLedger, promotions, couponCodes, promoRedemptions, giftCards, giftCardTxns, segments, campaigns, campaignMessages, journeys, referrals,
      promoBanners, guestFeedback, marketProfiles, adSlots, adBookings,
    },
    visitPlan,
  };
}

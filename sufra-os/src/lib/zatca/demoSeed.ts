/**
 * KSA demo tenant "سُفرة – الرياض" (Riyadh, Olaya) so the ZATCA path is demoable: VAT 15% inclusive menu in SAR, seller
 * data in the national-address format, ZATCA on in **demo key custody** (keys on the tablet, never sent to ZATCA).
 * A separate restaurant (not a branch of the Zamalek one) because a Saudi outlet is its own VAT registrant.
 * The owner/admin/manager demo logins are members, so "Switch restaurant" reaches it. Everything here is fictional;
 * 399999999900003 is the VAT number ZATCA's own SDK samples use.
 */
import { seedId } from "@/lib/id";
import { major } from "@/lib/money";
import type { Branch, Collections, DiningTable, KitchenStation, Localized, Membership, MenuCategory, MenuItem, Restaurant, Settings, Zone } from "@/data/types";
import type { ZatcaSettings } from "./model";
import { KSA_TAX } from "./settings";

export const KSA_SLUG = "sufra-riyadh";
const id = (k: string) => seedId(`sufra-riyadh:${k}`);
export const KSA_RESTAURANT_ID = id("restaurant");
export const KSA_BRANCH_ID = id("branch:olaya");
const L = (ar: string, en: string): Localized => ({ ar, en });

export const KSA_ZATCA: ZatcaSettings = {
  enabled: true,
  environment: "sandbox",
  seller: {
    nameAr: "شركة سُفرة للمطاعم – فرع الرياض (تجريبي)",
    nameEn: "Sufra Restaurants Co. – Riyadh (demo)",
    vatNumber: "399999999900003",
    idScheme: "CRN",
    idValue: "1010010000",
    address: { street: "طريق الملك فهد", building: "2322", additionalNo: "8228", district: "العليا", city: "الرياض", postalCode: "12241", country: "SA" },
  },
  invoiceTypes: "1100",
  industry: "Restaurants",
  keyCustody: "demo_browser",
  serverConfigured: false,
};

type Rows = { [C in keyof Collections]?: Collections[C][] };

export function demoKsaRows(c: { created: string; userId: (k: string) => string }): Rows {
  const R = KSA_RESTAURANT_ID;
  const B = KSA_BRANCH_ID;
  const base = (k: string) => ({ id: id(k), restaurantId: R, createdAt: c.created, updatedAt: c.created });
  const restaurant: Restaurant = {
    id: R, createdAt: c.created, updatedAt: c.created, slug: KSA_SLUG, name: L("سُفرة – الرياض", "Sufra – Riyadh"), ownerUserId: c.userId("owner"), country: "SA", currency: "SAR",
    timezone: "Asia/Riyadh", brandColor: "#1d5c3f", phone: "0112345678", plan: "pro", active: true,
  };
  const branch: Branch = {
    ...base("branch:olaya"), name: L("فرع العليا", "Olaya"), slug: "olaya", address: L("طريق الملك فهد، العليا، الرياض ١٢٢٤١", "King Fahd Rd, Olaya, Riyadh 12241"), phone: "0112345678",
    isDefault: true, etaBranchCode: "0", openingHours: { open: "12:00", close: "02:00" },
  };
  const member = (k: string, name: string, role: Membership["role"], user: string | null, color: string): Membership => ({
    ...base(`staff:${k}`), userId: user ? c.userId(user) : null, name, role, branchIds: [], phone: null, email: null, color, hasPin: false, active: true, lastSeenAt: null,
  });
  const memberships = [
    member("owner", "كريم الشريف", "owner", "owner", "#0d5a53"),
    member("admin", "منى عبد الحميد", "admin", "admin", "#6b4fa0"),
    member("manager", "تامر فؤاد", "manager", "manager", "#a8700c"),
    member("accountant", "هالة منصور", "accountant", "accountant", "#5b6a64"),
  ];
  const st = (k: string, name: Localized, color: string, sort: number): KitchenStation => ({ ...base(`station:${k}`), branchId: B, name, color, printerId: null, sort });
  const kitchenStations = [st("grill", L("المشويات", "Grill"), "#c2412d", 1), st("kitchen", L("المطبخ", "Kitchen"), "#c46a12", 2), st("bar", L("المشروبات", "Drinks"), "#2f6f9f", 3)];
  const zones: Zone[] = [{ ...base("zone:hall"), branchId: B, name: L("الصالة", "Main hall"), width: 1200, height: 800, sort: 1 }];
  const tables: DiningTable[] = [1, 2, 3, 4, 5, 6].map((n) => ({
    ...base(`table:${n}`), branchId: B, zoneId: id("zone:hall"), label: String(n), code: `RY${String(n).padStart(2, "0")}`, shape: n > 4 ? "rect" : "square",
    x: 200 + ((n - 1) % 3) * 350, y: n <= 3 ? 220 : 560, w: n > 4 ? 160 : 90, h: 90, rotation: 0, seatsOverride: null, status: "free", statusSince: null, active: true,
  }));
  const cat = (k: string, name: Localized, sort: number, icon: string, station: string, color: string): MenuCategory => ({ ...base(`cat:${k}`), name, sort, color, icon, stationId: id(`station:${station}`), active: true });
  const menuCategories = [
    cat("mains", L("أطباق رئيسية", "Mains"), 1, "soup", "kitchen", "#b4531f"),
    cat("grills", L("مشويات", "Grills"), 2, "flame", "grill", "#c2412d"),
    cat("starters", L("مقبلات", "Starters"), 3, "utensils", "kitchen", "#a8700c"),
    cat("drinks", L("مشروبات", "Drinks"), 4, "coffee", "bar", "#2f6f9f"),
  ];
  // prices are VAT-inclusive SAR (KSA menus show the price the guest pays)
  const menuItems: MenuItem[] = [];
  const item = (catKey: string, k: string, name: Localized, price: string, desc: Localized = L("", "")) =>
    menuItems.push({
      ...base(`item:${k}`), categoryId: id(`cat:${catKey}`), name, description: desc, price: major(price), cost: null, sku: k.toUpperCase().slice(0, 12), stationId: null,
      modifierGroupIds: [], tags: [], prepMinutes: 12, available: true, vatExempt: false, imageUrl: null, sort: menuItems.filter((m) => m.categoryId === id(`cat:${catKey}`)).length + 1, active: true,
    } as MenuItem);
  item("mains", "kabsa", L("كبسة لحم", "Lamb kabsa"), "70", L("رز بسمتي ولحم نعيمي", "Basmati rice with Naimi lamb"));
  item("mains", "mandi", L("مندي دجاج", "Chicken mandi"), "46");
  item("mains", "jareesh", L("جريش", "Jareesh"), "28");
  item("grills", "mixed", L("مشاوي مشكلة", "Mixed grill"), "89");
  item("grills", "shawarma", L("شاورما عربي", "Arabic shawarma"), "23");
  item("grills", "kebab", L("كباب لحم", "Lamb kebab"), "52.5");
  item("starters", "hummus", L("حمص", "Hummus"), "18");
  item("starters", "mutabbal", L("متبل", "Mutabbal"), "18");
  item("starters", "fattoush", L("فتوش", "Fattoush"), "22");
  item("drinks", "tea", L("شاي", "Tea"), "10");
  item("drinks", "qahwa", L("قهوة عربية", "Arabic coffee"), "15");
  item("drinks", "orange", L("عصير برتقال", "Orange juice"), "18");
  item("drinks", "water", L("ماء", "Water"), "3");
  const settings: Settings = {
    ...base("settings"), id: R,
    tax: { ...KSA_TAX, taxId: KSA_ZATCA.seller.vatNumber, commercialRegister: KSA_ZATCA.seller.idValue, activityCode: "" },
    invoice: {
      header: L("سُفرة – الرياض", "Sufra – Riyadh"), footer: L("شكرًا لزيارتكم", "Thank you for your visit"), showLogo: true, showQr: true, showTaxBreakdown: true, showWaiter: true, language: "both", paperWidth: 80,
    },
    discountApprovalPct: 10, autoLockMinutes: 5, tipsEnabled: false,
    qrOrdering: { enabled: false, requireWaiterConfirm: true, allowServiceCalls: false },
    locale: { defaultLang: "ar", currency: "SAR", timezone: "Asia/Riyadh" },
    eta: { enabled: false, environment: "preprod", posSerial: "", tradeName: "", branchAddress: { governate: "", regionCity: "", street: "", buildingNumber: "", postalCode: "" }, splitTender: "dominant", itemCodePrefix: "", credentialsConfigured: false },
    zatca: KSA_ZATCA,
  };
  return { restaurants: [restaurant], branches: [branch], memberships, kitchenStations, zones, tables, menuCategories, menuItems, settings: [settings], zatcaEgsUnits: [], zatcaInvoices: [] };
}

/** Appends the KSA tenant to a seed (additive). */
export function addKsaDemo<D extends { [C in keyof Collections]: Collections[C][] }>(data: D, c: { created: string; userId: (k: string) => string }): D {
  const rows = demoKsaRows(c);
  for (const [k, v] of Object.entries(rows) as [keyof Collections, unknown[]][]) (data[k] as unknown[]) = [...((data[k] as unknown[] | undefined) ?? []), ...v];
  return data;
}

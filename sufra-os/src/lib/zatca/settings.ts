/**
 * ZATCA settings defaults, the KSA tax profile as Sufra TaxSettings, the country switch (Egypt → ETA, Saudi → ZATCA)
 * and the readiness checklist shown in Settings → ZATCA and the queue.
 */
import { KSA_PROFILE } from "@finance/tax";
import type { Restaurant, Settings, TaxSettings } from "@/data/types";
import type { ZatcaEgsUnit, ZatcaSettings } from "./model";
import { checkSeller, isVatNumber } from "./validate";

export const DEFAULT_ZATCA: ZatcaSettings = {
  enabled: false,
  environment: "sandbox",
  seller: {
    nameAr: "",
    nameEn: "",
    vatNumber: "",
    idScheme: "CRN",
    idValue: "",
    address: { street: "", building: "", additionalNo: "", district: "", city: "", postalCode: "", country: "SA" },
  },
  invoiceTypes: "1100",
  industry: "Restaurants",
  keyCustody: "server",
  serverConfigured: false,
};

export const zatcaSettingsOf = (s: Pick<Settings, "zatca"> | null | undefined): ZatcaSettings => ({
  ...DEFAULT_ZATCA,
  ...(s?.zatca ?? {}),
  seller: { ...DEFAULT_ZATCA.seller, ...(s?.zatca?.seller ?? {}), address: { ...DEFAULT_ZATCA.seller.address, ...(s?.zatca?.seller?.address ?? {}) } },
});

/** KSA tax settings (VAT 15% inclusive, no service charge) in Sufra's JSON shape — mirrors @finance/tax KSA_PROFILE. */
export const KSA_TAX: Pick<TaxSettings, "vatRegistered" | "vatRate" | "vatCode" | "serviceRate" | "serviceModes" | "vatOnService" | "serviceCode" | "priceMode" | "vatOnDelivery" | "taxDecimals"> = {
  vatRegistered: KSA_PROFILE.vatRegistered,
  vatRate: KSA_PROFILE.vatRate,
  vatCode: KSA_PROFILE.vatCode,
  serviceRate: KSA_PROFILE.serviceRate,
  serviceModes: [],
  vatOnService: KSA_PROFILE.vatOnService,
  serviceCode: KSA_PROFILE.serviceCode,
  priceMode: KSA_PROFILE.priceMode,
  vatOnDelivery: KSA_PROFILE.vatOnDelivery,
  taxDecimals: KSA_PROFILE.taxDecimals,
};

export type TaxRegime = "eta" | "zatca" | "none";
/** The country switch: Saudi restaurants with ZATCA on issue ZATCA documents; Egyptian ones ETA e-receipts. */
export function taxRegime(restaurant: Pick<Restaurant, "country"> | null | undefined, settings: Pick<Settings, "eta" | "zatca"> | null | undefined): TaxRegime {
  if (restaurant?.country === "SA") return zatcaSettingsOf(settings).enabled ? "zatca" : "none";
  return settings?.eta?.enabled === false ? "none" : "eta";
}

export interface ReadinessItem {
  id: "seller" | "vat" | "address" | "egs" | "compliance" | "production" | "server" | "tax";
  ok: boolean;
  label: { ar: string; en: string };
  hint?: { ar: string; en: string };
}

export function zatcaReadiness(settings: Settings | null | undefined, units: ZatcaEgsUnit[]): { ok: boolean; items: ReadinessItem[] } {
  const z = zatcaSettingsOf(settings);
  const sellerIssues = checkSeller({ name: z.seller.nameAr, vatNumber: z.seller.vatNumber, id: { scheme: z.seller.idScheme, value: z.seller.idValue }, address: z.seller.address });
  const addr = sellerIssues.filter((i) => i.field.startsWith("seller.address"));
  const now = Date.now();
  const live = units.filter((u) => u.status === "production" && (!u.production?.expiresAt || Date.parse(u.production.expiresAt) > now));
  const items: ReadinessItem[] = [
    { id: "seller", ok: !!z.seller.nameAr && /[؀-ۿ]/.test(z.seller.nameAr) && !!z.seller.idValue, label: { ar: "اسم المنشأة بالعربي والسجل التجاري", en: "Arabic legal name and CR number" } },
    { id: "vat", ok: isVatNumber(z.seller.vatNumber), label: { ar: "الرقم الضريبي (١٥ رقم يبدأ وينتهي بـ ٣)", en: "VAT number (15 digits, starts and ends with 3)" } },
    { id: "address", ok: addr.length === 0, label: { ar: "العنوان الوطني: مبنى ٤ أرقام، شارع، حي، مدينة، رمز بريدي ٥ أرقام", en: "National address: 4-digit building, street, district, city, 5-digit postal code" }, hint: addr[0]?.message },
    {
      id: "tax",
      ok: settings?.tax.vatRate === 1500 && settings.tax.serviceCode === null,
      label: { ar: "ملف الضريبة: ١٥٪ بدون كود خدمة مصري", en: "Tax profile: 15% VAT, no Egyptian service-charge code" },
    },
    { id: "egs", ok: units.length > 0, label: { ar: "وحدة EGS لكل جهاز كاشير", en: "An EGS unit for every POS device" } },
    { id: "compliance", ok: units.some((u) => u.compliance || u.status === "production"), label: { ar: "شهادة الامتثال (Compliance CSID) بكود OTP", en: "Compliance CSID (with an OTP)" } },
    { id: "production", ok: live.length > 0, label: { ar: "شهادة الإنتاج (Production CSID) سارية", en: "Valid production CSID" } },
    {
      id: "server",
      ok: z.keyCustody === "server" && z.serverConfigured,
      label: { ar: "المفاتيح والإرسال على السيرفر (ZATCA_ENV + Supabase Vault)", en: "Keys and submission on the server (ZATCA_ENV + Supabase Vault)" },
      hint: z.keyCustody === "demo_browser" ? { ar: "وضع تجريبي: المفتاح على التابلت — مش مقبول للإنتاج", en: "Demo mode: key on the tablet — not acceptable for production" } : undefined,
    },
  ];
  return { ok: items.every((i) => i.ok), items };
}

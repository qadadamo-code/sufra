/**
 * Owner-facing tax settings — the same options as the finance core's TaxProfile (sufra-finance/src/tax.ts):
 * VAT registered, service 12% for chosen modes (default dine-in only), VAT on service (ETA T9/SC01, inside the VAT base)
 * or not (T17/SC03, outside), inclusive vs exclusive menu prices, activity code. The preview below is a simplified mirror
 * for the settings screen; real bills are priced by the finance core.
 */
import { applyRate } from "@/lib/pricing";

export interface TaxSettings {
  vatRegistered: boolean;
  rin: string;
  /** basis points */
  serviceRate: number;
  serviceDineInOnly: boolean;
  serviceCode: "T9" | "T17";
  priceMode: "exclusive" | "inclusive";
  activity: "5610" | "5630";
  vatOnDelivery: boolean;
  autoSubmit: boolean;
}

export const DEFAULT_TAX: TaxSettings = { vatRegistered: true, rin: "512334908", serviceRate: 1200, serviceDineInOnly: true, serviceCode: "T9", priceMode: "exclusive", activity: "5610", vatOnDelivery: true, autoSubmit: true };
const VAT = 1400;

export interface TaxPreview {
  base: number;
  service: number;
  vat: number;
  total: number;
}

/** Price a bill of printed menu prices (piastres) under the settings. */
export function previewBill(printed: number, mode: "dine-in" | "takeaway" | "delivery", s: TaxSettings): TaxPreview {
  const sv = s.serviceRate > 0 && (!s.serviceDineInOnly || mode === "dine-in") ? s.serviceRate : 0;
  const v = s.vatRegistered ? VAT : 0;
  const vatOnService = s.serviceCode === "T9";
  if (s.priceMode === "exclusive") {
    const base = printed;
    const service = applyRate(base, sv);
    const vat = applyRate(base + (vatOnService ? service : 0), v);
    return { base, service, vat, total: base + service + vat };
  }
  // inclusive: the printed price IS the total; back the base out and leave rounding in the base
  const factor = vatOnService ? (1 + sv / 10000) * (1 + v / 10000) : 1 + sv / 10000 + v / 10000;
  const approx = Math.round(printed / factor);
  const service = applyRate(approx, sv);
  const vat = applyRate(approx + (vatOnService ? service : 0), v);
  const base = printed - service - vat;
  return { base, service, vat, total: printed };
}

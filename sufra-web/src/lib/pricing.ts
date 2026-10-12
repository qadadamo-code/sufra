/**
 * Sufra pricing — the ONE place money is computed.
 *
 * All amounts are integer piastres (1 EGP = 100 piastres). Rates are converted to basis points and
 * every derived amount is rounded half-up with integer arithmetic, so there is no floating-point drift.
 *
 * Order of operations (Egyptian restaurant convention, menu prices are before tax):
 *   subtotal  = Σ round(unitPrice × qty)                       (each line rounded)
 *   discount  = offer on the subtotal (percent or fixed amount, never more than the subtotal)
 *   service   = (subtotal − discount) × serviceRate              (dine-in only; delivery fee never carries service)
 *   vat       = (subtotal − discount + service) × vatRate        (delivery fee excluded)
 *   total     = subtotal − discount + service + vat + deliveryFee (deliveryFee only for mode "delivery")
 *
 * TODO(finance): the finance team will replace this with the real tax engine (per-item VAT classes,
 * e-invoice rounding rules, service-charge exemptions). Keep the signature stable so call sites don't change.
 */

export type PriceMode = "dine-in" | "delivery" | "pickup";
export type Discount = { kind: "percent"; value: number } | { kind: "amount"; value: number };
export type PriceLine = { unitPrice: number; qty: number };

export interface PriceInput {
  lines: PriceLine[];
  mode: PriceMode;
  /** e.g. 0.12 for 12 %. Applies to dine-in only. */
  serviceRate?: number;
  /** e.g. 0.14 for 14 % VAT. */
  vatRate?: number;
  discount?: Discount | null;
  /** piastres; only charged when mode === "delivery". */
  deliveryFee?: number;
}

export interface PriceBreakdown {
  subtotal: number;
  discount: number;
  service: number;
  vat: number;
  deliveryFee: number;
  total: number;
}

const BP = 10_000;

/** Rate (0.14) → basis points (1400), exact for any rate with ≤ 4 decimals. */
export function toBasisPoints(rate: number): number {
  if (!Number.isFinite(rate) || rate < 0) return 0;
  return Math.round(rate * BP);
}

/** amount × bp / 10000 rounded half-up (amount is a non-negative integer). */
export function applyRate(amount: number, bp: number): number {
  if (amount <= 0 || bp <= 0) return 0;
  return Math.floor((amount * bp + BP / 2) / BP);
}

/** Half-up rounding of a possibly fractional piastre value (used for line totals). */
export function roundHalfUp(v: number): number {
  // Nudge by a tiny epsilon so 2.4999999999 coming from float multiplication still rounds to 3 when it "is" 2.5.
  return Math.floor(v + 0.5 + 1e-9);
}

export function priceBreakdown({ lines, mode, serviceRate = 0.12, vatRate = 0.14, discount = null, deliveryFee = 0 }: PriceInput): PriceBreakdown {
  const subtotal = lines.reduce((sum, l) => {
    const qty = Math.max(0, Math.floor(l.qty));
    const unit = Math.max(0, l.unitPrice);
    return sum + roundHalfUp(unit * qty);
  }, 0);

  let disc = 0;
  if (discount && discount.value > 0) {
    disc = discount.kind === "percent" ? applyRate(subtotal, Math.min(BP, toBasisPoints(discount.value / 100))) : Math.round(discount.value);
  }
  disc = Math.min(subtotal, Math.max(0, disc));

  const net = subtotal - disc;
  const service = mode === "dine-in" ? applyRate(net, toBasisPoints(serviceRate)) : 0;
  const vat = applyRate(net + service, toBasisPoints(vatRate));
  const fee = mode === "delivery" ? Math.max(0, Math.round(deliveryFee)) : 0;
  return { subtotal, discount: disc, service, vat, deliveryFee: fee, total: net + service + vat + fee };
}

/** EGP (menu number) → piastres. */
export const egp = (pounds: number) => Math.round(pounds * 100);

/** Piastres → display string "185 ج.م" / "EGP 185" (shows piastres only when non-zero). */
export function formatMoney(piastres: number, lang: "ar" | "en" = "ar"): string {
  const neg = piastres < 0;
  const abs = Math.abs(piastres);
  const pounds = Math.floor(abs / 100);
  const pt = abs % 100;
  const num = pounds.toLocaleString("en-US") + (pt ? "." + String(pt).padStart(2, "0") : "");
  const s = lang === "ar" ? `${num} ج.م` : `EGP ${num}`;
  return neg ? "−" + s : s;
}

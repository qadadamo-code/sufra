import type { Offer, Restaurant } from "./data";
import { minutesOf } from "./hours";
import type { Discount, PriceMode } from "./pricing";

export type CodeResult = { ok: true; offer: Offer; discount: Discount | null; freeDelivery: boolean; note?: { ar: string; en: string } } | { ok: false; reason: { ar: string; en: string } };

/** Validate a restaurant offer code for an order. Free delivery needs a 300 EGP subtotal; happy hour checks the clock. */
export function applyCode(r: Restaurant, code: string, ctx: { subtotal: number; mode: PriceMode; now: Date; party?: number; firstVisit?: boolean; plus?: boolean }): CodeResult {
  const c = code.trim().toUpperCase();
  if (!c) return { ok: false, reason: { ar: "اكتب الكود", en: "Enter a code" } };
  const offer = r.offers.find((o) => o.code.toUpperCase() === c);
  if (!offer) return { ok: false, reason: { ar: "الكود ده مش تبع المطعم ده", en: "That code isn't for this restaurant" } };
  const day = ctx.now.getDay();
  if (offer.days.length && !offer.days.includes(day)) return { ok: false, reason: { ar: "العرض مش شغال النهارده", en: "This offer doesn't run today" } };
  switch (offer.kind) {
    case "free-delivery":
      if (ctx.mode !== "delivery") return { ok: false, reason: { ar: "الكود ده للتوصيل بس", en: "Delivery orders only" } };
      if (ctx.subtotal < 30000) return { ok: false, reason: { ar: "التوصيل المجاني للطلبات فوق 300 ج.م", en: "Free delivery is for orders over EGP 300" } };
      return { ok: true, offer, discount: null, freeDelivery: true };
    case "happy-hour": {
      const m = minutesOf(ctx.now);
      if (offer.from != null && offer.to != null && (m < offer.from || m >= offer.to)) return { ok: false, reason: { ar: "الهابي أور مش دلوقتي", en: "Not happy hour right now" } };
      return { ok: true, offer, discount: { kind: "percent", value: offer.value }, freeDelivery: false };
    }
    case "group":
      if ((ctx.party ?? 0) < 6 && ctx.mode === "dine-in") return { ok: false, reason: { ar: "العرض للمجموعات 6 أفراد أو أكتر", en: "For groups of 6 or more" } };
      return { ok: true, offer, discount: { kind: "percent", value: offer.value }, freeDelivery: false, note: { ar: "خصم المجموعات", en: "Group discount" } };
    case "bogo":
      return { ok: true, offer, discount: null, freeDelivery: false, note: { ar: "اطلب صنفين واحد ببلاش — هيتطبق في المطعم", en: "Buy one get one — applied by the restaurant" } };
    case "first-visit":
    case "plus":
    case "percent":
    default:
      return { ok: true, offer, discount: { kind: "percent", value: offer.value }, freeDelivery: false };
  }
}

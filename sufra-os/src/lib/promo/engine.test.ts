import { describe, expect, it } from "vitest";
import { major } from "@/lib/money";
import { priceItems } from "@/data/pricing";
import type { OrderItem, TaxSettings } from "@/data/types";
import { allocateUnits, evaluatePromotions, normalizeCode, windowCheck, type Promo } from "./engine";
import type { PromoCart, PromoContext, PromoLine } from "./types";

const E = major;
const line = (id: string, itemId: string, qty: number, price: number, categoryId: string | null = "food", discount = 0): PromoLine => ({ id, itemId, categoryId, qty, unitPrice: E(price), discount: E(discount) });
// Saturday 2026-10-24 20:00 Cairo (UTC+3)
const SAT_8PM = new Date("2026-10-24T17:00:00Z");
const cart = (lines: PromoLine[], extra: Partial<PromoCart> = {}): PromoCart => ({ lines, channel: "pos", mode: "dine_in", deliveryFee: 0, at: SAT_8PM, timezone: "Africa/Cairo", ...extra });
const NOCTX: PromoContext = { customer: null, codes: [] };
let n = 0;
const promo = (p: Partial<Promo>): Promo => ({
  id: p.id ?? `p${++n}`, name: { ar: "عرض", en: "Offer" }, kind: "auto", type: "percent", code: null, value: 1000, channels: [], stackable: true, priority: 10, active: true, uses: 0, ...p,
});

describe("promo engine", () => {
  it("allocates in whole piastres and always adds up", () => {
    const parts = allocateUnits(E(10), [E(3), E(3), E(3)]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(E(10));
    expect(parts.every((p) => p % 1000 === 0)).toBe(true);
    expect(allocateUnits(E(5), [0, 0])).toEqual([0, 0]);
  });

  it("percent off the bill is spread over the lines, rounded to piastres", () => {
    const r = evaluatePromotions(cart([line("a", "kofta", 1, 345), line("b", "tea", 3, 45.33)]), [promo({ value: 1500 })], NOCTX);
    // base 345 + 135.99 = 480.99 → 15% = 72.1485 → 72.15
    expect(r.discount).toBe(E("72.15"));
    expect(r.lineDiscounts.a + r.lineDiscounts.b).toBe(E("72.15"));
    expect(Object.values(r.lineDiscounts).every((v) => v % 1000 === 0)).toBe(true);
  });

  it("respects manual line discounts and never goes below zero", () => {
    const r = evaluatePromotions(cart([line("a", "x", 1, 100, "food", 90)]), [promo({ type: "amount", value: E(50) })], NOCTX);
    expect(r.discount).toBe(E(10));
  });

  it("targets items/categories", () => {
    const p = promo({ value: 5000, target: { itemIds: [], categoryIds: ["drinks"] } });
    const r = evaluatePromotions(cart([line("a", "kofta", 1, 345), line("b", "tea", 2, 45, "drinks")]), [p], NOCTX);
    expect(r.lineDiscounts).toEqual({ b: E(45) });
  });

  it("minimum spend", () => {
    const p = promo({ type: "amount", value: E(50), minSpend: E(500) });
    const small = evaluatePromotions(cart([line("a", "kofta", 1, 345)]), [p], NOCTX);
    expect(small.applied).toHaveLength(0);
    expect(small.hints[0].missing).toBe(E(155));
    const big = evaluatePromotions(cart([line("a", "kofta", 2, 345)]), [p], NOCTX);
    expect(big.discount).toBe(E(50));
  });

  it("BOGO gives the cheapest units free, in groups", () => {
    const p = promo({ type: "bogo", value: 10_000, bogo: { buyQty: 1, getQty: 1 }, target: { itemIds: ["coffee", "tea"], categoryIds: [] } });
    // 3 coffees @70 + 1 tea @45 → 4 units → 2 groups → free: the 2 cheapest units (45 + 70)
    const r = evaluatePromotions(cart([line("c", "coffee", 3, 70), line("t", "tea", 1, 45)]), [p], NOCTX);
    expect(r.discount).toBe(E(115));
    // odd unit out gets nothing
    const r2 = evaluatePromotions(cart([line("c", "coffee", 3, 70)]), [p], NOCTX);
    expect(r2.discount).toBe(E(70));
  });

  it("buy X get Y (different item), half price", () => {
    const p = promo({ type: "bogo", value: 5000, bogo: { buyQty: 2, getQty: 1, getItemIds: ["dessert"] }, target: { itemIds: ["main"], categoryIds: [] } });
    const r = evaluatePromotions(cart([line("m", "main", 4, 300), line("d", "dessert", 3, 100)]), [p], NOCTX);
    expect(r.discount).toBe(E(100)); // 2 sets → 2 desserts at 50%
  });

  it("combo price", () => {
    const p = promo({ type: "combo", value: E(400), combo: { itemIds: ["kofta", "salad", "soda"] } });
    const r = evaluatePromotions(cart([line("k", "kofta", 1, 345), line("s", "salad", 1, 75), line("d", "soda", 2, 50)]), [p], NOCTX);
    expect(r.discount).toBe(E(70)); // 470 → 400
    expect(r.lineDiscounts.d).toBeLessThanOrEqual(E(50));
  });

  it("free delivery over X and the delivery-only guard", () => {
    const p = promo({ type: "free_delivery", value: 0, minSpend: E(300) });
    const r = evaluatePromotions(cart([line("a", "kofta", 1, 345)], { mode: "delivery", deliveryFee: E(35) }), [p], NOCTX);
    expect(r.deliveryDiscount).toBe(E(35));
    expect(r.discount).toBe(0);
    expect(evaluatePromotions(cart([line("a", "kofta", 1, 345)]), [p], NOCTX).applied).toHaveLength(0);
  });

  it("first-order discount needs a customer with no orders", () => {
    const p = promo({ value: 2000, firstOrderOnly: true });
    const c = cart([line("a", "kofta", 1, 100)]);
    expect(evaluatePromotions(c, [p], NOCTX).applied).toHaveLength(0);
    expect(evaluatePromotions(c, [p], { codes: [], customer: { id: "c1", orders: 0, usesByPromo: {}, segmentIds: [], tierId: null } }).discount).toBe(E(20));
    expect(evaluatePromotions(c, [p], { codes: [], customer: { id: "c1", orders: 3, usesByPromo: {}, segmentIds: [], tierId: null } }).discount).toBe(0);
  });

  it("happy hour windows (days, hours, past midnight)", () => {
    const hh = promo({ value: 2000, window: { from: "17:00", to: "19:00" } });
    expect(windowCheck(hh, SAT_8PM, "Africa/Cairo")).toBe("wrong_time");
    expect(windowCheck(hh, new Date("2026-10-24T15:30:00Z"), "Africa/Cairo")).toBeNull(); // 18:30
    const late = promo({ window: { from: "23:00", to: "02:00", days: [6] } }); // Saturday night
    expect(windowCheck(late, new Date("2026-10-24T22:30:00Z"), "Africa/Cairo")).toBeNull(); // Sun 01:30 → Saturday's window
    expect(windowCheck(late, new Date("2026-10-25T22:30:00Z"), "Africa/Cairo")).toBe("wrong_day");
    const dated = promo({ window: { startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" } });
    expect(windowCheck(dated, SAT_8PM)).toBe("not_started");
    expect(windowCheck(dated, new Date("2026-12-02T00:00:00Z"))).toBe("expired");
  });

  it("coupon codes: shared, unique, used, owner, limits", () => {
    const shared = promo({ kind: "coupon", code: "RAMADAN15", value: 1500, limits: { total: 100 } });
    const uniq = promo({ id: "u", kind: "coupon", code: null, type: "amount", value: E(50) });
    const c = cart([line("a", "kofta", 2, 300)]);
    expect(evaluatePromotions(c, [shared], { customer: null, codes: [" ramadan-15 "] }).discount).toBe(E(90));
    expect(evaluatePromotions(c, [shared], { customer: null, codes: [] }).applied).toHaveLength(0);
    expect(evaluatePromotions(c, [{ ...shared, uses: 100 }], { customer: null, codes: ["RAMADAN15"] }).rejected[0].reason).toBe("limit_total");
    expect(evaluatePromotions(c, [shared], { customer: null, codes: ["NOPE"] }).rejected[0].reason).toBe("unknown_code");
    const cust = { id: "c1", orders: 2, usesByPromo: {}, segmentIds: [], tierId: null };
    const codes = [{ code: "WB-ABC12", promotionId: "u", customerId: "c1", usedAt: null }];
    expect(evaluatePromotions(c, [uniq], { customer: cust, codes: ["wb-abc12"], uniqueCodes: codes }).discount).toBe(E(50));
    expect(evaluatePromotions(c, [uniq], { customer: { ...cust, id: "c2" }, codes: ["WB-ABC12"], uniqueCodes: codes }).rejected[0].reason).toBe("code_owner");
    expect(evaluatePromotions(c, [uniq], { customer: cust, codes: ["WB-ABC12"], uniqueCodes: [{ ...codes[0], usedAt: "2026-10-01T00:00:00Z" }] }).rejected[0].reason).toBe("code_used");
    const per = { ...shared, limits: { perCustomer: 1 } };
    expect(evaluatePromotions(c, [per], { customer: { ...cust, usesByPromo: { [per.id]: 1 } }, codes: ["RAMADAN15"] }).rejected[0].reason).toBe("limit_customer");
  });

  it("channels and order types", () => {
    const p = promo({ channels: ["online"], modes: ["delivery"] });
    expect(evaluatePromotions(cart([line("a", "x", 1, 100)]), [p], NOCTX).applied).toHaveLength(0);
    expect(evaluatePromotions(cart([line("a", "x", 1, 100)], { channel: "online", mode: "delivery" }), [p], NOCTX).applied).toHaveLength(1);
  });

  it("stacking: stackables combine in priority order; a better non-stackable wins alone", () => {
    const a = promo({ id: "a", value: 1000, priority: 1 }); // 10%
    const b = promo({ id: "b", type: "amount", value: E(20), priority: 2 });
    const big = promo({ id: "big", value: 2500, stackable: false, priority: 5 }); // 25% alone
    const c = cart([line("x", "x", 1, 200)]);
    const both = evaluatePromotions(c, [a, b], NOCTX);
    expect(both.applied.map((x) => x.promotionId)).toEqual(["a", "b"]);
    expect(both.discount).toBe(E(40)); // 20 then 20 on the remaining 180
    const r = evaluatePromotions(c, [a, b, big], NOCTX);
    expect(r.applied.map((x) => x.promotionId)).toEqual(["big"]);
    expect(r.discount).toBe(E(50));
    expect(r.rejected.filter((x) => x.reason === "not_stackable").map((x) => x.promotionId).sort()).toEqual(["a", "b"]);
  });

  it("max discount cap", () => {
    const p = promo({ value: 5000, maxDiscount: E(100) });
    expect(evaluatePromotions(cart([line("a", "x", 1, 1000)]), [p], NOCTX).discount).toBe(E(100));
  });

  it("free item takes the cheapest qualifying unit", () => {
    const p = promo({ type: "free_item", value: 1, target: { itemIds: ["tea", "coffee"], categoryIds: [] } });
    expect(evaluatePromotions(cart([line("a", "coffee", 1, 70), line("b", "tea", 1, 45)]), [p], NOCTX).lineDiscounts).toEqual({ b: E(45) });
  });

  it("result is compatible with @finance/tax (discount before VAT/service)", () => {
    const tax: TaxSettings = {
      vatRegistered: true, vatRate: 1400, vatCode: { type: "T1", subType: "V009" }, serviceRate: 1200, serviceModes: ["dine_in"], vatOnService: true,
      serviceCode: { type: "T9", subType: "SC01" }, priceMode: "exclusive", vatOnDelivery: true, taxDecimals: 2, taxId: "", commercialRegister: "", activityCode: "",
    };
    const lines = [line("a", "kofta", 1, 345), line("b", "tea", 2, 45)];
    const r = evaluatePromotions(cart(lines), [promo({ value: 1000 })], NOCTX);
    const items = lines.map((l) => ({ id: l.id, itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice, modifiers: [], status: "new", stationId: "food", discount: r.lineDiscounts[l.id] ?? 0 }) as unknown as OrderItem);
    const { totals } = priceItems(items, { mode: "dine_in", tax });
    expect(totals.discountTotal).toBe(E(43.5));
    // net 391.5 → service 46.98 → VAT 14% of 438.48 = 61.39 → 499.87
    expect(totals.service).toBe(E("46.98"));
    expect(totals.total).toBe(E("499.87"));
  });

  it("normalises codes", () => {
    expect(normalizeCode(" sufra-٢٠٢٦ ")).toBe("SUFRA2026");
  });
});

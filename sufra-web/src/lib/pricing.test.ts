import { describe, expect, it } from "vitest";
import { applyRate, egp, formatMoney, priceBreakdown, toBasisPoints } from "./pricing";

describe("priceBreakdown", () => {
  it("dine-in: service 12% on subtotal, VAT 14% on subtotal + service", () => {
    const r = priceBreakdown({ lines: [{ unitPrice: egp(100), qty: 2 }], mode: "dine-in" });
    expect(r).toEqual({ subtotal: 20000, discount: 0, service: 2400, vat: 3136, deliveryFee: 0, total: 25536 });
  });

  it("delivery: no service, fee added after VAT and not taxed", () => {
    const r = priceBreakdown({ lines: [{ unitPrice: egp(185), qty: 1 }], mode: "delivery", deliveryFee: egp(25) });
    expect(r.service).toBe(0);
    expect(r.vat).toBe(2590); // 18500 × 14%
    expect(r.deliveryFee).toBe(2500);
    expect(r.total).toBe(18500 + 2590 + 2500);
  });

  it("pickup ignores the delivery fee and service", () => {
    const r = priceBreakdown({ lines: [{ unitPrice: 5000, qty: 3 }], mode: "pickup", deliveryFee: 3000 });
    expect(r).toMatchObject({ subtotal: 15000, service: 0, deliveryFee: 0, vat: 2100, total: 17100 });
  });

  it("percent discount comes off before service and VAT", () => {
    const r = priceBreakdown({ lines: [{ unitPrice: egp(250), qty: 2 }], mode: "dine-in", discount: { kind: "percent", value: 10 } });
    expect(r.subtotal).toBe(50000);
    expect(r.discount).toBe(5000);
    expect(r.service).toBe(5400); // 45000 × 12%
    expect(r.vat).toBe(7056); // 50400 × 14%
    expect(r.total).toBe(45000 + 5400 + 7056);
  });

  it("amount discount is capped at the subtotal", () => {
    const r = priceBreakdown({ lines: [{ unitPrice: 3000, qty: 1 }], mode: "pickup", discount: { kind: "amount", value: 10000 } });
    expect(r).toMatchObject({ subtotal: 3000, discount: 3000, vat: 0, total: 0 });
  });

  it("rounds half-up at each step", () => {
    // 1 piastre... 125 × 14% = 17.5 → 18
    expect(applyRate(125, toBasisPoints(0.14))).toBe(18);
    // 105 × 12% = 12.6 → 13 ; (105+13) × 14% = 16.52 → 17
    const r = priceBreakdown({ lines: [{ unitPrice: 105, qty: 1 }], mode: "dine-in" });
    expect(r).toMatchObject({ service: 13, vat: 17, total: 135 });
    // line rounding: fractional unit price × qty rounds per line
    const l = priceBreakdown({ lines: [{ unitPrice: 33.5, qty: 1 }, { unitPrice: 33.5, qty: 1 }], mode: "pickup", vatRate: 0 });
    expect(l.subtotal).toBe(68);
  });

  it("supports a per-restaurant service rate and zero items", () => {
    expect(priceBreakdown({ lines: [{ unitPrice: 10000, qty: 1 }], mode: "dine-in", serviceRate: 0.1 }).service).toBe(1000);
    expect(priceBreakdown({ lines: [], mode: "delivery", deliveryFee: 2000 })).toEqual({ subtotal: 0, discount: 0, service: 0, vat: 0, deliveryFee: 2000, total: 2000 });
  });

  it("always returns integers", () => {
    for (let i = 1; i < 400; i += 7) {
      const r = priceBreakdown({ lines: [{ unitPrice: i * 37, qty: (i % 5) + 1 }], mode: "dine-in", discount: { kind: "percent", value: i % 30 }, deliveryFee: 999 });
      Object.values(r).forEach((v) => expect(Number.isInteger(v)).toBe(true));
      expect(r.total).toBe(r.subtotal - r.discount + r.service + r.vat + r.deliveryFee);
    }
  });
});

describe("formatMoney", () => {
  it("formats Arabic and English", () => {
    expect(formatMoney(18500, "ar")).toBe("185 ج.م");
    expect(formatMoney(123456, "en")).toBe("EGP 1,234.56");
  });
});

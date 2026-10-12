import { describe, expect, it } from "vitest";
import { DEFAULT_TAX, previewBill } from "./tax";

describe("tax settings preview", () => {
  it("exclusive, T9: service 12% then VAT 14% on base + service", () => {
    const p = previewBill(10000, "dine-in", DEFAULT_TAX);
    expect(p).toEqual({ base: 10000, service: 1200, vat: 1568, total: 12768 });
  });
  it("T17 keeps service outside the VAT base", () => {
    const p = previewBill(10000, "dine-in", { ...DEFAULT_TAX, serviceCode: "T17" });
    expect(p.vat).toBe(1400);
    expect(p.total).toBe(12600);
  });
  it("service is dine-in only by default", () => {
    expect(previewBill(10000, "delivery", DEFAULT_TAX).service).toBe(0);
    expect(previewBill(10000, "delivery", { ...DEFAULT_TAX, serviceDineInOnly: false }).service).toBe(1200);
  });
  it("not VAT registered → no VAT", () => {
    expect(previewBill(10000, "takeaway", { ...DEFAULT_TAX, vatRegistered: false }).vat).toBe(0);
  });
  it("inclusive prices: guest pays exactly the printed price", () => {
    for (const price of [18500, 9999, 100, 26000]) {
      const p = previewBill(price, "dine-in", { ...DEFAULT_TAX, priceMode: "inclusive" });
      expect(p.total).toBe(price);
      expect(p.base + p.service + p.vat).toBe(price);
    }
  });
});

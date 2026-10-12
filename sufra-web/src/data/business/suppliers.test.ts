import { describe, expect, it } from "vitest";
import { CATEGORIES, PRODUCTS, SUPPLIERS, offersFor, supplierById } from "./suppliers";

describe("sample supplier catalogue", () => {
  it("has ~25 suppliers and ~250 products with unique ids", () => {
    expect(SUPPLIERS.length).toBe(25);
    expect(PRODUCTS.length).toBeGreaterThanOrEqual(240);
    expect(new Set(PRODUCTS.map((p) => p.id)).size).toBe(PRODUCTS.length);
  });
  it("every product has a positive integer piastre price and a known supplier/category", () => {
    const cats = new Set(CATEGORIES.map((c) => c.id));
    for (const p of PRODUCTS) {
      expect(Number.isInteger(p.price) && p.price > 0).toBe(true);
      expect(supplierById[p.supplierId]).toBeTruthy();
      expect(cats.has(p.category)).toBe(true);
    }
  });
  it("every category is stocked and prices can be compared", () => {
    for (const c of CATEGORIES) expect(PRODUCTS.some((p) => p.category === c.id)).toBe(true);
    const tomatoes = offersFor("tomato");
    expect(tomatoes.length).toBeGreaterThan(1);
    expect(tomatoes[0].price).toBeLessThanOrEqual(tomatoes[1].price);
  });
});

import { describe, expect, it } from "vitest";
import { catalogue, getRestaurant, openNow, searchRestaurants, toFilters, validatePicks, type AskContext } from "./concierge-tools";
import { areaById, restaurants } from "./data";

const ctx: AskContext = { origin: { lat: areaById.zamalek.lat, lng: areaById.zamalek.lng }, now: new Date(2026, 9, 12, 20, 0), lang: "ar", favourites: [], recent: [] };

describe("concierge tools (same engine as the site)", () => {
  it("validates and clamps model input", () => {
    const f = toFilters({ areas: ["zamalek", "atlantis"], moods: ["work", "nope"], limit: 99, max_km: -5, price: "free" });
    expect(f.areas).toEqual(["zamalek"]);
    expect(f.moods).toEqual(["work"]);
    expect(f.limit).toBe(8);
    expect(f.maxKm).toBe(0.2);
    expect(f.price).toBeNull();
  });
  it("search_restaurants returns deep-linkable, honest results", () => {
    const out = searchRestaurants({ areas: ["zamalek"], cuisines: ["cafe"], limit: 3 }, ctx);
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results.length).toBeLessThanOrEqual(3);
    for (const r of out.results) {
      expect(r.link).toMatch(/^#\/r\//);
      expect(r.area).toBe("zamalek");
      expect(typeof r.rating_is_sample).toBe("boolean");
    }
  });
  it("like_restaurant finds similar places by name", () => {
    const out = searchRestaurants({ like_restaurant: "كشري ابو طارق", limit: 4 }, ctx);
    expect(out.similar_to?.toLowerCase()).toContain("koshary");
    expect(out.results.every((r) => !r.name_en.toLowerCase().includes("abou tarek"))).toBe(true);
  });
  it("get_restaurant and open_now", () => {
    const r = restaurants[0];
    const d = getRestaurant({ id: r.id }, ctx) as Record<string, unknown>;
    expect(d.name_en).toBe(r.en);
    expect(Object.keys(d.hours as object)).toHaveLength(7);
    expect((getRestaurant({ id: "nope" }, ctx) as { error?: string }).error).toBeTruthy();
    const o = openNow({ ids: [r.id], at_time: "03:00" }, ctx) as { places: { open: boolean }[] };
    expect(o.places).toHaveLength(1);
    const any = openNow({}, ctx) as { open_count: number; nearest_open: unknown[] };
    expect(any.open_count).toBeGreaterThan(0);
  });
  it("show_picks validation drops unknown ids and caps at 4", () => {
    const ids = restaurants.slice(0, 6).map((r) => r.id);
    expect(validatePicks({ picks: [...ids, "fake"].map((id) => ({ id, reasons: ["x"] })) })).toHaveLength(4);
    expect(validatePicks({ picks: [{ id: "fake", reasons: [] }] })).toBeNull();
    expect(validatePicks("nonsense")).toBeNull();
  });
  it("catalogue is stable (cache-friendly) and covers every place", () => {
    expect(catalogue()).toBe(catalogue());
    expect(catalogue().split("\n")).toHaveLength(restaurants.length);
  });
});

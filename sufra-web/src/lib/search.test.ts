import { describe, expect, it } from "vitest";
import { matchScore, searchAll, trending } from "./search";
import { areaById, restaurants } from "./data";

const home = { lat: areaById.downtown.lat, lng: areaById.downtown.lng };

describe("smart search", () => {
  it("finds a place by name in either script, with typos", () => {
    const a = searchAll("كشري ابو طارق", { origin: home });
    expect(a.places[0]?.r.en.toLowerCase()).toContain("koshary");
    const b = searchAll("koshary abu tarek", { origin: home });
    expect(b.places.some((p) => p.r.ar.includes("كشري"))).toBe(true);
  });
  it("finds areas and cuisines, including via synonyms", () => {
    expect(searchAll("الزمالك").areas[0]?.a.id).toBe("zamalek");
    expect(searchAll("zamalk").areas[0]?.a.id).toBe("zamalek");
    expect(searchAll("كافيه").cuisines.map((c) => c.id)).toContain("cafe");
  });
  it("matchScore requires every word to hit something", () => {
    const r = restaurants.find((x) => x.area === "zamalek" && x.cuisine === "cafe")!;
    expect(matchScore(r, "الزمالك")).toBeGreaterThan(0);
    expect(matchScore(r, "zzqqxx")).toBe(0);
  });
  it("trending follows the time of day", () => {
    expect(trending(new Date(2026, 9, 12, 8), "ar")[0]).toBe("فطار");
    expect(trending(new Date(2026, 9, 12, 23, 30), "en")[0]).toBe("late night");
    expect(trending(new Date(2026, 9, 12, 13), "en").length).toBeGreaterThan(3);
  });
});

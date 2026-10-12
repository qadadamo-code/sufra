import { describe, expect, it } from "vitest";
import { affinityFn, becauseFn, buildTaste, dayMoment } from "./taste";
import { restaurants } from "./data";

const italian = restaurants.filter((r) => r.cuisine === "italian");
const cafe = restaurants.find((r) => r.cuisine === "cafe")!;

describe("taste model", () => {
  it("cold start is neutral apart from the time of day", () => {
    const t = buildTaste({ favourites: [], bookings: [], orders: [], recent: [], searches: [], moods: [] });
    expect(t.strength).toBe(0);
    const f = affinityFn(t, new Date(2026, 9, 12, 14));
    expect(Math.abs(f(italian[0]) - f(italian[1]))).toBeLessThan(1);
  });
  it("favourites and orders raise their cuisine; searches count too", () => {
    const t = buildTaste({ favourites: [italian[0].id], bookings: [], orders: [{ rid: italian[1].id }], recent: [], searches: ["بيتزا"], moods: [] });
    expect(t.cuisine.italian).toBeGreaterThan(5);
    const f = affinityFn(t, new Date(2026, 9, 12, 14));
    expect(f(italian[2])).toBeGreaterThan(f(cafe));
  });
  it("explains with 'because you liked X' only when the resemblance is real", () => {
    const t = buildTaste({ favourites: [italian[0].id], bookings: [], orders: [], recent: [], searches: [], moods: [] });
    const why = becauseFn(t, "en");
    expect(why(italian[3])).toBe(`Because you liked ${italian[0].en}`);
    expect(why(italian[0])).toBeNull(); // not itself
  });
  it("time of day: breakfast in the morning, late-night after 11pm", () => {
    expect(dayMoment(new Date(2026, 9, 12, 8))).toBe("breakfast");
    expect(dayMoment(new Date(2026, 9, 12, 13))).toBe("lunch");
    expect(dayMoment(new Date(2026, 9, 12, 16))).toBe("afternoon");
    expect(dayMoment(new Date(2026, 9, 12, 20))).toBe("dinner");
    expect(dayMoment(new Date(2026, 9, 12, 23, 30))).toBe("late");
    expect(dayMoment(new Date(2026, 9, 13, 1))).toBe("late");
  });
});

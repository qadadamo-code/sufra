import { describe, expect, it } from "vitest";
import { major, UNITS_PER_MINOR } from "@/lib/money";
import { allocate, evenShares, itemsShare, myShare, tipFor } from "./split";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("bill splitting", () => {
  it("even shares always add back to the total, in whole piastres", () => {
    for (const total of [major("100.00"), major("114.91"), major("1250.07"), major("0.05")])
      for (let n = 1; n <= 9; n++) {
        const s = evenShares(total, n);
        expect(s).toHaveLength(n);
        expect(sum(s)).toBe(total);
        expect(s.every((x) => x % UNITS_PER_MINOR === 0)).toBe(true);
        expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(UNITS_PER_MINOR);
      }
    expect(evenShares(major(100), 3)).toEqual([major("33.34"), major("33.33"), major("33.33")]);
  });

  it("proportional allocation is exact for any weights", () => {
    const total = major("987.65");
    const parts = allocate(total, [1, 2, 3.5, 0, 7]);
    expect(sum(parts)).toBe(total);
    expect(parts[3]).toBe(0);
    expect(allocate(total, [0, 0])).toEqual(evenShares(total, 2));
  });

  it("by-item shares of everyone at the table sum to the bill", () => {
    const lines = [
      { id: "a", qty: 2, gross: major(690) },
      { id: "b", qty: 1, gross: major(145) },
      { id: "c", qty: 3, gross: major(135) },
    ];
    const total = major("1229.79");
    const me = itemsShare(lines, { a: 1, c: 1 }, total);
    const you = itemsShare(lines, { a: 1, b: 1, c: 2 }, total);
    expect(me + you).toBe(total);
    expect(itemsShare(lines, {}, total)).toBe(0);
    expect(itemsShare(lines, { a: 2, b: 1, c: 3 }, total)).toBe(total);
    expect(itemsShare(lines, { a: 9 }, total)).toBe(itemsShare(lines, { a: 2 }, total)); // clamped to the line qty
  });

  it("my share never exceeds what is still due", () => {
    const base = { total: major(300), paid: major(250) };
    expect(myShare({ ...base, mode: "full" })).toBe(major(50));
    expect(myShare({ ...base, mode: "even", people: 2, shares: 1 })).toBe(major(50));
    expect(myShare({ ...base, mode: "custom", custom: major(80) })).toBe(major(50));
    expect(myShare({ total: major(300), paid: 0, mode: "even", people: 4, shares: 3 })).toBe(major(225));
    expect(myShare({ total: major(300), paid: 0, mode: "custom", custom: major("12.3456") })).toBe(major("12.35"));
  });

  it("tips round to piastres", () => {
    expect(tipFor(major("114.91"), 1000)).toBe(major("11.49"));
    expect(tipFor(major(100), 0)).toBe(0);
  });
});

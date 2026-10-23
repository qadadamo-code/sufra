import { describe, expect, it } from "vitest";
import { major } from "@/lib/money";
import { priceItems } from "@/data/pricing";
import { buildSeed } from "@/data/seed";
import type { OrderItem } from "@/data/types";
import { changeDue, courseStates, discountPct, heldItems, lineDiscountUnits, quickTenders, remaining, sameLine, seatGroups, sendableItems, splitByAmounts, splitEvenly, sumUnits, toPiastre } from "./math";

const { data } = buildSeed(new Date("2026-10-23T20:00:00+03:00"));
const tax = data.settings[0].tax;
let n = 0;
const line = (price: number, qty = 1, extra: Partial<OrderItem> = {}): OrderItem => ({
  id: `l${++n}`, restaurantId: "r", createdAt: "", updatedAt: "", orderId: "o", itemId: `i${n}`, name: { ar: "x", en: "x" }, qty, unitPrice: major(price), modifiers: [],
  notes: "", seat: null, course: 1, status: "new", stationId: null, originTableId: null, discount: 0, firedAt: null, readyAt: null, servedAt: null, voidReason: null,
  voidedBy: null, createdBy: null, ...extra,
});

describe("totals", () => {
  it("dine-in: 12% service then 14% VAT on top, to the piastre", () => {
    const { totals } = priceItems([line(345, 2), line(65, 3)], { mode: "dine_in", tax });
    // 885 + 106.20 service + 138.77 VAT (14% of 991.20)
    expect(totals.subtotal).toBe(major(885));
    expect(totals.service).toBe(major("106.2"));
    expect(totals.vat).toBe(major("138.77"));
    expect(totals.total).toBe(major("1129.97"));
  });
  it("takeaway has no service charge", () => {
    const { totals } = priceItems([line(100)], { mode: "takeaway", tax });
    expect(totals.service).toBe(0);
    expect(totals.total).toBe(major(114));
  });
  it("bill discount is taken before service and VAT", () => {
    const { totals } = priceItems([line(200), line(100)], { mode: "dine_in", tax, discount: { kind: "percent", rate: 1000 } });
    expect(totals.discountTotal).toBe(major(30));
    expect(totals.service).toBe(major("32.4"));
    expect(totals.total).toBe(major("344.73")); // VAT is rounded per line (ETA), not on the bill
  });
  it("item discount is clamped to the line", () => {
    expect(lineDiscountUnits(line(50, 2), { kind: "percent", rate: 2000 })).toBe(major(20));
    expect(lineDiscountUnits(line(50, 1), { kind: "amount", value: major(80) })).toBe(major(50));
  });
  it("discount % for the approval rule", () => {
    expect(discountPct({ kind: "percent", rate: 1500 }, major(100))).toBe(15);
    expect(discountPct({ kind: "amount", value: major(25) }, major(200))).toBe(12.5);
    expect(discountPct(null, major(1))).toBe(0);
  });
});

describe("splits add up to the total", () => {
  it("evenly, to the piastre, for any n", () => {
    for (const total of [major("1129.97"), major("100"), major("0.05"), major("344.74")])
      for (let k = 1; k <= 9; k++) {
        const s = splitEvenly(total, k);
        expect(s).toHaveLength(k);
        expect(sumUnits(s)).toBe(total);
        expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1000);
        for (const x of s) expect(x % 1000).toBe(0);
      }
  });
  it("by amount: the last share takes the rest; too much throws", () => {
    expect(splitByAmounts(major(300), [major(100), major(50)])).toEqual([major(100), major(50), major(150)]);
    expect(splitByAmounts(major(300), [major(300)])).toEqual([major(300)]);
    expect(() => splitByAmounts(major(300), [major(200), major(101)])).toThrow();
  });
  it("by item: sub-checks add up to the original (no bill discount)", () => {
    const items = [line(345, 2, { seat: 1 }), line(65, 3, { seat: 2 }), line(120, 1, { seat: 2 }), line(30, 4, { seat: null })];
    const whole = priceItems(items, { mode: "dine_in", tax }).totals.total;
    const groups = [...seatGroups(items).values()];
    expect(groups).toHaveLength(3);
    const parts = groups.map((g) => priceItems(g, { mode: "dine_in", tax }).totals.total);
    expect(sumUnits(parts)).toBe(whole);
  });
  it("remaining ignores voided tenders", () => {
    expect(remaining(major(100), [{ amount: major(40) }, { amount: major(30), status: "void" }])).toBe(major(60));
    expect(remaining(major(100), [{ amount: major(120) }])).toBe(0);
  });
});

describe("cash", () => {
  it("quick tenders start at the exact amount and go up in notes", () => {
    const q = quickTenders(major("344.74"));
    expect(q[0]).toBe(major("344.74"));
    expect(q).toContain(major(345));
    expect(q).toContain(major(350));
    expect(q).toContain(major(400));
    expect([...q].sort((a, b) => a - b)).toEqual(q);
  });
  it("change and piastre rounding", () => {
    expect(changeDue(major("344.74"), major(400))).toBe(major("55.26"));
    expect(changeDue(major(10), major(5))).toBe(0);
    expect(toPiastre(1499)).toBe(1000);
    expect(toPiastre(1500)).toBe(2000);
    expect(toPiastre(-1500)).toBe(-2000);
  });
});

describe("courses: hold & fire", () => {
  it("course 1 sends, later courses wait until fired", () => {
    const a = line(10, 1, { course: 1 });
    const b = line(10, 1, { course: 2 });
    const c = line(10, 1, { course: 3, status: "sent" });
    const d = line(10, 1, { course: 3 });
    const items = [a, b, c, d];
    expect(sendableItems(items).map((i) => i.id)).toEqual([a.id, d.id]);
    expect(heldItems(items).map((i) => i.id)).toEqual([b.id]);
    expect(courseStates(items).map((c) => [c.course, c.fired, c.waiting])).toEqual([[1, false, 1], [2, false, 1], [3, true, 1]]);
  });
  it("identical unsent lines merge; sent or different ones do not", () => {
    const a = line(10, 1);
    expect(sameLine(a, { ...a })).toBe(true);
    expect(sameLine(a, { ...a, notes: "no onion" })).toBe(false);
    expect(sameLine(a, { ...a, status: "sent" })).toBe(false);
  });
});

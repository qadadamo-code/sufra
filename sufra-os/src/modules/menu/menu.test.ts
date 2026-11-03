import { describe, expect, it } from "vitest";
import { major } from "@/lib/money";
import { bulkPrice, channelOf, inWindow, priceFor, sellable } from "./rules";
import { classify } from "./engineering";

describe("menu rules", () => {
  const item = { price: major(345), channelPrices: { aggregator: major(395) }, branchPrices: { b2: major(360) } };
  it("prices per channel, then branch, then base", () => {
    expect(priceFor(item, "aggregator", "b2")).toBe(major(395));
    expect(priceFor(item, "dine_in", "b2")).toBe(major(360));
    expect(priceFor(item, "dine_in", "b1")).toBe(major(345));
    expect(channelOf("delivery", "aggregator")).toBe("aggregator");
    expect(channelOf("dine_in", "qr")).toBe("qr");
    expect(channelOf("takeaway", "pos")).toBe("takeaway");
  });
  it("availability windows (incl. past midnight) and the 86 flag", () => {
    const fri9 = new Date("2026-10-23T09:30:00"); // Friday
    expect(inWindow({ days: [5, 6], from: "09:00", to: "13:00" }, fri9)).toBe(true);
    expect(inWindow({ days: [6], from: "09:00", to: "13:00" }, fri9)).toBe(false);
    expect(inWindow({ days: [], from: "22:00", to: "02:00" }, new Date("2026-10-23T01:00:00"))).toBe(true);
    expect(inWindow({ days: [], from: "22:00", to: "02:00" }, new Date("2026-10-23T12:00:00"))).toBe(false);
    const base = { available: true, active: true, schedule: [{ days: [], from: "07:00", to: "12:00" }], hiddenOn: ["aggregator" as const] };
    expect(sellable(base, "dine_in", new Date("2026-10-23T08:00:00"))).toEqual({ ok: true });
    expect(sellable(base, "dine_in", new Date("2026-10-23T20:00:00"))).toEqual({ ok: false, why: "hours" });
    expect(sellable(base, "aggregator", new Date("2026-10-23T08:00:00"))).toEqual({ ok: false, why: "channel" });
    expect(sellable({ ...base, available: false }, "qr", new Date("2026-10-23T08:00:00"))).toEqual({ ok: false, why: "86" });
  });
  it("bulk price change rounds to the step", () => {
    expect(bulkPrice(major(345), { kind: "percent", value: 10 }, major(5))).toBe(major(380));
    expect(bulkPrice(major(70), { kind: "amount", value: major(7) }, major(5))).toBe(major(75));
    expect(bulkPrice(major(20), { kind: "amount", value: -major(50) }, major(5))).toBe(0);
  });
});

describe("menu engineering", () => {
  it("classifies stars, plowhorses, puzzles and dogs", () => {
    const { rows, avgContribution } = classify([
      { id: "kofta", qty: 100, contribution: major(230) },
      { id: "tea", qty: 120, contribution: major(40) },
      { id: "chops", qty: 10, contribution: major(400) },
      { id: "pigeon", qty: 5, contribution: major(50) },
    ]);
    expect(avgContribution).toBe(Math.round((100 * major(230) + 120 * major(40) + 10 * major(400) + 5 * major(50)) / 235));
    expect(Object.fromEntries(rows.map((r) => [r.id, r.cls]))).toEqual({ kofta: "star", tea: "plowhorse", chops: "puzzle", pigeon: "dog" });
  });
});

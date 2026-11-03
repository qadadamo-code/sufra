import { describe, expect, it } from "vitest";
import { buildSeed } from "@/data/seed";
import { major } from "@/lib/money";
import { businessDay } from "@/modules/accounting/core";
import { menuEngineering } from "./menuEngineering";
import { lineValue, salesReport } from "./sales";

describe("menu engineering", () => {
  const items = [
    { id: "kofta", name: "Kofta", qty: 120, revenue: major(120 * 250), unitCost: major(80) }, // popular, margin 170
    { id: "fatta", name: "Fatta", qty: 100, revenue: major(100 * 180), unitCost: major(90) }, // popular, margin 90
    { id: "seabass", name: "Sea bass", qty: 20, revenue: major(20 * 420), unitCost: major(160) }, // rare, margin 260
    { id: "salad", name: "Salad", qty: 10, revenue: major(10 * 60), unitCost: major(25) }, // rare, margin 35
  ];
  it("classifies stars, plowhorses, puzzles and dogs", () => {
    const r = menuEngineering(items, 3200);
    const k = Object.fromEntries(r.rows.map((x) => [x.id, x.klass]));
    expect(k).toEqual({ kofta: "star", fatta: "plowhorse", seabass: "puzzle", salad: "dog" });
    expect(r.popThreshold).toBeCloseTo(0.175);
    expect(r.avgMargin).toBe(Math.round(r.totalContribution / r.totalQty));
  });
  it("falls back to the default food-cost % when there is no cost", () => {
    const r = menuEngineering([{ id: "x", name: "X", qty: 4, revenue: major(400), unitCost: null }], 3000);
    expect(r.rows[0].cost).toBe(major(30));
    expect(r.rows[0].costSource).toBe("default");
    expect(r.defaultCosted).toBe(1);
  });
});

describe("sales report on the seed", () => {
  const now = new Date("2026-10-23T20:00:00+03:00");
  const { data } = buildSeed(now);
  const day = businessDay(now);
  const r = salesReport({ checks: data.checks, orders: data.orders, items: data.orderItems, payments: data.payments, menuItems: data.menuItems, categories: data.menuCategories, tables: data.tables }, day, day);
  it("adds up across breakdowns", () => {
    const paid = data.checks.filter((c) => c.status === "paid" && businessDay(new Date(c.closedAt!)) === day);
    expect(r.kpis.checks).toBe(paid.length);
    expect(r.kpis.net).toBe(paid.reduce((a, c) => a + c.subtotal - c.discountTotal, 0));
    const sum = (b: { net: number }[]) => b.reduce((a, x) => a + x.net, 0);
    for (const b of [r.byHour, r.byChannel, r.byMode, r.byDay]) expect(sum(b)).toBe(r.kpis.net);
    expect(sum(r.byItem)).toBe(sum(r.byCategory));
    expect(r.kpis.checks).toBeGreaterThan(0);
    expect(r.kpis.avgCheck).toBe(Math.round(r.kpis.net / r.kpis.checks));
  });
  it("line value = (price + modifiers) × qty − line discount", () => {
    expect(lineValue({ unitPrice: major(100), qty: 2, modifiers: [{ price: major(10) } as never], discount: major(5) })).toBe(major(215));
  });
});

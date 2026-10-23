import { describe, expect, it } from "vitest";
import { buildSeed, DEMO_STAFF } from "./seed";
import { priceItems } from "./pricing";
import { COLLECTIONS } from "./types";
import { ROLES } from "@/auth/roles";

describe("demo seed", () => {
  const { data, pins } = buildSeed(new Date("2026-10-23T20:00:00+03:00"));

  it("is deterministic", () => {
    const again = buildSeed(new Date("2026-10-23T20:00:00+03:00"));
    expect(JSON.stringify(again.data)).toBe(JSON.stringify(data));
  });

  it("has unique ids and valid references", () => {
    const ids = new Set<string>();
    for (const c of COLLECTIONS) for (const r of data[c] as { id: string }[]) {
      if (c !== "settings") expect(ids.has(r.id), `${c}/${r.id}`).toBe(false);
      ids.add(r.id);
    }
    const has = (c: (typeof COLLECTIONS)[number], id: string | null) => id === null || (data[c] as { id: string }[]).some((r) => r.id === id);
    for (const t of data.tables) expect(has("zones", t.zoneId)).toBe(true);
    for (const i of data.menuItems) {
      expect(has("menuCategories", i.categoryId)).toBe(true);
      for (const g of i.modifierGroupIds) expect(has("modifierGroups", g)).toBe(true);
    }
    for (const oi of data.orderItems) expect(has("orders", oi.orderId) && has("menuItems", oi.itemId)).toBe(true);
    for (const o of data.orders) expect(has("checks", o.checkId)).toBe(true);
    for (const p of data.payments) expect(has("checks", p.checkId)).toBe(true);
    for (const s of data.serviceCalls) expect(has("tables", s.tableId)).toBe(true);
  });

  it("covers the brief", () => {
    expect(data.zones).toHaveLength(2);
    expect(data.tables).toHaveLength(18);
    expect(data.menuItems.length).toBeGreaterThanOrEqual(45);
    expect(data.menuCategories.map((c) => c.name.ar)).toEqual(["مشويات", "طواجن", "محاشي", "سلطات", "مقبلات", "حلويات", "مشروبات سخنة", "مشروبات ساقعة"]);
    for (const r of ROLES) expect(DEMO_STAFF.some((s) => s.role === r), r).toBe(true);
    expect(Object.keys(pins)).toHaveLength(DEMO_STAFF.length);
    expect(data.orders.some((o) => o.status !== "closed")).toBe(true);
    expect(data.serviceCalls.length).toBeGreaterThan(0);
    expect(data.reservations.length).toBeGreaterThan(0);
    expect(data.customers.length).toBeGreaterThan(0);
  });

  it("check totals match @finance/tax", () => {
    for (const c of data.checks) {
      const orders = data.orders.filter((o) => o.checkId === c.id);
      const items = data.orderItems.filter((i) => orders.some((o) => o.id === i.orderId));
      const { totals } = priceItems(items, { mode: orders[0].mode, tax: data.settings[0].tax, discount: c.discount, deliveryFee: orders[0].deliveryFee });
      expect(c.total, c.id).toBe(totals.total);
    }
  });

  it("merged tables keep their origin on each line", () => {
    const merged = data.orders.find((o) => o.tableIds.length === 2)!;
    const origins = new Set(data.orderItems.filter((i) => i.orderId === merged.id).map((i) => i.originTableId));
    expect([...origins].sort()).toEqual([...merged.tableIds].sort());
  });
});

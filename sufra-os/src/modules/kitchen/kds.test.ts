import { describe, expect, it } from "vitest";
import type { Order, OrderItem } from "@/data/types";
import { ageLevel, allDay, avgTicketMinutes, buildTickets, deriveOrderStatus, fmtTimer, isAllergy, itemPatch, kdsSettings, lastBumped, patchesFor, prepStats, transition } from "./kds";

const T0 = Date.parse("2026-10-23T19:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

const order = (id: string, p: Partial<Order> = {}): Order => ({
  id, restaurantId: "r", createdAt: at(0), updatedAt: at(0), branchId: "b", number: Number(id.replace(/\D/g, "")) || 1, mode: "dine_in", source: "pos", status: "sent",
  tableIds: ["t1"], checkId: null, customerId: null, guests: 2, openedBy: null, waiterId: null, note: "", delivery: null, deliveryStatus: null, driverId: null, deliveryFee: 0,
  openedAt: at(0), closedAt: null, ...p,
});
let n = 0;
const item = (orderId: string, p: Partial<OrderItem> = {}): OrderItem => ({
  id: `i${++n}`, restaurantId: "r", createdAt: at(0), updatedAt: at(0), orderId, itemId: "kofta", name: { ar: "كفتة", en: "Kofta" }, qty: 1, unitPrice: 0, modifiers: [], notes: "",
  seat: null, course: 1, status: "sent", stationId: "grill", originTableId: null, discount: 0, firedAt: at(0), readyAt: null, servedAt: null, voidReason: null, voidedBy: null, createdBy: null, ...p,
});

describe("aging", () => {
  it("green → amber → red at the thresholds", () => {
    expect(ageLevel(0)).toBe("ok");
    expect(ageLevel(9.9)).toBe("ok");
    expect(ageLevel(10)).toBe("amber");
    expect(ageLevel(17.9)).toBe("amber");
    expect(ageLevel(18)).toBe("red");
    const k = kdsSettings({ kitchen: { amberMin: 5, redMin: 8, sound: false } });
    expect(ageLevel(6, k)).toBe("amber");
    expect(ageLevel(8, k)).toBe("red");
    expect(k.sound).toBe(false);
  });
  it("sanitises settings (red after amber)", () => {
    expect(kdsSettings({ kitchen: { amberMin: 12, redMin: 5, sound: true } })).toEqual({ amberMin: 12, redMin: 13, sound: true });
    expect(kdsSettings(null).amberMin).toBe(10);
  });
  it("formats the timer", () => {
    expect(fmtTimer(0)).toBe("0:00");
    expect(fmtTimer(247_000)).toBe("4:07");
    expect(fmtTimer(3_750_000)).toBe("1:02:30");
  });
});

describe("bump / recall state machine", () => {
  it("allows only the defined transitions", () => {
    expect(transition("sent", "start")).toBe("preparing");
    expect(transition("preparing", "start")).toBeNull();
    expect(transition("sent", "bump")).toBe("ready");
    expect(transition("preparing", "bump")).toBe("ready");
    expect(transition("ready", "bump")).toBeNull();
    expect(transition("ready", "serve")).toBe("served");
    expect(transition("preparing", "serve")).toBeNull();
    expect(transition("ready", "recall")).toBe("preparing");
    expect(transition("served", "recall")).toBe("ready");
    expect(transition("new", "bump")).toBeNull();
    expect(transition("void", "recall")).toBeNull();
  });
  it("stamps and clears timestamps", () => {
    expect(itemPatch({ status: "preparing", firedAt: at(0) }, "bump", at(7))).toEqual({ status: "ready", readyAt: at(7) });
    expect(itemPatch({ status: "ready", firedAt: at(0) }, "recall", at(8))).toEqual({ status: "preparing", readyAt: null });
    expect(itemPatch({ status: "served", firedAt: at(0) }, "recall", at(8))).toEqual({ status: "ready", servedAt: null });
    expect(itemPatch({ status: "ready", firedAt: at(0) }, "serve", at(9))).toEqual({ status: "served", servedAt: at(9) });
    expect(itemPatch({ status: "sent", firedAt: null }, "start", at(1))).toEqual({ status: "preparing", firedAt: at(1) });
  });
  it("bump ticket = every cooking item, ready ones untouched", () => {
    const o = "o1";
    const xs = [item(o, { status: "sent" }), item(o, { status: "preparing" }), item(o, { status: "ready", readyAt: at(2) })];
    expect(patchesFor(xs, "bump", at(5)).map((p) => p.id)).toEqual([xs[0].id, xs[1].id]);
  });
  it("finds the last bumped ticket for recall", () => {
    const xs = [
      item("o1", { status: "ready", readyAt: at(3) }),
      item("o2", { status: "ready", readyAt: at(6) }),
      item("o2", { status: "ready", readyAt: new Date(T0 + 6 * 60_000 - 1000).toISOString() }),
      item("o2", { status: "ready", readyAt: at(1) }), // bumped earlier, separately
      item("o3", { status: "preparing" }),
      item("o4", { status: "ready", readyAt: at(9), stationId: "bar" }),
    ];
    expect(lastBumped(xs).map((i) => i.id)).toEqual([xs[5].id]);
    expect(lastBumped(xs, "grill").map((i) => i.id)).toEqual([xs[1].id, xs[2].id]);
    expect(lastBumped([item("o1")])).toEqual([]);
  });
  it("derives the order status from its items", () => {
    expect(deriveOrderStatus([{ status: "new" }], "open")).toBe("open");
    expect(deriveOrderStatus([{ status: "sent" }, { status: "ready" }], "open")).toBe("sent");
    expect(deriveOrderStatus([{ status: "ready" }, { status: "served" }, { status: "new" }], "sent")).toBe("ready");
    expect(deriveOrderStatus([{ status: "served" }, { status: "void" }], "ready")).toBe("served");
    expect(deriveOrderStatus([{ status: "sent" }], "closed")).toBe("closed");
  });
});

describe("tickets", () => {
  const orders = [order("o1", { openedAt: at(-20) }), order("o2", { priority: "rush", openedAt: at(-5) }), order("o3", { source: "qr" }), order("o4", { status: "closed" }), order("o5", { mode: "takeaway", tableIds: [] })];
  const items = [
    item("o1", { firedAt: at(-20), stationId: "grill" }),
    item("o1", { firedAt: at(-20), stationId: "bar", itemId: "tea", name: { ar: "شاي", en: "Tea" } }),
    item("o1", { status: "new", course: 2, stationId: "grill" }),
    item("o1", { status: "void", firedAt: at(-20), updatedAt: at(-1), stationId: "grill" }),
    item("o2", { firedAt: at(-5), status: "preparing" }),
    item("o3", { status: "new" }), // QR waiting for confirmation → not on the KDS
    item("o4", { status: "sent" }), // closed order
    item("o5", { status: "ready", readyAt: at(-1), firedAt: at(-8) }),
  ];
  it("one ticket per active order, rush first, bumped tickets hidden", () => {
    const ts = buildTickets(orders, items, { now: T0 });
    expect(ts.map((t) => t.order.id)).toEqual(["o2", "o1"]);
    const t1 = ts[1];
    expect(t1.groups.map((g) => g.stationId)).toEqual(["grill", "bar"]);
    expect(t1.held).toHaveLength(1);
    expect(t1.voided).toHaveLength(1);
    expect(t1.state).toBe("new");
    expect(t1.pending).toBe(2);
    expect(ts[0].state).toBe("preparing");
  });
  it("station filter and ready tickets for expo", () => {
    expect(buildTickets(orders, items, { stationId: "bar", now: T0 }).map((t) => t.key)).toEqual(["o1:bar"]);
    const expo = buildTickets(orders, items, { includeReady: true, now: T0 });
    const ta = expo.find((t) => t.order.id === "o5")!;
    expect(ta.state).toBe("ready");
    expect(ta.kind).toBe("takeaway");
  });
  it("station sort order", () => {
    const ts = buildTickets(orders, items, { stationOrder: ["bar", "grill"], now: T0 });
    expect(ts.find((t) => t.order.id === "o1")!.groups.map((g) => g.stationId)).toEqual(["bar", "grill"]);
  });
});

describe("all-day aggregation", () => {
  it("sums outstanding quantities per item with variants", () => {
    const mod = (ar: string) => ({ groupId: "g", modifierId: ar, name: { ar, en: ar }, price: 0 });
    const xs = [
      item("o1", { qty: 2, modifiers: [mod("نص كيلو")] }),
      item("o2", { qty: 1, status: "preparing", modifiers: [mod("نص كيلو")] }),
      item("o2", { qty: 4, modifiers: [mod("ربع")] }),
      item("o3", { qty: 5, status: "ready" }),
      item("o3", { qty: 4, status: "new" }),
      item("o3", { qty: 1, itemId: "tea", stationId: "bar", name: { ar: "شاي", en: "Tea" } }),
    ];
    const rows = allDay(xs);
    expect(rows.map((r) => [r.itemId, r.total, r.waiting, r.preparing, r.tickets])).toEqual([
      ["kofta", 7, 6, 1, 2],
      ["tea", 1, 1, 0, 1],
    ]);
    expect(rows[0].variants).toEqual([{ label: ["ربع"], qty: 4 }, { label: ["نص كيلو"], qty: 3 }]);
    expect(allDay(xs, { stationId: "bar" }).map((r) => r.itemId)).toEqual(["tea"]);
  });
});

describe("prep stats", () => {
  it("averages fired → ready per item and per ticket", () => {
    const xs = [
      item("o1", { firedAt: at(0), readyAt: at(10), status: "ready" }),
      item("o2", { firedAt: at(0), readyAt: at(14), status: "served" }),
      item("o3", { firedAt: at(0), readyAt: null, status: "preparing" }),
      item("o4", { itemId: "tea", firedAt: at(0), readyAt: at(3), status: "ready" }),
    ];
    const s = prepStats(xs);
    expect(s.get("kofta")).toEqual({ itemId: "kofta", n: 2, avgMin: 12 });
    expect(s.get("tea")?.avgMin).toBe(3);
    expect(avgTicketMinutes(xs)).toBe(9); // o1 10, o2 14, o4 3 (o3 still open)
  });
});

describe("allergy notes", () => {
  it("flags allergy notes in Arabic and English", () => {
    expect(isAllergy("حساسية من السمسم")).toBe(true);
    expect(isAllergy("peanut allergy")).toBe(true);
    expect(isAllergy("من غير بصل")).toBe(false);
    expect(isAllergy("ready in 5 minutes")).toBe(false);
  });
});

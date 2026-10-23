import { describe, expect, it } from "vitest";
import { snapBox, touching, bbox } from "./geometry";
import { autoSeatCount, chairsFor } from "./seats";
import { capacityOf, computeGroups, physicalEdges, resizeFrom, changeShape, sizeForSeats } from "./layout";
import { addItem, checkTotal, mergeChecks, openCheck, reconcile, splitCheck, transferTable, checkForTable } from "./checks";
import { conflictsOf, suggestTables, waitEstimate, defaultDuration } from "./reservations";
import type { Check, Layout, MenuItem, Reservation, Table } from "./types";

let n = 0;
const id = () => `id${++n}`;
const T = (p: Partial<Table> & { id: string }): Table => ({
  label: p.id,
  zoneId: "z",
  shape: "square",
  x: 0,
  y: 0,
  w: 70,
  h: 70,
  rotation: 0,
  seatsOverride: null,
  ...p,
});
const L = (tables: Table[]): Layout => ({ zones: [{ id: "z", name: { ar: "", en: "" }, width: 1000, height: 800 }], tables, decor: [] });
const kofta: MenuItem = { id: "k", name: { ar: "كفتة", en: "Kofta" }, price: 12_550 };

describe("seats follow table size", () => {
  it("counts chairs from edge length", () => {
    expect(autoSeatCount({ shape: "square", w: 70, h: 70 })).toBe(4);
    expect(autoSeatCount({ shape: "rect", w: 140, h: 70 })).toBe(6);
    expect(autoSeatCount({ shape: "rect", w: 180, h: 80 })).toBe(8);
    expect(autoSeatCount({ shape: "round", w: 80, h: 80 })).toBe(4);
    expect(autoSeatCount({ shape: "round", w: 120, h: 120 })).toBe(6);
    expect(autoSeatCount({ shape: "bar", w: 220, h: 50 })).toBe(4);
    expect(autoSeatCount({ shape: "booth", w: 160, h: 80 })).toBe(4);
  });

  it("grows and shrinks seats as the table is resized from a handle", () => {
    const t = T({ id: "a", shape: "rect", w: 140, h: 70 });
    const wider = resizeFrom(t, { hx: 1, hy: 0 }, 60, 0);
    expect(wider.w).toBe(200);
    expect(wider.x).toBe(30); // left edge stayed put
    expect(autoSeatCount(wider)).toBe(8);
    const narrower = resizeFrom(t, { hx: -1, hy: 0 }, 80, 0);
    expect(narrower.w).toBe(60);
    expect(autoSeatCount(narrower)).toBe(4);
  });

  it("keeps squares square", () => {
    const t = resizeFrom(T({ id: "a" }), { hx: 1, hy: 0 }, 50, 0);
    expect([t.w, t.h]).toEqual([120, 120]);
    expect(changeShape(T({ id: "a", shape: "rect", w: 140, h: 70 }), "square").w).toBe(110);
  });

  it("sizes a table for a target seat count", () => {
    const d = sizeForSeats("rect", 8);
    expect(autoSeatCount({ shape: "rect", ...d })).toBeGreaterThanOrEqual(8);
  });

  it("places chairs evenly when seats are set by hand", () => {
    expect(chairsFor(T({ id: "a", shape: "rect", w: 140, h: 70, seatsOverride: 5 }), []).length).toBe(5);
  });
});

describe("pushing tables together", () => {
  const a = T({ id: "a", x: 100, y: 100 });
  const b = T({ id: "b", x: 170, y: 100 }); // right edge of a == left edge of b

  it("detects touching edges and removes chairs on the shared edge", () => {
    expect(touching(a, b)).toBe(true);
    expect(touching(a, { ...b, x: 200 })).toBe(false);
    expect(touching(a, { ...b, y: 160 })).toBe(false); // only 10cm shared
    const layout = L([a, b]);
    expect(capacityOf(a, layout)).toBe(3);
    expect(capacityOf(a, layout) + capacityOf(b, layout)).toBe(6);
  });

  it("snaps a nearby table into contact", () => {
    const moving = bbox({ ...b, x: 178, y: 104 });
    const s = snapBox(moving, [bbox(a)], 12, 10);
    expect(s.dx).toBe(-8);
    expect(s.dy).toBe(-4);
  });

  it("prefers edge contact over lining up with something else", () => {
    // 6cm short of touching `a`, but only 2cm off lining up with `c`'s left edge.
    const c = bbox(T({ id: "c", x: 251, y: 400 }));
    const moving = bbox({ ...b, x: 176 });
    expect(snapBox(moving, [bbox(a), c], 12, 10).dx).toBe(-6);
  });

  it("groups touching tables and hand-made links", () => {
    const c = T({ id: "c", x: 600, y: 600 });
    const groups = computeGroups([a, b, c], [{ id: "l", tableIds: ["c", "a"] }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].tableIds.sort()).toEqual(["a", "b", "c"]);
    expect(computeGroups([a, b, c], [])[0].physical).toBe(true);
  });
});

describe("bills follow the tables", () => {
  function seated(): Check[] {
    let c = openCheck([], ["a"], 2, 1200, id);
    c = openCheck(c, ["b"], 3, 1210, id);
    c = addItem(c, c[0].id, kofta, "a", id);
    c = addItem(c, c[0].id, kofta, "a", id);
    c = addItem(c, c[1].id, kofta, "b", id);
    return c;
  }

  it("merges two bills into the one opened first, losing nothing", () => {
    const before = seated();
    const r = mergeChecks(before, ["a", "b"]);
    expect(r.checks).toHaveLength(1);
    expect(r.checks[0].id).toBe(before[0].id);
    expect(r.checks[0].tableIds).toEqual(["a", "b"]);
    expect(r.checks[0].guests).toBe(5);
    expect(checkTotal(r.checks[0])).toBe(3 * 12_550);
  });

  it("splits a merged bill back to the tables things were ordered from", () => {
    const merged = mergeChecks(seated(), ["a", "b"]).checks;
    const split = splitCheck(merged, merged[0].id, id);
    expect(split).toHaveLength(2);
    expect(checkTotal(checkForTable(split, "a")!)).toBe(2 * 12_550);
    expect(checkTotal(checkForTable(split, "b")!)).toBe(12_550);
  });

  it("merges automatically only when a new contact appears", () => {
    const a = T({ id: "a", x: 100, y: 100 });
    const bFar = T({ id: "b", x: 300, y: 100 });
    const bNear = { ...bFar, x: 170 };
    const prev = physicalEdges([a, bFar]);
    const next = physicalEdges([a, bNear]);
    const r = reconcile([a, bNear], [], seated(), prev, next);
    expect(r.merges).toHaveLength(1);
    expect(r.checks).toHaveLength(1);
    // Same contact again (e.g. after a deliberate split) does not re-merge.
    const split = splitCheck(r.checks, r.checks[0].id, id);
    expect(reconcile([a, bNear], [], split, next, next).checks).toHaveLength(2);
  });

  it("flags a bill whose tables were pulled apart", () => {
    const a = T({ id: "a", x: 100, y: 100 });
    const b = T({ id: "b", x: 170, y: 100 });
    const merged = mergeChecks(seated(), ["a", "b"]).checks;
    const apart = [a, { ...b, x: 400 }];
    const r = reconcile(apart, [], merged, physicalEdges([a, b]), physicalEdges(apart));
    expect(r.separated).toEqual([merged[0].id]);
    expect(reconcile(apart, [{ id: "l", tableIds: ["a", "b"] }], merged, new Set(), physicalEdges(apart)).separated).toEqual([]);
  });

  it("moves a bill to another table, joining a bill already there", () => {
    const c = seated();
    const moved = transferTable(c, c[0].id, "a", "z");
    expect(checkForTable(moved, "z")!.lines[0].originTableId).toBe("z");
    expect(checkForTable(moved, "a")).toBeNull();
    expect(transferTable(c, c[0].id, "a", "b")).toHaveLength(1);
  });
});

describe("reservations", () => {
  const res = (p: Partial<Reservation> & { id: string }): Reservation => ({
    name: "x",
    phone: "",
    party: 2,
    start: 20 * 60,
    duration: 90,
    tableIds: ["a"],
    status: "confirmed",
    note: "",
    tags: [],
    ...p,
  });

  it("finds clashes including the turnover buffer", () => {
    const r1 = res({ id: "r1" });
    expect(conflictsOf(r1, [r1, res({ id: "r2", start: 21 * 60 + 35 })])).toHaveLength(1);
    expect(conflictsOf(r1, [r1, res({ id: "r2", start: 21 * 60 + 40 })])).toHaveLength(0);
    expect(conflictsOf(r1, [r1, res({ id: "r2", start: 21 * 60, status: "cancelled" })])).toHaveLength(0);
  });

  it("suggests the snuggest free table, then tables that can be pushed together", () => {
    const layout = L([
      T({ id: "a", x: 100, y: 100 }),
      T({ id: "b", x: 200, y: 100 }), // 30cm gap from a
      T({ id: "c", shape: "rect", w: 180, h: 80, x: 500, y: 400 }),
    ]);
    const four = suggestTables(4, 20 * 60, 90, layout, [], [], 18 * 60);
    expect(four[0].tableIds).toEqual(["a"]);
    const six = suggestTables(6, 20 * 60, 90, layout, [], [], 18 * 60);
    expect(six[0].tableIds.sort()).toEqual(["a", "b"]);
    expect(six[0].reasons).toContain("push");
    const busy = [res({ id: "r", tableIds: ["a", "b"], party: 6 })];
    expect(suggestTables(6, 20 * 60, 90, layout, busy, [], 18 * 60)[0].tableIds).toEqual(["c"]);
  });

  it("estimates the wait for walk-ins from seated tables", () => {
    const layout = L([T({ id: "a" })]);
    const checks = openCheck([], ["a"], 2, 19 * 60, id);
    expect(waitEstimate(2, layout, [], [], 20 * 60)).toBe(0);
    expect(waitEstimate(2, layout, [], checks, 20 * 60)).toBe(25); // expected free 20:15, +10 to reset
    expect(defaultDuration(8)).toBe(120);
  });
});

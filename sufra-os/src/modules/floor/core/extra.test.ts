import { describe, expect, it } from "vitest";
import { bookingSlots, parseHours } from "./availability";
import { detectTables } from "./detect";
import { turnStats, occupancy } from "./analytics";
import { autoSeatCount, chairsFor } from "./seats";
import { pinchResize, resizeFrom, capacityOf, computeGroups, nextLabel } from "./layout";
import { bbox, containsPoint, floorSize, touching } from "./geometry";
import { conflictsOf, isLate, nextReservationFor } from "./reservations";
import type { Layout, Reservation, Table } from "./types";

const T = (p: Partial<Table> & { id: string }): Table => ({ label: p.id, zoneId: "z", shape: "square", x: 0, y: 0, w: 70, h: 70, rotation: 0, seatsOverride: null, ...p });
const L = (tables: Table[]): Layout => ({ zones: [{ id: "z", name: { ar: "", en: "" }, width: 1000, height: 800 }], tables, decor: [] });
const res = (p: Partial<Reservation> & { id: string }): Reservation => ({ name: "x", phone: "", party: 2, start: 20 * 60, duration: 90, tableIds: ["a"], status: "confirmed", note: "", tags: [], ...p });

describe("geometry", () => {
  it("rotated tables swap their footprint at 90° and never touch at 45°", () => {
    const t = T({ id: "a", shape: "rect", w: 140, h: 70, rotation: 90 });
    expect(floorSize(t)).toEqual({ w: 70, h: 140 });
    expect(touching(T({ id: "a", rotation: 45 }), T({ id: "b", x: 70 }))).toBe(false);
  });
  it("hit-tests round tables as ellipses", () => {
    const r = T({ id: "r", shape: "round", w: 100, h: 100 });
    expect(containsPoint(r, 45, 0)).toBe(true);
    expect(containsPoint(r, 40, 40)).toBe(false);
    expect(bbox(r)).toEqual({ x1: -50, y1: -50, x2: 50, y2: 50 });
  });
});

describe("chairs follow size (resize adds and removes chairs)", () => {
  it("adds a chair per 60 cm of edge as a rect table is stretched, and removes them as it shrinks", () => {
    let t = T({ id: "a", shape: "rect", w: 120, h: 70 });
    const counts: number[] = [];
    for (const dx of [0, 60, 120, 60, 0, -60]) counts.push(autoSeatCount(resizeFrom(t, { hx: 1, hy: 0 }, dx, 0)));
    expect(counts).toEqual([6, 8, 10, 8, 6, 4]);
    t = pinchResize(T({ id: "b", shape: "round", w: 80, h: 80 }), 1.5, 1.5);
    expect(t.w).toBe(120);
    expect(autoSeatCount(t)).toBe(6);
  });
  it("a hand-set seat count wins over the automatic one", () => {
    expect(chairsFor(T({ id: "a", seatsOverride: 2 }), []).length).toBe(2);
  });
  it("a wall next to a table blocks the chairs on that side", () => {
    const t = T({ id: "a", x: 100, y: 100 });
    const layout: Layout = { ...L([t]), decor: [{ id: "w", zoneId: "z", kind: "wall", x: 100, y: 50, w: 300, h: 20, rotation: 0 }] };
    expect(capacityOf(t, layout)).toBe(3);
  });
  it("names new tables with the first free label", () => {
    expect(nextLabel([T({ id: "a", label: "T1" }), T({ id: "b", label: "T3" })])).toBe("T2");
  });
  it("three tables in a row form one group", () => {
    const g = computeGroups([T({ id: "a", x: 0 }), T({ id: "b", x: 70 }), T({ id: "c", x: 140 })], []);
    expect(g).toHaveLength(1);
    expect(g[0].tableIds).toHaveLength(3);
  });
});

describe("reservation edges", () => {
  it("back-to-back bookings on different tables never clash; seated ones still do", () => {
    const a = res({ id: "a" });
    expect(conflictsOf(a, [a, res({ id: "b", tableIds: ["b"] })])).toHaveLength(0);
    expect(conflictsOf(a, [a, res({ id: "c", status: "seated", start: 20 * 60 + 30 })])).toHaveLength(1);
  });
  it("flags late guests after the grace period and finds the next booking for a table", () => {
    const r = res({ id: "a" });
    expect(isLate(r, 20 * 60 + 10)).toBe(false);
    expect(isLate(r, 20 * 60 + 20)).toBe(true);
    expect(nextReservationFor("a", [r], 19 * 60)?.id).toBe("a");
    expect(nextReservationFor("a", [r], 15 * 60)).toBeNull();
  });
});

describe("booking availability", () => {
  const layout = L([T({ id: "a", x: 100, y: 100 }), T({ id: "b", x: 400, y: 100 })]);
  const day = 0;
  const hours = parseHours({ open: "18:00", close: "23:00" });

  it("reads opening hours that run past midnight", () => {
    expect(parseHours({ open: "12:00", close: "01:00" })).toEqual({ open: 720, close: 1500 });
  });

  it("offers every 15 minutes until an hour before closing", () => {
    const s = bookingSlots({ dayStart: day, party: 2, hours, now: 0, leadMinutes: 0 }, layout, [], []);
    expect(s[0].start).toBe(18 * 60);
    expect(s[s.length - 1].start).toBe(22 * 60);
    expect(s.every((x) => x.ok)).toBe(true);
  });

  it("closes slots already in the past (with the notice period)", () => {
    const s = bookingSlots({ dayStart: day, party: 2, hours, now: 19 * 60, leadMinutes: 30 }, layout, [], []);
    expect(s.filter((x) => x.reason === "past").map((x) => x.start)).toEqual([18 * 60, 18 * 60 + 15, 18 * 60 + 30, 18 * 60 + 45, 19 * 60, 19 * 60 + 15]);
  });

  it("is full when every table is booked around that time", () => {
    const booked = [res({ id: "1", tableIds: ["a"], start: 20 * 60 }), res({ id: "2", tableIds: ["b"], start: 20 * 60 })];
    const s = bookingSlots({ dayStart: day, party: 2, hours, now: 0, leadMinutes: 0 }, layout, booked, []);
    const at = (m: number) => s.find((x) => x.start === m)!;
    expect(at(20 * 60).reason).toBe("full");
    expect(at(18 * 60).ok).toBe(true); // 18:00 + 75 + 10 buffer < 20:00 → free
    expect(at(21 * 60 + 45).ok).toBe(true); // 20:00 + 90 + 10 → 21:40
  });

  it("applies pacing (max covers arriving per slot)", () => {
    const booked = [res({ id: "1", tableIds: [], party: 6, start: 19 * 60 })];
    const s = bookingSlots({ dayStart: day, party: 2, hours, now: 0, leadMinutes: 0, maxCoversPerSlot: 7 }, layout, booked, []);
    expect(s.find((x) => x.start === 19 * 60)!.reason).toBe("pacing");
    expect(s.find((x) => x.start === 19 * 60 + 15)!.ok).toBe(true);
  });

  it("sends parties bigger than the online limit to the phone", () => {
    expect(bookingSlots({ dayStart: day, party: 12, hours, now: 0, maxParty: 10 }, layout, [], [])[0].reason).toBe("too_big");
  });
});

describe("table detection from a drawing (beta)", () => {
  function canvas(W: number, H: number) {
    const data = new Uint8ClampedArray(W * H * 4).fill(255);
    const ink = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 20;
    };
    return {
      img: { width: W, height: H, data },
      rectOutline(x1: number, y1: number, x2: number, y2: number) {
        for (let x = x1; x <= x2; x++) ink(x, y1), ink(x, y2);
        for (let y = y1; y <= y2; y++) ink(x1, y), ink(x2, y);
      },
      circleOutline(cx: number, cy: number, r: number) {
        for (let a = 0; a < 720; a++) ink(Math.round(cx + r * Math.cos((a * Math.PI) / 360)), Math.round(cy + r * Math.sin((a * Math.PI) / 360)));
      },
      fillRect(x1: number, y1: number, x2: number, y2: number) {
        for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) ink(x, y);
      },
    };
  }

  it("finds outlined rectangles and circles at table size and ignores rooms and chairs", () => {
    const c = canvas(240, 200);
    c.rectOutline(2, 2, 237, 197); // the room: too big
    c.rectOutline(20, 20, 60, 40); // 41×21 px → 164×84 cm rect
    c.circleOutline(150, 60, 15); // ⌀31 px → 124 cm round
    c.rectOutline(100, 150, 106, 156); // a chair: too small
    c.fillRect(30, 120, 55, 145); // a solid square table 26 px → 104 cm
    const found = detectTables(c.img, { cmPerPx: 4 });
    const shapes = found.map((d) => d.shape).sort();
    expect(shapes).toEqual(["rect", "round", "square"]);
    const rect = found.find((d) => d.shape === "rect")!;
    expect(Math.abs(rect.x - 40)).toBeLessThanOrEqual(1);
    expect(Math.abs(rect.w * 4 - 164)).toBeLessThanOrEqual(16);
  });

  it("finds nothing on a blank page", () => {
    expect(detectTables(canvas(50, 50).img, { cmPerPx: 4 })).toEqual([]);
  });
});

describe("turn analytics", () => {
  it("averages closed visits and ignores blips and forgotten checks", () => {
    const s = turnStats([
      { openedAt: 0, closedAt: 60, guests: 2, tableCount: 1 },
      { openedAt: 0, closedAt: 90, guests: 4, tableCount: 1 },
      { openedAt: 0, closedAt: 2, guests: 2, tableCount: 1 },
      { openedAt: 0, closedAt: 900, guests: 2, tableCount: 1 },
      { openedAt: 0, closedAt: 40, guests: 1, tableCount: 0 },
    ]);
    expect(s.avgTurn).toBe(75);
    expect(s.count).toBe(2);
    expect(s.bySize.find((b) => b.bucket === "4")!.avg).toBe(90);
    expect(occupancy({ seats: 40, covers: 10, tables: 10, busyTables: 3 })).toEqual({ seatPct: 25, tablePct: 30 });
  });
});

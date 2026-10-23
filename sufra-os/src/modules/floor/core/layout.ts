import { clamp, roundTo, touching, type Placed } from "./geometry";
import { autoSeatCount, seatCount } from "./seats";
import type { Decor, Layout, ManualLink, Shape, Table } from "./types";

export const MIN_TABLE = 40;
export const MAX_TABLE = 600;
export const SIZE_STEP = 10;

const BLOCKING_DECOR: Decor["kind"][] = ["wall", "pillar", "counter", "plant"];

/** Everything a chair of table `t` could bump into. */
export function obstaclesFor(t: Table, layout: Layout): Placed[] {
  return [
    ...layout.tables.filter((o) => o.id !== t.id && o.zoneId === t.zoneId),
    ...layout.decor.filter((d) => d.zoneId === t.zoneId && BLOCKING_DECOR.includes(d.kind)).map((d) => ({ ...d, shape: d.kind })),
  ];
}

export function capacityOf(t: Table, layout: Layout) {
  return seatCount(t, obstaclesFor(t, layout));
}

export type Handle = { hx: -1 | 0 | 1; hy: -1 | 0 | 1 };

/**
 * Resizes from a handle while keeping the opposite edge where it was.
 * dx/dy are the pointer movement on the floor; they are turned into the
 * table's own frame so handles behave the same on rotated tables.
 */
export function resizeFrom<T extends Placed & { shape: string }>(start: T, h: Handle, dx: number, dy: number): T {
  const r = (-start.rotation * Math.PI) / 180;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  const min = start.shape === "bar" ? 60 : start.shape === "wall" ? 10 : MIN_TABLE;
  const max = start.shape === "wall" || start.shape === "counter" ? 2000 : MAX_TABLE;
  let w = h.hx ? clamp(roundTo(start.w + h.hx * lx, SIZE_STEP), min, max) : start.w;
  let hgt = h.hy ? clamp(roundTo(start.h + h.hy * ly, SIZE_STEP), min, max) : start.h;
  if (start.shape === "square" || start.shape === "round") {
    const grow = h.hx && h.hy ? (Math.abs(w - start.w) > Math.abs(hgt - start.h) ? w : hgt) : h.hx ? w : hgt;
    w = hgt = grow;
  }
  return anchored(start, w, hgt, h);
}

/** Uniform or one-axis scaling from a two-finger pinch on the table itself. */
export function pinchResize<T extends Placed & { shape: string }>(start: T, sx: number, sy: number): T {
  let w = clamp(roundTo(start.w * sx, SIZE_STEP), MIN_TABLE, MAX_TABLE);
  let h = clamp(roundTo(start.h * sy, SIZE_STEP), MIN_TABLE, MAX_TABLE);
  if (start.shape === "square" || start.shape === "round") w = h = Math.max(w, h);
  return { ...start, w, h };
}

function anchored<T extends Placed>(start: T, w: number, h: number, hd: Handle): T {
  const shiftX = (hd.hx * (w - start.w)) / 2;
  const shiftY = (hd.hy * (h - start.h)) / 2;
  const r = (start.rotation * Math.PI) / 180;
  return {
    ...start,
    w,
    h,
    x: start.x + shiftX * Math.cos(r) - shiftY * Math.sin(r),
    y: start.y + shiftX * Math.sin(r) + shiftY * Math.cos(r),
  };
}

/** Changing shape keeps the area roughly the same and seats sensible. */
export function changeShape(t: Table, shape: Shape): Table {
  const side = Math.max(t.w, t.h);
  const short = Math.min(t.w, t.h);
  switch (shape) {
    case "square":
    case "round":
      return { ...t, shape, w: roundTo(Math.max(short, (t.w + t.h) / 2), SIZE_STEP), h: roundTo(Math.max(short, (t.w + t.h) / 2), SIZE_STEP) };
    case "rect":
    case "oval":
    case "booth":
      return { ...t, shape, w: t.w === t.h ? side * 2 : t.w, h: t.w === t.h ? short : t.h };
    case "bar":
      return { ...t, shape, w: Math.max(side, 120), h: 50 };
  }
}

/** Size suggestion so a table seats `n` diners with automatic chairs. */
export function sizeForSeats(shape: Shape, n: number): { w: number; h: number } {
  for (let s = MIN_TABLE; s <= MAX_TABLE; s += SIZE_STEP) {
    const dims = shape === "square" || shape === "round" ? { w: s, h: s } : shape === "bar" ? { w: s, h: 50 } : { w: s, h: Math.max(70, Math.min(100, roundTo(s / 2, SIZE_STEP))) };
    if (autoSeatCount({ shape, ...dims }) >= n) return dims;
  }
  return { w: MAX_TABLE, h: 100 };
}

// ---------------------------------------------------------------------------
// Groups: tables that share a bill because they touch or were linked by hand.

export const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function physicalEdges(tables: Table[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < tables.length; i++) for (let j = i + 1; j < tables.length; j++) if (touching(tables[i], tables[j])) out.add(edgeKey(tables[i].id, tables[j].id));
  return out;
}

export interface TableGroup {
  id: string;
  tableIds: string[];
  physical: boolean; // at least one touching pair
  manual: boolean; // at least one hand-made link
}

export function computeGroups(tables: Table[], links: ManualLink[], edges = physicalEdges(tables)): TableGroup[] {
  const parent = new Map(tables.map((t) => [t.id, t.id]));
  const find = (x: string): string => {
    const p = parent.get(x)!;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a) || !parent.has(b)) return;
    parent.set(find(a), find(b));
  };
  for (const e of edges) {
    const [a, b] = e.split("|");
    union(a, b);
  }
  for (const l of links) for (let i = 1; i < l.tableIds.length; i++) union(l.tableIds[0], l.tableIds[i]);

  const buckets = new Map<string, string[]>();
  for (const t of tables) {
    const r = find(t.id);
    buckets.set(r, [...(buckets.get(r) ?? []), t.id]);
  }
  const groups: TableGroup[] = [];
  for (const ids of buckets.values()) {
    if (ids.length < 2) continue;
    const inGroup = new Set(ids);
    const physical = [...edges].some((e) => e.split("|").every((x) => inGroup.has(x)));
    const manual = links.some((l) => l.tableIds.some((x) => inGroup.has(x)));
    groups.push({ id: [...ids].sort().join("+"), tableIds: ids, physical, manual });
  }
  return groups;
}

export function groupOf(tableId: string, groups: TableGroup[]) {
  return groups.find((g) => g.tableIds.includes(tableId)) ?? null;
}

export function nextLabel(tables: Table[], prefix = "T") {
  const used = new Set(tables.map((t) => t.label));
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

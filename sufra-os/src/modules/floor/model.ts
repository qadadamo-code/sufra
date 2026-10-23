/**
 * OS rows → floor-engine (core) shapes, and the live derived view of the floor.
 * Time in the core is epoch *minutes* (Date.parse(iso) / 60000).
 */
import type { Check, DecorKind, DiningTable, FloorDecor, Membership, Order, OrderItem, Reservation, ServiceCall, TableLink, Zone } from "@/data/types";
import { bbox, overlapping } from "./core/geometry";
import { capacityOf, computeGroups, obstaclesFor, physicalEdges, type TableGroup } from "./core/layout";
import { chairsFor, type Chair } from "./core/seats";
import { expectedFreeAt, expectedStay, isLate, TURN_BUFFER } from "./core/reservations";
import type * as C from "./core/types";

export const toMin = (iso: string) => Math.floor(Date.parse(iso) / 60000);
export const fromMin = (m: number) => new Date(m * 60000).toISOString();

export function layoutOf(zones: Zone[], tables: DiningTable[], decor: FloorDecor[]): C.Layout {
  return { zones, tables: tables.filter((t) => t.active), decor };
}

export function coreReservation(r: Reservation): C.Reservation {
  return { id: r.id, name: r.name, phone: r.phone, party: r.party, start: toMin(r.startsAt), duration: r.durationMin, tableIds: r.tableIds, status: r.status, note: r.note, tags: r.tags };
}

/** Checks with their lines (non-void items), each line remembering the table it was ordered from. */
export function coreChecks(checks: Check[], orders: Order[], items: OrderItem[]): C.Check[] {
  const orderCheck = new Map(orders.map((o) => [o.id, o.checkId]));
  const byCheck = new Map<string, C.CheckLine[]>();
  const primary = new Map(checks.map((c) => [c.id, c.tableIds[0] ?? ""]));
  for (const i of items) {
    if (i.status === "void") continue;
    const cid = orderCheck.get(i.orderId);
    if (!cid || !primary.has(cid)) continue;
    const line: C.CheckLine = { id: i.id, itemId: i.itemId, qty: i.qty, unitPrice: i.unitPrice, originTableId: i.originTableId ?? primary.get(cid)! };
    byCheck.set(cid, [...(byCheck.get(cid) ?? []), line]);
  }
  return checks.map((c) => ({
    id: c.id,
    tableIds: c.tableIds,
    lines: byCheck.get(c.id) ?? [],
    guests: c.guests,
    openedAt: toMin(c.openedAt),
    status: c.status,
    reservationId: c.reservationId,
  }));
}

/* ───────────── live view ───────────── */

/**
 * What the floor shows for a table. Colour + icon + pattern per state (colour-blind safe):
 * free (green) · reserved/booked soon (red) · dirty (orange) · occupied (teal) · long stay (amber) · bill (purple) · blocked (grey)
 */
export type FloorState = "free" | "reserved" | "dirty" | "occupied" | "long" | "bill" | "blocked";
export const FLOOR_STATES: FloorState[] = ["free", "occupied", "long", "bill", "reserved", "dirty", "blocked"];

export interface TableView {
  table: DiningTable;
  chairs: Chair[];
  capacity: number;
  state: FloorState;
  check: Check | null;
  guests: number;
  /** minutes since seated (null when free) */
  elapsed: number | null;
  waiter: Membership | null;
  calls: ServiceCall[];
  /** next pending/confirmed booking for this table within 3 h */
  next: Reservation | null;
  /** seated party probably won't leave before the next booking arrives */
  atRisk: boolean;
  late: boolean;
  overlaps: boolean;
  group: TableGroup | null;
}

export interface FloorInput {
  zones: Zone[];
  tables: DiningTable[];
  decor: FloorDecor[];
  links: TableLink[];
  checks: Check[];
  orders: Order[];
  reservations: Reservation[];
  calls: ServiceCall[];
  members: Membership[];
  now: number; // epoch ms
}

export interface FloorView {
  tables: Map<string, TableView>;
  groups: TableGroup[];
  edges: Set<string>;
  layout: C.Layout;
}

/** booked tables turn red this many minutes before the guests are due */
export const RESERVED_LEAD_MIN = 45;

export function deriveFloor(d: FloorInput): FloorView {
  const nowMin = d.now / 60000;
  const layout = layoutOf(d.zones, d.tables, d.decor);
  const edges = physicalEdges(layout.tables);
  const groups = computeGroups(layout.tables, d.links, edges);
  const active = d.checks.filter((c) => c.status === "open" || c.status === "bill_requested");
  const memberById = new Map(d.members.map((m) => [m.id, m]));
  const waiterOfCheck = new Map<string, string>();
  for (const o of [...d.orders].sort((a, b) => a.openedAt.localeCompare(b.openedAt))) if (o.checkId && o.waiterId && !waiterOfCheck.has(o.checkId)) waiterOfCheck.set(o.checkId, o.waiterId);
  const liveRes = d.reservations.filter((r) => r.status === "pending" || r.status === "confirmed");
  const out = new Map<string, TableView>();
  for (const t of d.tables.filter((x) => x.active)) {
    const chairs = chairsFor(t, obstaclesFor(t, layout));
    const capacity = chairs.filter((c) => !c.blocked).length;
    const check = active.find((c) => c.tableIds.includes(t.id)) ?? null;
    const next =
      liveRes
        .filter((r) => r.tableIds.includes(t.id) && toMin(r.startsAt) + r.durationMin > nowMin && toMin(r.startsAt) <= nowMin + 180)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null;
    const since = check ? check.openedAt : ["seated", "ordered", "bill"].includes(t.status) ? t.statusSince : null;
    const elapsed = since ? Math.max(0, Math.floor(nowMin - toMin(since))) : null;
    const guests = check?.guests ?? 0;
    let state: FloorState = "free";
    if (t.status === "blocked") state = "blocked";
    else if (check?.status === "bill_requested" || (!check && t.status === "bill")) state = "bill";
    else if (check || t.status === "seated" || t.status === "ordered") state = elapsed !== null && elapsed > expectedStay(Math.max(1, guests)) + 15 ? "long" : "occupied";
    else if (t.status === "dirty") state = "dirty";
    else if (t.status === "reserved" || (next && toMin(next.startsAt) - nowMin <= RESERVED_LEAD_MIN)) state = "reserved";
    const nextStart = next ? toMin(next.startsAt) : null;
    const atRisk = !!(check && nextStart !== null && expectedFreeAt({ ...coreChecks([check], [], [])[0] }, nowMin) + TURN_BUFFER > nextStart);
    const wid = (check && waiterOfCheck.get(check.id)) ?? t.waiterId ?? null;
    out.set(t.id, {
      table: t,
      chairs,
      capacity,
      state,
      check,
      guests,
      elapsed,
      waiter: wid ? memberById.get(wid) ?? null : null,
      calls: d.calls.filter((c) => c.tableId === t.id && (c.status === "open" || c.status === "ack")),
      next,
      atRisk,
      late: next ? isLate(coreReservation(next), nowMin) : false,
      overlaps: layout.tables.some((o) => o.id !== t.id && o.zoneId === t.zoneId && overlapping(t, o)),
      group: groups.find((g) => g.tableIds.includes(t.id)) ?? null,
    });
  }
  return { tables: out, groups, edges, layout };
}

export function capacities(layout: C.Layout) {
  return new Map(layout.tables.map((t) => [t.id, capacityOf(t, layout)]));
}

export function groupBox(tables: { x: number; y: number; w: number; h: number; rotation: number; shape?: string }[]) {
  const bs = tables.map((t) => bbox(t as never));
  return { x1: Math.min(...bs.map((b) => b.x1)), y1: Math.min(...bs.map((b) => b.y1)), x2: Math.max(...bs.map((b) => b.x2)), y2: Math.max(...bs.map((b) => b.y2)) };
}

export const DECOR_KINDS: DecorKind[] = ["wall", "pillar", "door", "window", "counter", "plant"];
export const DECOR_DEFAULT: Record<DecorKind, { w: number; h: number }> = {
  wall: { w: 300, h: 15 },
  pillar: { w: 50, h: 50 },
  door: { w: 100, h: 15 },
  window: { w: 200, h: 15 },
  counter: { w: 300, h: 70 },
  plant: { w: 60, h: 60 },
};

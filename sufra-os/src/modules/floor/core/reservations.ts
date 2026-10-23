import { bbox, gaps, isAxisAligned } from "./geometry";
import { capacityOf, computeGroups } from "./layout";
import { checkForTable } from "./checks";
import type { Check, Layout, Reservation, Table } from "./types";

/** Minutes the table needs between parties (clearing and resetting). */
export const TURN_BUFFER = 10;
/** A guest this late is flagged; the table can be released. */
export const GRACE_MINUTES = 15;
export const SLOT = 15;

export const isLive = (r: Reservation) => r.status === "pending" || r.status === "confirmed" || r.status === "seated";
export const endOf = (r: Pick<Reservation, "start" | "duration">) => r.start + r.duration;

export function defaultDuration(party: number) {
  if (party <= 2) return 75;
  if (party <= 4) return 90;
  if (party <= 6) return 105;
  return 120;
}

/** How long a party usually stays, used to guess when a busy table frees up. */
export const expectedStay = defaultDuration;

export function windowsClash(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd + TURN_BUFFER && bStart < aEnd + TURN_BUFFER;
}

export function conflictsOf(r: Reservation, all: Reservation[]) {
  if (!isLive(r)) return [];
  return all.filter((o) => o.id !== r.id && isLive(o) && o.tableIds.some((t) => r.tableIds.includes(t)) && windowsClash(r.start, endOf(r), o.start, endOf(o)));
}

/** When a seated table is expected to be free again. */
export function expectedFreeAt(check: Check, now: number) {
  return Math.max(now + 10, check.openedAt + expectedStay(check.guests));
}

export function tableFree(tableId: string, from: number, to: number, reservations: Reservation[], checks: Check[], now: number, excludeId?: string) {
  const busy = reservations.some((r) => r.id !== excludeId && isLive(r) && r.status !== "seated" && r.tableIds.includes(tableId) && windowsClash(from, to, r.start, endOf(r)));
  if (busy) return false;
  const c = checkForTable(checks, tableId);
  return !c || c.reservationId === excludeId || expectedFreeAt(c, now) + TURN_BUFFER <= from;
}

export type SuggestReason = "exact" | "joined" | "push" | "zone" | "roomy";

export interface Suggestion {
  tableIds: string[];
  capacity: number;
  score: number;
  reasons: SuggestReason[];
}

/** `b` slid along one axis until it touches `a`, or null if they are not lined up. */
export function pushTogether(a: Table, b: Table): Table | null {
  if (a.zoneId !== b.zoneId || !isAxisAligned(a.rotation) || !isAxisAligned(b.rotation)) return null;
  const A = bbox(a);
  const B = bbox(b);
  const g = gaps(A, B);
  if (g.x > 0 && g.x <= 80 && -g.y >= 30) return { ...b, x: b.x + (B.x1 >= A.x2 ? -g.x : g.x) };
  if (g.y > 0 && g.y <= 80 && -g.x >= 30) return { ...b, y: b.y + (B.y1 >= A.y2 ? -g.y : g.y) };
  return null;
}

/** Seats two tables would have if `b` were slid along one axis to touch `a`. */
function joinedCapacity(a: Table, b: Table, layout: Layout): number | null {
  const moved = pushTogether(a, b);
  if (!moved) return null;
  const trial: Layout = { ...layout, tables: layout.tables.map((t) => (t.id === b.id ? moved! : t)) };
  return capacityOf(a, trial) + capacityOf(moved, trial);
}

/**
 * Ranks tables (or tables that can be pushed together) for a party:
 * fewest empty chairs first, then single tables over joined ones,
 * then the guest's preferred area.
 */
export function suggestTables(
  party: number,
  start: number,
  duration: number,
  layout: Layout,
  reservations: Reservation[],
  checks: Check[],
  now: number,
  opts: { zoneId?: string; excludeId?: string } = {},
): Suggestion[] {
  const free = (id: string) => tableFree(id, start, start + duration, reservations, checks, now, opts.excludeId);
  const zoneOf = new Map(layout.tables.map((t) => [t.id, t.zoneId]));
  const out: Suggestion[] = [];
  const push = (tableIds: string[], capacity: number, base: SuggestReason[]) => {
    if (capacity < party || capacity > party + Math.max(4, party)) return;
    if (!tableIds.every(free)) return;
    const reasons = [...base];
    const waste = capacity - party;
    if (waste === 0) reasons.push("exact");
    else if (waste >= 3) reasons.push("roomy");
    const inZone = !opts.zoneId || tableIds.every((t) => zoneOf.get(t) === opts.zoneId);
    if (opts.zoneId && inZone) reasons.push("zone");
    const score = waste * 10 + (tableIds.length - 1) * 12 + (base.includes("push") ? 6 : 0) + (inZone ? 0 : 25);
    out.push({ tableIds, capacity, score, reasons });
  };

  for (const t of layout.tables) push([t.id], capacityOf(t, layout), []);
  for (const g of computeGroups(layout.tables, [])) {
    const cap = g.tableIds.reduce((s, id) => s + capacityOf(layout.tables.find((t) => t.id === id)!, layout), 0);
    push(g.tableIds, cap, ["joined"]);
  }
  for (let i = 0; i < layout.tables.length; i++)
    for (let j = i + 1; j < layout.tables.length; j++) {
      const cap = joinedCapacity(layout.tables[i], layout.tables[j], layout);
      if (cap != null) push([layout.tables[i].id, layout.tables[j].id], cap, ["joined", "push"]);
    }

  const seen = new Set<string>();
  return out
    .sort((a, b) => a.score - b.score)
    .filter((s) => {
      const k = [...s.tableIds].sort().join();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 4);
}

/**
 * Minutes until a walk-in party could sit somewhere for a normal stay
 * without colliding with a booking. null = not tonight.
 */
export function waitEstimate(party: number, layout: Layout, reservations: Reservation[], checks: Check[], now: number): number | null {
  const stay = defaultDuration(party);
  for (let t = now; t <= now + 240; t += 5) {
    if (suggestTables(party, t, stay, layout, reservations, checks, now).length > 0) return t - now;
  }
  return null;
}

export function isLate(r: Reservation, now: number) {
  return (r.status === "pending" || r.status === "confirmed") && now > r.start + GRACE_MINUTES;
}

export function nextReservationFor(tableId: string, reservations: Reservation[], now: number, horizon = 180) {
  return (
    reservations
      .filter((r) => (r.status === "pending" || r.status === "confirmed") && r.tableIds.includes(tableId) && endOf(r) > now && r.start <= now + horizon)
      .sort((a, b) => a.start - b.start)[0] ?? null
  );
}

export function fmtTime(min: number, lang: "ar" | "en" = "en") {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const h12 = h24 % 12 || 12;
  const pm = h24 >= 12;
  return lang === "ar" ? `${h12}:${mm} ${pm ? "م" : "ص"}` : `${h12}:${mm} ${pm ? "PM" : "AM"}`;
}

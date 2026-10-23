/**
 * Pure floor-engine types (ported from sufra-floor/src/core).
 *
 * The OS rows (src/data/types.ts) are structurally compatible with the layout types here:
 * a `DiningTable` is a `Table`, a `FloorDecor` is a `Decor`, a `Zone` is a `Zone`.
 * Checks and reservations are adapted by ../adapt.ts:
 *   - times are *minutes* on any consistent clock (the OS uses epoch minutes: Date.parse(iso) / 60000);
 *   - money is whatever integer unit the caller uses (the OS uses Units).
 * All lengths are centimetres on the real floor.
 */

export type Shape = "square" | "rect" | "round" | "oval" | "booth" | "bar";

export interface Table {
  id: string;
  label: string;
  zoneId: string;
  shape: Shape;
  x: number; // centre
  y: number;
  w: number;
  h: number;
  rotation: number; // degrees, multiples of 45
  seatsOverride: number | null; // null = computed from size
}

export type DecorKind = "wall" | "pillar" | "door" | "counter" | "plant" | "window";

export interface Decor {
  id: string;
  zoneId: string;
  kind: DecorKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export interface Zone {
  id: string;
  name: { ar: string; en: string };
  width: number;
  height: number;
}

export interface Layout {
  zones: Zone[];
  tables: Table[];
  decor: Decor[];
}

export interface MenuItem {
  id: string;
  name: { ar: string; en: string };
  price: number;
}

export interface CheckLine {
  id: string;
  itemId: string;
  qty: number;
  unitPrice: number; // snapshotted at order time
  originTableId: string; // lets a merged bill be split back to its tables
}

export type CheckStatus = "open" | "bill_requested" | "paid" | "void";

export interface Check {
  id: string;
  tableIds: string[]; // first id is the primary table
  lines: CheckLine[];
  guests: number;
  openedAt: number;
  status: CheckStatus;
  reservationId: string | null;
}

/** Tables a person joined on purpose even though they are not touching. */
export interface ManualLink {
  id: string;
  tableIds: string[];
}

export type ReservationStatus = "pending" | "confirmed" | "seated" | "done" | "no_show" | "cancelled" | "waiting";

export interface Reservation {
  id: string;
  name: string;
  phone: string;
  party: number;
  start: number;
  duration: number;
  tableIds: string[];
  status: ReservationStatus;
  note: string;
  tags: ReservationTag[];
}

export type ReservationTag = "birthday" | "vip" | "kids" | "smoking" | "quiet";

export interface WaitEntry {
  id: string;
  name: string;
  phone: string;
  party: number;
  addedAt: number;
}

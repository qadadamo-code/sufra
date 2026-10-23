/**
 * Booking availability: which start times can take a party of N, given the floor, the bookings already
 * made and (for today) who is sitting down right now. Used by the public booking page and the
 * staff "new reservation" dialog. Pure — times are minutes on the caller's clock (the OS uses epoch minutes).
 */
import { defaultDuration, isLive, suggestTables } from "./reservations";
import type { Check, Layout, Reservation } from "./types";

export const SLOT_MINUTES = 15;

/** "12:00" → 720. "01:00" after a "12:00" opening is read as the next day (1500). */
export function parseHours(h: { open: string; close: string } | null | undefined): { open: number; close: number } {
  const p = (s: string) => {
    const [hh, mm] = s.split(":").map((x) => parseInt(x, 10));
    return (hh || 0) * 60 + (mm || 0);
  };
  if (!h) return { open: 12 * 60, close: 24 * 60 };
  const open = p(h.open);
  let close = p(h.close);
  if (close <= open) close += 24 * 60;
  return { open, close };
}

export interface SlotQuery {
  /** minute at which the service day starts (local midnight of the chosen date) */
  dayStart: number;
  party: number;
  hours: { open: number; close: number };
  /** current minute (slots before now + leadMinutes are closed) */
  now: number;
  /** minimum notice for a booking */
  leadMinutes?: number;
  /** the kitchen stops seating this long before closing */
  lastSeatingBeforeClose?: number;
  /** pacing: at most this many booked covers may arrive per slot (0/undefined = no limit) */
  maxCoversPerSlot?: number;
  slot?: number;
  /** party sizes the page may book online (bigger parties call the restaurant) */
  maxParty?: number;
}

export type SlotReason = "past" | "pacing" | "full" | "too_big";

export interface Slot {
  start: number;
  ok: boolean;
  reason?: SlotReason;
  /** best table(s) for this slot (for staff; the public page never shows them) */
  tableIds: string[];
}

export function bookingSlots(q: SlotQuery, layout: Layout, reservations: Reservation[], checks: Check[]): Slot[] {
  const step = q.slot ?? SLOT_MINUTES;
  const lead = q.leadMinutes ?? 30;
  const last = q.hours.close - (q.lastSeatingBeforeClose ?? 60);
  const duration = defaultDuration(q.party);
  const out: Slot[] = [];
  for (let m = q.hours.open; m <= last; m += step) {
    const start = q.dayStart + m;
    if (q.maxParty && q.party > q.maxParty) {
      out.push({ start, ok: false, reason: "too_big", tableIds: [] });
      continue;
    }
    if (start < q.now + lead) {
      out.push({ start, ok: false, reason: "past", tableIds: [] });
      continue;
    }
    if (q.maxCoversPerSlot) {
      const arriving = reservations.filter((r) => isLive(r) && r.start >= start && r.start < start + step).reduce((s, r) => s + r.party, 0);
      if (arriving + q.party > q.maxCoversPerSlot) {
        out.push({ start, ok: false, reason: "pacing", tableIds: [] });
        continue;
      }
    }
    const best = suggestTables(q.party, start, duration, layout, reservations, checks, q.now);
    out.push(best.length ? { start, ok: true, tableIds: best[0].tableIds } : { start, ok: false, reason: "full", tableIds: [] });
  }
  return out;
}

/** Slots grouped by part of the day, for the booking page. */
export function groupSlots(slots: Slot[], dayStart: number) {
  const part = (s: Slot) => {
    const h = Math.floor(((s.start - dayStart) % 1440) / 60);
    return h < 16 ? "lunch" : h < 20 ? "evening" : "late";
  };
  const g: Record<"lunch" | "evening" | "late", Slot[]> = { lunch: [], evening: [], late: [] };
  for (const s of slots) g[part(s)].push(s);
  return g;
}

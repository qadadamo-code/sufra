import { useMemo } from "react";
import { useBranch } from "@/auth/session";
import { useLive, type Db } from "@/data/hooks";
import type { Reservation, ReservationStatus } from "@/data/types";
import { nowIso } from "@/lib/time";
import { seatTables } from "@/modules/floor/ops";
import { suggestTables } from "@/modules/floor/core/reservations";
import { coreChecks, coreReservation, toMin } from "@/modules/floor/model";
import type { Layout } from "@/modules/floor/core/types";
import type { Check } from "@/data/types";

export const LIVE: ReservationStatus[] = ["pending", "confirmed", "seated"];

export function parseDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(date: string, n: number) {
  const d = parseDate(date);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Week starts on Saturday (Egypt). */
export function weekStart(date: string) {
  const d = parseDate(date);
  const back = (d.getDay() + 1) % 7;
  return addDays(date, -back);
}

/** Reservations for a 7-day window + the waitlist, live. */
export function useWeekReservations(date: string) {
  const branch = useBranch();
  const bq = branch ? { branchId: branch.id } : {};
  const ws = weekStart(date);
  const from = useMemo(() => parseDate(ws).toISOString(), [ws]);
  const to = useMemo(() => parseDate(addDays(ws, 7)).toISOString(), [ws]);
  const week = useLive("reservations", { where: bq, gte: { startsAt: from }, lte: { startsAt: to }, orderBy: [{ field: "startsAt" }] });
  const waiting = useLive("reservations", { where: { ...bq, status: "waiting" }, orderBy: [{ field: "createdAt" }] }).data;
  return { week: week.data.filter((r) => r.status !== "waiting"), waiting, loading: week.loading, weekStartDate: ws };
}

export function sameDay(iso: string, date: string) {
  const d = new Date(iso);
  const p = parseDate(date);
  return d.getFullYear() === p.getFullYear() && d.getMonth() === p.getMonth() && d.getDate() === p.getDate();
}

/** Seat a booking: its tables, or the best free ones right now. Opens the check on the floor. */
export async function seatReservation(db: Db, r: Reservation, layout: Layout, reservations: Reservation[], checks: Check[]) {
  let tableIds = r.tableIds;
  const now = Date.now() / 60000;
  const busy = new Set(checks.filter((c) => c.status === "open" || c.status === "bill_requested").flatMap((c) => c.tableIds));
  if (!tableIds.length || tableIds.some((t) => busy.has(t))) {
    const s = suggestTables(r.party, now, r.durationMin, layout, reservations.map(coreReservation), coreChecks(checks, [], []), now, { excludeId: r.id });
    if (!s.length) throw new Error("no_table");
    tableIds = s[0].tableIds;
  }
  await seatTables(db, { tableIds, guests: r.party, reservationId: r.id, customerId: r.customerId });
  return tableIds;
}

export async function setStatus(db: Db, r: Reservation, status: ReservationStatus) {
  const patch: Partial<Reservation> = { status };
  if (status === "confirmed" && r.status === "waiting") patch.startsAt = nowIso();
  await db.update("reservations", r.id, patch);
  await db.audit(`reservation.${status}`, "reservations", r.id);
}

export const minutesLate = (r: Reservation, now = Date.now()) => Math.floor((now - Date.parse(r.startsAt)) / 60000);
export const endIso = (r: Reservation) => new Date(Date.parse(r.startsAt) + r.durationMin * 60000).toISOString();
export { toMin };

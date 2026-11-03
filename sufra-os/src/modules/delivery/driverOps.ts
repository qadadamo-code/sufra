/** Rider shift on/off and live location (one row per rider in `driverLocations`, id = locationId(driverId)). */
import type { Db } from "@/data/hooks";
import type { DriverLocation, DriverShift } from "@/data/types";
import { nowIso } from "@/lib/time";
import { haversineKm } from "./geo";
import { seedId } from "@/lib/id";

/** Stable row id of a rider's position (one row per rider). */
export const locationId = (driverId: string) => seedId(`driver-location:${driverId}`);

export async function currentShift(db: Db, driverId: string): Promise<DriverShift | null> {
  const [s] = await db.list("driverShifts", { where: { driverId, status: "on" }, orderBy: [{ field: "startedAt", dir: "desc" }], limit: 1 });
  return s ?? null;
}

async function branchOf(db: Db) {
  if (db.branchId) return db.branchId;
  const [b] = await db.list("branches", { where: { isDefault: true } });
  return b?.id ?? (await db.list("branches"))[0]?.id ?? "";
}

export async function startShift(db: Db, driverId: string): Promise<DriverShift> {
  const cur = await currentShift(db, driverId);
  if (cur) return cur;
  const s = await db.insert("driverShifts", { branchId: await branchOf(db), driverId, status: "on", startedAt: nowIso(), endedAt: null, settlement: null });
  await db.audit("delivery.shift_on", "driverShifts", s.id, { driver: driverId });
  const loc = await db.get("driverLocations", locationId(driverId));
  if (loc) await db.update("driverLocations", loc.id, { onShift: true });
  return s;
}

export async function endShift(db: Db, shift: DriverShift): Promise<DriverShift> {
  const row = await db.update("driverShifts", shift.id, { status: "off", endedAt: nowIso() });
  await db.audit("delivery.shift_off", "driverShifts", shift.id, { driver: shift.driverId });
  const loc = await db.get("driverLocations", locationId(shift.driverId));
  if (loc) await db.update("driverLocations", loc.id, { onShift: false });
  return row;
}

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  at: number;
}

/**
 * Battery/data-friendly throttle: write when moved ≥ 30 m and ≥ 15 s since the last write, or every 60 s as a heartbeat.
 * Fixes worse than 150 m accuracy are ignored unless nothing better came in for a minute.
 */
export function shouldSend(last: Fix | null, next: Fix, opts = { minMoveM: 30, minGapMs: 15_000, heartbeatMs: 60_000, maxAccuracyM: 150 }): boolean {
  if (!last) return true;
  const gap = next.at - last.at;
  if (gap >= opts.heartbeatMs) return true;
  if ((next.accuracy ?? 0) > opts.maxAccuracyM) return false;
  const moved = haversineKm(last, next) * 1000;
  return gap >= opts.minGapMs && moved >= opts.minMoveM;
}

export async function saveLocation(db: Db, driverId: string, f: Fix, onShift = true): Promise<DriverLocation> {
  const patch = { lat: f.lat, lng: f.lng, accuracy: f.accuracy, heading: f.heading, speed: f.speed, at: new Date(f.at).toISOString(), onShift };
  const id = locationId(driverId);
  const cur = await db.get("driverLocations", id);
  if (cur) return db.update("driverLocations", id, patch);
  return db.insert("driverLocations", { id, driverId, ...patch });
}

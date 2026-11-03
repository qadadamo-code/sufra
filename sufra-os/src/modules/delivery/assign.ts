/**
 * Dispatch helpers (pure, tested in assign.test.ts):
 *   - suggestDrivers: rank on-shift riders for an order — idle near the kitchen, or already holding nearby orders (batch)
 *   - batchGroups:    unassigned orders whose doors are close enough to go out on one trip
 *   - lateness:       on time / at risk / late against the promise
 */
import type { LatLng } from "@/data/types";
import { haversineKm, travelMinutes } from "./geo";

export interface DriverLoad {
  orderId: string;
  /** assigned = still at the kitchen with it; out = on the road */
  state: "assigned" | "out";
  to: LatLng | null;
}

export interface DriverState {
  id: string;
  name: string;
  onShift: boolean;
  location: LatLng | null;
  /** ISO time of the last GPS fix */
  locationAt: string | null;
  load: DriverLoad[];
}

export interface DispatchParams {
  origin: LatLng;
  speedKmh: number;
  batchRadiusKm: number;
  maxBatch: number;
}

export type SuggestionReason = "idle" | "batch" | "returning" | "full";

export interface Suggestion {
  driverId: string;
  name: string;
  reason: SuggestionReason;
  /** minutes until the rider can be at the kitchen */
  atKitchenMin: number;
  /** door ETA for this order if given to this rider */
  etaMin: number;
  /** km from the rider to the kitchen now */
  distanceKm: number;
  batchWith: string[];
  score: number;
}

const STALE_MIN = 10;

/**
 * Rank riders for an order. `prepLeftMin` = kitchen minutes left (0 when ready).
 * A rider on a trip has to finish the drop-offs and ride back; one with orders still at the kitchen can take this one
 * on the same trip when every door is within `batchRadiusKm`.
 */
export function suggestDrivers(order: { id: string; to: LatLng | null; prepLeftMin: number }, drivers: DriverState[], p: DispatchParams, now = Date.now()): Suggestion[] {
  const out: Suggestion[] = [];
  for (const d of drivers) {
    if (!d.onShift) continue;
    const others = d.load.filter((l) => l.orderId !== order.id);
    const here = d.location ?? p.origin;
    const stale = !d.location || (d.locationAt ? (now - Date.parse(d.locationAt)) / 60_000 > STALE_MIN : true);
    const distanceKm = haversineKm(here, p.origin);
    const onRoad = others.filter((l) => l.state === "out");
    const waiting = others.filter((l) => l.state === "assigned");
    let reason: SuggestionReason;
    let atKitchenMin: number;
    let batchWith: string[] = [];
    if (onRoad.length) {
      // finish the remaining stops (in order), then ride back
      let at = here;
      let m = 0;
      for (const l of onRoad) {
        if (!l.to) continue;
        m += travelMinutes(at, l.to, p.speedKmh);
        at = l.to;
      }
      atKitchenMin = m + travelMinutes(at, p.origin, p.speedKmh, { handover: false });
      reason = "returning";
    } else {
      atKitchenMin = distanceKm < 0.15 ? 0 : travelMinutes(here, p.origin, p.speedKmh, { handover: false });
      reason = "idle";
    }
    if (waiting.length) {
      const near = order.to && waiting.every((l) => l.to && haversineKm(l.to, order.to!) <= p.batchRadiusKm);
      if (near && !onRoad.length) {
        reason = "batch";
        batchWith = waiting.map((l) => l.orderId);
      } else {
        // holding orders that go elsewhere: those drops first, then back to the kitchen
        reason = "full";
        let at = p.origin;
        let m = atKitchenMin;
        for (const l of waiting) {
          if (!l.to) continue;
          m += travelMinutes(at, l.to, p.speedKmh);
          at = l.to;
        }
        atKitchenMin = m + travelMinutes(at, p.origin, p.speedKmh, { handover: false });
      }
    }
    if (others.length >= p.maxBatch) reason = "full";
    const leaveIn = Math.max(atKitchenMin, order.prepLeftMin);
    const ride = order.to ? travelMinutes(p.origin, order.to, p.speedKmh) : 20;
    const stopsBefore = reason === "batch" ? batchWith.length : 0;
    const etaMin = leaveIn + ride + stopsBefore * 4;
    const score = etaMin + (reason === "batch" ? -6 : 0) + (reason === "full" ? 60 : 0) + (stale ? 3 : 0) + others.length * 2;
    out.push({ driverId: d.id, name: d.name, reason, atKitchenMin, etaMin, distanceKm, batchWith, score });
  }
  return out.sort((a, b) => a.score - b.score || a.distanceKm - b.distanceKm || a.name.localeCompare(b.name));
}

/** Greedy clusters of unassigned orders (ready soonest first) whose doors are all within radius of the group's first door. */
export function batchGroups(orders: { id: string; to: LatLng | null; readyBy: number }[], radiusKm: number, max: number): string[][] {
  const pool = [...orders].filter((o) => o.to).sort((a, b) => a.readyBy - b.readyBy || a.id.localeCompare(b.id));
  const used = new Set<string>();
  const groups: string[][] = [];
  for (const seed of pool) {
    if (used.has(seed.id)) continue;
    const g = [seed];
    for (const o of pool) {
      if (g.length >= max) break;
      if (o === seed || used.has(o.id)) continue;
      // all doors close to each other, and food ready within 10 minutes of each other
      if (g.every((x) => haversineKm(x.to!, o.to!) <= radiusKm) && Math.abs(o.readyBy - seed.readyBy) <= 10 * 60_000) g.push(o);
    }
    if (g.length > 1) {
      g.forEach((x) => used.add(x.id));
      groups.push(g.map((x) => x.id));
    }
  }
  return groups;
}

export type Lateness = "ok" | "risk" | "late";

/** Late when the projected door time passes the promise + grace; at risk within 5 minutes of it. */
export function lateness(promisedAt: string | null, projectedAt: number | null, now: number, graceMin: number): Lateness {
  if (!promisedAt) return "ok";
  const limit = Date.parse(promisedAt) + graceMin * 60_000;
  const when = Math.max(now, projectedAt ?? now);
  if (when > limit) return "late";
  if (when > limit - 5 * 60_000) return "risk";
  return "ok";
}

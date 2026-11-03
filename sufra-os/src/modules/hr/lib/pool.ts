/**
 * Pools that are shared out in whole piastres and always add up to the pool exactly (largest remainder):
 * the service-charge pool (نقاط الخدمة: points × hours is common in Egypt) and the POS tips pool.
 */
import { UNITS_PER_MINOR, type Units } from "@/lib/money";

export interface PoolMember {
  id: string;
  /** points (service), hours worked, or 1 (equal) — any non-negative number */
  weight: number;
}

/** Splits `total` by weight. Shares are whole piastres; Σ shares === total (when total is whole piastres). */
export function splitPool(total: Units, members: PoolMember[]): Record<string, Units> {
  const out: Record<string, Units> = {};
  for (const m of members) out[m.id] = 0;
  const live = members.filter((m) => m.weight > 0 && Number.isFinite(m.weight));
  const piastres = Math.round(total / UNITS_PER_MINOR);
  const W = live.reduce((a, m) => a + m.weight, 0);
  if (!live.length || W <= 0 || piastres <= 0) return out;
  const raw = live.map((m) => ({ id: m.id, exact: (piastres * m.weight) / W }));
  const base = raw.map((r) => ({ ...r, p: Math.floor(r.exact + 1e-9), frac: r.exact - Math.floor(r.exact + 1e-9) }));
  let left = piastres - base.reduce((a, r) => a + r.p, 0);
  // biggest remainders first; ties go to the bigger weight, then id (deterministic)
  const order = [...base].sort((a, b) => b.frac - a.frac || b.exact - a.exact || (a.id < b.id ? -1 : 1));
  for (const r of order) {
    if (left <= 0) break;
    r.p += 1;
    left--;
  }
  for (const r of base) out[r.id] = r.p * UNITS_PER_MINOR;
  return out;
}

export type ServiceMethod = "points" | "hours" | "points_hours";

/** Weight of one person in the service pool. */
export function serviceWeight(method: ServiceMethod, points: number, hours: number): number {
  if (method === "points") return hours > 0 ? points : 0; // nobody who did not work this period
  if (method === "hours") return hours;
  return points * hours;
}

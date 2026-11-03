/**
 * Estimated occupancy per zone (BETA) — pure.
 *
 * Inputs are people-count samples: manual head counts from the host ("الصالة فيها ٢٤") and line-crossing counts from
 * camera counters (in/out since the previous sample). The estimate is the last manual count plus the net flow after it,
 * clamped at zero. It is an ESTIMATE: counters miss groups and staff walk through doors — the UI labels it so.
 *
 * Table-level occupancy from video (a vision model on a ceiling camera) is a design note only (DESIGN.md): not reliable
 * enough today to drive table status.
 */
import type { PeopleCount } from "../types";

export interface OccupancyEstimate {
  zoneId: string | null;
  people: number;
  /** null when the zone has no capacity configured */
  pct: number | null;
  basis: "manual" | "counter" | "mixed" | "none";
  lastAt: string | null;
  /** minutes since the last sample */
  ageMin: number | null;
  /** low when only counter flow (no anchor) or the data is old */
  confidence: "low" | "medium" | "high";
}

export function estimateOccupancy(samples: PeopleCount[], zoneId: string | null, capacity: number | null, now = Date.now(), sinceIso?: string): OccupancyEstimate {
  const mine = samples
    .filter((s) => s.zoneId === zoneId && (!sinceIso || s.at >= sinceIso))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!mine.length) return { zoneId, people: 0, pct: capacity ? 0 : null, basis: "none", lastAt: null, ageMin: null, confidence: "low" };
  let anchor = -1;
  for (let i = mine.length - 1; i >= 0; i--)
    if (mine[i].occupancy != null) {
      anchor = i;
      break;
    }
  let people = anchor >= 0 ? (mine[anchor].occupancy as number) : 0;
  let flow = false;
  for (let i = anchor + 1; i < mine.length; i++) {
    people += mine[i].inCount - mine[i].outCount;
    flow = true;
    if (people < 0) people = 0;
  }
  const last = mine[mine.length - 1];
  const ageMin = Math.max(0, Math.round((now - Date.parse(last.at)) / 60000));
  const basis = anchor >= 0 ? (flow ? "mixed" : "manual") : "counter";
  const confidence = ageMin > 60 ? "low" : basis === "counter" ? "low" : basis === "mixed" ? "medium" : ageMin > 20 ? "medium" : "high";
  return { zoneId, people, pct: capacity ? Math.round((people / capacity) * 100) : null, basis, lastAt: last.at, ageMin, confidence };
}

/**
 * Camera people-counter integration. A small on-site/serverless poller implements this for the NVR and writes
 * people_counts rows (source "camera"). Endpoints are vendor-specific — see DESIGN.md (unconfirmed ones are marked).
 */
export interface PeopleCounterSource {
  brand: "hikvision" | "dahua" | "uniview" | "other";
  /** returns in/out counts between two times for one channel */
  fetchCounts(channel: number, fromIso: string, toIso: string): Promise<{ in: number; out: number }>;
}

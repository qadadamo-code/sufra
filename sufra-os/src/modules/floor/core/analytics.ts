/** Turn analytics for the floor strip. Pure; minutes on any consistent clock. */

export interface ClosedVisit {
  openedAt: number;
  closedAt: number;
  guests: number;
  tableCount: number;
}

export interface TurnStats {
  /** average minutes a party stayed (0 when none closed yet) */
  avgTurn: number;
  /** by party size bucket: 1–2, 3–4, 5–6, 7+ */
  bySize: { bucket: "2" | "4" | "6" | "8+"; avg: number; count: number }[];
  count: number;
}

const bucketOf = (g: number): TurnStats["bySize"][number]["bucket"] => (g <= 2 ? "2" : g <= 4 ? "4" : g <= 6 ? "6" : "8+");

export function turnStats(visits: ClosedVisit[]): TurnStats {
  // ignore takeaway-like blips (< 5 min) and forgotten checks (> 6 h)
  const ok = visits.filter((v) => v.tableCount > 0 && v.closedAt - v.openedAt >= 5 && v.closedAt - v.openedAt <= 360);
  const avg = (xs: ClosedVisit[]) => (xs.length ? Math.round(xs.reduce((s, v) => s + (v.closedAt - v.openedAt), 0) / xs.length) : 0);
  const buckets: TurnStats["bySize"] = (["2", "4", "6", "8+"] as const).map((b) => {
    const xs = ok.filter((v) => bucketOf(v.guests) === b);
    return { bucket: b, avg: avg(xs), count: xs.length };
  });
  return { avgTurn: avg(ok), bySize: buckets, count: ok.length };
}

export interface OccupancyInput {
  seats: number;
  covers: number;
  tables: number;
  busyTables: number;
}

export function occupancy(o: OccupancyInput) {
  return {
    seatPct: o.seats ? Math.min(100, Math.round((o.covers / o.seats) * 100)) : 0,
    tablePct: o.tables ? Math.round((o.busyTables / o.tables) * 100) : 0,
  };
}

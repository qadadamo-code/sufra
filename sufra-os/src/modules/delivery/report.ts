/** Delivery reports (pure — reports.test.ts): channels, zones, hours, times, lateness, riders, aggregator commission. */
import type { AggregatorId, Check, Order, OrderChannel } from "@/data/types";
import type { Units } from "@/lib/money";
import { commissionOf } from "./aggregators";
import { dispatchOf } from "./settings";

export interface DeliveryReport {
  orders: number;
  revenue: Units;
  byChannel: { channel: OrderChannel; count: number; revenue: Units }[];
  byZone: { zone: string; count: number; revenue: Units }[];
  byHour: number[];
  avgAcceptSec: number | null;
  avgPrepMin: number | null;
  avgRideMin: number | null;
  avgTotalMin: number | null;
  late: number;
  onTimeBase: number;
  latePct: number | null;
  rejected: number;
  failed: number;
  riders: { driverId: string; deliveries: number; avgRideMin: number | null; cash: Units; late: number; rating: number | null; ratings: number }[];
  aggregators: { id: AggregatorId; count: number; gross: Units; commission: Units; net: Units }[];
}

const mins = (a: string | null, b: string | null) => (a && b ? (Date.parse(b) - Date.parse(a)) / 60_000 : null);
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x) && x >= 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/**
 * `orders`: delivery/takeaway/online/aggregator orders of the period. `checks` by id (totals).
 * `ratings`: guest feedback stars by order id. `hourOf` maps an ISO time to the local hour (venue timezone).
 */
export function deliveryReport(orders: Order[], checks: Map<string, Pick<Check, "total">>, opts: { graceMin: number; ratings?: Map<string, number>; hourOf?: (iso: string) => number }): DeliveryReport {
  const hourOf = opts.hourOf ?? ((iso: string) => new Date(iso).getHours());
  const ch = new Map<OrderChannel, { count: number; revenue: Units }>();
  const zn = new Map<string, { count: number; revenue: Units }>();
  const ag = new Map<AggregatorId, { count: number; gross: Units; commission: Units }>();
  const rid = new Map<string, { deliveries: number; ride: (number | null)[]; cash: Units; late: number; stars: number[] }>();
  const byHour = Array.from({ length: 24 }, () => 0);
  let revenue = 0;
  let late = 0;
  let base = 0;
  let rejected = 0;
  let failed = 0;
  let n = 0;
  const accept: (number | null)[] = [];
  const prep: (number | null)[] = [];
  const ride: (number | null)[] = [];
  const total: (number | null)[] = [];
  for (const o of orders) {
    const d = dispatchOf(o);
    if (d.stage === "rejected" || (d.stage === "cancelled" && !d.acceptedAt)) {
      rejected++;
      continue;
    }
    if (o.status === "void" || d.stage === "cancelled") continue;
    if (d.stage === "failed") failed++;
    n++;
    const amount = (o.checkId ? checks.get(o.checkId)?.total : 0) ?? 0;
    revenue += amount;
    const c = ch.get(d.channel) ?? { count: 0, revenue: 0 };
    ch.set(d.channel, { count: c.count + 1, revenue: c.revenue + amount });
    const zk = d.zone ?? o.delivery?.area ?? (o.mode === "delivery" ? "—" : "takeaway");
    const z = zn.get(zk) ?? { count: 0, revenue: 0 };
    zn.set(zk, { count: z.count + 1, revenue: z.revenue + amount });
    byHour[hourOf(d.receivedAt) % 24]++;
    if (d.acceptedAt && d.receivedAt !== d.acceptedAt) accept.push(mins(d.receivedAt, d.acceptedAt)! * 60);
    prep.push(mins(d.acceptedAt, d.readyAt));
    const r = mins(d.pickedUpAt, d.deliveredAt);
    ride.push(r);
    total.push(mins(d.receivedAt, d.deliveredAt));
    let isLate = false;
    if (d.stage === "delivered" && d.promisedAt && d.deliveredAt) {
      base++;
      isLate = Date.parse(d.deliveredAt) > Date.parse(d.promisedAt) + opts.graceMin * 60_000;
      if (isLate) late++;
    }
    if (o.driverId && o.mode === "delivery" && !d.aggregator?.theirRider) {
      const x = rid.get(o.driverId) ?? { deliveries: 0, ride: [], cash: 0, late: 0, stars: [] };
      if (d.stage === "delivered") {
        x.deliveries++;
        x.ride.push(r);
        if (d.collected?.method === "cash") x.cash += d.collected.amount;
        if (isLate) x.late++;
        const s = opts.ratings?.get(o.id);
        if (s) x.stars.push(s);
      }
      rid.set(o.driverId, x);
    }
    if (d.aggregator) {
      const a = ag.get(d.aggregator.id) ?? { count: 0, gross: 0, commission: 0 };
      ag.set(d.aggregator.id, { count: a.count + 1, gross: a.gross + amount, commission: a.commission + commissionOf(amount, d.aggregator.commissionBps) });
    }
  }
  return {
    orders: n,
    revenue,
    byChannel: [...ch].map(([channel, v]) => ({ channel, ...v })).sort((a, b) => b.count - a.count),
    byZone: [...zn].map(([zone, v]) => ({ zone, ...v })).sort((a, b) => b.count - a.count),
    byHour,
    avgAcceptSec: avg(accept),
    avgPrepMin: avg(prep),
    avgRideMin: avg(ride),
    avgTotalMin: avg(total),
    late,
    onTimeBase: base,
    latePct: base ? late / base : null,
    rejected,
    failed,
    riders: [...rid]
      .map(([driverId, x]) => ({ driverId, deliveries: x.deliveries, avgRideMin: avg(x.ride), cash: x.cash, late: x.late, rating: x.stars.length ? x.stars.reduce((a, b) => a + b, 0) / x.stars.length : null, ratings: x.stars.length }))
      .sort((a, b) => b.deliveries - a.deliveries),
    aggregators: [...ag].map(([id, v]) => ({ id, ...v, net: v.gross - v.commission })).sort((a, b) => b.gross - a.gross),
  };
}

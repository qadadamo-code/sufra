/** Projected door time + lateness for a live order view (pure on top of geo/assign). */
import type { DriverLocation } from "@/data/types";
import { lateness, type Lateness } from "./assign";
import { travelMinutes } from "./geo";
import { dispatchOf } from "./settings";
import type { OrderView } from "./useDelivery";

export interface Projection {
  /** epoch ms the food reaches the customer (or the counter for takeaway) */
  at: number | null;
  /** minutes from now */
  inMin: number | null;
  late: Lateness;
  /** minutes the kitchen still needs (0 when ready) */
  prepLeftMin: number;
}

export function project(v: OrderView, cfg: { origin: { lat: number; lng: number }; speedKmh: number; lateGraceMin: number; defaultPrepMin: number }, loc: DriverLocation | null, now = Date.now()): Projection {
  const d = dispatchOf(v.order);
  const readyAt = d.readyAt ? Date.parse(d.readyAt) : d.acceptedAt ? Date.parse(d.acceptedAt) + (d.prepMin ?? cfg.defaultPrepMin) * 60_000 : now;
  const prepLeftMin = v.column === "preparing" ? Math.max(0, Math.ceil((readyAt - now) / 60_000)) : 0;
  let at: number | null = null;
  if (v.order.mode !== "delivery" || d.aggregator?.theirRider) at = Math.max(now, readyAt);
  else if (v.to) {
    if (v.column === "out") at = d.stage === "arrived" ? now : now + travelMinutes(loc ?? cfg.origin, v.to, cfg.speedKmh) * 60_000;
    else {
      const riderBack = v.column === "assigned" && loc ? travelMinutes(loc, cfg.origin, cfg.speedKmh, { handover: false }) : 0;
      at = now + Math.max(prepLeftMin, riderBack) * 60_000 + travelMinutes(cfg.origin, v.to, cfg.speedKmh) * 60_000;
    }
  }
  const done = ["delivered", "failed", "rejected", "cancelled"].includes(d.stage);
  return { at, inMin: at === null ? null : Math.max(0, Math.round((at - now) / 60_000)), late: done ? "ok" : lateness(d.promisedAt, at, now, cfg.lateGraceMin), prepLeftMin };
}

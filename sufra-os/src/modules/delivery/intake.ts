/**
 * Where online / QR orders enter the delivery workflow (called by the guest GuestService in local mode;
 * 0006_delivery.sql's guest_place_order_v2 does the same server-side).
 *
 *   - auto-accept per channel (settings.delivery.autoAccept; QR follows qrOrdering.requireWaiterConfirm)
 *   - otherwise the order waits in the inbox (`dispatch.stage = "received"`) until accepted/rejected,
 *     auto-rejected after `autoRejectMin` when nobody answers
 *   - zones come from `deliveryZones` (map editor) — the hard-coded demo list is only a fallback
 */
import type { Repo } from "@/data/repo";
import type { DeliveryZoneRow, DispatchInfo, LatLng, Order, Settings } from "@/data/types";
import type { DeliveryZone } from "@/modules/guest/data/venue";
import { autoAccepts, channelOf, deliverySettings, makeOtp, newDispatch } from "./settings";
import { geometryCenter, jitter, travelMinutes } from "./geo";

export function toGuestZone(z: DeliveryZoneRow): DeliveryZone {
  return { id: z.slug, name: z.name, fee: z.fee, minOrder: z.minOrder, etaMin: z.etaMin, etaMax: z.etaMax, freeOver: z.freeOver, geometry: z.geometry, hours: z.hours };
}

/** Active zones for a restaurant in guest shape, or null when none are configured (caller falls back). */
export async function venueZones(repo: Repo, restaurantId: string): Promise<DeliveryZone[] | null> {
  const rows = await repo.list("deliveryZones", { where: { restaurantId, active: true }, orderBy: [{ field: "sort" }] });
  return rows.length ? rows.map(toGuestZone) : null;
}

export interface Intake {
  autoFire: boolean;
  dispatch: DispatchInfo;
  /** door pin: the guest's GPS, else the zone centre (spread a little so pins don't stack) */
  door: LatLng | null;
}

export function intakeDispatch(x: { settings: Settings | null; order: Pick<Order, "id" | "source" | "mode">; zone?: DeliveryZone | null; gps?: LatLng | null; now?: number }): Intake {
  const now = x.now ?? Date.now();
  const at = new Date(now).toISOString();
  const channel = channelOf(x.order);
  const s = deliverySettings(x.settings);
  const auto = autoAccepts(channel, x.settings);
  const center = x.zone?.geometry ? geometryCenter(x.zone.geometry) : null;
  const door = x.gps ?? (center ? jitter(center, x.order.id) : null);
  if (channel === "qr") return { autoFire: auto, dispatch: newDispatch(channel, at, { stage: auto ? "accepted" : "received", acceptedAt: auto ? at : null }), door: null };
  const base = newDispatch(channel, at, { zone: x.zone?.id ?? null, otp: x.order.mode === "delivery" ? makeOtp() : null });
  if (!auto) return { autoFire: false, dispatch: { ...base, expiresAt: s.autoRejectMin > 0 ? new Date(now + s.autoRejectMin * 60_000).toISOString() : null }, door };
  const ride = x.order.mode === "delivery" ? (door ? travelMinutes(s.origin, door, s.speedKmh) : (x.zone?.etaMax ?? 30) - s.defaultPrepMin) : 0;
  return { autoFire: true, dispatch: { ...base, stage: "accepted", acceptedAt: at, prepMin: s.defaultPrepMin, promisedAt: new Date(now + (s.defaultPrepMin + Math.max(0, ride)) * 60_000).toISOString() }, door };
}

/* ───────── what the tracking page shows about the rider ───────── */

export interface DriverView {
  stage: DispatchInfo["stage"];
  driver: { name: string; phone: string | null } | null;
  position: (LatLng & { at: string; heading: number | null }) | null;
  door: LatLng | null;
  origin: LatLng;
  promisedAt: string | null;
  /** minutes to the door from the rider's last fix */
  etaMin: number | null;
  /** read to the rider at the door (shown only while the order is on its way) */
  otp: string | null;
}

/** Local-mode equivalent of the `guest_driver_view` RPC. */
export async function driverView(repo: Repo, slug: string, orderId: string): Promise<DriverView | null> {
  const [r] = await repo.list("restaurants", { where: { slug } });
  const o = r ? await repo.get("orders", orderId) : null;
  if (!r || !o || o.restaurantId !== r.id || o.mode !== "delivery") return null;
  const [settings] = await repo.list("settings", { where: { restaurantId: r.id } });
  const s = deliverySettings(settings);
  const d = o.dispatch;
  const stage = d?.stage ?? (o.deliveryStatus === "picked_up" ? "picked_up" : o.deliveryStatus === "delivered" ? "delivered" : "accepted");
  const onTheWay = stage === "picked_up" || stage === "arrived";
  const driver = o.driverId ? await repo.get("memberships", o.driverId) : null;
  const loc = onTheWay && o.driverId ? await repo.get("driverLocations", o.driverId) : null;
  const door = o.delivery?.lat != null && o.delivery?.lng != null ? { lat: o.delivery.lat, lng: o.delivery.lng } : null;
  const fresh = loc && Date.now() - Date.parse(loc.at) < 15 * 60_000;
  return {
    stage,
    driver: driver ? { name: driver.name.split(" ")[0], phone: driver.phone } : null,
    position: fresh && loc ? { lat: loc.lat, lng: loc.lng, at: loc.at, heading: loc.heading } : null,
    door,
    origin: s.origin,
    promisedAt: d?.promisedAt ?? null,
    etaMin: onTheWay && door ? (stage === "arrived" ? 0 : travelMinutes(fresh && loc ? loc : s.origin, door, s.speedKmh)) : null,
    otp: onTheWay ? (d?.otp ?? null) : null,
  };
}

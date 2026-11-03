/** Live data for the delivery screens (today's online/delivery/takeaway orders, riders, shifts, positions, zones). */
import { useEffect, useMemo, useState } from "react";
import { useLive } from "@/data/hooks";
import type { Check, Customer, DeliveryZoneRow, DriverLocation, DriverShift, LatLng, Membership, Order, OrderItem, Settings } from "@/data/types";
import { startOfDay } from "@/lib/time";
import { deliverySettings, dispatchOf } from "./settings";
import { columnOf, type Column } from "./stages";
import { geometryCenter, jitter, zoneFor } from "./geo";
import type { DriverState } from "./assign";

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Orders this workflow cares about: anything not dine-in, plus QR orders still waiting for a waiter. */
export const isDeliveryish = (o: Order) => o.mode !== "dine_in" || o.source === "qr";

export interface OrderView {
  order: Order;
  items: OrderItem[];
  check: Check | null;
  customer: Customer | null;
  column: Column;
  /** door pin (GPS, or the zone centre) */
  to: LatLng | null;
  approx: boolean;
  /** amount the rider collects at the door (0 = paid) */
  due: number;
  driver: Membership | null;
}

export interface DeliveryData {
  loading: boolean;
  settings: Settings | null;
  cfg: ReturnType<typeof deliverySettings>;
  views: OrderView[];
  byId: Map<string, OrderView>;
  /** waiting for accept: online/phone in the inbox + QR waiting for the waiter */
  inbox: OrderView[];
  qrWaiting: OrderView[];
  drivers: Membership[];
  shifts: DriverShift[];
  locations: Map<string, DriverLocation>;
  zones: DeliveryZoneRow[];
  driverStates: DriverState[];
}

export function useDeliveryData(opts: { days?: number } = {}): DeliveryData {
  const since = useMemo(() => {
    const d = startOfDay();
    d.setDate(d.getDate() - (opts.days ?? 0));
    return d.toISOString();
  }, [opts.days]);
  const orders = useLive("orders", { gte: { openedAt: since }, orderBy: [{ field: "openedAt", dir: "desc" }] });
  const list = useMemo(() => orders.data.filter(isDeliveryish), [orders.data]);
  const ids = useMemo(() => list.map((o) => o.id), [list]);
  const checkIds = useMemo(() => [...new Set(list.map((o) => o.checkId).filter((x): x is string => !!x))], [list]);
  const custIds = useMemo(() => [...new Set(list.map((o) => o.customerId).filter((x): x is string => !!x))], [list]);
  const items = useLive("orderItems", { where: { orderId: ids } }, { enabled: ids.length > 0 });
  const checks = useLive("checks", { where: { id: checkIds } }, { enabled: checkIds.length > 0 });
  const customers = useLive("customers", { where: { id: custIds } }, { enabled: custIds.length > 0 });
  const staff = useLive("memberships", { where: { role: "delivery", active: true }, orderBy: [{ field: "name" }] });
  const shifts = useLive("driverShifts", { gte: { startedAt: new Date(Date.parse(since) - 86_400_000).toISOString() }, orderBy: [{ field: "startedAt", dir: "desc" }] });
  const locs = useLive("driverLocations");
  const zones = useLive("deliveryZones", { orderBy: [{ field: "sort" }] });
  const settings = useLive("settings");

  return useMemo(() => {
    const s = settings.data[0] ?? null;
    const cfg = deliverySettings(s);
    const itemsBy = new Map<string, OrderItem[]>();
    for (const i of items.data) (itemsBy.get(i.orderId) ?? itemsBy.set(i.orderId, []).get(i.orderId)!).push(i);
    const checkBy = new Map(checks.data.map((c) => [c.id, c]));
    const custBy = new Map(customers.data.map((c) => [c.id, c]));
    const staffBy = new Map(staff.data.map((m) => [m.id, m]));
    const zoneBy = new Map(zones.data.map((z) => [z.slug, z]));
    const views: OrderView[] = list.map((order) => {
      const its = itemsBy.get(order.id) ?? [];
      const check = order.checkId ? (checkBy.get(order.checkId) ?? null) : null;
      const d = dispatchOf(order);
      let to: LatLng | null = order.delivery?.lat != null && order.delivery?.lng != null ? { lat: order.delivery.lat, lng: order.delivery.lng } : null;
      let approx = false;
      if (!to && order.mode === "delivery" && !d.aggregator?.theirRider) {
        const z = (d.zone && zoneBy.get(d.zone)) || zones.data.find((x) => x.name.ar === order.delivery?.area || x.name.en === order.delivery?.area);
        const c = z ? geometryCenter(z.geometry) : null;
        if (c) {
          to = jitter(c, order.id);
          approx = true;
        }
      }
      return { order, items: its, check, customer: order.customerId ? (custBy.get(order.customerId) ?? null) : null, column: order.source === "qr" ? "done" : columnOf(order, its), to, approx, due: check ? Math.max(0, check.total - check.paid) : 0, driver: order.driverId ? (staffBy.get(order.driverId) ?? null) : null };
    });
    const byId = new Map(views.map((v) => [v.order.id, v]));
    const inbox = views.filter((v) => v.order.source !== "qr" && v.order.status !== "void" && dispatchOf(v.order).stage === "received").sort((a, b) => a.order.openedAt.localeCompare(b.order.openedAt));
    const qrWaiting = views.filter((v) => v.order.source === "qr" && v.order.status === "open" && v.items.some((i) => i.status === "new"));
    const locations = new Map(locs.data.map((l) => [l.driverId, l]));
    const onShift = new Set(shifts.data.filter((x) => x.status === "on").map((x) => x.driverId));
    const driverStates: DriverState[] = staff.data.map((m) => {
      const loc = locations.get(m.id) ?? null;
      return {
        id: m.id, name: m.name, onShift: onShift.has(m.id), location: loc ? { lat: loc.lat, lng: loc.lng } : null, locationAt: loc?.at ?? null,
        load: views.filter((v) => v.order.driverId === m.id && ["assigned", "out"].includes(v.column)).map((v) => ({ orderId: v.order.id, state: v.column === "out" ? ("out" as const) : ("assigned" as const), to: v.to })),
      };
    });
    return { loading: orders.loading, settings: s, cfg, views, byId, inbox, qrWaiting, drivers: staff.data, shifts: shifts.data, locations, zones: zones.data, driverStates };
  }, [list, items.data, checks.data, customers.data, staff.data, shifts.data, locs.data, zones.data, settings.data, orders.loading]);
}

/** Zone slug for a picked point (phone orders / checkout "use my location"). */
export const zoneSlugAt = (p: LatLng, zones: DeliveryZoneRow[]) => zoneFor(p, zones)?.slug ?? null;

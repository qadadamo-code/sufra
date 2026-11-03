/** Delivery settings defaults (settings.delivery is optional — older rows fall back to these). */
import type { DeliverySettings, DispatchInfo, Order, OrderChannel, Settings } from "@/data/types";

/** Brazil St, Zamalek — the demo kitchen door. */
export const DEMO_ORIGIN = { lat: 30.0626, lng: 31.2179 };

export const DEFAULT_DELIVERY: DeliverySettings = {
  autoAccept: { online_delivery: false, online_takeaway: false, phone: true, aggregator: true },
  autoRejectMin: 8,
  defaultPrepMin: 20,
  speedKmh: 22,
  lateGraceMin: 10,
  proof: "either",
  batchRadiusKm: 1.2,
  maxBatch: 3,
  sound: true,
  origin: DEMO_ORIGIN,
};

export function deliverySettings(s: Pick<Settings, "delivery"> | null | undefined): DeliverySettings {
  const d = s?.delivery;
  return { ...DEFAULT_DELIVERY, ...(d ?? {}), autoAccept: { ...DEFAULT_DELIVERY.autoAccept, ...(d?.autoAccept ?? {}) }, origin: d?.origin ?? DEFAULT_DELIVERY.origin };
}

/** Which inbox channel an order belongs to. */
export function channelOf(o: Pick<Order, "source" | "mode">): OrderChannel {
  if (o.source === "qr") return "qr";
  if (o.source === "aggregator") return "aggregator";
  if (o.source === "phone") return "phone";
  if (o.source === "online") return o.mode === "delivery" ? "online_delivery" : "online_takeaway";
  return "pos";
}

/** Does this channel skip the inbox? QR follows the waiter-confirm setting. */
export function autoAccepts(channel: OrderChannel, s: Pick<Settings, "delivery" | "qrOrdering"> | null | undefined): boolean {
  if (channel === "pos") return true;
  if (channel === "qr") return !(s?.qrOrdering?.requireWaiterConfirm ?? true);
  return deliverySettings(s).autoAccept[channel];
}

export function newDispatch(channel: OrderChannel, at: string, patch: Partial<DispatchInfo> = {}): DispatchInfo {
  return {
    stage: "received", channel, receivedAt: at, expiresAt: null, acceptedAt: null, acceptedBy: null, prepMin: null, promisedAt: null, readyAt: null,
    assignedAt: null, pickedUpAt: null, arrivedAt: null, deliveredAt: null, failedAt: null, failReason: null, rejectReason: null, otp: null, proof: null,
    collected: null, driverShiftId: null, batchId: null, zone: null, aggregator: null, delayedAt: null, ...patch,
  };
}

/** Orders made before 0006 (or straight from the POS) have no dispatch: they count as accepted when they were opened. */
export function dispatchOf(o: Order): DispatchInfo {
  if (o.dispatch) return o.dispatch;
  const stage = o.status === "void" ? "cancelled" : o.deliveryStatus === "delivered" ? "delivered" : o.deliveryStatus === "failed" ? "failed" : o.deliveryStatus === "picked_up" ? "picked_up" : o.driverId ? "assigned" : "accepted";
  return newDispatch(channelOf(o), o.openedAt, { stage, acceptedAt: o.openedAt });
}

/** 4-digit delivery code (not a secret — it proves the rider was at the door). */
export function makeOtp(rand: () => number = Math.random): string {
  return String(Math.floor(rand() * 9000) + 1000);
}

/**
 * What the guest sees as "where is my order", derived from order + item statuses (pure, tested).
 *
 * Table (QR):   received → preparing → ready → served
 * Takeaway:     received → accepted → preparing → ready → picked_up
 * Delivery:     received → accepted → preparing → ready → out_for_delivery → delivered
 * Any:          cancelled (order void)
 *
 * "received" with a waiter-confirm restaurant means the waiter still has to approve the QR order.
 */
import type { DeliveryStatus, OrderItemStatus, OrderMode, OrderStatus } from "@/data/types";

export type Stage = "received" | "accepted" | "preparing" | "ready" | "served" | "picked_up" | "out_for_delivery" | "delivered" | "cancelled";

export function pipeline(mode: OrderMode, qr: boolean): Stage[] {
  if (qr || mode === "dine_in") return ["received", "preparing", "ready", "served"];
  if (mode === "takeaway") return ["received", "accepted", "preparing", "ready", "picked_up"];
  return ["received", "accepted", "preparing", "ready", "out_for_delivery", "delivered"];
}

export function stageOf(o: { mode: OrderMode; status: OrderStatus; deliveryStatus: DeliveryStatus | null; qr: boolean }, items: { status: OrderItemStatus }[]): Stage {
  if (o.status === "void") return "cancelled";
  const live = items.filter((i) => i.status !== "void");
  if (!live.length) return items.length ? "cancelled" : "received";
  const dineIn = o.qr || o.mode === "dine_in";
  if (o.mode === "delivery") {
    if (o.deliveryStatus === "delivered" || o.status === "closed") return "delivered";
    if (o.deliveryStatus === "picked_up") return "out_for_delivery";
  }
  if (o.mode === "takeaway" && !o.qr && (o.status === "closed" || o.status === "served" || live.every((i) => i.status === "served"))) return "picked_up";
  if (dineIn && live.every((i) => i.status === "served")) return "served";
  if (live.every((i) => i.status === "ready" || i.status === "served")) return "ready";
  if (live.some((i) => i.status === "preparing" || i.status === "ready" || i.status === "served")) return "preparing";
  if (live.some((i) => i.status === "sent")) return dineIn ? "preparing" : "accepted";
  return "received";
}

/** index in the pipeline (cancelled = -1) */
export const stageIndex = (stages: Stage[], s: Stage) => stages.indexOf(s);

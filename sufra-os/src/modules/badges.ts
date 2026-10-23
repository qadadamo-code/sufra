/** Live nav badge hooks shared by stub modules (real modules may define their own). */
import { useLive } from "@/data/hooks";
import { startOfDay } from "@/lib/time";

export function useOpenCalls() {
  return useLive("serviceCalls", { where: { status: "open" } }).data.length || null;
}
export function useKitchenQueue() {
  return useLive("orderItems", { where: { status: ["sent", "preparing"] } }).data.length || null;
}
export function useActiveOrders() {
  return useLive("orders", { where: { status: ["open", "sent", "ready", "served"] } }).data.length || null;
}
export function usePendingDeliveries() {
  return useLive("orders", { where: { mode: "delivery", deliveryStatus: ["pending", "assigned"] } }).data.length || null;
}
export function usePendingReservations() {
  return useLive("reservations", { where: { status: "pending" }, gte: { startsAt: startOfDay().toISOString() } }).data.length || null;
}

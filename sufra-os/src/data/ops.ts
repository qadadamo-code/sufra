/**
 * Shared domain operations on top of the Repo. Modules add their own (POS: payments, splits…),
 * but anything two modules need lives here so the rules stay in one place.
 */
import { nowIso, startOfDay } from "@/lib/time";
import type { Db } from "./hooks";
import { priceItems, type CheckTotals } from "./pricing";
import type { OrderItemStatus, ServiceCall, TableStatus } from "./types";

export async function ackServiceCall(db: Db, call: Pick<ServiceCall, "id">) {
  return db.update("serviceCalls", call.id, { status: "ack", ackBy: db.actorId, ackAt: nowIso() });
}
export async function resolveServiceCall(db: Db, call: Pick<ServiceCall, "id">) {
  return db.update("serviceCalls", call.id, { status: "done", doneAt: nowIso(), ...(db.actorId ? { ackBy: db.actorId } : {}) });
}

export async function setTableStatus(db: Db, tableId: string, status: TableStatus) {
  return db.update("tables", tableId, { status, statusSince: nowIso() });
}

const ITEM_TIMESTAMP: Partial<Record<OrderItemStatus, "firedAt" | "readyAt" | "servedAt">> = { sent: "firedAt", ready: "readyAt", served: "servedAt" };

export async function setItemStatus(db: Db, itemId: string, status: OrderItemStatus) {
  const ts = ITEM_TIMESTAMP[status];
  return db.update("orderItems", itemId, { status, ...(ts ? { [ts]: nowIso() } : {}) });
}

/** Recompute and store a check's totals from its live items (via @finance/tax). */
export async function recomputeCheck(db: Db, checkId: string): Promise<CheckTotals | null> {
  const [check] = await db.list("checks", { where: { id: checkId } });
  const [settings] = await db.list("settings");
  if (!check || !settings) return null;
  const orders = await db.list("orders", { where: { checkId } });
  const items = orders.length ? await db.list("orderItems", { where: { orderId: orders.map((o) => o.id) } }) : [];
  const vatExempt = new Set((await db.list("menuItems", { where: { vatExempt: true } })).map((m) => m.id));
  const { totals } = priceItems(items, { mode: orders[0]?.mode ?? "dine_in", tax: settings.tax, discount: check.discount, deliveryFee: orders[0]?.deliveryFee, vatExemptItemIds: vatExempt });
  await db.update("checks", checkId, { subtotal: totals.subtotal, discountTotal: totals.discountTotal, service: totals.service, vat: totals.vat, total: totals.total });
  return totals;
}

/** Next daily order number for a branch. (Supabase: the `next_order_number` SQL function is authoritative.) */
export async function nextOrderNumber(db: Db, branchId: string) {
  const today = await db.list("orders", { where: { branchId }, gte: { openedAt: startOfDay().toISOString() } });
  return today.reduce((m, o) => Math.max(m, o.number), 0) + 1;
}

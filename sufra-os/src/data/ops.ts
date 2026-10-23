/**
 * Shared domain operations on top of the Repo. Modules add their own (POS: payments, splits…),
 * but anything two modules need lives here so the rules stay in one place.
 */
import { nowIso, startOfDay } from "@/lib/time";
import type { Db } from "./hooks";
import { priceItems, type CheckTotals } from "./pricing";
import type { Check, Order, OrderItemStatus, OrderMode, OrderSource, ServiceCall, TableStatus } from "./types";

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

const ACTIVE_ORDER: Order["status"][] = ["open", "sent", "ready", "served"];

/**
 * The order new lines go into for a check: its most recent still-active order (e.g. the empty dine-in order the floor
 * creates when seating, carrying the waiter), or a new one when there is none. POS and the waiter app both use this,
 * so a table never ends up with a second order just because someone else added the next round.
 */
export async function activeOrderFor(
  db: Db,
  check: Pick<Check, "id" | "branchId" | "tableIds" | "guests" | "customerId">,
  init: { source: OrderSource; mode?: OrderMode; tableId?: string | null; status?: Order["status"] } = { source: "pos" },
): Promise<Order> {
  const all = await db.list("orders", { where: { checkId: check.id, status: ACTIVE_ORDER }, orderBy: [{ field: "openedAt", dir: "desc" }] });
  const hit = (init.tableId ? all.find((o) => o.tableIds.includes(init.tableId!)) : null) ?? all[0];
  if (hit) return hit;
  const t = nowIso();
  const mode = init.mode ?? "dine_in";
  return db.insert("orders", {
    branchId: check.branchId, number: await nextOrderNumber(db, check.branchId), mode, source: init.source, status: init.status ?? "open",
    tableIds: mode === "dine_in" ? (init.tableId ? [init.tableId] : check.tableIds) : [], checkId: check.id, customerId: check.customerId, guests: check.guests,
    openedBy: db.actorId, waiterId: init.source === "waiter" ? db.actorId : null, note: "", delivery: null, deliveryStatus: null, driverId: null, deliveryFee: 0,
    openedAt: t, closedAt: null,
  });
}

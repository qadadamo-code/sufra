/** Kitchen writes (KDS + waiter "mark served"). Pure rules live in kds.ts. */
import type { Db } from "@/data/hooks";
import type { OrderItem, OrderPriority } from "@/data/types";
import { nowIso } from "@/lib/time";
import { deriveOrderStatus, patchesFor, type KdsAction } from "./kds";

/** Apply a KDS action to some items; returns the ids that changed. Order statuses follow. */
export async function applyAction(db: Db, items: Pick<OrderItem, "id" | "status" | "firedAt" | "orderId">[], action: KdsAction): Promise<string[]> {
  const at = nowIso();
  const patches = patchesFor(items, action, at);
  if (!patches.length) return [];
  await Promise.all(patches.map((p) => db.update("orderItems", p.id, p.patch)));
  const orderIds = [...new Set(items.filter((i) => patches.some((p) => p.id === i.id)).map((i) => i.orderId))];
  await syncOrders(db, orderIds);
  if (action === "recall") void db.audit("kitchen.recall", "orderItems", null, { items: patches.map((p) => p.id) });
  return patches.map((p) => p.id);
}

/** Recompute order.status from its items (sent → ready → served). */
export async function syncOrders(db: Db, orderIds: string[]) {
  if (!orderIds.length) return;
  const [orders, items] = await Promise.all([db.list("orders", { where: { id: orderIds } }), db.list("orderItems", { where: { orderId: orderIds } })]);
  await Promise.all(
    orders.map((o) => {
      const next = deriveOrderStatus(
        items.filter((i) => i.orderId === o.id),
        o.status,
      );
      return next !== o.status ? db.update("orders", o.id, { status: next }) : null;
    }),
  );
}

/** 86 / un-86: the item disappears from POS, waiter app and QR menu everywhere, live. */
export async function setAvailability(db: Db, menuItemId: string, available: boolean) {
  await db.update("menuItems", menuItemId, { available });
  void db.audit(available ? "menu.un86" : "menu.86", "menuItems", menuItemId, {});
}

export async function setPriority(db: Db, orderId: string, priority: OrderPriority) {
  await db.update("orders", orderId, { priority });
}

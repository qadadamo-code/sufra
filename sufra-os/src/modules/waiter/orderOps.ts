/**
 * Waiter-side order writes: seat, send a round to the kitchen, fire held courses, confirm a QR order,
 * request the bill, claim a table. Shared rules (check totals, item status) come from src/data/ops.ts
 * and the kitchen module so the POS, KDS and waiter app agree.
 */
import type { Db } from "@/data/hooks";
import { activeOrderFor, recomputeCheck, resolveServiceCall } from "@/data/ops";
import type { Check, DiningTable, MenuCategory, MenuItem, Modifier, Order, OrderItem } from "@/data/types";
import { nowIso } from "@/lib/time";
import { syncOrders } from "@/modules/kitchen/ops";

export interface CartLine {
  key: string;
  item: Pick<MenuItem, "id" | "name" | "price" | "stationId" | "categoryId">;
  qty: number;
  modifiers: Pick<Modifier, "id" | "groupId" | "name" | "price">[];
  notes: string;
  seat: number | null;
  course: number;
}

export const lineTotal = (l: Pick<CartLine, "qty" | "modifiers" | "item">) => l.qty * (l.item.price + l.modifiers.reduce((a, m) => a + m.price, 0));


/** The table's open check (creating one when the table has none). */
export async function ensureCheck(db: Db, table: Pick<DiningTable, "id" | "branchId">, guests: number): Promise<Check> {
  const open = await db.list("checks", { where: { status: ["open", "bill_requested"] }, contains: { tableIds: table.id }, orderBy: [{ field: "openedAt", dir: "desc" }] });
  if (open[0]) return open[0];
  const t = nowIso();
  return db.insert("checks", {
    branchId: table.branchId, tableIds: [table.id], status: "open", guests, reservationId: null, customerId: null, discount: null, discountApprovedBy: null,
    subtotal: 0, discountTotal: 0, service: 0, vat: 0, total: 0, paid: 0, receiptNo: null, etaUuid: null, openedAt: t, closedAt: null,
  });
}

export async function seatTable(db: Db, table: Pick<DiningTable, "id" | "branchId">, guests: number) {
  const check = await ensureCheck(db, table, guests);
  if (check.guests !== guests) await db.update("checks", check.id, { guests });
  await db.update("tables", table.id, { status: "seated", statusSince: nowIso(), ...(db.actorId ? { waiterId: db.actorId } : {}) });
  return check;
}

/** Send a round. Lines in later courses are held ("new") when `holdLater`; course 1 (or the lowest) fires now. */
export async function sendRound(
  db: Db,
  input: { table: Pick<DiningTable, "id" | "branchId" | "status">; lines: CartLine[]; guests: number; categories: Pick<MenuCategory, "id" | "stationId">[]; holdLater: boolean },
): Promise<Order> {
  const { table, lines, guests, categories, holdLater } = input;
  if (!lines.length) throw new Error("empty");
  const t = nowIso();
  const check = await ensureCheck(db, table, guests);
  // reuse the check's active order (e.g. the empty one the floor made when seating) — shared with the POS
  const order = await activeOrderFor(db, check, { source: "waiter", tableId: table.id });
  const existing = order;
  const stationOfCat = new Map(categories.map((c) => [c.id, c.stationId]));
  const firstCourse = Math.min(...lines.map((l) => l.course));
  const rows: Omit<OrderItem, "id" | "createdAt" | "updatedAt" | "restaurantId">[] = lines.map((l) => {
    const fire = !holdLater || l.course <= firstCourse;
    return {
      orderId: order.id, itemId: l.item.id, name: l.item.name, qty: l.qty, unitPrice: l.item.price,
      modifiers: l.modifiers.map((m) => ({ groupId: m.groupId, modifierId: m.id, name: m.name, price: m.price })),
      notes: l.notes.trim(), seat: l.seat, course: l.course, status: fire ? "sent" : "new",
      stationId: l.item.stationId ?? stationOfCat.get(l.item.categoryId) ?? null, originTableId: table.id, discount: 0,
      firedAt: fire ? t : null, readyAt: null, servedAt: null, voidReason: null, voidedBy: null, createdBy: db.actorId,
    };
  });
  for (const r of rows) await db.insert("orderItems", r);
  if (!existing?.waiterId && db.actorId) await db.update("orders", order.id, { waiterId: db.actorId });
  await syncOrders(db, [order.id]);
  await recomputeCheck(db, check.id);
  if (table.status !== "ordered" && table.status !== "bill") await db.update("tables", table.id, { status: "ordered", statusSince: t });
  void db.audit("waiter.send", "orders", order.id, { lines: rows.length, held: rows.filter((r) => r.status === "new").length });
  return order;
}

/** Fire held items (a course, or a confirmed QR order). */
export async function fireItems(db: Db, items: Pick<OrderItem, "id" | "orderId" | "status">[]) {
  const t = nowIso();
  const held = items.filter((i) => i.status === "new");
  await Promise.all(held.map((i) => db.update("orderItems", i.id, { status: "sent", firedAt: t })));
  await syncOrders(db, [...new Set(held.map((i) => i.orderId))]);
}

/** A QR order confirmed by the waiter: take ownership and fire it. */
export async function confirmQrOrder(db: Db, order: Pick<Order, "id" | "waiterId">, items: Pick<OrderItem, "id" | "orderId" | "status" | "course">[]) {
  if (!order.waiterId && db.actorId) await db.update("orders", order.id, { waiterId: db.actorId });
  const first = Math.min(...items.filter((i) => i.status === "new").map((i) => i.course));
  await fireItems(db, items.filter((i) => i.course <= first));
}

export async function requestBill(db: Db, table: Pick<DiningTable, "id">, check: Pick<Check, "id"> | null) {
  if (check) await db.update("checks", check.id, { status: "bill_requested" });
  await db.update("tables", table.id, { status: "bill", statusSince: nowIso() });
  // a guest's "bill please" call is now handled
  const calls = await db.list("serviceCalls", { where: { tableId: table.id, type: "bill", status: ["open", "ack"] } });
  await Promise.all(calls.map((c) => resolveServiceCall(db, c)));
}

export async function claimTable(db: Db, table: Pick<DiningTable, "id">, waiterId: string | null) {
  await db.update("tables", table.id, { waiterId });
}

export async function markTableClean(db: Db, table: Pick<DiningTable, "id">) {
  await db.update("tables", table.id, { status: "free", statusSince: nowIso() });
}

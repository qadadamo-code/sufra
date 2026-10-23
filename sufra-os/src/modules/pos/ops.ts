/**
 * POS ticket operations on the data layer. Every write goes through Db (scoped to the restaurant), so the floor, the
 * kitchen display and other tablets see each change live. Totals are always recomputed with @finance/tax.
 */
import type { Db } from "@/data/hooks";
import { nextOrderNumber, recomputeCheck, setTableStatus } from "@/data/ops";
import type { Check, Discount, MenuCategory, MenuItem, Modifier, Order, OrderItem, OrderItemModifier, OrderMode, OrderSource } from "@/data/types";
import { nowIso } from "@/lib/time";
import { sameLine, sendableItems } from "./math";

export interface TicketDraft {
  mode: OrderMode;
  pickup: boolean;
  tableIds: string[];
  guests: number;
  customerId: string | null;
  deliveryFee: number;
  delivery: Order["delivery"];
  pickupAt: string | null;
  source?: OrderSource;
}

export interface Ticket {
  check: Check;
  orders: Order[];
  items: OrderItem[];
}

async function branchOf(db: Db) {
  if (db.branchId) return db.branchId;
  const [b] = await db.list("branches", { where: { isDefault: true } });
  if (!b) throw new Error("no branch");
  return b.id;
}

/** Opens a check with its first order (lazily, on the first item). */
export async function openTicket(db: Db, d: TicketDraft): Promise<{ check: Check; order: Order }> {
  const branchId = await branchOf(db);
  const now = nowIso();
  const check = await db.insert("checks", {
    branchId, tableIds: d.mode === "dine_in" ? d.tableIds : [], status: "open", guests: d.guests, reservationId: null, customerId: d.customerId,
    discount: null, discountApprovedBy: null, discountReason: null, splitFrom: null, subtotal: 0, discountTotal: 0, service: 0, vat: 0, total: 0, paid: 0,
    receiptNo: null, etaUuid: null, openedAt: now, closedAt: null,
  });
  const order = await db.insert("orders", {
    branchId, number: await nextOrderNumber(db, branchId), mode: d.mode, source: d.source ?? "pos", status: "open", tableIds: d.mode === "dine_in" ? d.tableIds : [],
    checkId: check.id, customerId: d.customerId, guests: d.guests, openedBy: db.actorId, waiterId: null, note: "", delivery: d.mode === "delivery" ? d.delivery : null,
    deliveryStatus: d.mode === "delivery" ? "pending" : null, driverId: null, deliveryFee: d.mode === "delivery" ? d.deliveryFee : 0, openedAt: now, closedAt: null,
    pickupAt: d.pickup ? d.pickupAt : null,
  });
  if (d.mode === "dine_in") for (const t of d.tableIds) await setTableStatus(db, t, "seated");
  await db.audit("check.open", "checks", check.id, { mode: d.mode, tables: d.tableIds });
  return { check, order };
}

export async function loadTicket(db: Db, checkId: string): Promise<Ticket | null> {
  const check = await db.get("checks", checkId);
  if (!check) return null;
  const orders = await db.list("orders", { where: { checkId }, orderBy: [{ field: "openedAt" }] });
  const items = orders.length ? await db.list("orderItems", { where: { orderId: orders.map((o) => o.id) }, orderBy: [{ field: "createdAt" }] }) : [];
  return { check, orders, items };
}

export const stationFor = (item: MenuItem, cats: MenuCategory[]) => item.stationId ?? cats.find((c) => c.id === item.categoryId)?.stationId ?? null;

export interface LineInput {
  item: MenuItem;
  modifiers: Modifier[];
  qty: number;
  notes: string;
  seat: number | null;
  course: number;
}

/** Adds a line (or bumps the qty of an identical unsent one). */
export async function addLine(db: Db, t: { orderId: string; checkId: string; items: OrderItem[]; tableId: string | null }, x: LineInput, cats: MenuCategory[]) {
  const mods: OrderItemModifier[] = x.modifiers.map((m) => ({ groupId: m.groupId, modifierId: m.id, name: m.name, price: m.price }));
  const probe = { itemId: x.item.id, modifiers: mods, notes: x.notes.trim(), seat: x.seat, course: x.course, status: "new" as const, discount: 0 };
  const same = t.items.find((i) => sameLine(i, probe));
  let row: OrderItem;
  if (same) row = await db.update("orderItems", same.id, { qty: same.qty + x.qty });
  else
    row = await db.insert("orderItems", {
      orderId: t.orderId, itemId: x.item.id, name: x.item.name, qty: x.qty, unitPrice: x.item.price, modifiers: mods, notes: probe.notes, seat: x.seat,
      course: x.course, status: "new", stationId: stationFor(x.item, cats), originTableId: t.tableId, discount: 0, firedAt: null, readyAt: null, servedAt: null,
      voidReason: null, voidedBy: null, createdBy: db.actorId,
    });
  await recomputeCheck(db, t.checkId);
  return row;
}

export async function setLineQty(db: Db, checkId: string, it: OrderItem, qty: number) {
  if (it.status !== "new") throw new Error("sent lines change through void");
  if (qty <= 0) await db.remove("orderItems", it.id);
  else await db.update("orderItems", it.id, { qty, discount: Math.min(it.discount, it.unitPrice * qty) });
  await recomputeCheck(db, checkId);
}

export async function updateLine(db: Db, checkId: string, it: OrderItem, patch: Partial<Pick<OrderItem, "notes" | "seat" | "course" | "discount">>) {
  await db.update("orderItems", it.id, patch);
  await recomputeCheck(db, checkId);
}

/** Before the kitchen saw it: just remove. After: mark void with a reason (needs approval upstream). */
export async function voidLine(db: Db, checkId: string, it: OrderItem, reason: string, approvedBy: string | null) {
  if (it.status === "new") {
    await db.remove("orderItems", it.id);
  } else {
    await db.update("orderItems", it.id, { status: "void", voidReason: reason, voidedBy: approvedBy ?? db.actorId });
    await db.audit("order.void", "orderItems", it.id, { item: it.name.en, qty: it.qty, reason }, approvedBy);
  }
  await recomputeCheck(db, checkId);
}

/** Fires every sendable line (course 1 + fired courses), or one held course. Kitchen displays pick them up live. */
export async function sendToKitchen(db: Db, t: Ticket, course?: number): Promise<number> {
  const list = course == null ? sendableItems(t.items) : t.items.filter((i) => i.status === "new" && i.course === course);
  const at = nowIso();
  for (const i of list) await db.update("orderItems", i.id, { status: "sent", firedAt: at });
  if (list.length) {
    const orderIds = new Set(list.map((i) => i.orderId));
    for (const o of t.orders) if (orderIds.has(o.id) && (o.status === "open" || o.status === "ready" || o.status === "served")) await db.update("orders", o.id, { status: "sent" });
    for (const tid of t.check.tableIds) await setTableStatus(db, tid, "ordered");
    await db.audit(course == null ? "order.send" : "order.fire_course", "checks", t.check.id, { items: list.length, course: course ?? null });
  }
  return list.length;
}

export async function setBillDiscount(db: Db, checkId: string, d: Discount | null, reason: string | null, approvedBy: string | null) {
  await db.update("checks", checkId, { discount: d, discountReason: d ? reason : null, discountApprovedBy: d ? approvedBy : null });
  await db.audit(d ? "check.discount" : "check.discount_removed", "checks", checkId, { discount: d, reason }, approvedBy);
  return recomputeCheck(db, checkId);
}

export async function setLineDiscount(db: Db, checkId: string, it: OrderItem, units: number, reason: string, approvedBy: string | null) {
  await db.update("orderItems", it.id, { discount: units });
  await db.audit("item.discount", "orderItems", it.id, { units, reason }, approvedBy);
  return recomputeCheck(db, checkId);
}

/** First order of a check, creating one when the check has none (e.g. a fresh split). */
async function orderFor(db: Db, check: Check, like: Order) {
  const [o] = await db.list("orders", { where: { checkId: check.id }, orderBy: [{ field: "openedAt" }], limit: 1 });
  if (o) return o;
  return db.insert("orders", {
    ...stripRow(like), number: await nextOrderNumber(db, like.branchId), checkId: check.id, tableIds: check.tableIds, status: "open", openedAt: nowIso(), closedAt: null, openedBy: db.actorId,
  });
}

const stripRow = <T extends { id: string; createdAt: string; updatedAt: string; restaurantId: string }>(r: T) => {
  const { id: _i, createdAt: _c, updatedAt: _u, restaurantId: _r, ...rest } = r;
  return rest;
};

/** Moves lines (optionally part of a line's qty) onto another check. */
export async function moveItems(db: Db, from: Ticket, to: Check, moves: { itemId: string; qty: number }[]) {
  const target = await orderFor(db, to, from.orders[0]);
  for (const mv of moves) {
    const it = from.items.find((i) => i.id === mv.itemId);
    if (!it || mv.qty <= 0) continue;
    if (mv.qty >= it.qty) await db.update("orderItems", it.id, { orderId: target.id });
    else {
      const share = Math.round((it.discount * mv.qty) / it.qty);
      await db.update("orderItems", it.id, { qty: it.qty - mv.qty, discount: it.discount - share });
      await db.insert("orderItems", { ...stripRow(it), orderId: target.id, qty: mv.qty, discount: share });
    }
  }
  await recomputeCheck(db, from.check.id);
  await recomputeCheck(db, to.id);
}

/** Split: each group becomes a new check (same mode/table), the rest stays. */
export async function splitIntoChecks(db: Db, t: Ticket, groups: { itemId: string; qty: number }[][]): Promise<Check[]> {
  const out: Check[] = [];
  for (const g of groups) {
    if (!g.length) continue;
    const c = await db.insert("checks", {
      ...stripRow(t.check), status: "open", discount: t.check.discount, discountApprovedBy: t.check.discountApprovedBy, discountReason: t.check.discountReason ?? null,
      splitFrom: t.check.id, subtotal: 0, discountTotal: 0, service: 0, vat: 0, total: 0, paid: 0, receiptNo: null, etaUuid: null, openedAt: nowIso(), closedAt: null,
    });
    const fresh = (await loadTicket(db, t.check.id))!;
    await moveItems(db, fresh, c, g);
    out.push(c);
  }
  await db.audit("check.split", "checks", t.check.id, { into: out.map((c) => c.id) });
  return out;
}

/** Merge `from` into `into`: orders move, tables join, `from` is voided. */
export async function mergeChecks(db: Db, into: Check, from: Check) {
  const orders = await db.list("orders", { where: { checkId: from.id } });
  for (const o of orders) await db.update("orders", o.id, { checkId: into.id });
  const tables = [...new Set([...into.tableIds, ...from.tableIds])];
  await db.update("checks", into.id, { tableIds: tables, guests: into.guests + from.guests });
  await db.update("checks", from.id, { status: "void", closedAt: nowIso() });
  await recomputeCheck(db, into.id);
  await db.audit("check.merge", "checks", into.id, { from: from.id });
}

/** Move a whole check to another table. */
export async function moveCheckToTable(db: Db, t: Ticket, tableId: string) {
  const old = t.check.tableIds;
  await db.update("checks", t.check.id, { tableIds: [tableId] });
  for (const o of t.orders) await db.update("orders", o.id, { tableIds: [tableId] });
  for (const tid of old) if (tid !== tableId) await setTableStatus(db, tid, "dirty");
  await setTableStatus(db, tableId, t.items.some((i) => i.status !== "new") ? "ordered" : "seated");
  await db.audit("check.transfer_table", "checks", t.check.id, { from: old, to: tableId });
}

export async function setTicketMeta(db: Db, t: Ticket, patch: { guests?: number; customerId?: string | null; delivery?: Order["delivery"]; deliveryFee?: number; note?: string }) {
  if (patch.guests != null || patch.customerId !== undefined) await db.update("checks", t.check.id, { ...(patch.guests != null ? { guests: patch.guests } : {}), ...(patch.customerId !== undefined ? { customerId: patch.customerId } : {}) });
  for (const o of t.orders)
    await db.update("orders", o.id, {
      ...(patch.guests != null ? { guests: patch.guests } : {}),
      ...(patch.customerId !== undefined ? { customerId: patch.customerId } : {}),
      ...(patch.delivery !== undefined ? { delivery: patch.delivery } : {}),
      ...(patch.deliveryFee != null ? { deliveryFee: patch.deliveryFee } : {}),
      ...(patch.note != null ? { note: patch.note } : {}),
    });
  await recomputeCheck(db, t.check.id);
}

/** Cancel an empty (or never-sent) check. */
export async function discardTicket(db: Db, t: Ticket) {
  if (t.items.some((i) => i.status !== "new" && i.status !== "void")) throw new Error("sent items need a void first");
  for (const i of t.items) await db.remove("orderItems", i.id);
  for (const o of t.orders) await db.update("orders", o.id, { status: "void", closedAt: nowIso() });
  await db.update("checks", t.check.id, { status: "void", closedAt: nowIso() });
  for (const tid of t.check.tableIds) await setTableStatus(db, tid, "free");
}

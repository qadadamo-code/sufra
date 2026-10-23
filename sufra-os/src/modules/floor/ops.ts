/**
 * Floor operations on the shared data (every device watching updates live).
 * The rules — who merges into whom, which lines go back to which table — come from the ported
 * sufra-floor engine in ./core; this file only turns its decisions into row writes.
 */
import type { Db } from "@/data/hooks";
import { nextOrderNumber, recomputeCheck } from "@/data/ops";
import type { Check, DiningTable, FloorDecor, Order, PaymentMethod, TableLink, TableStatus } from "@/data/types";
import { nowIso } from "@/lib/time";
import { uuid } from "@/lib/id";
import { mergeChecks, reconcile, splitCheck } from "./core/checks";
import { physicalEdges } from "./core/layout";
import { coreChecks } from "./model";

const ACTIVE: Check["status"][] = ["open", "bill_requested"];

async function activeChecksFor(db: Db, tableIds: string[]) {
  const all = await db.list("checks", { where: { status: ACTIVE } });
  return all.filter((c) => c.tableIds.some((t) => tableIds.includes(t)));
}

async function setTables(db: Db, ids: string[], status: TableStatus) {
  const at = nowIso();
  await Promise.all(ids.map((id) => db.update("tables", id, { status, statusSince: at })));
}

/** Seat guests: a check (and an empty dine-in order carrying the waiter) on one or more tables. */
export async function seatTables(db: Db, input: { tableIds: string[]; guests: number; waiterId?: string | null; reservationId?: string | null; customerId?: string | null }) {
  const busy = await activeChecksFor(db, input.tableIds);
  if (busy.length) throw new Error("table_busy");
  const [first] = await db.list("tables", { where: { id: input.tableIds[0] } });
  if (!first) throw new Error("not_found");
  const at = nowIso();
  const check = await db.insert("checks", {
    branchId: first.branchId, tableIds: input.tableIds, status: "open", guests: Math.max(1, input.guests), reservationId: input.reservationId ?? null, customerId: input.customerId ?? null,
    discount: null, discountApprovedBy: null, subtotal: 0, discountTotal: 0, service: 0, vat: 0, total: 0, paid: 0, receiptNo: null, etaUuid: null, openedAt: at, closedAt: null,
  });
  await db.insert("orders", {
    branchId: first.branchId, number: await nextOrderNumber(db, first.branchId), mode: "dine_in", source: "pos", status: "open", tableIds: input.tableIds, checkId: check.id,
    customerId: input.customerId ?? null, guests: check.guests, openedBy: db.actorId, waiterId: input.waiterId ?? db.actorId, note: "", delivery: null, deliveryStatus: null, driverId: null,
    deliveryFee: 0, openedAt: at, closedAt: null,
  });
  if (input.tableIds.length > 1) await linkTables(db, input.tableIds);
  await setTables(db, input.tableIds, "seated");
  if (input.reservationId) await db.update("reservations", input.reservationId, { status: "seated", seatedAt: at, tableIds: input.tableIds });
  await db.audit("floor.seat", "checks", check.id, { tableIds: input.tableIds, guests: check.guests });
  return check;
}

export async function setGuests(db: Db, check: Check, guests: number) {
  await db.update("checks", check.id, { guests: Math.max(1, guests) });
}

export async function setWaiter(db: Db, check: Check, waiterId: string | null) {
  const orders = await db.list("orders", { where: { checkId: check.id } });
  await Promise.all(orders.map((o) => db.update("orders", o.id, { waiterId })));
}

export async function requestBill(db: Db, check: Check) {
  await db.update("checks", check.id, { status: "bill_requested" });
  await setTables(db, check.tableIds, "bill");
  await db.audit("check.bill_requested", "checks", check.id);
}

/** Back to open (guests ordered again after asking for the bill). */
export async function reopenBill(db: Db, check: Check) {
  await db.update("checks", check.id, { status: "open" });
  await setTables(db, check.tableIds, "ordered");
}

/** Quick settle from the floor: one payment for the balance, check closed, tables need clearing. */
export async function markPaid(db: Db, check: Check, method: PaymentMethod = "cash") {
  const totals = await recomputeCheck(db, check.id);
  const [fresh] = await db.list("checks", { where: { id: check.id } });
  const total = totals?.total ?? fresh?.total ?? check.total;
  const due = Math.max(0, total - (fresh?.paid ?? check.paid));
  const at = nowIso();
  if (due > 0)
    await db.insert("payments", {
      branchId: check.branchId, checkId: check.id, method, amount: due, tip: 0, tendered: method === "cash" ? due : null, change: method === "cash" ? 0 : null,
      reference: null, splitLabel: null, status: "captured", takenBy: db.actorId, refundOf: null,
    });
  await db.update("checks", check.id, { status: "paid", paid: total, closedAt: at });
  const orders = await db.list("orders", { where: { checkId: check.id } });
  await Promise.all(orders.filter((o) => o.status !== "void").map((o) => db.update("orders", o.id, { status: "closed", closedAt: at })));
  await setTables(db, check.tableIds, "dirty");
  await unlinkTables(db, check.tableIds);
  if (check.reservationId) await db.update("reservations", check.reservationId, { status: "done" });
  await db.audit("check.paid_from_floor", "checks", check.id, { method, amount: due });
}

export async function markClean(db: Db, tableIds: string[]) {
  await setTables(db, tableIds, "free");
}

export async function setBlocked(db: Db, table: DiningTable, blocked: boolean) {
  await setTables(db, [table.id], blocked ? "blocked" : "free");
}

/* ───────────── links (tables joined on purpose without touching) ───────────── */

export async function linkTables(db: Db, tableIds: string[]) {
  const links = await db.list("tableLinks");
  const touched = links.filter((l) => l.tableIds.some((t) => tableIds.includes(t)));
  const all = [...new Set([...touched.flatMap((l) => l.tableIds), ...tableIds])];
  for (const l of touched) await db.remove("tableLinks", l.id);
  return db.insert("tableLinks", { tableIds: all });
}

export async function unlinkTables(db: Db, tableIds: string[]) {
  const links = await db.list("tableLinks");
  for (const l of links.filter((x) => x.tableIds.some((t) => tableIds.includes(t)))) await db.remove("tableLinks", l.id);
}

/* ───────────── merge / split / transfer ───────────── */

async function loadCore(db: Db, checks: Check[]) {
  const orders = checks.length ? await db.list("orders", { where: { checkId: checks.map((c) => c.id) } }) : [];
  const items = orders.length ? await db.list("orderItems", { where: { orderId: orders.map((o) => o.id) } }) : [];
  return { orders, items, core: coreChecks(checks, orders, items) };
}

/**
 * Join tables into one bill. Every open bill on `tableIds` folds into the one opened first (sufra-floor
 * mergeChecks); orders and payments move with it; items keep their origin table so the merge can be split back.
 * Tables that are not touching are also linked, so the floor draws them as one party.
 */
export async function mergeTables(db: Db, tableIds: string[], opts: { link?: boolean } = {}) {
  const checks = await activeChecksFor(db, tableIds);
  if (opts.link !== false && tableIds.length > 1) await linkTables(db, tableIds);
  if (!checks.length) return null;
  const { orders, core } = await loadCore(db, checks);
  const r = mergeChecks(core, tableIds);
  if (!r.targetId) return null;
  const target = r.checks.find((c) => c.id === r.targetId)!;
  for (const absorbedId of r.absorbed) {
    for (const o of orders.filter((x) => x.checkId === absorbedId)) await db.update("orders", o.id, { checkId: target.id, tableIds: target.tableIds });
    const pays = await db.list("payments", { where: { checkId: absorbedId } });
    for (const p of pays) await db.update("payments", p.id, { checkId: target.id });
    await db.update("checks", absorbedId, { status: "void", tableIds: [], guests: 0, subtotal: 0, discountTotal: 0, service: 0, vat: 0, total: 0, closedAt: nowIso() });
  }
  for (const o of orders.filter((x) => x.checkId === target.id)) await db.update("orders", o.id, { tableIds: target.tableIds });
  const paidMoved = (await db.list("payments", { where: { checkId: target.id, status: "captured" } })).reduce((s, p) => s + p.amount, 0);
  await db.update("checks", target.id, { tableIds: target.tableIds, guests: target.guests, status: target.status === "bill_requested" ? "bill_requested" : "open", paid: paidMoved });
  await recomputeCheck(db, target.id);
  const status: TableStatus = target.status === "bill_requested" ? "bill" : "ordered";
  const fresh = target.tableIds.filter((t) => !checks.some((c) => c.tableIds.includes(t)));
  if (fresh.length) await setTables(db, fresh, status);
  await db.audit("checks.merge", "checks", target.id, { tableIds: target.tableIds, absorbed: r.absorbed });
  return target.id;
}

/**
 * Undo a merge: every table gets back the items that were ordered from it (sufra-floor splitCheck).
 * Items move to a new order on the new check, so kitchen tickets keep their numbers per table.
 */
export async function splitByTable(db: Db, check: Check) {
  if (check.tableIds.length < 2) return [];
  const { orders, items, core } = await loadCore(db, [check]);
  let n = 0;
  const ids: string[] = [];
  const result = splitCheck(core, check.id, () => {
    const id = uuid();
    ids.push(id);
    n++;
    return id;
  });
  const kept = result.find((c) => c.id === check.id)!;
  const spawned = result.filter((c) => ids.includes(c.id));
  const at = nowIso();
  for (const s of spawned) {
    await db.insert("checks", {
      id: s.id, branchId: check.branchId, tableIds: s.tableIds, status: "open", guests: s.guests, reservationId: null, customerId: null, discount: null, discountApprovedBy: null,
      subtotal: 0, discountTotal: 0, service: 0, vat: 0, total: 0, paid: 0, receiptNo: null, etaUuid: null, openedAt: check.openedAt, closedAt: null,
    } as never);
    const lineIds = new Set(s.lines.map((l) => l.id));
    // one new order per original order that had items for this table
    const byOrder = new Map<string, string[]>();
    for (const it of items) if (lineIds.has(it.id)) byOrder.set(it.orderId, [...(byOrder.get(it.orderId) ?? []), it.id]);
    for (const [orderId, itemIds] of byOrder) {
      const o = orders.find((x) => x.id === orderId) as Order;
      const copy = await db.insert("orders", {
        branchId: o.branchId, number: await nextOrderNumber(db, o.branchId), mode: o.mode, source: o.source, status: o.status, tableIds: s.tableIds, checkId: s.id, customerId: null,
        guests: s.guests, openedBy: o.openedBy, waiterId: o.waiterId, note: o.note, delivery: null, deliveryStatus: null, driverId: null, deliveryFee: 0, openedAt: o.openedAt, closedAt: null,
      });
      for (const iid of itemIds) await db.update("orderItems", iid, { orderId: copy.id });
    }
    await recomputeCheck(db, s.id);
  }
  await db.update("checks", check.id, { tableIds: kept.tableIds, guests: kept.guests });
  for (const o of orders) await db.update("orders", o.id, { tableIds: kept.tableIds });
  await recomputeCheck(db, check.id);
  await unlinkTables(db, check.tableIds);
  // tables with nothing ordered are released (free), the rest keep their status
  const released = check.tableIds.filter((t) => !kept.tableIds.includes(t) && !spawned.some((s) => s.tableIds.includes(t)));
  if (released.length) await setTables(db, released, "free");
  await db.audit("checks.split_by_table", "checks", check.id, { into: spawned.map((s) => s.id), at, n });
  return spawned.map((s) => s.id);
}

/** Move the party (and its bill) to another table; joins the bill there, if any. */
export async function transferTable(db: Db, check: Check, from: string, to: string) {
  if (from === to || !check.tableIds.includes(from)) return;
  const there = (await activeChecksFor(db, [to])).filter((c) => c.id !== check.id);
  const tableIds = check.tableIds.includes(to) ? check.tableIds.filter((t) => t !== from) : check.tableIds.map((t) => (t === from ? to : t));
  const { orders, items } = await loadCore(db, [check]);
  await db.update("checks", check.id, { tableIds });
  for (const o of orders) await db.update("orders", o.id, { tableIds });
  for (const it of items.filter((i) => (i.originTableId ?? check.tableIds[0]) === from)) await db.update("orderItems", it.id, { originTableId: to });
  const [toRow] = await db.list("tables", { where: { id: to } });
  await setTables(db, [from], "dirty");
  if (toRow) await setTables(db, [to], check.status === "bill_requested" ? "bill" : "ordered");
  await unlinkTables(db, [from]);
  if (there.length) await mergeTables(db, [...new Set([...tableIds, ...there[0].tableIds])], { link: false });
  await db.audit("orders.transfer_table", "checks", check.id, { from, to });
}

/* ───────────── layout edits with contact rules ───────────── */

export type LayoutPatch = { c: "tables" | "floorDecor"; id: string; patch: Partial<DiningTable & FloorDecor> };

export interface ReconcileResult {
  merged: { targetId: string; tableIds: string[] }[];
  /** bills whose tables were pulled apart (offer to split) */
  separated: string[];
}

/**
 * After tables move: a contact that did not exist before merges the bills of the tables now touching;
 * contacts that already existed are left alone so a deliberate split is not undone (sufra-floor reconcile).
 */
export async function reconcileContacts(db: Db, before: DiningTable[], after: DiningTable[], links: TableLink[]): Promise<ReconcileResult> {
  const prev = physicalEdges(before.filter((t) => t.active));
  const next = physicalEdges(after.filter((t) => t.active));
  const all = await db.list("checks", { where: { status: ACTIVE } });
  const { core } = await loadCore(db, all);
  const r = reconcile(after.filter((t) => t.active), links, core, prev, next);
  const merged: ReconcileResult["merged"] = [];
  for (const m of r.merges) {
    const id = await mergeTables(db, m.tableIds, { link: false });
    if (id) merged.push({ targetId: id, tableIds: m.tableIds });
  }
  return { merged, separated: r.separated };
}

export async function applyLayout(db: Db, patches: LayoutPatch[]) {
  for (const p of patches) await db.update(p.c, p.id, p.patch as never);
}

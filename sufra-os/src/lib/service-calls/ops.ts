/**
 * Service-call writes. Every write goes through the Db, so the waiter app, floor, bell and guest page update live.
 *
 *   await createServiceCall(db, { branchId, tableId, type: "water", source: "waiter" });
 *   await ackCall(db, call); await doneCall(db, call);
 *   await pingWaiter(db, order);        // kitchen/expo → "food ready" pickup call for the table's waiter
 */
import type { Db } from "@/data/hooks";
import type { Order, ServiceCall, ServiceCallType } from "@/data/types";
import { nowIso } from "@/lib/time";
import { cleanText, findDuplicate } from "./core";

export interface NewCall {
  branchId: string;
  tableId: string;
  type: ServiceCallType;
  text?: string;
  itemId?: string | null;
  orderId?: string | null;
  source: ServiceCall["source"];
}

/** Creates a call, or returns the matching open one from the same table (2-minute de-duplication). */
export async function createServiceCall(db: Db, c: NewCall): Promise<ServiceCall> {
  const recent = await db.list("serviceCalls", { where: { tableId: c.tableId, status: ["open", "ack"] } });
  const dup = c.type === "pickup" ? recent.find((r) => r.type === "pickup" && r.orderId === c.orderId && r.status === "open") ?? null : findDuplicate(recent, c.tableId, c.type);
  if (dup) return dup;
  return db.insert("serviceCalls", {
    branchId: c.branchId,
    tableId: c.tableId,
    type: c.type,
    text: cleanText(c.text),
    status: "open",
    source: c.source,
    ackBy: null,
    ackAt: null,
    doneAt: null,
    itemId: c.itemId ?? null,
    orderId: c.orderId ?? null,
    escalatedAt: null,
  });
}

/** "جاي" — the waiter is on the way. Keeps the first acknowledgement (its time is the KPI). */
export async function ackCall(db: Db, call: Pick<ServiceCall, "id" | "status" | "ackAt">) {
  if (call.status !== "open") return null;
  return db.update("serviceCalls", call.id, { status: "ack", ackBy: db.actorId, ackAt: nowIso() });
}

export async function doneCall(db: Db, call: Pick<ServiceCall, "id" | "ackAt" | "ackBy">) {
  const t = nowIso();
  // done without an explicit ack counts as answered at that moment
  return db.update("serviceCalls", call.id, { status: "done", doneAt: t, ...(call.ackAt ? {} : { ackAt: t, ackBy: db.actorId }) });
}

export async function cancelCall(db: Db, call: Pick<ServiceCall, "id">) {
  return db.update("serviceCalls", call.id, { status: "cancelled", doneAt: nowIso() });
}

/** Stamp the escalation moment once (any client that notices first). */
export async function markEscalated(db: Db, calls: Pick<ServiceCall, "id">[]) {
  const t = nowIso();
  await Promise.all(calls.map((c) => db.update("serviceCalls", c.id, { escalatedAt: t })));
}

/** Kitchen/expo "ping waiter": one pickup call per order (dine-in with a table). Returns null for takeaway/delivery. */
export async function pingWaiter(db: Db, order: Pick<Order, "id" | "branchId" | "tableIds" | "number">, text = "") {
  const tableId = order.tableIds[0];
  if (!tableId) return null;
  return createServiceCall(db, { branchId: order.branchId, tableId, type: "pickup", orderId: order.id, text: text || `#${order.number}`, source: "kitchen" });
}

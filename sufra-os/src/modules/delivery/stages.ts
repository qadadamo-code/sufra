/**
 * Delivery / online-order stage machine (pure rules + the writes that apply them).
 *
 *   received ──accept──▶ accepted ──assign──▶ assigned ──pick up──▶ picked_up ──▶ arrived ──▶ delivered
 *       │                   │  ▲                 │                     │            │
 *       └─reject/cancel     │  └──unassign───────┘                     └───fail─────┴──▶ failed ──▶ assigned (retry) / cancelled
 *                           └─ takeaway, or an aggregator's own rider: handed over ──▶ delivered
 *
 * Kitchen readiness is not a stage: it is `dispatch.readyAt`, stamped when every live item is ready (board column "ready").
 * Every write mirrors the core order fields (status / deliveryStatus / driverId) so POS, kitchen, orders and the guest
 * tracking page keep working, and calls `notifyOrderStage` for the customer.
 */
import type { Db } from "@/data/hooks";
import { recomputeCheck } from "@/data/ops";
import type { DeliveryStatus, DispatchInfo, DispatchStage, Order, OrderItem } from "@/data/types";
import { nowIso } from "@/lib/time";
import { notifyOrderStage, type OrderStage } from "./notify";
import { deliverySettings, dispatchOf, makeOtp } from "./settings";
import { travelMinutes } from "./geo";

export const TRANSITIONS: Record<DispatchStage, DispatchStage[]> = {
  received: ["accepted", "rejected", "cancelled"],
  accepted: ["assigned", "delivered", "cancelled"],
  assigned: ["assigned", "accepted", "picked_up", "cancelled"],
  picked_up: ["arrived", "delivered", "failed"],
  arrived: ["delivered", "failed"],
  failed: ["assigned", "cancelled"],
  delivered: [],
  rejected: [],
  cancelled: [],
};

export const TERMINAL: DispatchStage[] = ["delivered", "rejected", "cancelled"];

export class StageError extends Error {
  constructor(public code: "illegal" | "needs_driver" | "own_rider" | "not_found" | "needs_proof" | "bad_otp", public from?: DispatchStage, public to?: DispatchStage) {
    super(from && to ? `${code}: ${from} → ${to}` : code);
  }
}

/** Does this order hand over at the counter (no own rider)? */
export const counterHandover = (o: Pick<Order, "mode" | "dispatch">) => o.mode !== "delivery" || !!o.dispatch?.aggregator?.theirRider;

/** null when allowed, otherwise why not. */
export function checkTransition(o: Pick<Order, "mode" | "dispatch" | "driverId" | "status" | "deliveryStatus" | "source" | "openedAt">, to: DispatchStage): StageError | null {
  const from = dispatchOf(o as Order).stage;
  if (!TRANSITIONS[from].includes(to)) return new StageError("illegal", from, to);
  // an own-rider delivery can only be closed by the rider (via picked up); counter hand-overs skip the rider
  if (from === "accepted" && to === "delivered" && !counterHandover(o)) return new StageError("own_rider", from, to);
  if (to === "assigned" && counterHandover(o)) return new StageError("illegal", from, to);
  return null;
}
export const canTransition = (o: Parameters<typeof checkTransition>[0], to: DispatchStage) => checkTransition(o, to) === null;

/** Core fields every other module reads, derived from the stage. */
export function mirror(stage: DispatchStage, o: Pick<Order, "mode" | "status">): { deliveryStatus?: DeliveryStatus | null; status?: Order["status"] } {
  const ds: Partial<Record<DispatchStage, DeliveryStatus>> = { received: "pending", accepted: "pending", assigned: "assigned", picked_up: "picked_up", arrived: "picked_up", delivered: "delivered", failed: "failed" };
  const out: { deliveryStatus?: DeliveryStatus | null; status?: Order["status"] } = {};
  if (o.mode === "delivery" && ds[stage]) out.deliveryStatus = ds[stage];
  if (stage === "rejected" || stage === "cancelled") out.status = "void";
  if (stage === "accepted" && o.status === "open") out.status = "sent";
  if (stage === "delivered" && o.mode !== "delivery" && o.status !== "closed") out.status = "served";
  return out;
}

/** Board column of a live order. */
export type Column = "inbox" | "preparing" | "ready" | "assigned" | "out" | "done";
export function columnOf(o: Order, items: Pick<OrderItem, "status">[]): Column {
  const d = dispatchOf(o);
  if (d.stage === "received") return "inbox";
  if (d.stage === "assigned") return "assigned";
  if (d.stage === "picked_up" || d.stage === "arrived") return "out";
  if (TERMINAL.includes(d.stage) || d.stage === "failed") return "done";
  return d.readyAt || allReady(items) ? "ready" : "preparing";
}

export function allReady(items: Pick<OrderItem, "status">[]): boolean {
  const live = items.filter((i) => i.status !== "void");
  return live.length > 0 && live.every((i) => i.status === "ready" || i.status === "served");
}

/* ───────── writes ───────── */

const NOTIFY: Partial<Record<DispatchStage, OrderStage>> = { accepted: "accepted", picked_up: "out_for_delivery", arrived: "arriving", delivered: "delivered", rejected: "cancelled", cancelled: "cancelled" };

async function fresh(db: Db, id: string): Promise<Order> {
  const o = await db.get("orders", id);
  if (!o) throw new StageError("not_found");
  return o;
}

/** Validates against the current row (another device may have moved it), writes stage + timestamps + mirrors, notifies. */
export async function advance(db: Db, orderId: string, to: DispatchStage, patch: Partial<DispatchInfo> = {}, extra: Partial<Order> = {}, notify: { eta?: string | null; reason?: string | null; silent?: boolean } = {}): Promise<Order> {
  const o = await fresh(db, orderId);
  const err = checkTransition(o, to);
  if (err) throw err;
  const cur = dispatchOf(o);
  const t = nowIso();
  const stamp: Partial<DispatchInfo> = {
    accepted: { acceptedAt: t, acceptedBy: db.actorId },
    assigned: { assignedAt: t },
    picked_up: { pickedUpAt: t },
    arrived: { arrivedAt: t },
    delivered: { deliveredAt: t },
    failed: { failedAt: t },
  }[to as "accepted"] ?? {};
  const dispatch: DispatchInfo = { ...cur, ...stamp, ...patch, stage: to };
  const row = await db.update("orders", o.id, { dispatch, ...mirror(to, o), ...extra });
  await db.audit(`delivery.${to}`, "orders", o.id, { from: cur.stage, number: o.number, ...(patch.rejectReason ? { reason: patch.rejectReason } : {}), ...(patch.failReason ? { reason: patch.failReason } : {}), ...(extra.driverId !== undefined ? { driver: extra.driverId } : {}) });
  const ns = NOTIFY[to];
  if (ns && !notify.silent && !(to === "accepted" && o.source === "qr")) await notifyOrderStage(row, ns, { db, eta: notify.eta ?? dispatch.promisedAt, reason: notify.reason ?? patch.rejectReason });
  return row;
}

/** Promise for the customer: prep + ride (delivery) from the kitchen door. */
export function promiseFor(o: Pick<Order, "mode" | "delivery">, prepMin: number, s: ReturnType<typeof deliverySettings>, now = Date.now()): string {
  const ride = o.mode === "delivery" && o.delivery?.lat != null && o.delivery?.lng != null ? travelMinutes(s.origin, { lat: o.delivery.lat, lng: o.delivery.lng }, s.speedKmh) : o.mode === "delivery" ? 20 : 0;
  return new Date(now + (prepMin + ride) * 60_000).toISOString();
}

/** Inbox: accept with a prep time → items fire to the kitchen, the customer gets the ETA. */
export async function acceptOrder(db: Db, orderId: string, prepMin: number): Promise<Order> {
  const o = await fresh(db, orderId);
  const [settings] = await db.list("settings");
  const s = deliverySettings(settings);
  const items = await db.list("orderItems", { where: { orderId, status: "new" } });
  const t = nowIso();
  // fire before the stage flips, so the kitchen has the tickets when the customer reads "preparing"
  await Promise.all(items.map((i) => db.update("orderItems", i.id, { status: "sent", firedAt: t })));
  const promisedAt = o.mode === "dine_in" || o.source === "qr" ? null : promiseFor(o, prepMin, s);
  return advance(db, orderId, "accepted", { prepMin, promisedAt, otp: o.mode === "delivery" ? (dispatchOf(o).otp ?? makeOtp()) : null, expiresAt: null });
}

/** Inbox: reject with a reason → order + items voided, customer told why. */
export async function rejectOrder(db: Db, orderId: string, reason: string, opts: { auto?: boolean } = {}): Promise<Order> {
  const o = await fresh(db, orderId);
  const items = await db.list("orderItems", { where: { orderId } });
  const t = nowIso();
  const why = reason.trim() || "-";
  const row = await advance(db, orderId, dispatchOf(o).stage === "received" ? "rejected" : "cancelled", { rejectReason: why, expiresAt: null }, { closedAt: t });
  await Promise.all(items.filter((i) => i.status !== "void").map((i) => db.update("orderItems", i.id, { status: "void", voidReason: opts.auto ? "auto-reject" : why, voidedBy: db.actorId })));
  if (o.checkId) {
    const check = await db.get("checks", o.checkId);
    const others = (await db.list("orders", { where: { checkId: o.checkId } })).filter((x) => x.id !== o.id && x.status !== "void");
    if (check && !others.length && check.paid <= 0) await db.update("checks", check.id, { status: "void", closedAt: t });
    else if (check) await recomputeCheck(db, check.id);
    if (check && check.paid > 0) await db.audit("delivery.refund_needed", "checks", check.id, { order: o.number, paid: check.paid });
  }
  return row;
}

/** Kitchen finished every item: stamp readyAt once and tell takeaway customers. Idempotent. */
export async function markReady(db: Db, orderId: string): Promise<Order | null> {
  const o = await fresh(db, orderId);
  const d = dispatchOf(o);
  if (d.readyAt || TERMINAL.includes(d.stage) || d.stage === "received") return null;
  const row = await db.update("orders", o.id, { dispatch: { ...d, readyAt: nowIso() }, ...(o.status === "sent" ? { status: "ready" as const } : {}) });
  if (o.mode === "takeaway" || d.aggregator?.theirRider) await notifyOrderStage(row, "ready_pickup", { db });
  return row;
}

export async function assignDriver(db: Db, orderId: string, driverId: string, batchId: string | null = null): Promise<Order> {
  return advance(db, orderId, "assigned", { batchId }, { driverId });
}
export async function unassignDriver(db: Db, orderId: string): Promise<Order> {
  return advance(db, orderId, "accepted", { batchId: null, assignedAt: null }, { driverId: null }, { silent: true });
}

/** Rider took the bag. `shiftId` ties the cash they will collect to their shift. */
export async function pickUp(db: Db, orderId: string, shiftId: string | null): Promise<Order> {
  const o = await fresh(db, orderId);
  const [settings] = await db.list("settings");
  const s = deliverySettings(settings);
  const d = dispatchOf(o);
  const to = o.delivery?.lat != null && o.delivery?.lng != null ? { lat: o.delivery.lat, lng: o.delivery.lng } : null;
  const loc = o.driverId ? await db.get("driverLocations", o.driverId) : null;
  const eta = to ? new Date(Date.now() + travelMinutes(loc ?? s.origin, to, s.speedKmh) * 60_000).toISOString() : (d.promisedAt ?? null);
  return advance(db, orderId, "picked_up", { driverShiftId: shiftId, readyAt: d.readyAt ?? nowIso() }, {}, { eta });
}

export async function arrive(db: Db, orderId: string): Promise<Order> {
  return advance(db, orderId, "arrived");
}

export interface DeliverInput {
  proof?: { kind: "photo" | "otp" | "none"; photo?: string | null; otp?: string | null };
  collected?: { method: "cash" | "card" | "prepaid"; amount: number } | null;
}

/** Proof rule from settings: none / photo / otp / either. */
export function proofOk(rule: "none" | "photo" | "otp" | "either", p: DeliverInput["proof"], expectedOtp: string | null): StageError | null {
  if (rule === "none") return null;
  const photo = p?.kind === "photo" && !!p.photo;
  const otp = p?.kind === "otp" && !!p.otp;
  if (otp && expectedOtp && p!.otp!.trim() !== expectedOtp) return new StageError("bad_otp");
  if (rule === "photo" && !photo) return new StageError("needs_proof");
  if (rule === "otp" && !otp) return new StageError("needs_proof");
  if (rule === "either" && !photo && !otp) return new StageError("needs_proof");
  return null;
}

/** Hand-over done (rider at the door, or the counter for takeaway). */
export async function deliver(db: Db, orderId: string, input: DeliverInput = {}): Promise<Order> {
  const o = await fresh(db, orderId);
  const d = dispatchOf(o);
  if (!counterHandover(o)) {
    const [settings] = await db.list("settings");
    const err = proofOk(deliverySettings(settings).proof, input.proof, d.otp);
    if (err) throw err;
  }
  const t = nowIso();
  const proof = input.proof ? { kind: input.proof.kind, photo: input.proof.photo ?? null, at: t } : null;
  const row = await advance(db, orderId, "delivered", { proof, collected: input.collected ?? null, readyAt: d.readyAt ?? t });
  if (o.mode !== "delivery") {
    const items = await db.list("orderItems", { where: { orderId, status: ["ready", "sent", "preparing"] } });
    await Promise.all(items.map((i) => db.update("orderItems", i.id, { status: "served", servedAt: t })));
  }
  return row;
}

export async function failDelivery(db: Db, orderId: string, reason: string): Promise<Order> {
  return advance(db, orderId, "failed", { failReason: reason.trim() || "-" });
}

/** Tell the customer the new time (once per 10 minutes at most). */
export async function markDelayed(db: Db, orderId: string, extraMin: number, reason: string): Promise<Order> {
  const o = await fresh(db, orderId);
  const d = dispatchOf(o);
  const base = Math.max(Date.now(), d.promisedAt ? Date.parse(d.promisedAt) : Date.now());
  const promisedAt = new Date(base + extraMin * 60_000).toISOString();
  const row = await db.update("orders", o.id, { dispatch: { ...d, promisedAt, delayedAt: nowIso() } });
  await db.audit("delivery.delayed", "orders", o.id, { number: o.number, extraMin, reason });
  await notifyOrderStage(row, "delayed", { db, eta: promisedAt, reason });
  return row;
}

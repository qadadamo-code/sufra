/** Call-centre / aggregator quick entry: customer by phone → address → a POS ticket in delivery mode (accepted). */
import type { Db } from "@/data/hooks";
import type { AggregatorId, Customer, DeliveryInfo, Order } from "@/data/types";
import { nowIso } from "@/lib/time";
import { normalizePhone } from "@/modules/guest/api/service";
import { openTicket } from "@/modules/pos/ops";
import { deliverySettings, makeOtp, newDispatch } from "./settings";
import { travelMinutes } from "./geo";

export async function findCustomer(db: Db, raw: string): Promise<Customer | null> {
  const phone = normalizePhone(raw);
  if (!phone) return null;
  const [c] = await db.list("customers", { where: { phone } });
  return c ?? null;
}

export async function upsertCustomer(db: Db, phone: string, name: string, address: DeliveryInfo | null): Promise<Customer> {
  const p = normalizePhone(phone) ?? phone.trim();
  const [hit] = await db.list("customers", { where: { phone: p } });
  if (hit) {
    const addresses = address && address.address.trim() && !hit.addresses.some((a) => a.address === address.address) ? [address, ...hit.addresses].slice(0, 5) : hit.addresses.map((a) => (address && a.address === address.address ? { ...a, lat: address.lat ?? a.lat, lng: address.lng ?? a.lng } : a));
    return db.update("customers", hit.id, { name: name.trim() || hit.name, addresses });
  }
  return db.insert("customers", {
    phone: p, name: name.trim() || p, email: null, visits: 0, lastVisitAt: null, totalSpent: 0, loyaltyPoints: 0, tags: ["phone"], notes: "", birthday: null, addresses: address && address.address.trim() ? [address] : [],
  });
}

export interface PhoneOrderInput {
  mode: "delivery" | "takeaway";
  phone: string;
  name: string;
  address: DeliveryInfo | null;
  zone: { slug: string; fee: number } | null;
  pickupAt?: string | null;
  note?: string;
}

/** Opens the ticket the POS will fill (`/pos?check=<id>`). Phone orders are accepted by the person who took the call. */
export async function createPhoneOrder(db: Db, x: PhoneOrderInput): Promise<{ checkId: string; order: Order }> {
  const customer = await upsertCustomer(db, x.phone, x.name, x.mode === "delivery" ? x.address : null);
  const [settings] = await db.list("settings");
  const s = deliverySettings(settings);
  const { check, order } = await openTicket(db, {
    mode: x.mode, pickup: x.mode === "takeaway" && !!x.pickupAt, tableIds: [], guests: 1, customerId: customer.id, deliveryFee: x.mode === "delivery" ? (x.zone?.fee ?? 0) : 0,
    delivery: x.mode === "delivery" ? x.address : null, pickupAt: x.pickupAt ?? null, source: "phone",
  });
  const t = nowIso();
  const door = x.address?.lat != null && x.address?.lng != null ? { lat: x.address.lat, lng: x.address.lng } : null;
  const prep = s.defaultPrepMin;
  const ride = x.mode === "delivery" ? (door ? travelMinutes(s.origin, door, s.speedKmh) : 20) : 0;
  const dispatch = newDispatch("phone", t, { stage: "accepted", acceptedAt: t, acceptedBy: db.actorId, prepMin: prep, promisedAt: new Date(Date.now() + (prep + ride) * 60_000).toISOString(), zone: x.zone?.slug ?? null, otp: x.mode === "delivery" ? makeOtp() : null });
  const row = await db.update("orders", order.id, { dispatch, note: (x.note ?? "").trim().slice(0, 300) });
  await db.audit("delivery.phone_order", "orders", order.id, { number: order.number, customer: customer.id });
  return { checkId: check.id, order: row };
}

export interface AggregatorOrderInput {
  aggregator: AggregatorId;
  ref: string;
  commissionBps: number;
  theirRider: boolean;
  customer: { phone: string; name: string } | null;
  address: DeliveryInfo | null;
  prepMin: number;
}

/** Manual aggregator order (until an integration pushes them). Prepaid to the aggregator; their commission feeds reports. */
export async function createAggregatorOrder(db: Db, x: AggregatorOrderInput): Promise<{ checkId: string; order: Order }> {
  const customer = x.customer?.phone ? await upsertCustomer(db, x.customer.phone, x.customer.name, x.theirRider ? null : x.address) : null;
  const { check, order } = await openTicket(db, {
    mode: "delivery", pickup: false, tableIds: [], guests: 1, customerId: customer?.id ?? null, deliveryFee: 0,
    delivery: x.theirRider ? { address: x.ref, area: x.aggregator, notes: "", lat: null, lng: null } : x.address, pickupAt: null, source: "aggregator",
  });
  const t = nowIso();
  const dispatch = newDispatch("aggregator", t, {
    stage: "accepted", acceptedAt: t, acceptedBy: db.actorId, prepMin: x.prepMin, promisedAt: new Date(Date.now() + x.prepMin * 60_000).toISOString(),
    aggregator: { id: x.aggregator, ref: x.ref.trim(), commissionBps: Math.max(0, Math.min(10_000, Math.round(x.commissionBps))), theirRider: x.theirRider }, otp: x.theirRider ? null : makeOtp(),
  });
  const row = await db.update("orders", order.id, { dispatch, note: `${x.aggregator} #${x.ref.trim()}` });
  await db.audit("delivery.aggregator_order", "orders", order.id, { number: order.number, aggregator: x.aggregator, ref: x.ref });
  return { checkId: check.id, order: row };
}

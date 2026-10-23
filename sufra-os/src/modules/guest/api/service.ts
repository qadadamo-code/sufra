/**
 * Guest API — everything a diner's phone can do, on top of `repo.guest` (menu / placeOrder / callWaiter).
 *
 * Two backends behind one interface, like the Repo itself:
 *   - local  (LocalAdapter): reads/writes the in-browser rows directly — guest and staff tabs share them,
 *            so a QR order shows up live in the POS/kitchen/waiter tabs.
 *   - cloud  (SupabaseAdapter): SECURITY DEFINER RPCs from supabase/migrations/0005_guest.sql (anon never
 *            touches tables). Prices, fees and totals are always recomputed server-side.
 */
import type { GuestMenu, GuestOrderLine, Repo } from "@/data/repo";
import type { Customer, DeliveryInfo, Localized, Order, OrderItem, OrderMode, Payment, ServiceCallStatus, ServiceCallType, TaxSettings } from "@/data/types";
import { makeDb } from "@/data/hooks";
import { recomputeCheck } from "@/data/ops";
import { lineUnitPrice } from "@/data/pricing";
import { latinDigits } from "@/lib/arabic";
import { nowIso } from "@/lib/time";
import type { Units } from "@/lib/money";
import { DEMO_ZONES, type DeliveryZone } from "../data/venue";
import { stageOf, type Stage } from "../stages";
import type { PaymentIntent } from "../pay/types";

/* ───────── shapes ───────── */

export interface Venue {
  restaurantId: string;
  slug: string;
  name: Localized;
  currency: "EGP" | "SAR";
  brandColor: string;
  phone: string | null;
  timezone: string;
  branch: { id: string; name: Localized; address: Localized; phone: string | null; hours: { open: string; close: string } | null } | null;
  tax: TaxSettings;
  qr: { enabled: boolean; requireWaiterConfirm: boolean; allowServiceCalls: boolean };
  tipsEnabled: boolean;
  zones: DeliveryZone[];
}

export type PayChoice = "cash" | "card" | "online";

export interface PlaceOrderInput {
  tableCode?: string | null;
  mode: OrderMode;
  lines: GuestOrderLine[];
  customer?: { name: string; phone: string } | null;
  note?: string;
  delivery?: { zoneId: string; address: string; notes: string } | null;
  /** pre-order pickup time (ISO) */
  pickupAt?: string | null;
  payment?: PayChoice;
}

export interface BillLineView {
  id: string;
  orderId: string;
  name: Localized;
  qty: number;
  unit: Units;
  gross: Units;
  modifiers: Localized[];
  notes: string;
  status: OrderItem["status"];
}

export interface TableBill {
  checkId: string;
  status: "open" | "bill_requested" | "paid" | "void";
  lines: BillLineView[];
  totals: { subtotal: Units; discountTotal: Units; service: Units; vat: Units; total: Units; paid: Units };
  payments: { id: string; method: Payment["method"]; amount: Units; tip: Units; splitLabel: string | null; at: string }[];
  orders: { id: string; number: number; stage: Stage; at: string; items: number }[];
}

export interface TrackInfo {
  orderId: string;
  number: number;
  mode: OrderMode;
  qr: boolean;
  stage: Stage;
  status: Order["status"];
  createdAt: string;
  pickupAt: string | null;
  note: string;
  items: { name: Localized; qty: number; status: OrderItem["status"]; unit: Units; modifiers: Localized[] }[];
  checkId: string | null;
  totals: { subtotal: Units; service: Units; vat: Units; deliveryFee: Units; total: Units; paid: Units };
  customer: { name: string; phone: string } | null;
  delivery: DeliveryInfo | null;
  driver: { name: string; phone: string | null } | null;
  table: string | null;
}

export interface CallState {
  id: string;
  type: ServiceCallType;
  status: ServiceCallStatus;
  createdAt: string;
  ackAt: string | null;
  doneAt: string | null;
}

export class GuestError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** Egyptian mobile: 01[0125] + 8 digits (Arabic digits and spaces accepted). */
export function normalizePhone(raw: string): string | null {
  let d = latinDigits(raw).replace(/[^\d+]/g, "");
  if (d.startsWith("+20")) d = "0" + d.slice(3);
  else if (d.startsWith("0020")) d = "0" + d.slice(4);
  else if (d.startsWith("20") && d.length === 12) d = "0" + d.slice(2);
  return /^01[0125]\d{8}$/.test(d) ? d : null;
}

type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> };

/* ───────── service ───────── */

export class GuestService {
  constructor(private repo: Repo) {}

  get local() {
    return this.repo.kind === "local";
  }

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const client = (this.repo as unknown as { client?: Rpc }).client;
    if (!client) throw new GuestError("no_backend");
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new GuestError(error.message);
    return data as T;
  }

  /* menu + venue */

  menu(slug: string, tableCode?: string | null): Promise<GuestMenu | null> {
    return this.repo.guest.menu(slug, tableCode ?? null);
  }

  async venue(slug: string, tableCode?: string | null): Promise<Venue | null> {
    if (!this.local) return this.rpc<Venue | null>("guest_venue", { p_slug: slug, p_table_code: tableCode ?? null });
    const [r] = await this.repo.list("restaurants", { where: { slug, active: true } });
    if (!r) return null;
    const table = tableCode ? (await this.repo.list("tables", { where: { restaurantId: r.id, code: tableCode.toUpperCase() } }))[0] : null;
    const branches = await this.repo.list("branches", { where: { restaurantId: r.id } });
    const b = (table && branches.find((x) => x.id === table.branchId)) || branches.find((x) => x.isDefault) || branches[0] || null;
    const [s] = await this.repo.list("settings", { where: { restaurantId: r.id } });
    if (!s) return null;
    const { taxId: _a, commercialRegister: _b, ...tax } = s.tax;
    return {
      restaurantId: r.id,
      slug: r.slug,
      name: r.name,
      currency: r.currency,
      brandColor: r.brandColor,
      phone: r.phone,
      timezone: r.timezone,
      branch: b ? { id: b.id, name: b.name, address: b.address, phone: b.phone, hours: b.openingHours } : null,
      tax: { ...tax, taxId: "", commercialRegister: "" },
      qr: s.qrOrdering,
      tipsEnabled: s.tipsEnabled,
      zones: DEMO_ZONES,
    };
  }

  /* ordering */

  async placeOrder(slug: string, input: PlaceOrderInput): Promise<{ orderId: string; number: number }> {
    if (!input.lines.length) throw new GuestError("empty_order");
    const customer = input.customer ? { name: input.customer.name.trim().slice(0, 80), phone: normalizePhone(input.customer.phone) ?? "" } : null;
    if (customer && (!customer.name || !customer.phone)) throw new GuestError("bad_customer");
    if (!input.tableCode && !customer) throw new GuestError("bad_customer");
    if (!this.local)
      return this.rpc("guest_place_order_v2", {
        p_slug: slug, p_table_code: input.tableCode ?? null, p_mode: input.mode, p_lines: input.lines, p_customer: customer,
        p_note: input.note ?? "", p_delivery: input.delivery ?? null, p_pickup_at: input.pickupAt ?? null, p_payment: input.payment ?? "cash",
      });

    const venue = await this.venue(slug, input.tableCode);
    if (!venue) throw new GuestError("not_found");
    const zone = input.mode === "delivery" ? venue.zones.find((z) => z.id === input.delivery?.zoneId) : null;
    if (input.mode === "delivery" && (!zone || !input.delivery?.address.trim())) throw new GuestError("bad_address");

    const payLabel = input.payment === "online" ? "💳 مدفوع أونلاين / paid online" : input.payment === "card" ? "💳 كارت عند الاستلام / card on delivery" : "💵 كاش عند الاستلام / cash on delivery";
    const note = [input.tableCode ? null : payLabel, input.note?.trim() || null].filter(Boolean).join(" · ");
    const res = await this.repo.guest.placeOrder(slug, { tableCode: input.tableCode ?? null, mode: input.mode, lines: input.lines, customer, note });

    const order = await this.repo.get("orders", res.orderId);
    if (!order) return res;
    const db = makeDb(this.repo, order.restaurantId, order.branchId, null);
    const patch: Partial<Order> = {};
    if (zone && input.delivery) {
      patch.delivery = { address: input.delivery.address.trim().slice(0, 200), area: zone.name.ar, notes: input.delivery.notes.trim().slice(0, 200), lat: null, lng: null };
      patch.deliveryStatus = "pending";
      patch.deliveryFee = zone.fee;
    }
    if (input.pickupAt) patch.pickupAt = input.pickupAt;
    if (customer) {
      const c = await this.upsertCustomer(order.restaurantId, customer.name, customer.phone, patch.delivery ?? null);
      patch.customerId = c.id;
      if (order.checkId) await this.repo.update("checks", order.checkId, { customerId: c.id });
    }
    // auto-send to the kitchen: online orders are auto-accepted; QR orders unless the waiter must confirm
    const autoFire = !input.tableCode || !venue.qr.requireWaiterConfirm;
    if (autoFire) {
      const items = await this.repo.list("orderItems", { where: { orderId: order.id } });
      const t = nowIso();
      await Promise.all(items.map((i) => this.repo.update("orderItems", i.id, { status: "sent", firedAt: t })));
      patch.status = "sent";
    }
    if (Object.keys(patch).length) await this.repo.update("orders", order.id, patch);
    if (order.checkId) await recomputeCheck(db, order.checkId);
    return res;
  }

  private async upsertCustomer(restaurantId: string, name: string, phone: string, address: DeliveryInfo | null): Promise<Customer> {
    const [hit] = await this.repo.list("customers", { where: { restaurantId, phone } });
    if (hit) {
      const addresses = address && !hit.addresses.some((a) => a.address === address.address) ? [address, ...hit.addresses].slice(0, 5) : hit.addresses;
      return this.repo.update("customers", hit.id, { name: hit.name || name, addresses });
    }
    return this.repo.insert("customers", {
      restaurantId, phone, name, email: null, visits: 0, lastVisitAt: null, totalSpent: 0, loyaltyPoints: 0, tags: ["online"], notes: "", birthday: null, addresses: address ? [address] : [],
    });
  }

  /* tracking */

  async track(slug: string, orderId: string): Promise<TrackInfo | null> {
    if (!this.local) return this.rpc<TrackInfo | null>("guest_order_track", { p_slug: slug, p_order_id: orderId });
    const [r] = await this.repo.list("restaurants", { where: { slug } });
    const o = r ? await this.repo.get("orders", orderId) : null;
    if (!r || !o || o.restaurantId !== r.id) return null;
    const items = await this.repo.list("orderItems", { where: { orderId: o.id } });
    const check = o.checkId ? await this.repo.get("checks", o.checkId) : null;
    const cust = o.customerId ? await this.repo.get("customers", o.customerId) : null;
    const driver = o.driverId ? await this.repo.get("memberships", o.driverId) : null;
    const table = o.tableIds[0] ? await this.repo.get("tables", o.tableIds[0]) : null;
    const qr = o.source === "qr";
    return {
      orderId: o.id,
      number: o.number,
      mode: o.mode,
      qr,
      stage: stageOf({ mode: o.mode, status: o.status, deliveryStatus: o.deliveryStatus, qr }, items),
      status: o.status,
      createdAt: o.openedAt,
      pickupAt: o.pickupAt ?? null,
      note: o.note,
      items: items.map((i) => ({ name: i.name, qty: i.qty, status: i.status, unit: lineUnitPrice(i), modifiers: i.modifiers.map((m) => m.name) })),
      checkId: o.checkId,
      totals: { subtotal: check?.subtotal ?? 0, service: check?.service ?? 0, vat: check?.vat ?? 0, deliveryFee: o.deliveryFee, total: check?.total ?? 0, paid: check?.paid ?? 0 },
      customer: cust ? { name: cust.name, phone: cust.phone } : null,
      delivery: o.delivery,
      driver: driver ? { name: driver.name.split(" ")[0], phone: driver.phone } : null,
      table: table?.label ?? null,
    };
  }

  /* the table's running bill */

  async tableBill(slug: string, tableCode: string): Promise<TableBill | null> {
    if (!this.local) return this.rpc<TableBill | null>("guest_table_bill", { p_slug: slug, p_table_code: tableCode });
    const [r] = await this.repo.list("restaurants", { where: { slug } });
    if (!r) return null;
    const [t] = await this.repo.list("tables", { where: { restaurantId: r.id, code: tableCode.toUpperCase() } });
    if (!t) return null;
    const checks = (await this.repo.list("checks", { where: { restaurantId: r.id, status: ["open", "bill_requested"] }, contains: { tableIds: t.id } })).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    const check = checks[0];
    if (!check) return null;
    const orders = await this.repo.list("orders", { where: { checkId: check.id }, orderBy: [{ field: "openedAt" }] });
    const items = orders.length ? await this.repo.list("orderItems", { where: { orderId: orders.map((o) => o.id) }, orderBy: [{ field: "createdAt" }] }) : [];
    const pays = await this.repo.list("payments", { where: { checkId: check.id, status: "captured" } });
    return {
      checkId: check.id,
      status: check.status,
      lines: items
        .filter((i) => i.status !== "void")
        .map((i) => ({ id: i.id, orderId: i.orderId, name: i.name, qty: i.qty, unit: lineUnitPrice(i), gross: lineUnitPrice(i) * i.qty - (i.discount || 0), modifiers: i.modifiers.map((m) => m.name), notes: i.notes, status: i.status })),
      totals: { subtotal: check.subtotal, discountTotal: check.discountTotal, service: check.service, vat: check.vat, total: check.total, paid: check.paid },
      payments: pays.map((p) => ({ id: p.id, method: p.method, amount: p.amount, tip: p.tip, splitLabel: p.splitLabel, at: p.createdAt })),
      orders: orders.map((o) => {
        const its = items.filter((i) => i.orderId === o.id);
        return { id: o.id, number: o.number, stage: stageOf({ mode: o.mode, status: o.status, deliveryStatus: o.deliveryStatus, qr: o.source === "qr" }, its), at: o.openedAt, items: its.reduce((a, i) => a + (i.status === "void" ? 0 : i.qty), 0) };
      }),
    };
  }

  /* waiter calls */

  callWaiter(slug: string, tableCode: string, type: ServiceCallType, text = "") {
    return this.repo.guest.callWaiter(slug, tableCode, type, text);
  }

  async callStates(slug: string, tableCode: string, ids: string[]): Promise<CallState[]> {
    if (!ids.length) return [];
    if (!this.local) return this.rpc<CallState[]>("guest_call_status", { p_slug: slug, p_table_code: tableCode, p_ids: ids });
    const rows = await this.repo.list("serviceCalls", { where: { id: ids } });
    return rows.map((c) => ({ id: c.id, type: c.type, status: c.status, createdAt: c.createdAt, ackAt: c.ackAt, doneAt: c.doneAt }));
  }

  /* payments — in the cloud the verified provider webhook records the payment (guest_record_payment);
     locally the DemoProvider's success is recorded here, idempotently by intent id. */

  async recordPayment(slug: string, intent: PaymentIntent): Promise<void> {
    if (intent.status !== "succeeded") throw new GuestError("not_paid");
    if (!this.local) return; // server did it
    const checkId = intent.request.checkId;
    if (!checkId) throw new GuestError("no_check");
    const check = await this.repo.get("checks", checkId);
    if (!check) throw new GuestError("no_check");
    const dup = await this.repo.list("payments", { where: { checkId, reference: intent.id } });
    if (dup.length) return;
    await this.repo.insert("payments", {
      restaurantId: check.restaurantId, branchId: check.branchId, checkId, method: "online", amount: intent.amount, tip: intent.tip, tendered: null, change: null,
      reference: intent.id, splitLabel: intent.request.splitLabel, status: "captured", takenBy: null, refundOf: null,
    });
    await this.repo.update("checks", checkId, { paid: check.paid + intent.amount });
    if (intent.request.tableCode) {
      const text = `✓ ${intent.request.splitLabel ?? ""} دفع أونلاين ${(intent.amount / 100000).toFixed(2)} (+ بقشيش ${(intent.tip / 100000).toFixed(2)}) · ${intent.reference ?? ""}`;
      await this.repo.guest.callWaiter(slug, intent.request.tableCode, "bill", text).catch(() => undefined);
    }
  }

  async paymentStatus(intentId: string): Promise<PaymentIntent | null> {
    if (this.local) return null;
    return this.rpc<PaymentIntent | null>("guest_payment_status", { p_intent_id: intentId });
  }

  /* after the meal */

  async feedback(slug: string, input: { checkId?: string | null; orderId?: string | null; tableCode?: string | null; stars: number; comment: string; tags?: string[] }): Promise<void> {
    const stars = Math.max(1, Math.min(5, Math.round(input.stars)));
    const comment = input.comment.trim().slice(0, 500);
    if (!this.local) {
      await this.rpc("guest_feedback_submit", { p_slug: slug, p_check_id: input.checkId ?? null, p_order_id: input.orderId ?? null, p_stars: stars, p_comment: comment, p_tags: input.tags ?? [] });
      return;
    }
    const [r] = await this.repo.list("restaurants", { where: { slug } });
    if (!r) throw new GuestError("not_found");
    const check = input.checkId ? await this.repo.get("checks", input.checkId) : null;
    await this.repo.insert("auditLog", {
      restaurantId: r.id, branchId: check?.branchId ?? null, actorId: null, action: "guest.feedback", entity: input.orderId ? "orders" : "checks",
      entityId: input.orderId ?? input.checkId ?? null, data: { stars, comment, tags: input.tags ?? [], table: input.tableCode ?? null }, approvedBy: null,
    });
  }

  async joinLoyalty(slug: string, input: { name: string; phone: string; checkId?: string | null }): Promise<{ points: number }> {
    const phone = normalizePhone(input.phone);
    if (!phone) throw new GuestError("bad_phone");
    if (!this.local) return this.rpc("guest_join_loyalty", { p_slug: slug, p_name: input.name.trim(), p_phone: phone, p_check_id: input.checkId ?? null });
    const [r] = await this.repo.list("restaurants", { where: { slug } });
    if (!r) throw new GuestError("not_found");
    const c = await this.upsertCustomer(r.id, input.name.trim() || phone, phone, null);
    let points = c.loyaltyPoints;
    if (input.checkId) {
      const check = await this.repo.get("checks", input.checkId);
      if (check && !check.customerId) {
        await this.repo.update("checks", check.id, { customerId: c.id });
        // 1 point per 10 EGP — the CRM/loyalty module owns the real rules
        points += Math.floor(check.total / 1_000_000);
        await this.repo.update("customers", c.id, { loyaltyPoints: points, tags: [...new Set([...c.tags, "loyalty"])] });
      }
    }
    return { points };
  }

  /** live updates: change feed in local mode; callers also poll (cloud anon has no Realtime rows) */
  watch(restaurantId: string, cb: () => void): () => void {
    return this.repo.subscribe(["orders", "orderItems", "checks", "payments", "serviceCalls", "menuItems"], restaurantId, () => cb());
  }
}

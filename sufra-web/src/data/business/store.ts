/**
 * Shared B2B demo state (restaurant ↔ supplier), persisted in localStorage.
 * Purchase orders placed from the restaurant dashboard show up in the supplier portal when they go to the demo
 * supplier, and status changes made by the supplier show up back in the restaurant's "track" list.
 */
import { useSyncExternalStore } from "react";
import { load, save } from "@/lib/storage";
import { PRODUCTS, DEMO_SUPPLIER_ID, productById, type SupplyCategory } from "./suppliers";
import type { SupplierOrderStatus } from "./billing";

export const DEMO_RESTAURANT = { id: "demo", ar: "مطعم سُفرة التجريبي — الزمالك", en: "Sufra Demo Kitchen — Zamalek", tax: "512-334-908" };

export interface POLine {
  productId: string;
  qty: number;
  /** unit price at order time, piastres before VAT */
  price: number;
  vat: 0 | 14;
}
export interface POMessage {
  from: "restaurant" | "supplier";
  name: string;
  text: string;
  at: number;
}
export type EInvoiceStatus = "none" | "pending" | "submitted" | "valid" | "rejected";
export interface PurchaseOrder {
  id: string;
  supplierId: string;
  restaurantId: string;
  restaurantAr: string;
  restaurantEn: string;
  restaurantTax: string;
  lines: POLine[];
  status: SupplierOrderStatus;
  createdAt: number;
  deliverOn: number;
  note?: string;
  messages: POMessage[];
  rating?: number;
  received?: boolean;
  einvoice: EInvoiceStatus;
  collectedBySufra: boolean;
}

export interface BizState {
  orders: PurchaseOrder[];
  /** cart per supplier: productId → qty */
  cart: Record<string, Record<string, number>>;
  /** supplier portal: local edits to the demo supplier's products */
  productEdits: Record<string, { price?: number; stock?: number; minQty?: number; hidden?: boolean }>;
  extraProducts: { id: string; ar: string; en: string; category: SupplyCategory; price: number; stock: number; unitAr: string; unitEn: string; vat: 0 | 14; minQty: number }[];
  seq: number;
}

const KEY = "sufra.biz.v1";
const DAY = 86_400_000;

const RESTAURANTS = [
  { id: "r-kebda", ar: "كبدة وسجق أبو علي", en: "Abu Ali Liver & Sausage", tax: "488-120-551" },
  { id: "r-nile", ar: "مطعم كورنيش النيل", en: "Nile Corniche Restaurant", tax: "301-882-047" },
  { id: "r-green", ar: "جرين بول — المعادي", en: "Green Bowl — Maadi", tax: "615-009-332" },
  { id: "r-pizza", ar: "بيتزا الفرن البلدي", en: "Baladi Oven Pizza", tax: "277-451-690" },
  { id: "r-cafe", ar: "كافيه الشرفة", en: "Balcony Café", tax: "390-776-214" },
];

function seed(): BizState {
  const now = Date.now();
  const mine = PRODUCTS.filter((p) => p.supplierId === DEMO_SUPPLIER_ID);
  const statuses: SupplierOrderStatus[] = ["new", "new", "confirmed", "out", "delivered", "invoiced", "invoiced", "invoiced", "delivered", "cancelled", "invoiced", "invoiced"];
  const orders: PurchaseOrder[] = statuses.map((status, i) => {
    const r = RESTAURANTS[i % RESTAURANTS.length];
    const lines = [0, 1, 2, 3].slice(0, 2 + (i % 3)).map((k) => {
      const p = mine[(i * 3 + k * 5) % mine.length];
      return { productId: p.id, qty: Math.max(p.minQty, 1 + ((i + k) % 4)) * (p.unit.en === "kg" ? 3 : 1), price: p.price, vat: p.vat };
    });
    const created = now - (i < 4 ? i * 3 : i * 2.2) * DAY - (i * 37 % 300) * 60_000;
    return {
      id: `PO-${2400 + i}`,
      supplierId: DEMO_SUPPLIER_ID,
      restaurantId: r.id,
      restaurantAr: r.ar,
      restaurantEn: r.en,
      restaurantTax: r.tax,
      lines,
      status,
      createdAt: created,
      deliverOn: created + DAY,
      messages:
        i === 0
          ? [
              { from: "restaurant", name: r.ar, text: "صباح الخير، ممكن الطماطم تكون فرز أول؟ عندنا حجز كبير بكرة.", at: created + 60_000 },
              { from: "supplier", name: "خضار وادي النيل", text: "صباح النور يا فندم، أكيد. هتوصل قبل 9 الصبح.", at: created + 9 * 60_000 },
            ]
          : [],
      einvoice: status === "invoiced" ? (i % 5 === 0 ? "submitted" : "valid") : "none",
      collectedBySufra: i % 2 === 0,
      rating: status === "invoiced" ? 4 + (i % 2) : undefined,
    };
  });
  // two orders from the demo restaurant to other suppliers, so its "track" list isn't empty
  const other = (sid: string, keys: string[], status: SupplierOrderStatus, ago: number, n: number): PurchaseOrder => {
    const lines = PRODUCTS.filter((p) => p.supplierId === sid && keys.includes(p.key)).map((p) => ({ productId: p.id, qty: p.minQty * 2, price: p.price, vat: p.vat }));
    return { id: `PO-${2300 + n}`, supplierId: sid, restaurantId: DEMO_RESTAURANT.id, restaurantAr: DEMO_RESTAURANT.ar, restaurantEn: DEMO_RESTAURANT.en, restaurantTax: DEMO_RESTAURANT.tax, lines, status, createdAt: now - ago * DAY, deliverOn: now - (ago - 1) * DAY, messages: [], einvoice: status === "invoiced" ? "valid" : "none", collectedBySufra: true };
  };
  orders.push(other("s12", ["rice", "sunflower", "pasta", "tomato-paste"], "out", 1, 1), other("s04", ["beef-mince", "beef-topside", "lamb"], "invoiced", 6, 2));
  return { orders, cart: {}, productEdits: {}, extraProducts: [], seq: 2500 };
}

let state: BizState = load<BizState | null>(KEY, null) ?? seed();
if (!Array.isArray(state.orders)) state = seed();
const ls = new Set<() => void>();
function set(next: BizState) {
  state = next;
  save(KEY, state);
  ls.forEach((l) => l());
}
export function useBiz<T>(sel: (s: BizState) => T): T {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => sel(state),
  );
}
export const getBiz = () => state;

export function resetBizDemo() {
  set(seed());
}

/* cart */
export function setCartQty(supplierId: string, productId: string, qty: number) {
  const c = { ...(state.cart[supplierId] ?? {}) };
  if (qty <= 0) delete c[productId];
  else c[productId] = qty;
  const cart = { ...state.cart, [supplierId]: c };
  if (!Object.keys(c).length) delete cart[supplierId];
  set({ ...state, cart });
}
export function clearCart(supplierId: string) {
  const cart = { ...state.cart };
  delete cart[supplierId];
  set({ ...state, cart });
}

export function placeOrder(supplierId: string, note?: string): PurchaseOrder | null {
  const c = state.cart[supplierId];
  if (!c || !Object.keys(c).length) return null;
  const lines = Object.entries(c).map(([productId, qty]) => {
    const p = productById[productId];
    const edit = state.productEdits[productId];
    return { productId, qty, price: edit?.price ?? p.price, vat: p.vat };
  });
  const now = Date.now();
  const seq = state.seq + 1;
  const po: PurchaseOrder = {
    id: `PO-${seq}`,
    supplierId,
    restaurantId: DEMO_RESTAURANT.id,
    restaurantAr: DEMO_RESTAURANT.ar,
    restaurantEn: DEMO_RESTAURANT.en,
    restaurantTax: DEMO_RESTAURANT.tax,
    lines,
    status: "new",
    createdAt: now,
    deliverOn: now + DAY,
    note,
    messages: note ? [{ from: "restaurant", name: DEMO_RESTAURANT.ar, text: note, at: now }] : [],
    einvoice: "none",
    collectedBySufra: true,
  };
  const cart = { ...state.cart };
  delete cart[supplierId];
  set({ ...state, orders: [po, ...state.orders], cart, seq });
  return po;
}

export const NEXT_STATUS: Partial<Record<SupplierOrderStatus, SupplierOrderStatus>> = { new: "confirmed", confirmed: "out", out: "delivered", delivered: "invoiced" };

export function updateOrder(id: string, patch: Partial<PurchaseOrder>) {
  set({ ...state, orders: state.orders.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
}
export function advanceOrder(id: string) {
  const o = state.orders.find((x) => x.id === id);
  const next = o && NEXT_STATUS[o.status];
  if (!o || !next) return;
  updateOrder(id, { status: next, einvoice: next === "invoiced" ? "submitted" : o.einvoice });
  if (next === "invoiced") window.setTimeout(() => updateOrder(id, { einvoice: "valid" }), 2500);
}
export function sendMessage(id: string, msg: Omit<POMessage, "at">) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) return;
  updateOrder(id, { messages: [...o.messages, { ...msg, at: Date.now() }] });
}

export function editProduct(id: string, patch: BizState["productEdits"][string]) {
  set({ ...state, productEdits: { ...state.productEdits, [id]: { ...state.productEdits[id], ...patch } } });
}
export function addProduct(p: BizState["extraProducts"][number]) {
  set({ ...state, extraProducts: [p, ...state.extraProducts] });
}

/** Order money (piastres): net before VAT, VAT, gross. */
export function orderTotals(o: Pick<PurchaseOrder, "lines">) {
  let net = 0;
  let vat = 0;
  for (const l of o.lines) {
    const n = l.price * l.qty;
    net += n;
    vat += Math.floor((n * l.vat + 50) / 100);
  }
  return { net, vat, gross: net + vat };
}

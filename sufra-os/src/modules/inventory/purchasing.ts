/**
 * Purchasing: suggested orders, purchase orders, receiving (GRN) with quantity & price variance, supplier invoices
 * (input VAT, sufra-finance postPurchase semantics via the accounting API), payments and supplier balances.
 *
 *   draft ──send──▶ sent ──receive──▶ partial ──receive──▶ received ──invoice──▶ invoiced ──pay in full──▶ paid
 *     └──cancel──▶ cancelled ◀──cancel── sent          └──close short──▶ received
 *
 * Stock enters at RECEIPT at the price actually charged (weighted average updates then); the ledger entry is made at
 * INVOICE (Dr inventory net + Dr 1401 input VAT, Cr 2101 payables), matching finance `postPurchase`.
 */
import type { Db } from "@/data/hooks";
import type { GrnLine, PoLine, PoStatus, PurchaseOrder, StockAccount, StockItem, Supplier, SupplierInvoice, SupplierItem } from "@/data/types";
import { uuid } from "@/lib/id";
import { nowIso } from "@/lib/time";
import { pctOf, type Units } from "@/lib/money";
import { businessDay } from "@/modules/accounting/api";
import { postPaymentToSupplier, postSupplierInvoice } from "./posting";
import { applyMoves } from "./stock";
import { commissionFor, planOf, SUPPLIER_PLANS } from "./marketplace/plans";
import { piastresToUnits } from "./marketplace/suppliers";
import { q3 } from "./units";

/* ───────── state machine ───────── */

const NEXT: Record<PoStatus, PoStatus[]> = {
  draft: ["sent", "cancelled"],
  sent: ["partial", "received", "cancelled"],
  partial: ["partial", "received"],
  received: ["invoiced"],
  invoiced: ["paid"],
  paid: [],
  cancelled: [],
};
export const canMove = (from: PoStatus, to: PoStatus) => NEXT[from].includes(to);
export function assertMove(from: PoStatus, to: PoStatus) {
  if (!canMove(from, to)) throw new Error(`purchase order cannot go from ${from} to ${to}`);
}
export const isOpenPo = (s: PoStatus) => s === "draft" || s === "sent" || s === "partial";

/* ───────── totals ───────── */

export function lineNet(l: Pick<PoLine, "qty" | "price">) {
  return Math.round(l.qty * l.price);
}
export function poTotals(lines: Pick<PoLine, "qty" | "price" | "vatBp">[], deliveryFee: Units = 0) {
  const net = lines.reduce((a, l) => a + lineNet(l), 0) + deliveryFee;
  const vat = lines.reduce((a, l) => a + pctOf(lineNet(l), l.vatBp), 0);
  return { net, vat, total: net + vat };
}

/* ───────── suggested orders ───────── */

export interface SuggestInput {
  onHand: number;
  onOrder: number;
  min: number;
  par: number;
  max: number;
  /** average daily use, base units (from the last weeks' sales + waste) */
  dailyUsage: number;
  leadDays: number;
  coverDays: number;
  packFactor: number;
}
/**
 * Order when what's on hand + on order is at or below the reorder point (max(min, usage × lead time)); order up to
 * max(par, usage × (lead + cover)) without passing `max`. Rounded UP to whole supplier packs.
 */
export function suggestPacks(x: SuggestInput): number {
  const projected = x.onHand + x.onOrder;
  const reorderAt = Math.max(x.min, x.dailyUsage * x.leadDays);
  if (projected > reorderAt) return 0;
  let upTo = Math.max(x.par, x.dailyUsage * (x.leadDays + x.coverDays));
  if (x.max > 0) upTo = Math.min(upTo, x.max);
  const need = upTo - projected;
  if (need <= 0) return 0;
  const f = Math.max(1, x.packFactor);
  let packs = Math.ceil(need / f - 1e-9);
  if (x.max > 0 && packs > 1 && projected + packs * f > x.max) packs = Math.max(1, Math.floor((x.max - projected) / f));
  return packs;
}

export interface Suggestion {
  item: StockItem;
  supplierId: string | null;
  offer: SupplierItem | null;
  packs: number;
  onHand: number;
  onOrder: number;
  dailyUsage: number;
}

/** Daily usage per item from sale/waste/production moves of the last `days`. */
export function dailyUsage(moves: { itemId: string; kind: string; qty: number; at: string }[], days: number, now = Date.now()) {
  const since = now - days * 86_400_000;
  const m = new Map<string, number>();
  for (const x of moves) {
    if (x.qty >= 0 || Date.parse(x.at) < since) continue;
    if (!["sale", "waste", "staff_meal", "production_out"].includes(x.kind)) continue;
    m.set(x.itemId, (m.get(x.itemId) ?? 0) - x.qty);
  }
  for (const [k, v] of m) m.set(k, q3(v / days));
  return m;
}

export function suggestOrders(a: {
  items: StockItem[];
  branchId: string;
  onHand: Map<string, number>;
  openPos: PurchaseOrder[];
  offers: SupplierItem[];
  suppliers: Supplier[];
  usage: Map<string, number>;
  coverDays: number;
}): Suggestion[] {
  const onOrder = new Map<string, number>();
  for (const po of a.openPos)
    if (po.branchId === a.branchId && isOpenPo(po.status)) for (const l of po.lines) onOrder.set(l.itemId, (onOrder.get(l.itemId) ?? 0) + (l.qty - l.receivedQty) * l.packFactor);
  const out: Suggestion[] = [];
  for (const it of a.items) {
    if (!it.active || it.kind === "prep") continue;
    const lv = it.branchLevels[a.branchId] ?? it.levels;
    const offers = a.offers.filter((o) => o.itemId === it.id);
    const offer = offers.find((o) => o.supplierId === it.preferredSupplierId) ?? offers.find((o) => o.preferred) ?? [...offers].sort((x, y) => x.price / x.packFactor - y.price / y.packFactor)[0] ?? null;
    const sup = a.suppliers.find((s) => s.id === (offer?.supplierId ?? it.preferredSupplierId));
    const packs = suggestPacks({
      onHand: a.onHand.get(it.id) ?? 0, onOrder: onOrder.get(it.id) ?? 0, min: lv.min, par: lv.par, max: lv.max, dailyUsage: a.usage.get(it.id) ?? 0,
      leadDays: sup?.leadDays ?? 1, coverDays: a.coverDays, packFactor: offer?.packFactor ?? 1,
    });
    if (packs > 0) out.push({ item: it, supplierId: offer?.supplierId ?? it.preferredSupplierId, offer, packs, onHand: a.onHand.get(it.id) ?? 0, onOrder: onOrder.get(it.id) ?? 0, dailyUsage: a.usage.get(it.id) ?? 0 });
  }
  return out;
}

/* ───────── purchase orders ───────── */

export async function nextPoNumber(db: Db) {
  const year = new Date().getFullYear();
  const all = await db.list("purchaseOrders");
  const n = all.reduce((m, p) => {
    const x = /^PO-(\d{4})-(\d+)$/.exec(p.number);
    return x && Number(x[1]) === year ? Math.max(m, Number(x[2])) : m;
  }, 0);
  return `PO-${year}-${String(n + 1).padStart(4, "0")}`;
}

export function poLine(item: Pick<StockItem, "id" | "name" | "vatBp">, offer: Pick<SupplierItem, "packName" | "packFactor" | "price" | "vatBp"> | null, qty: number): PoLine {
  return {
    id: uuid(), itemId: item.id, name: item.name, packName: offer?.packName ?? { ar: "وحدة", en: "unit" }, packFactor: offer?.packFactor ?? 1, qty, price: offer?.price ?? 0,
    vatBp: offer?.vatBp ?? item.vatBp, receivedQty: 0, receivedValue: 0,
  };
}

export async function createPo(db: Db, p: { supplierId: string; branchId: string; locationId: string; lines: PoLine[]; channel?: "direct" | "marketplace"; note?: string; expectedAt?: string | null; suggested?: boolean }) {
  const sup = await db.get("suppliers", p.supplierId);
  if (!sup) throw new Error("unknown supplier");
  const lines = p.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new Error("add at least one line");
  const channel = p.channel ?? (sup.marketplaceId ? "marketplace" : "direct");
  const t = poTotals(lines, sup.deliveryFee);
  const plan = sup.marketplaceId ? planOf(sup.marketplaceId) : null;
  return db.insert("purchaseOrders", {
    branchId: p.branchId, locationId: p.locationId, supplierId: sup.id, number: await nextPoNumber(db), status: "draft", channel, lines, ...t, deliveryFee: sup.deliveryFee,
    expectedAt: p.expectedAt ?? new Date(Date.now() + Math.max(1, sup.leadDays) * 86_400_000).toISOString(), sentAt: null, receivedAt: null, invoiceId: null, note: p.note ?? "",
    createdBy: db.actorId, approvedBy: null, sentVia: null, suggested: !!p.suggested,
    marketplace: channel === "marketplace" && sup.marketplaceId && plan
      ? { supplierRef: sup.marketplaceId, plan, commissionPct: SUPPLIER_PLANS.find((x) => x.id === plan)!.commissionPct, commission: 0, base: 0, collectedBySufra: true }
      : null,
  });
}

export async function updatePoLines(db: Db, poId: string, lines: PoLine[]) {
  const po = await db.get("purchaseOrders", poId);
  if (!po || po.status !== "draft") throw new Error("only drafts can be edited");
  return db.update("purchaseOrders", poId, { lines, ...poTotals(lines, po.deliveryFee) });
}

export async function sendPo(db: Db, poId: string, via: NonNullable<PurchaseOrder["sentVia"]>, approvedBy: string | null = null) {
  const po = await db.get("purchaseOrders", poId);
  if (!po) throw new Error("not found");
  assertMove(po.status, "sent");
  const row = await db.update("purchaseOrders", poId, { status: "sent", sentAt: nowIso(), sentVia: via, approvedBy: approvedBy ?? db.actorId });
  await db.audit("po.send", "purchaseOrders", poId, { via, total: po.total }, approvedBy);
  return row;
}

export async function cancelPo(db: Db, poId: string) {
  const po = await db.get("purchaseOrders", poId);
  if (!po) throw new Error("not found");
  assertMove(po.status, "cancelled");
  return db.update("purchaseOrders", poId, { status: "cancelled" });
}

/** WhatsApp / text version of a PO for the supplier. */
export function poMessage(po: PurchaseOrder, restaurant: string, lang: "ar" | "en" = "ar") {
  const L = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const lines = po.lines.map((l) => `• ${l.qty} × ${l.packName[lang]} ${l.name[lang]}`);
  return [L(`طلب شراء ${po.number} من ${restaurant}`, `Purchase order ${po.number} from ${restaurant}`), ...lines, po.expectedAt ? L(`التسليم: ${po.expectedAt.slice(0, 10)}`, `Delivery: ${po.expectedAt.slice(0, 10)}`) : "", po.note].filter(Boolean).join("\n");
}

export interface ReceiveLine {
  lineId: string;
  qty: number;
  price: Units;
  lot?: string | null;
  expiresOn?: string | null;
  note?: string;
}

export interface Variance {
  lineId: string;
  qtyDiff: number;
  priceDiff: Units;
  /** (received price − PO price) × received qty */
  priceEffect: Units;
}
export function receiptVariance(po: Pick<PurchaseOrder, "lines">, rec: ReceiveLine[]): Variance[] {
  return rec.map((r) => {
    const l = po.lines.find((x) => x.id === r.lineId)!;
    const remaining = l.qty - l.receivedQty;
    return { lineId: r.lineId, qtyDiff: q3(r.qty - remaining), priceDiff: r.price - l.price, priceEffect: Math.round((r.price - l.price) * r.qty) };
  });
}

/**
 * Goods in against a PO: stock moves at the price actually charged, supplier price list + item last cost updated
 * (price history → price-increase alerts), batches for tracked items, PO → partial / received.
 */
export async function receivePo(db: Db, poId: string, rec: ReceiveLine[], opts: { closeShort?: boolean; note?: string } = {}) {
  const po = await db.get("purchaseOrders", poId);
  if (!po) throw new Error("not found");
  const lines = rec.filter((r) => r.qty > 0);
  if (!lines.length && !opts.closeShort) throw new Error("nothing received");
  const items = new Map((await db.list("stockItems")).map((i) => [i.id, i]));
  const now = nowIso();
  const grnLines: GrnLine[] = [];
  const nextLines = po.lines.map((l) => ({ ...l }));
  const moves = [];
  for (const r of lines) {
    const l = nextLines.find((x) => x.id === r.lineId);
    if (!l) throw new Error("line not on this order");
    const baseQty = q3(r.qty * l.packFactor);
    const value = Math.round(r.qty * r.price);
    l.receivedQty = q3(l.receivedQty + r.qty);
    l.receivedValue += value;
    const it = items.get(l.itemId);
    let batchId: string | null = null;
    if (it?.trackBatches) {
      const expires = r.expiresOn ?? (it.shelfLifeDays ? new Date(Date.now() + it.shelfLifeDays * 86_400_000).toISOString().slice(0, 10) : null);
      const b = await db.insert("stockBatches", { branchId: po.branchId, locationId: po.locationId, itemId: l.itemId, lot: r.lot || `${po.number}-${l.itemId.slice(0, 4)}`, receivedAt: now, expiresOn: expires, qty: baseQty, remaining: baseQty, poId: po.id });
      batchId = b.id;
    }
    moves.push({ itemId: l.itemId, locationId: po.locationId, branchId: po.branchId, kind: "receive" as const, qty: baseQty, value, refType: "purchase_order", refId: po.id, groupId: po.id, batchId, note: po.number });
    grnLines.push({ lineId: l.id, itemId: l.itemId, qty: r.qty, price: r.price, packFactor: l.packFactor, lot: r.lot ?? null, expiresOn: r.expiresOn ?? null, note: r.note ?? "" });
    // price list + last cost
    const [offer] = await db.list("supplierItems", { where: { supplierId: po.supplierId, itemId: l.itemId } });
    if (offer && offer.price !== r.price) await db.update("supplierItems", offer.id, { price: r.price, history: [...offer.history, { price: r.price, at: now }].slice(-24) });
    if (it && l.packFactor > 0) await db.update("stockItems", it.id, { lastCost: Math.round(r.price / l.packFactor) });
  }
  await applyMoves(db, moves, { items });
  const value = grnLines.reduce((a, g) => a + Math.round(g.qty * g.price), 0);
  if (grnLines.length) await db.insert("goodsReceipts", { branchId: po.branchId, locationId: po.locationId, poId: po.id, supplierId: po.supplierId, lines: grnLines, value, receivedAt: now, receivedBy: db.actorId, note: opts.note ?? "" });
  const complete = opts.closeShort || nextLines.every((l) => l.receivedQty >= l.qty);
  const status: PoStatus = complete ? "received" : "partial";
  assertMove(po.status, status);
  const delivered = nextLines.reduce((a, l) => a + l.receivedValue, 0);
  const marketplace = po.marketplace ? { ...po.marketplace, base: delivered, commission: commissionUnits(po.marketplace.plan, delivered) } : null;
  const row = await db.update("purchaseOrders", po.id, { lines: nextLines, status, receivedAt: complete ? now : po.receivedAt, marketplace });
  await db.audit("po.receive", "purchaseOrders", po.id, { lines: grnLines.length, value, status });
  return row;
}

/** Commission (Units) on a delivered marketplace order — the website's piastre calculator, converted. */
export function commissionUnits(plan: "starter" | "growth" | "distributor", deliveredUnits: Units): Units {
  const piastres = Math.round(deliveredUnits / 1000);
  return piastresToUnits(commissionFor(plan, piastres));
}

/** Supplier invoice from what was received (net per account, input VAT per line) → posted with postPurchase semantics. */
export async function invoicePo(db: Db, poId: string, inv: { number: string; date?: string; etaUuid?: string | null }) {
  const po = await db.get("purchaseOrders", poId);
  if (!po) throw new Error("not found");
  assertMove(po.status, "invoiced");
  const sup = await db.get("suppliers", po.supplierId);
  const items = new Map((await db.list("stockItems")).map((i) => [i.id, i]));
  const byAcc = new Map<StockAccount | "expense", { net: Units; vat: Units }>();
  for (const l of po.lines) {
    if (!l.receivedValue) continue;
    const a = items.get(l.itemId)?.account ?? "food";
    const cur = byAcc.get(a) ?? { net: 0, vat: 0 };
    byAcc.set(a, { net: cur.net + l.receivedValue, vat: cur.vat + pctOf(l.receivedValue, l.vatBp) });
  }
  if (po.deliveryFee) {
    const cur = byAcc.get("expense") ?? { net: 0, vat: 0 };
    byAcc.set("expense", { net: cur.net + po.deliveryFee, vat: cur.vat + pctOf(po.deliveryFee, 1400) });
  }
  const lines = [...byAcc.entries()].map(([account, v]) => ({ account, ...v }));
  const net = lines.reduce((a, l) => a + l.net, 0);
  const vat = lines.reduce((a, l) => a + l.vat, 0);
  const date = inv.date ?? businessDay();
  const due = new Date(Date.parse(`${date}T12:00:00Z`) + (sup?.termsDays ?? 0) * 86_400_000).toISOString().slice(0, 10);
  const row = await db.insert("supplierInvoices", {
    branchId: po.branchId, supplierId: po.supplierId, poId: po.id, number: inv.number.trim() || po.number, date, dueDate: due, lines, net, vat, total: net + vat, paid: 0, status: "open",
    etaUuid: inv.etaUuid ?? null, ledgerEntryId: null,
  });
  let entryId: string | null = null;
  try {
    entryId = (await postSupplierInvoice(db, { id: row.id, branchId: po.branchId, supplier: sup?.name.en ?? po.supplierId, invoiceNo: row.number, date, lines })).id;
    await db.update("supplierInvoices", row.id, { ledgerEntryId: entryId });
  } catch (e) {
    await db.audit("ledger.error", "supplierInvoices", row.id, { what: "purchase-invoice", error: String((e as Error).message ?? e) });
  }
  await db.update("purchaseOrders", po.id, { status: "invoiced", invoiceId: row.id });
  return { ...row, ledgerEntryId: entryId };
}

export async function paySupplier(db: Db, p: { invoiceId: string; amount: Units; method: "cash" | "bank" | "instapay" | "cheque"; reference?: string }) {
  const inv = await db.get("supplierInvoices", p.invoiceId);
  if (!inv) throw new Error("invoice not found");
  const due = inv.total - inv.paid;
  if (p.amount <= 0 || p.amount > due) throw new Error("amount must be between 0 and what is due");
  const sup = await db.get("suppliers", inv.supplierId);
  const pay = await db.insert("supplierPayments", { supplierId: inv.supplierId, invoiceId: inv.id, amount: p.amount, method: p.method, reference: p.reference ?? "", paidAt: nowIso(), by: db.actorId });
  await postPaymentToSupplier(db, { id: pay.id, branchId: inv.branchId, supplier: sup?.name.en ?? inv.supplierId, amount: p.amount, method: p.method, date: businessDay() }).catch((e) =>
    db.audit("ledger.error", "supplierPayments", pay.id, { what: "supplier.payment", error: String((e as Error).message ?? e) }),
  );
  const paid = inv.paid + p.amount;
  const status: SupplierInvoice["status"] = paid >= inv.total ? "paid" : "partial";
  await db.update("supplierInvoices", inv.id, { paid, status });
  if (status === "paid" && inv.poId) {
    const po = await db.get("purchaseOrders", inv.poId);
    if (po && canMove(po.status, "paid")) await db.update("purchaseOrders", po.id, { status: "paid" });
  }
  return pay;
}

/** What we owe each supplier: invoices − payments (+ overdue part). */
export function supplierBalances(invoices: SupplierInvoice[], today = new Date().toISOString().slice(0, 10)) {
  const m = new Map<string, { owed: Units; overdue: Units; invoices: number }>();
  for (const i of invoices) {
    const due = i.total - i.paid;
    if (due <= 0) continue;
    const cur = m.get(i.supplierId) ?? { owed: 0, overdue: 0, invoices: 0 };
    m.set(i.supplierId, { owed: cur.owed + due, overdue: cur.overdue + (i.dueDate < today ? due : 0), invoices: cur.invoices + 1 });
  }
  return m;
}

/** wa.me link for a supplier (Egyptian mobile → +20). */
export function waLink(phone: string, text: string) {
  const d = phone.replace(/\D/g, "");
  const e164 = d.startsWith("20") ? d : d.startsWith("0") ? `20${d.slice(1)}` : d;
  return `https://wa.me/${e164}?text=${encodeURIComponent(text)}`;
}

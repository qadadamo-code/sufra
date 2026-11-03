/**
 * Alerts & reports — pure functions over rows (screens pass what useLive returns; tests pass fixtures).
 */
import type { MoveKind, PurchaseOrder, StockBatch, StockCount, StockItem, StockLevel, StockMove, Supplier, SupplierItem, WasteReason } from "@/data/types";
import type { Units } from "@/lib/money";
import { lineVariance, lineVarianceValue } from "./stock";
import { q3 } from "./units";

/* ───────── alerts ───────── */

export type AlertKind = "low" | "out" | "expiring" | "expired" | "price" | "variance";
export interface Alert {
  id: string;
  kind: AlertKind;
  severity: "danger" | "warn" | "info";
  itemId: string | null;
  /** extra data for the message */
  data: Record<string, number | string>;
}

export function onHandMap(levels: Pick<StockLevel, "itemId" | "qty" | "branchId">[], branchId: string | null) {
  const m = new Map<string, number>();
  for (const l of levels) if (!branchId || l.branchId === branchId) m.set(l.itemId, q3((m.get(l.itemId) ?? 0) + l.qty));
  return m;
}

/**
 * Batches still on the shelf, derived (no writes on every sale): stock is used oldest first, so what's on hand is the
 * NEWEST receipts. Walks batches newest → oldest assigning the on-hand quantity.
 */
export function batchesOnHand(batches: StockBatch[], onHand: number): (StockBatch & { left: number })[] {
  let rest = Math.max(0, onHand);
  const out: (StockBatch & { left: number })[] = [];
  for (const b of [...batches].sort((a, c) => (a.receivedAt < c.receivedAt ? 1 : -1))) {
    if (rest <= 0) break;
    const left = Math.min(b.qty, rest);
    rest = q3(rest - left);
    out.push({ ...b, left: q3(left) });
  }
  return out;
}

export function stockAlerts(a: {
  items: StockItem[];
  levels: StockLevel[];
  batches: StockBatch[];
  offers: SupplierItem[];
  counts: StockCount[];
  branchId: string | null;
  today?: string;
  expiryWarnDays: number;
  priceAlertBp: number;
  varianceAlertBp: number;
}): Alert[] {
  const today = a.today ?? new Date().toISOString().slice(0, 10);
  const warnDay = new Date(Date.parse(`${today}T12:00:00Z`) + a.expiryWarnDays * 86_400_000).toISOString().slice(0, 10);
  const onHand = onHandMap(a.levels, a.branchId);
  const out: Alert[] = [];
  for (const it of a.items) {
    if (!it.active) continue;
    const lv = (a.branchId && it.branchLevels[a.branchId]) || it.levels;
    const q = onHand.get(it.id) ?? 0;
    if (q <= 0 && lv.min > 0) out.push({ id: `out:${it.id}`, kind: "out", severity: "danger", itemId: it.id, data: { qty: q, min: lv.min } });
    else if (q <= lv.min && lv.min > 0) out.push({ id: `low:${it.id}`, kind: "low", severity: "warn", itemId: it.id, data: { qty: q, min: lv.min, par: lv.par } });
    if (it.trackBatches) {
      const mine = a.batches.filter((b) => b.itemId === it.id && (!a.branchId || b.branchId === a.branchId));
      for (const b of batchesOnHand(mine, q)) {
        if (!b.expiresOn) continue;
        if (b.expiresOn < today) out.push({ id: `expired:${b.id}`, kind: "expired", severity: "danger", itemId: it.id, data: { lot: b.lot, on: b.expiresOn, qty: b.left } });
        else if (b.expiresOn <= warnDay) out.push({ id: `expiring:${b.id}`, kind: "expiring", severity: "warn", itemId: it.id, data: { lot: b.lot, on: b.expiresOn, qty: b.left } });
      }
    }
  }
  for (const o of a.offers) {
    const h = o.history;
    if (h.length < 2) continue;
    const prev = h[h.length - 2].price;
    const cur = h[h.length - 1].price;
    if (prev > 0 && cur > prev && ((cur - prev) * 10_000) / prev >= a.priceAlertBp)
      out.push({ id: `price:${o.id}`, kind: "price", severity: "info", itemId: o.itemId, data: { supplierId: o.supplierId, from: prev, to: cur, bp: Math.round(((cur - prev) * 10_000) / prev) } });
  }
  const recent = a.counts.filter((c) => (c.status === "submitted" || c.status === "approved") && (!a.branchId || c.branchId === a.branchId)).sort((x, y) => (x.startedAt < y.startedAt ? 1 : -1))[0];
  if (recent)
    for (const l of recent.lines) {
      if (l.counted == null) continue;
      const expVal = Math.abs(Math.round(l.expected * l.unitCost));
      const v = lineVarianceValue(l);
      if (v !== 0 && expVal > 0 && (Math.abs(v) * 10_000) / expVal >= a.varianceAlertBp && Math.abs(v) >= 2_000_000)
        out.push({ id: `variance:${recent.id}:${l.itemId}:${l.locationId}`, kind: "variance", severity: v < 0 ? "warn" : "info", itemId: l.itemId, data: { qty: lineVariance(l), value: v, countId: recent.id } });
    }
  const rank = { danger: 0, warn: 1, info: 2 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity]);
}

/* ───────── usage: theoretical vs actual ───────── */

const inPeriod = (m: Pick<StockMove, "at">, from: string, to: string) => m.at >= from && m.at <= to;

export interface UsageRow {
  itemId: string;
  /** recipe × what was sold */
  theoretical: number;
  waste: number;
  staffMeal: number;
  /** count adjustments (− = missing / unexplained) */
  countDiff: number;
  /** theoretical + waste + staff meals − count diff */
  actual: number;
  /** actual − theoretical (what the recipes don't explain) */
  variance: number;
  theoreticalValue: Units;
  actualValue: Units;
  varianceValue: Units;
}

export function usageReport(moves: StockMove[], from: string, to: string): UsageRow[] {
  const m = new Map<string, UsageRow>();
  const row = (id: string) => {
    let r = m.get(id);
    if (!r) m.set(id, (r = { itemId: id, theoretical: 0, waste: 0, staffMeal: 0, countDiff: 0, actual: 0, variance: 0, theoreticalValue: 0, actualValue: 0, varianceValue: 0 }));
    return r;
  };
  for (const x of moves) {
    if (!inPeriod(x, from, to)) continue;
    const r = row(x.itemId);
    if (x.kind === "sale" || x.kind === "sale_reversal") {
      r.theoretical = q3(r.theoretical - x.qty);
      r.theoreticalValue -= x.value;
    } else if (x.kind === "waste") r.waste = q3(r.waste - x.qty);
    else if (x.kind === "staff_meal") r.staffMeal = q3(r.staffMeal - x.qty);
    else if (x.kind === "count_adjust") r.countDiff = q3(r.countDiff + x.qty);
    else continue;
    if (x.kind !== "sale" && x.kind !== "sale_reversal") r.varianceValue -= x.value;
  }
  for (const r of m.values()) {
    r.actual = q3(r.theoretical + r.waste + r.staffMeal - r.countDiff);
    r.variance = q3(r.actual - r.theoretical);
    r.actualValue = r.theoreticalValue + r.varianceValue;
  }
  return [...m.values()].filter((r) => r.theoretical || r.actual).sort((a, b) => Math.abs(b.varianceValue) - Math.abs(a.varianceValue));
}

/* ───────── COGS & waste ───────── */

export function cogsSummary(moves: StockMove[], items: Map<string, StockItem>, from: string, to: string) {
  const r = { food: 0, beverage: 0, packaging: 0, waste: 0, staffMeal: 0, countLoss: 0, countGain: 0 };
  for (const x of moves) {
    if (!inPeriod(x, from, to)) continue;
    const acc = items.get(x.itemId)?.account ?? "food";
    if (x.kind === "sale" || x.kind === "sale_reversal") r[acc] -= x.value;
    else if (x.kind === "waste") r.waste -= x.value;
    else if (x.kind === "staff_meal") r.staffMeal -= x.value;
    else if (x.kind === "count_adjust") {
      if (x.value < 0) r.countLoss -= x.value;
      else r.countGain += x.value;
    }
  }
  return { ...r, sales: r.food + r.beverage + r.packaging, total: r.food + r.beverage + r.packaging + r.waste + r.staffMeal + r.countLoss - r.countGain };
}

export function wasteReport(moves: StockMove[], from: string, to: string) {
  const byReason = new Map<WasteReason, { qty: number; value: Units; n: number }>();
  const byItem = new Map<string, { qty: number; value: Units; n: number }>();
  const rows = moves.filter((x) => (x.kind === "waste" || x.kind === "staff_meal") && inPeriod(x, from, to));
  for (const x of rows) {
    const reason = x.reason ?? (x.kind === "staff_meal" ? "staff_meal" : "other");
    const a = byReason.get(reason) ?? { qty: 0, value: 0, n: 0 };
    byReason.set(reason, { qty: q3(a.qty - x.qty), value: a.value - x.value, n: a.n + 1 });
    const b = byItem.get(x.itemId) ?? { qty: 0, value: 0, n: 0 };
    byItem.set(x.itemId, { qty: q3(b.qty - x.qty), value: b.value - x.value, n: b.n + 1 });
  }
  return { rows: rows.sort((a, b) => (a.at < b.at ? 1 : -1)), byReason, byItem, total: rows.reduce((a, x) => a - x.value, 0) };
}

export function valuation(levels: StockLevel[], items: Map<string, StockItem>, branchId: string | null) {
  const byLocation = new Map<string, Units>();
  const byCategory = new Map<string, Units>();
  let total = 0;
  for (const l of levels) {
    if (branchId && l.branchId !== branchId) continue;
    const v = Math.max(0, l.value);
    total += v;
    byLocation.set(l.locationId, (byLocation.get(l.locationId) ?? 0) + v);
    const c = items.get(l.itemId)?.category ?? "dry";
    byCategory.set(c, (byCategory.get(c) ?? 0) + v);
  }
  return { total, byLocation, byCategory };
}

/* ───────── purchasing ───────── */

export function purchaseHistory(pos: PurchaseOrder[], from: string, to: string) {
  const rows = pos.filter((p) => p.status !== "draft" && p.status !== "cancelled" && (p.sentAt ?? p.createdAt) >= from && (p.sentAt ?? p.createdAt) <= to);
  const bySupplier = new Map<string, { orders: number; value: Units }>();
  for (const p of rows) {
    const v = p.lines.reduce((a, l) => a + (l.receivedValue || Math.round(l.qty * l.price)), 0);
    const cur = bySupplier.get(p.supplierId) ?? { orders: 0, value: 0 };
    bySupplier.set(p.supplierId, { orders: cur.orders + 1, value: cur.value + v });
  }
  return { rows, bySupplier, total: [...bySupplier.values()].reduce((a, x) => a + x.value, 0) };
}

export interface SupplierScore {
  supplierId: string;
  orders: number;
  delivered: number;
  onTime: number;
  /** on-time deliveries ÷ delivered, bp */
  onTimeBp: number;
  /** received ÷ ordered quantity, bp */
  fillBp: number;
  priceRises: number;
  /** average price change across their items since the first recorded price, bp */
  priceChangeBp: number;
}
export function supplierPerformance(suppliers: Supplier[], pos: PurchaseOrder[], offers: SupplierItem[]): SupplierScore[] {
  return suppliers.map((s) => {
    const mine = pos.filter((p) => p.supplierId === s.id && p.status !== "draft" && p.status !== "cancelled");
    const delivered = mine.filter((p) => p.receivedAt);
    const onTime = delivered.filter((p) => !p.expectedAt || p.receivedAt!.slice(0, 10) <= p.expectedAt.slice(0, 10)).length;
    const ordered = mine.reduce((a, p) => a + p.lines.reduce((b, l) => b + l.qty, 0), 0);
    const received = mine.reduce((a, p) => a + p.lines.reduce((b, l) => b + Math.min(l.qty, l.receivedQty), 0), 0);
    const my = offers.filter((o) => o.supplierId === s.id && o.history.length);
    let rises = 0;
    let changeSum = 0;
    for (const o of my) {
      for (let i = 1; i < o.history.length; i++) if (o.history[i].price > o.history[i - 1].price) rises++;
      const first = o.history[0].price;
      if (first > 0) changeSum += ((o.price - first) * 10_000) / first;
    }
    return {
      supplierId: s.id, orders: mine.length, delivered: delivered.length, onTime, onTimeBp: delivered.length ? Math.round((onTime * 10_000) / delivered.length) : 0,
      fillBp: ordered ? Math.round((received * 10_000) / ordered) : 0, priceRises: rises, priceChangeBp: my.length ? Math.round(changeSum / my.length) : 0,
    };
  });
}

export const MOVE_SIGN: Record<MoveKind, 1 | -1> = {
  opening: 1, receive: 1, transfer_in: 1, production_in: 1, sale_reversal: 1, count_adjust: 1,
  sale: -1, waste: -1, staff_meal: -1, transfer_out: -1, production_out: -1, supplier_return: -1,
};

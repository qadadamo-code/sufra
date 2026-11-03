/**
 * Sales analytics (pure) over the operational rows: paid checks in the period (by business day of closing), their
 * orders, lines and tenders. Breakdowns by item, category, hour, day, channel, order type, staff, table, payment
 * method; discounts, voids and refunds with reasons; covers, average check, table turns.
 */
import type { Check, DiningTable, Localized, MenuCategory, MenuItem, Order, OrderItem, Payment } from "@/data/types";
import type { Units } from "@/lib/money";
import { businessDay } from "@/modules/accounting/core";

export interface SalesInput {
  checks: Check[];
  orders: Order[];
  items: OrderItem[];
  payments: Payment[];
  menuItems: MenuItem[];
  categories: MenuCategory[];
  tables: DiningTable[];
}

export interface Bucket {
  key: string;
  label: Localized | string;
  count: number;
  qty: number;
  net: Units;
}
export interface StaffRow {
  id: string;
  checks: number;
  covers: number;
  net: Units;
  tips: Units;
  discounts: Units;
  voids: number;
}

export const lineValue = (i: Pick<OrderItem, "unitPrice" | "qty" | "modifiers" | "discount">) => Math.round((i.unitPrice + i.modifiers.reduce((a, m) => a + m.price, 0)) * i.qty) - (i.discount ?? 0);
const closedDay = (c: Pick<Check, "closedAt" | "openedAt">) => businessDay(new Date(c.closedAt ?? c.openedAt));

export function salesReport(x: SalesInput, from: string, to: string) {
  const checks = x.checks.filter((c) => c.status === "paid" && closedDay(c) >= from && closedDay(c) <= to);
  const ids = new Set(checks.map((c) => c.id));
  const orders = x.orders.filter((o) => o.checkId && ids.has(o.checkId));
  const orderBy = new Map(orders.map((o) => [o.id, o]));
  const firstOrder = new Map<string, Order>();
  for (const o of orders) if (o.checkId && !firstOrder.has(o.checkId)) firstOrder.set(o.checkId, o);
  const lines = x.items.filter((i) => orderBy.has(i.orderId));
  const live = lines.filter((i) => i.status !== "void");
  const voids = lines.filter((i) => i.status === "void");
  const pays = x.payments.filter((p) => ids.has(p.checkId));
  const menu = new Map(x.menuItems.map((m) => [m.id, m]));
  const cats = new Map(x.categories.map((c) => [c.id, c]));
  const tables = new Map(x.tables.map((t) => [t.id, t]));

  const net = (c: Check) => c.subtotal - c.discountTotal;
  const totalNet = checks.reduce((a, c) => a + net(c), 0);
  const covers = checks.reduce((a, c) => a + (firstOrder.get(c.id)?.mode === "dine_in" ? Math.max(1, c.guests) : 0), 0);
  const dineChecks = checks.filter((c) => firstOrder.get(c.id)?.mode === "dine_in");
  const dineNet = dineChecks.reduce((a, c) => a + net(c), 0);
  const days = new Set(checks.map(closedDay)).size || 1;
  const activeTables = x.tables.filter((t) => t.active).length || 1;

  const bump = (m: Map<string, Bucket>, key: string, label: Bucket["label"], v: Units, qty = 0, count = 1) => {
    const b = m.get(key) ?? { key, label, count: 0, qty: 0, net: 0 };
    b.count += count;
    b.qty += qty;
    b.net += v;
    m.set(key, b);
  };
  const byItem = new Map<string, Bucket>();
  const byCat = new Map<string, Bucket>();
  for (const i of live) {
    const v = lineValue(i);
    bump(byItem, i.itemId, i.name, v, i.qty);
    const cat = menu.get(i.itemId)?.categoryId ?? "-";
    bump(byCat, cat, cats.get(cat)?.name ?? "—", v, i.qty);
  }
  const byHour = new Map<string, Bucket>();
  const byDay = new Map<string, Bucket>();
  const byWeekday = new Map<string, Bucket>();
  const byChannel = new Map<string, Bucket>();
  const byMode = new Map<string, Bucket>();
  const byTable = new Map<string, Bucket>();
  const staff = new Map<string, StaffRow>();
  for (const c of checks) {
    const v = net(c);
    const at = new Date(c.closedAt ?? c.openedAt);
    const h = String(at.getHours()).padStart(2, "0");
    bump(byHour, h, h, v);
    const d = closedDay(c);
    bump(byDay, d, d, v);
    const wd = String(new Date(`${d}T12:00:00`).getDay());
    bump(byWeekday, wd, wd, v);
    const o = firstOrder.get(c.id);
    bump(byChannel, o?.source ?? "pos", o?.source ?? "pos", v);
    bump(byMode, o?.mode ?? "dine_in", o?.mode ?? "dine_in", v);
    for (const t of c.tableIds.slice(0, 1)) bump(byTable, t, tables.get(t)?.label ?? t, v, c.guests);
    const who = o?.waiterId ?? o?.openedBy ?? "—";
    const s = staff.get(who) ?? { id: who, checks: 0, covers: 0, net: 0, tips: 0, discounts: 0, voids: 0 };
    s.checks++;
    s.covers += o?.mode === "dine_in" ? c.guests : 0;
    s.net += v;
    s.discounts += c.discountTotal;
    s.tips += pays.filter((p) => p.checkId === c.id && p.status === "captured").reduce((a, p) => a + p.tip, 0);
    staff.set(who, s);
  }
  for (const i of voids) {
    const o = orderBy.get(i.orderId);
    const who = o?.waiterId ?? o?.openedBy ?? "—";
    const s = staff.get(who);
    if (s) s.voids++;
  }
  const byPay = new Map<string, Bucket>();
  for (const p of pays) if (p.status !== "void") bump(byPay, p.method, p.method, p.status === "refunded" ? 0 : p.amount);

  const discounts = checks
    .filter((c) => c.discountTotal > 0)
    .map((c) => ({ checkId: c.id, receiptNo: c.receiptNo, amount: c.discountTotal, reason: c.discountReason ?? "", approvedBy: c.discountApprovedBy, kind: c.discount?.kind ?? "amount", rate: c.discount?.kind === "percent" ? c.discount.rate : null }));
  const lineDiscounts = live.filter((i) => i.discount > 0).map((i) => ({ itemId: i.itemId, name: i.name, amount: i.discount }));
  const voidRows = voids.map((i) => ({ id: i.id, name: i.name, qty: i.qty, value: lineValue({ ...i, discount: 0 }), reason: i.voidReason ?? "", by: i.voidedBy, afterSend: !!i.firedAt }));
  const refunds = x.payments.filter((p) => (p.status === "refunded" || p.refundOf) && ids.has(p.checkId)).map((p) => ({ id: p.id, method: p.method, amount: p.amount, reference: p.reference }));

  const sorted = (m: Map<string, Bucket>) => [...m.values()].sort((a, b) => b.net - a.net);
  return {
    from, to, days,
    kpis: {
      net: totalNet,
      gross: checks.reduce((a, c) => a + c.subtotal, 0),
      discounts: checks.reduce((a, c) => a + c.discountTotal, 0) + lineDiscounts.reduce((a, d) => a + d.amount, 0),
      service: checks.reduce((a, c) => a + c.service, 0),
      vat: checks.reduce((a, c) => a + c.vat, 0),
      total: checks.reduce((a, c) => a + c.total, 0),
      checks: checks.length,
      covers,
      avgCheck: checks.length ? Math.round(totalNet / checks.length) : 0,
      avgCover: covers ? Math.round(dineNet / covers) : 0,
      tips: pays.filter((p) => p.status === "captured").reduce((a, p) => a + p.tip, 0),
      voidCount: voids.length,
      voidValue: voidRows.reduce((a, v) => a + v.value, 0),
      refunds: refunds.reduce((a, r) => a + r.amount, 0),
      /** dine-in checks per table per day */
      tableTurns: Math.round((dineChecks.length / activeTables / days) * 100) / 100,
    },
    byItem: sorted(byItem),
    byCategory: sorted(byCat),
    byHour: [...byHour.values()].sort((a, b) => a.key.localeCompare(b.key)),
    byDay: [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key)),
    byWeekday: [...byWeekday.values()].sort((a, b) => Number(a.key) - Number(b.key)),
    byChannel: sorted(byChannel),
    byMode: sorted(byMode),
    byTable: sorted(byTable),
    byPayment: sorted(byPay),
    staff: [...staff.values()].sort((a, b) => b.net - a.net),
    discounts,
    lineDiscounts,
    voids: voidRows,
    refunds,
  };
}
export type SalesReport = ReturnType<typeof salesReport>;

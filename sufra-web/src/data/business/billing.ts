/**
 * Billing calculators for Sufra's B2B side (restaurant plans, supplier statements, revenue projection).
 * Integer piastres throughout; rates go through the shared basis-point helpers so rounding matches the rest of Sufra.
 */
import { applyRate, toBasisPoints } from "@/lib/pricing";
import { ADDONS, LIFETIME, PERIODS, PLANS, VAT_RATE, type PeriodId, type PlanId } from "./plans";
import { PAYMENT_COLLECTION_PCT, SUPPLIER_FEE_VAT, SUPPLIER_PLANS, type SupplierPlanId } from "./supplier-plans";

export interface PlanQuote {
  plan: PlanId;
  period: PeriodId;
  /** what is charged now, before VAT */
  net: number;
  vat: number;
  /** net + vat */
  gross: number;
  /** months of service covered (0 = perpetual) */
  months: number;
  /** effective monthly price before VAT (0 for lifetime) */
  perMonth: number;
  /** saving against paying monthly for the same months, before VAT */
  saving: number;
  /** lifetime only: yearly maintenance after the included year, before VAT */
  maintenancePerYear: number;
  /** lifetime + on-prem: one-time setup, before VAT (included in net) */
  onPremSetup: number;
}

const pct = (amount: number, percent: number) => applyRate(amount, toBasisPoints(percent / 100));

export function quotePlan(planId: PlanId, periodId: PeriodId, opts: { onPrem?: boolean } = {}): PlanQuote {
  const plan = PLANS.find((p) => p.id === planId);
  const period = PERIODS.find((p) => p.id === periodId);
  if (!plan || !period) throw new Error(`Unknown plan/period ${planId}/${periodId}`);
  const vatBp = toBasisPoints(VAT_RATE);
  if (period.id === "lifetime") {
    const onPremSetup = opts.onPrem ? LIFETIME.onPremSetup : 0;
    const net = plan.lifetime + onPremSetup;
    const vat = applyRate(net, vatBp);
    return { plan: planId, period: periodId, net, vat, gross: net + vat, months: 0, perMonth: 0, saving: 0, maintenancePerYear: pct(plan.lifetime, plan.maintenancePct), onPremSetup };
  }
  const paid = period.paidMonths ?? period.months;
  const list = plan.monthly * paid;
  const net = list - pct(list, period.discountPct ?? 0);
  const vat = applyRate(net, vatBp);
  const full = plan.monthly * period.months;
  return {
    plan: planId,
    period: periodId,
    net,
    vat,
    gross: net + vat,
    months: period.months,
    perMonth: Math.round(net / period.months),
    saving: full - net,
    maintenancePerYear: 0,
    onPremSetup: 0,
  };
}

/** Months after which owning beats subscribing monthly (lifetime licence ÷ monthly price, rounded up). */
export function breakEvenMonths(planId: PlanId): number {
  const plan = PLANS.find((p) => p.id === planId)!;
  return Math.ceil(plan.lifetime / plan.monthly);
}

/** Monthly add-ons scale with the period the same way the plan does; one-time and packs are charged as is. */
export function quoteAddon(addonId: string, periodId: PeriodId, qty = 1): number {
  const a = ADDONS.find((x) => x.id === addonId);
  const period = PERIODS.find((p) => p.id === periodId);
  if (!a || !period || qty <= 0) return 0;
  if (a.unit !== "month") return a.price * qty;
  if (period.id === "lifetime") return a.price * 12 * qty; // first year, billed yearly for owners
  const paid = period.paidMonths ?? period.months;
  const list = a.price * paid * qty;
  return list - pct(list, period.discountPct ?? 0);
}

/* ───────────────────────── Supplier commission statement ───────────────────────── */

export type SupplierOrderStatus = "new" | "confirmed" | "out" | "delivered" | "invoiced" | "cancelled";
export interface StatementOrder {
  id: string;
  /** order value before VAT, piastres */
  net: number;
  status: SupplierOrderStatus;
  /** paid through Sufra (collection fee applies) */
  collectedBySufra?: boolean;
  /** returned value before VAT, piastres (reduces the commission base) */
  returned?: number;
}

export interface StatementLine {
  id: string;
  base: number;
  commission: number;
  collection: number;
}

export interface SupplierStatement {
  plan: SupplierPlanId;
  lines: StatementLine[];
  /** delivered order value (commission base), before VAT */
  gmv: number;
  subscription: number;
  commission: number;
  collection: number;
  /** subscription + commission + collection, before VAT */
  feesNet: number;
  feesVat: number;
  feesGross: number;
  /** collected by Sufra on the supplier's behalf (order value incl. 14% VAT) */
  collected: number;
  /** what Sufra pays out: collected − feesGross (may be negative → supplier owes Sufra) */
  payout: number;
}

const CHARGEABLE: SupplierOrderStatus[] = ["delivered", "invoiced"];

export function commissionFor(planId: SupplierPlanId, base: number): number {
  const plan = SUPPLIER_PLANS.find((p) => p.id === planId)!;
  if (base <= 0) return 0;
  let c = pct(base, plan.commissionPct);
  if (plan.minCommission) c = Math.max(c, Math.min(plan.minCommission, base));
  if (plan.maxCommission) c = Math.min(c, plan.maxCommission);
  return c;
}

export function supplierStatement(planId: SupplierPlanId, orders: StatementOrder[], opts: { months?: number } = {}): SupplierStatement {
  const plan = SUPPLIER_PLANS.find((p) => p.id === planId);
  if (!plan) throw new Error(`Unknown supplier plan ${planId}`);
  const vatBp = toBasisPoints(SUPPLIER_FEE_VAT);
  const goodsVatBp = toBasisPoints(VAT_RATE);
  const lines: StatementLine[] = [];
  let collected = 0;
  for (const o of orders) {
    if (!CHARGEABLE.includes(o.status)) continue;
    const base = Math.max(0, o.net - Math.max(0, o.returned ?? 0));
    const gross = base + applyRate(base, goodsVatBp);
    const collection = o.collectedBySufra ? pct(gross, PAYMENT_COLLECTION_PCT) : 0;
    if (o.collectedBySufra) collected += gross;
    lines.push({ id: o.id, base, commission: commissionFor(planId, base), collection });
  }
  const gmv = lines.reduce((s, l) => s + l.base, 0);
  const commission = lines.reduce((s, l) => s + l.commission, 0);
  const collection = lines.reduce((s, l) => s + l.collection, 0);
  const subscription = plan.monthly * (opts.months ?? 1);
  const feesNet = subscription + commission + collection;
  const feesVat = applyRate(feesNet, vatBp);
  const feesGross = feesNet + feesVat;
  return { plan: planId, lines, gmv, subscription, commission, collection, feesNet, feesVat, feesGross, collected, payout: collected - feesGross };
}

/* ───────────────────────── Revenue projection (owner's internal page) ───────────────────────── */

export interface RevenueInputs {
  restaurants: number;
  /** average subscription per restaurant per month, EGP */
  avgPlanEgp: number;
  /** online orders + bookings per restaurant per month */
  ordersPerRestaurant: number;
  /** average online order value, EGP */
  avgOrderEgp: number;
  /** Sufra fee on online orders, percent */
  orderFeePct: number;
  suppliers: number;
  /** average supplier subscription, EGP / month */
  avgSupplierPlanEgp: number;
  /** marketplace GMV per month (all suppliers), EGP */
  supplierGmvEgp: number;
  /** supplier commission, percent */
  supplierCommissionPct: number;
  /** share of restaurants buying promoted listings, percent */
  promotedPct?: number;
  /** promoted listing price, EGP / month */
  promotedEgp?: number;
}

export interface RevenueProjection {
  subscriptions: number;
  orderFees: number;
  supplierSubscriptions: number;
  supplierCommission: number;
  promoted: number;
  monthly: number;
  yearly: number;
}

/** Monthly revenue in piastres. */
export function projectRevenue(i: RevenueInputs): RevenueProjection {
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  const subscriptions = Math.round(n(i.restaurants) * n(i.avgPlanEgp) * 100);
  const orderFees = pct(Math.round(n(i.restaurants) * n(i.ordersPerRestaurant) * n(i.avgOrderEgp) * 100), n(i.orderFeePct));
  const supplierSubscriptions = Math.round(n(i.suppliers) * n(i.avgSupplierPlanEgp) * 100);
  const supplierCommission = pct(Math.round(n(i.supplierGmvEgp) * 100), n(i.supplierCommissionPct));
  const promoted = Math.round((n(i.restaurants) * n(i.promotedPct ?? 0)) / 100) * Math.round(n(i.promotedEgp ?? 0) * 100);
  const monthly = subscriptions + orderFees + supplierSubscriptions + supplierCommission + promoted;
  return { subscriptions, orderFees, supplierSubscriptions, supplierCommission, promoted, monthly, yearly: monthly * 12 };
}

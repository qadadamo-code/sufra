/**
 * Alerts center (pure): aggregates what needs a manager from the live rows + who gets notified (rules).
 *
 * Sources: escalated guest calls (lib/service-calls), late deliveries (dispatch.promisedAt), low stock (pluggable —
 * inventory registers a source with `registerLowStockSource`), cash over/short + camera exceptions (cameras/events.ts),
 * failed online payments (paymentIntents), support tickets past SLA (support/tickets.ts).
 */
import type { Localized, Order, PaymentIntentRow, ServiceCall } from "@/data/types";
import type { Role } from "@/auth/roles";
import { needsManager, type Sla as CallSla } from "@/lib/service-calls";
import type { AlertKind, AlertRule, SupportTicket } from "../types";
import type { VideoEvent } from "../cameras/events";
import { slaView, type Sla as TicketSla } from "../support/tickets";

export interface Alert {
  /** stable key (ack id) */
  id: string;
  kind: AlertKind;
  severity: "info" | "warn" | "high";
  title: Localized;
  detail: Localized;
  at: string;
  /** deep link */
  path: string;
  branchId: string | null;
}

export const ALERT_KINDS: AlertKind[] = ["call_escalated", "late_delivery", "low_stock", "cash_variance", "camera_exception", "payment_failed", "ticket_sla", "device_offline"];

export const ALERT_LABEL: Record<AlertKind, Localized> = {
  call_escalated: { ar: "نداء متصعّد", en: "Escalated call" },
  late_delivery: { ar: "دليفري متأخر", en: "Late delivery" },
  low_stock: { ar: "مخزون قليل", en: "Low stock" },
  cash_variance: { ar: "عجز / زيادة نقدية", en: "Cash over/short" },
  camera_exception: { ar: "استثناء كاميرا", en: "Camera exception" },
  payment_failed: { ar: "دفع فشل", en: "Failed payment" },
  ticket_sla: { ar: "تذكرة عدّت الـ SLA", en: "Ticket past SLA" },
  device_offline: { ar: "جهاز أوفلاين", en: "Device offline" },
};

export const DEFAULT_RULES: AlertRule[] = [
  { kind: "call_escalated", enabled: true, notify: ["owner", "admin", "manager"], threshold: 0 },
  { kind: "late_delivery", enabled: true, notify: ["manager", "cashier"], threshold: 10 },
  { kind: "low_stock", enabled: true, notify: ["owner", "manager", "chef"], threshold: 0 },
  { kind: "cash_variance", enabled: true, notify: ["owner", "admin", "accountant"], threshold: 2_000_000 },
  { kind: "camera_exception", enabled: true, notify: ["owner", "admin"], threshold: 0 },
  { kind: "payment_failed", enabled: true, notify: ["manager", "cashier"], threshold: 0 },
  { kind: "ticket_sla", enabled: true, notify: ["owner", "manager"], threshold: 0 },
  { kind: "device_offline", enabled: false, notify: ["manager"], threshold: 5 },
];

export function ruleFor(rules: AlertRule[] | undefined, kind: AlertKind): AlertRule {
  return rules?.find((r) => r.kind === kind) ?? DEFAULT_RULES.find((r) => r.kind === kind)!;
}

/** Should this role be notified (toast / push) about this alert? */
export function shouldNotify(rules: AlertRule[] | undefined, a: Pick<Alert, "kind">, role: Role | null): boolean {
  const r = ruleFor(rules, a.kind);
  return !!role && r.enabled && r.notify.includes(role);
}

export interface LowStockItem {
  id: string;
  name: Localized;
  qty: number;
  unit: string;
  par: number;
  branchId: string | null;
}
type LowStockSource = () => LowStockItem[];
const lowStockSources = new Set<LowStockSource>();
/** Inventory plugs in here (keeps ops independent of the inventory schema). */
export function registerLowStockSource(fn: LowStockSource) {
  lowStockSources.add(fn);
  return () => lowStockSources.delete(fn);
}
export const lowStockNow = () => [...lowStockSources].flatMap((f) => {
  try {
    return f();
  } catch {
    return [];
  }
});

export interface AlertInputs {
  now: number;
  calls: (ServiceCall & { table?: string })[];
  callSla: CallSla;
  orders: Pick<Order, "id" | "number" | "branchId" | "dispatch" | "status" | "mode">[];
  lateGraceMin?: number;
  lowStock: LowStockItem[];
  events: VideoEvent[];
  payments: Pick<PaymentIntentRow, "id" | "status" | "amount" | "updatedAt" | "provider" | "branchId">[];
  tickets: Pick<SupportTicket, "id" | "number" | "subject" | "priority" | "status" | "createdAt" | "firstResponseAt" | "resolvedAt" | "branchId">[];
  ticketSla: TicketSla;
  rules?: AlertRule[];
  /** only the last N hours (events, payments) */
  windowH?: number;
  money: (units: number) => string;
}

const ACTIVE_STAGES = new Set(["accepted", "assigned", "picked_up", "arrived"]);

export function buildAlerts(x: AlertInputs): Alert[] {
  const out: Alert[] = [];
  const on = (k: AlertKind) => ruleFor(x.rules, k).enabled;
  const since = x.now - (x.windowH ?? 24) * 3600_000;

  if (on("call_escalated"))
    for (const c of x.calls)
      if (c.status === "open" && needsManager(c, x.now, x.callSla))
        out.push({
          id: `call:${c.id}`, kind: "call_escalated", severity: "high", at: c.createdAt, path: "/waiter", branchId: c.branchId,
          title: { ar: `طاولة ${c.table ?? "?"} مستنية`, en: `Table ${c.table ?? "?"} waiting` },
          detail: { ar: `محدش ردّ من ${Math.round((x.now - Date.parse(c.createdAt)) / 60000)} دقيقة`, en: `No answer for ${Math.round((x.now - Date.parse(c.createdAt)) / 60000)} min` },
        });

  if (on("late_delivery")) {
    const grace = (x.lateGraceMin ?? ruleFor(x.rules, "late_delivery").threshold) * 60_000;
    for (const o of x.orders) {
      const d = o.dispatch;
      if (!d || !ACTIVE_STAGES.has(d.stage) || !d.promisedAt) continue;
      const late = x.now - Date.parse(d.promisedAt);
      if (late > grace)
        out.push({
          id: `late:${o.id}`, kind: "late_delivery", severity: late > grace + 15 * 60_000 ? "high" : "warn", at: d.promisedAt, path: "/delivery/dispatch", branchId: o.branchId,
          title: { ar: `أوردر #${o.number} متأخر`, en: `Order #${o.number} is late` },
          detail: { ar: `متأخر ${Math.round(late / 60000)} دقيقة عن الوقت الموعود`, en: `${Math.round(late / 60000)} min past the promised time` },
        });
    }
  }

  if (on("low_stock"))
    for (const s of x.lowStock)
      out.push({
        id: `stock:${s.id}`, kind: "low_stock", severity: s.qty <= 0 ? "high" : "warn", at: new Date(x.now).toISOString(), path: "/inventory", branchId: s.branchId,
        title: { ar: `${s.name.ar} قرب يخلص`, en: `${s.name.en} running low` },
        detail: { ar: `الموجود ${s.qty} ${s.unit} (الحد ${s.par})`, en: `${s.qty} ${s.unit} left (par ${s.par})` },
      });

  const varianceMin = ruleFor(x.rules, "cash_variance").threshold;
  for (const e of x.events) {
    if (Date.parse(e.at) < since) continue;
    if (e.kind === "cash_variance") {
      if (!on("cash_variance") || Math.abs(e.signed ?? 0) < varianceMin) continue;
      const short = (e.signed ?? 0) < 0;
      out.push({
        id: `ev:${e.id}`, kind: "cash_variance", severity: short ? "high" : "warn", at: e.at, path: "/cameras/events", branchId: e.branchId,
        title: short ? { ar: `عجز ${x.money(e.amount ?? 0)}`, en: `Short ${x.money(e.amount ?? 0)}` } : { ar: `زيادة ${x.money(e.amount ?? 0)}`, en: `Over ${x.money(e.amount ?? 0)}` },
        detail: { ar: `${e.device ?? "درج"} — راجع الفيديو`, en: `${e.device ?? "Drawer"} — review the video` },
      });
    } else if (on("camera_exception") && e.severity === "high") {
      out.push({
        id: `ev:${e.id}`, kind: "camera_exception", severity: "warn", at: e.at, path: "/cameras/events", branchId: e.branchId,
        title: { ar: e.kind === "refund" ? "مرتجع" : e.kind === "void" ? "إلغاء دفع/صنف" : "خصم كبير", en: e.kind === "refund" ? "Refund" : e.kind === "void" ? "Void" : "Large discount" },
        detail: { ar: `${e.device ?? ""}${e.amount ? " · " + x.money(e.amount) : ""}`, en: `${e.device ?? ""}${e.amount ? " · " + x.money(e.amount) : ""}` },
      });
    }
  }

  if (on("payment_failed"))
    for (const p of x.payments)
      if (p.status === "failed" && Date.parse(p.updatedAt) >= since)
        out.push({
          id: `pay:${p.id}`, kind: "payment_failed", severity: "warn", at: p.updatedAt, path: "/payments", branchId: p.branchId,
          title: { ar: `دفع أونلاين فشل ${x.money(p.amount)}`, en: `Online payment failed ${x.money(p.amount)}` },
          detail: { ar: p.provider, en: p.provider },
        });

  if (on("ticket_sla"))
    for (const t of x.tickets) {
      const v = slaView(t, x.ticketSla, x.now);
      if (v.worst === "breached" && t.status !== "resolved" && t.status !== "closed")
        out.push({
          id: `tk:${t.id}`, kind: "ticket_sla", severity: t.priority === "urgent" || t.priority === "high" ? "high" : "warn", at: t.createdAt, path: `/support/t/${t.id}`, branchId: t.branchId,
          title: { ar: `تذكرة ${t.number} عدّت الوقت`, en: `Ticket ${t.number} past SLA` },
          detail: { ar: t.subject, en: t.subject },
        });
    }

  const rank = { high: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || Date.parse(b.at) - Date.parse(a.at));
}

/**
 * POS ↔ video exception linking (pure).
 *
 * Every sensitive POS action already lands in audit_log (pos/ops.ts, pos/sale.ts, kitchen/ops.ts, delivery/settle.ts).
 * `eventFromAudit` turns the ones a loss-prevention review cares about into a video event with the device and staff,
 * `camerasFor` picks the cameras that see that device / drawer / table. Cloud mirrors this in 0013_ops.sql (ops_video_events view).
 */
import type { AuditEntry, CashMovement, Check, Order, OrderItem, Receipt, Shift } from "@/data/types";
import type { Camera } from "../types";

export type VideoEventKind = "void" | "refund" | "discount" | "no_sale" | "cash_variance" | "item_86";

export const EVENT_KINDS: VideoEventKind[] = ["void", "refund", "discount", "no_sale", "cash_variance", "item_86"];

export interface VideoEvent {
  /** = audit entry id */
  id: string;
  kind: VideoEventKind;
  at: string;
  branchId: string | null;
  actorId: string | null;
  approvedBy: string | null;
  /** POS device code (POS1 …), "KDS" for the kitchen, "RIDER" for delivery settlement; null when unknown */
  device: string | null;
  tableIds: string[];
  /** money involved, units (absolute); null when not money */
  amount: number | null;
  /** signed for cash variance (negative = short) */
  signed: number | null;
  reason: string;
  entity: string;
  entityId: string | null;
  severity: "info" | "warn" | "high";
}

export interface EventLookups {
  shifts: Pick<Shift, "id" | "device" | "openedBy" | "branchId" | "openedAt" | "closedAt" | "status">[];
  cashMovements?: Pick<CashMovement, "id" | "shiftId">[];
  receipts?: Pick<Receipt, "id" | "device" | "checkId">[];
  checks?: Pick<Check, "id" | "tableIds" | "total">[];
  orderItems?: Pick<OrderItem, "id" | "orderId" | "unitPrice" | "qty">[];
  orders?: Pick<Order, "id" | "checkId" | "tableIds">[];
  /** discounts above this % are exceptions (Settings.discountApprovalPct) */
  discountLimitPct: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The POS device the actor was working on at that moment (their open shift), when the row itself doesn't say. */
export function deviceOfActor(actorId: string | null, at: string, branchId: string | null, shifts: EventLookups["shifts"]): string | null {
  if (!actorId) return null;
  const t = Date.parse(at);
  const s = shifts
    .filter((x) => x.openedBy === actorId && (!branchId || x.branchId === branchId) && Date.parse(x.openedAt) <= t && (!x.closedAt || Date.parse(x.closedAt) >= t))
    .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt))[0];
  return s?.device ?? null;
}

function tablesOf(e: AuditEntry, lk: EventLookups): string[] {
  if (Array.isArray(e.data.tableIds)) return e.data.tableIds as string[];
  if (e.entity === "checks" && e.entityId) return lk.checks?.find((c) => c.id === e.entityId)?.tableIds ?? [];
  if (e.entity === "orderItems" && e.entityId) {
    const it = lk.orderItems?.find((i) => i.id === e.entityId);
    const o = it ? lk.orders?.find((x) => x.id === it.orderId) : null;
    if (o?.tableIds.length) return o.tableIds;
    const c = o ? lk.checks?.find((x) => x.id === o.checkId) : null;
    return c?.tableIds ?? [];
  }
  if (e.entity === "receipts" && e.entityId) {
    const r = lk.receipts?.find((x) => x.id === e.entityId);
    return (r && lk.checks?.find((c) => c.id === r.checkId)?.tableIds) || [];
  }
  return [];
}

function deviceOf(e: AuditEntry, lk: EventLookups): string | null {
  if (typeof e.data.device === "string") return e.data.device;
  if (e.entity === "shifts" && e.entityId) return lk.shifts.find((s) => s.id === e.entityId)?.device ?? null;
  if (e.entity === "cashMovements" && e.entityId) {
    const m = lk.cashMovements?.find((x) => x.id === e.entityId);
    const s = m ? lk.shifts.find((x) => x.id === m.shiftId) : null;
    if (s) return s.device;
  }
  if (e.entity === "receipts" && e.entityId) {
    const r = lk.receipts?.find((x) => x.id === e.entityId);
    if (r) return r.device;
  }
  return deviceOfActor(e.actorId, e.createdAt, e.branchId, lk.shifts);
}

/** Discount size in % from the audit payload ({pct} | {discount:{kind,rate|value}} | {units}). */
function discountPct(e: AuditEntry, lk: EventLookups): number | null {
  const pct = num(e.data.pct);
  if (pct != null) return pct;
  const d = e.data.discount as { kind?: string; rate?: number; value?: number } | null | undefined;
  if (d?.kind === "percent" && typeof d.rate === "number") return d.rate / 100;
  if (d?.kind === "amount" && typeof d.value === "number") {
    const c = e.entityId ? lk.checks?.find((x) => x.id === e.entityId) : null;
    return c && c.total > 0 ? (d.value / (c.total + d.value)) * 100 : null;
  }
  return null;
}

/** null = not a video exception. */
export function eventFromAudit(e: AuditEntry, lk: EventLookups): VideoEvent | null {
  let kind: VideoEventKind | null = null;
  let amount: number | null = null;
  let signed: number | null = null;
  let severity: VideoEvent["severity"] = "warn";
  switch (e.action) {
    case "order.void": {
      kind = "void";
      const it = lk.orderItems?.find((i) => i.id === e.entityId);
      amount = it ? it.unitPrice * (num(e.data.qty) ?? it.qty) : null;
      severity = e.approvedBy ? "warn" : "info";
      break;
    }
    case "payment.void":
      kind = "void";
      amount = num(e.data.amount);
      severity = "high";
      break;
    case "payment.refund":
      kind = "refund";
      amount = num(e.data.total);
      severity = "high";
      break;
    case "check.discount":
    case "item.discount": {
      const pct = discountPct(e, lk);
      const over = pct != null ? pct > lk.discountLimitPct : !!e.approvedBy;
      if (!over) return null;
      kind = "discount";
      amount = num(e.data.units);
      severity = pct != null && pct >= 30 ? "high" : "warn";
      break;
    }
    case "drawer.open":
      kind = "no_sale";
      break;
    case "shift.close":
    case "delivery.settle": {
      const diff = num(e.data.difference);
      if (!diff) return null;
      kind = "cash_variance";
      signed = diff;
      amount = Math.abs(diff);
      severity = diff < 0 ? "high" : "warn";
      break;
    }
    case "menu.86":
      kind = "item_86";
      severity = "info";
      break;
    default:
      return null;
  }
  const device = e.action === "menu.86" ? "KDS" : e.action === "delivery.settle" ? deviceOfActor(e.actorId, e.createdAt, e.branchId, lk.shifts) ?? "RIDER" : deviceOf(e, lk);
  return {
    id: e.id,
    kind,
    at: e.createdAt,
    branchId: e.branchId,
    actorId: e.actorId,
    approvedBy: e.approvedBy,
    device,
    tableIds: tablesOf(e, lk),
    amount,
    signed,
    reason: str(e.data.reason) || str(e.data.item),
    entity: e.entity,
    entityId: e.entityId,
    severity,
  };
}

export function eventsFromAudit(entries: AuditEntry[], lk: EventLookups): VideoEvent[] {
  const out: VideoEvent[] = [];
  for (const e of entries) {
    const v = eventFromAudit(e, lk);
    if (v) out.push(v);
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/**
 * Cameras that see the event: same branch, active, and linked to its POS device, its drawer (device code) or one of its
 * tables. Kitchen 86s go to cameras linked to "KDS". Ranked: device match first, then table match.
 */
export function camerasFor(ev: Pick<VideoEvent, "device" | "tableIds" | "branchId">, cameras: Camera[]): Camera[] {
  const scored: { c: Camera; s: number }[] = [];
  for (const c of cameras) {
    if (!c.active || (ev.branchId && c.branchId !== ev.branchId)) continue;
    let s = 0;
    if (ev.device && (c.posDevices.includes(ev.device) || c.drawers.includes(ev.device))) s += 2;
    if (ev.tableIds.some((t) => c.tableIds.includes(t))) s += 1;
    if (s) scored.push({ c, s });
  }
  return scored.sort((a, b) => b.s - a.s || a.c.sort - b.c.sort).map((x) => x.c);
}

export interface EventFilter {
  kinds?: VideoEventKind[];
  device?: string | null;
  actorId?: string | null;
  from?: string | null;
  to?: string | null;
  unreviewed?: boolean;
}

export function filterEvents(evs: VideoEvent[], f: EventFilter, reviewed: Set<string> = new Set()): VideoEvent[] {
  return evs.filter(
    (e) =>
      (!f.kinds?.length || f.kinds.includes(e.kind)) &&
      (!f.device || e.device === f.device) &&
      (!f.actorId || e.actorId === f.actorId || e.approvedBy === f.actorId) &&
      (!f.from || e.at >= f.from) &&
      (!f.to || e.at <= f.to) &&
      (!f.unreviewed || !reviewed.has(e.id)),
  );
}

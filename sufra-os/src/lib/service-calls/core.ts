/**
 * Service calls — the pure core (no React, no I/O). Shared by the waiter app, the floor plan badges,
 * the manager bell and the guest QR page.
 *
 *   const sla = slaFrom(settings);                       // thresholds (seconds), with defaults
 *   callLevel(call, Date.now(), sla)                     // "fresh" | "warn" | "escalated" | "critical" | "ack" | "closed"
 *   sortInbox(calls, now, sla)                           // most urgent first
 *   callStats(calls, { now })                            // avg response, per waiter, per table
 *
 * Escalation ladder for an unacknowledged call (thresholds are scaled by the call's priority):
 *   0 ─ warnSec ─▶ "warn" (amber) ─ escalateSec ─▶ "escalated" (manager is notified) ─ criticalSec ─▶ "critical" (red)
 */
import type { ServiceCall, ServiceCallType, Settings } from "@/data/types";

export type CallPriority = "low" | "normal" | "high" | "urgent";
export type CallLevel = "fresh" | "warn" | "escalated" | "critical" | "ack" | "closed";

export interface Sla {
  /** unacknowledged this long → amber */
  warnSec: number;
  /** → the manager/owner is notified (bell + floor) */
  escalateSec: number;
  /** → red */
  criticalSec: number;
}
export const DEFAULT_SLA: Sla = { warnSec: 60, escalateSec: 120, criticalSec: 300 };

export function slaFrom(settings: Pick<Settings, "serviceCalls"> | null | undefined): Sla {
  const s = settings?.serviceCalls;
  if (!s) return DEFAULT_SLA;
  const warnSec = pos(s.warnSec, DEFAULT_SLA.warnSec);
  const escalateSec = Math.max(warnSec, pos(s.escalateSec, DEFAULT_SLA.escalateSec));
  const criticalSec = Math.max(escalateSec, pos(s.criticalSec, DEFAULT_SLA.criticalSec));
  return { warnSec, escalateSec, criticalSec };
}
const pos = (n: unknown, d: number) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : d);

export interface CallTypeMeta {
  type: ServiceCallType;
  priority: CallPriority;
  /** shown as a quick button on the guest QR page */
  guest: boolean;
  /** a guest request (counts in response-time KPIs); "pickup" is kitchen → waiter */
  guestFacing: boolean;
}

/** Order = the order buttons appear in on the guest page. */
export const CALL_TYPES: CallTypeMeta[] = [
  { type: "waiter", priority: "normal", guest: true, guestFacing: true },
  { type: "water", priority: "normal", guest: true, guestFacing: true },
  { type: "napkins", priority: "low", guest: true, guestFacing: true },
  { type: "coffee", priority: "normal", guest: true, guestFacing: true },
  { type: "tea", priority: "normal", guest: true, guestFacing: true },
  { type: "item", priority: "normal", guest: true, guestFacing: true },
  { type: "clean_table", priority: "low", guest: true, guestFacing: true },
  { type: "bill", priority: "high", guest: true, guestFacing: true },
  { type: "complaint", priority: "urgent", guest: true, guestFacing: true },
  { type: "help", priority: "high", guest: false, guestFacing: true },
  { type: "other", priority: "normal", guest: true, guestFacing: true },
  { type: "pickup", priority: "high", guest: false, guestFacing: false },
];
const META = new Map(CALL_TYPES.map((m) => [m.type, m]));
export const callMeta = (type: ServiceCallType): CallTypeMeta => META.get(type) ?? { type, priority: "normal", guest: false, guestFacing: true };
export const GUEST_CALL_TYPES = CALL_TYPES.filter((m) => m.guest).map((m) => m.type);

/** Urgent calls escalate twice as fast; low-priority ones get 50% longer. */
export const PRIORITY_FACTOR: Record<CallPriority, number> = { urgent: 0.5, high: 0.75, normal: 1, low: 1.5 };
const PRIORITY_RANK: Record<CallPriority, number> = { urgent: 3, high: 2, normal: 1, low: 0 };

/** The thresholds that apply to one call type. */
export function slaFor(type: ServiceCallType, sla: Sla = DEFAULT_SLA): Sla {
  const f = PRIORITY_FACTOR[callMeta(type).priority];
  return { warnSec: Math.round(sla.warnSec * f), escalateSec: Math.round(sla.escalateSec * f), criticalSec: Math.round(sla.criticalSec * f) };
}

type CallLike = Pick<ServiceCall, "type" | "status" | "createdAt" | "ackAt" | "doneAt">;

/** Seconds the guest has been waiting for an answer (to the acknowledgement, or now). */
export function waitingSec(call: CallLike, now: number = Date.now()): number {
  const end = call.ackAt ? Date.parse(call.ackAt) : call.doneAt ? Date.parse(call.doneAt) : now;
  return Math.max(0, Math.floor((end - Date.parse(call.createdAt)) / 1000));
}

export function callLevel(call: CallLike, now: number = Date.now(), sla: Sla = DEFAULT_SLA): CallLevel {
  if (call.status === "done" || call.status === "cancelled") return "closed";
  if (call.status === "ack") return "ack";
  const s = slaFor(call.type, sla);
  const w = waitingSec(call, now);
  if (w >= s.criticalSec) return "critical";
  if (w >= s.escalateSec) return "escalated";
  if (w >= s.warnSec) return "warn";
  return "fresh";
}

/** True once the manager should know about it (escalated or worse, still unanswered). */
export const needsManager = (call: CallLike, now?: number, sla?: Sla) => {
  const l = callLevel(call, now, sla);
  return l === "escalated" || l === "critical";
};

/** Seconds until the call reaches its next level (null when it can't get worse). For scheduling re-renders/alerts. */
export function secondsToNextLevel(call: CallLike, now: number = Date.now(), sla: Sla = DEFAULT_SLA): number | null {
  if (call.status !== "open") return null;
  const s = slaFor(call.type, sla);
  const w = waitingSec(call, now);
  for (const t of [s.warnSec, s.escalateSec, s.criticalSec]) if (w < t) return t - w;
  return null;
}

/** Calls that just crossed into "escalated" and haven't been stamped yet (the client stamps escalatedAt once). */
export function toEscalate<T extends CallLike & Pick<ServiceCall, "escalatedAt">>(calls: T[], now: number = Date.now(), sla: Sla = DEFAULT_SLA): T[] {
  return calls.filter((c) => c.status === "open" && !c.escalatedAt && needsManager(c, now, sla));
}

const LEVEL_RANK: Record<CallLevel, number> = { critical: 5, escalated: 4, warn: 3, fresh: 2, ack: 1, closed: 0 };

/** Inbox order: most urgent level, then priority, then longest waiting. */
export function sortInbox<T extends CallLike>(calls: T[], now: number = Date.now(), sla: Sla = DEFAULT_SLA): T[] {
  return [...calls].sort((a, b) => {
    const l = LEVEL_RANK[callLevel(b, now, sla)] - LEVEL_RANK[callLevel(a, now, sla)];
    if (l) return l;
    const p = PRIORITY_RANK[callMeta(b.type).priority] - PRIORITY_RANK[callMeta(a.type).priority];
    if (p) return p;
    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });
}

/* ───────── routing ───────── */

/**
 * Who should answer a call: the table's section waiter, else the waiter on the table's open order, else nobody (everyone sees it).
 * `owners` maps tableId → waiter membership id (see `tableOwners`).
 */
export function assigneeOf(call: Pick<ServiceCall, "tableId">, owners: Map<string, string | null>): string | null {
  return owners.get(call.tableId) ?? null;
}

/** tableId → responsible waiter: section assignment first, then the waiter on the newest active order at that table. */
export function tableOwners(
  tables: { id: string; waiterId?: string | null }[],
  orders: { tableIds: string[]; waiterId: string | null; status: string; openedAt: string }[],
): Map<string, string | null> {
  const m = new Map<string, string | null>();
  const active = orders.filter((o) => o.waiterId && !["closed", "void"].includes(o.status)).sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt));
  for (const o of active) for (const t of o.tableIds) m.set(t, o.waiterId);
  for (const t of tables) if (t.waiterId) m.set(t.id, t.waiterId);
  return m;
}

/** A waiter's inbox: calls for their tables + unassigned calls + anything escalated (all hands). */
export function isForWaiter(call: CallLike & Pick<ServiceCall, "tableId">, waiterId: string, owners: Map<string, string | null>, now?: number, sla?: Sla): boolean {
  const who = assigneeOf(call, owners);
  return !who || who === waiterId || needsManager(call, now, sla);
}

/* ───────── creation rules (used by the guest page + staff) ───────── */

export const DEDUPE_WINDOW_SEC = 120;
export const MAX_TEXT = 200;

/** An open/ack call of the same type from the same table in the last 2 minutes — the new one merges into it. */
export function findDuplicate<T extends Pick<ServiceCall, "tableId" | "type" | "status" | "createdAt">>(existing: T[], tableId: string, type: ServiceCallType, now: number = Date.now()): T | null {
  if (type === "other" || type === "complaint") return null; // free text is never merged
  return existing.find((c) => c.tableId === tableId && c.type === type && (c.status === "open" || c.status === "ack") && now - Date.parse(c.createdAt) < DEDUPE_WINDOW_SEC * 1000) ?? null;
}

export function cleanText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

/* ───────── statistics ───────── */

export interface ResponseStats {
  count: number;
  answered: number;
  /** mean seconds to acknowledgement (answered calls) */
  avgSec: number | null;
  /** 90th percentile seconds */
  p90Sec: number | null;
  /** answered later than escalateSec, or still open past it */
  late: number;
  open: number;
}

export interface CallStats extends ResponseStats {
  byWaiter: (ResponseStats & { waiterId: string })[];
  byTable: (ResponseStats & { tableId: string })[];
  byType: (ResponseStats & { type: ServiceCallType })[];
}

function summarize(calls: CallLike[], now: number, sla: Sla): ResponseStats {
  const answered = calls.filter((c) => c.ackAt || c.doneAt);
  const secs = answered.map((c) => waitingSec(c, now)).sort((a, b) => a - b);
  const late = calls.filter((c) => {
    if (c.status === "cancelled") return false;
    const s = slaFor(c.type, sla);
    return waitingSec(c, now) >= s.escalateSec;
  }).length;
  return {
    count: calls.length,
    answered: answered.length,
    avgSec: secs.length ? Math.round(secs.reduce((a, b) => a + b, 0) / secs.length) : null,
    p90Sec: secs.length ? secs[Math.min(secs.length - 1, Math.ceil(secs.length * 0.9) - 1)] : null,
    late,
    open: calls.filter((c) => c.status === "open").length,
  };
}

/** Response-time KPIs. Pickup pings (kitchen → waiter) and cancelled calls are left out. */
export function callStats<T extends CallLike & Pick<ServiceCall, "tableId" | "ackBy">>(calls: T[], opts: { now?: number; sla?: Sla } = {}): CallStats {
  const now = opts.now ?? Date.now();
  const sla = opts.sla ?? DEFAULT_SLA;
  const xs = calls.filter((c) => callMeta(c.type).guestFacing && c.status !== "cancelled");
  const group = <K extends string>(key: (c: T) => K | null) => {
    const m = new Map<K, T[]>();
    for (const c of xs) {
      const k = key(c);
      if (k === null) continue;
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.entries()];
  };
  return {
    ...summarize(xs, now, sla),
    byWaiter: group((c) => c.ackBy)
      .map(([waiterId, cs]) => ({ waiterId, ...summarize(cs, now, sla) }))
      .sort((a, b) => (a.avgSec ?? Infinity) - (b.avgSec ?? Infinity)),
    byTable: group((c) => c.tableId)
      .map(([tableId, cs]) => ({ tableId, ...summarize(cs, now, sla) }))
      .sort((a, b) => b.count - a.count),
    byType: group((c) => c.type)
      .map(([type, cs]) => ({ type, ...summarize(cs, now, sla) }))
      .sort((a, b) => b.count - a.count),
  };
}

/** "45s" / "3:05" / "1h 04" — short, Latin digits. */
export function fmtWait(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}:${String(s).padStart(2, "0")}`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}`;
}

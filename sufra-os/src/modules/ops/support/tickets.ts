/**
 * Ticket rules (pure): SLA clocks, breach + escalation, numbering, transitions.
 *
 * SLA per priority (minutes): first response, and resolution. The clock runs from createdAt; "pending" (waiting for the
 * guest / Sufra) pauses nothing — kept simple and strict, like a restaurant manager would read it.
 * Escalation: an unanswered ticket past its response SLA, or an unresolved one past its resolution SLA, goes up one
 * priority level (urgent stays urgent) and is flagged escalatedAt — the alerts center picks it up.
 */
import type { SupportTicket, TicketPriority, TicketStatus } from "../types";

export type Sla = Record<TicketPriority, { response: number; resolve: number }>;

export const DEFAULT_SLA: Sla = {
  urgent: { response: 10, resolve: 60 },
  high: { response: 30, resolve: 4 * 60 },
  normal: { response: 2 * 60, resolve: 24 * 60 },
  low: { response: 8 * 60, resolve: 72 * 60 },
};

export const PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];
export const bump = (p: TicketPriority): TicketPriority => PRIORITIES[Math.min(PRIORITIES.length - 1, PRIORITIES.indexOf(p) + 1)];

export type SlaState = "ok" | "due_soon" | "breached" | "met" | "closed";

export interface SlaView {
  response: { dueAt: string; state: SlaState; leftMin: number };
  resolve: { dueAt: string; state: SlaState; leftMin: number };
  /** the clock that matters now */
  worst: SlaState;
}

type T = Pick<SupportTicket, "priority" | "status" | "createdAt" | "firstResponseAt" | "resolvedAt">;

const done = (s: TicketStatus) => s === "resolved" || s === "closed";

function clock(start: number, minutes: number, metAt: string | null, closed: boolean, now: number) {
  const due = start + minutes * 60_000;
  const leftMin = Math.round((due - now) / 60_000);
  let state: SlaState;
  if (metAt) state = Date.parse(metAt) <= due ? "met" : "breached";
  else if (closed) state = "closed";
  else if (now > due) state = "breached";
  else if (leftMin <= Math.max(5, minutes * 0.2)) state = "due_soon";
  else state = "ok";
  return { dueAt: new Date(due).toISOString(), state, leftMin };
}

export function slaView(t: T, sla: Sla = DEFAULT_SLA, now = Date.now()): SlaView {
  const s = Date.parse(t.createdAt);
  const cfg = sla[t.priority] ?? DEFAULT_SLA.normal;
  const response = clock(s, cfg.response, t.firstResponseAt, done(t.status), now);
  const resolve = clock(s, cfg.resolve, t.resolvedAt, t.status === "closed" && !t.resolvedAt, now);
  const order: SlaState[] = ["breached", "due_soon", "ok", "met", "closed"];
  const live = [!t.firstResponseAt && !done(t.status) ? response.state : null, !done(t.status) ? resolve.state : null].filter(Boolean) as SlaState[];
  const worst = live.length ? live.sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] : resolve.state === "breached" || response.state === "breached" ? "breached" : "met";
  return { response, resolve, worst };
}

/** Tickets that should be escalated now, with their new priority. Already-escalated tickets escalate again only after another full response window. */
export function toEscalate<X extends T & Pick<SupportTicket, "id" | "escalatedAt">>(tickets: X[], sla: Sla = DEFAULT_SLA, now = Date.now()): { ticket: X; priority: TicketPriority }[] {
  const out: { ticket: X; priority: TicketPriority }[] = [];
  for (const t of tickets) {
    if (done(t.status)) continue;
    const v = slaView(t, sla, now);
    const breached = (!t.firstResponseAt && v.response.state === "breached") || v.resolve.state === "breached";
    if (!breached) continue;
    if (t.escalatedAt && now - Date.parse(t.escalatedAt) < (sla[t.priority] ?? DEFAULT_SLA.normal).response * 60_000) continue;
    out.push({ ticket: t, priority: bump(t.priority) });
  }
  return out;
}

const NEXT: Record<TicketStatus, TicketStatus[]> = {
  new: ["open", "pending", "resolved", "closed"],
  open: ["pending", "resolved", "closed"],
  pending: ["open", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: ["open"],
};
export const canMove = (from: TicketStatus, to: TicketStatus) => from === to || NEXT[from].includes(to);

/** Next human number: G-1001 (guest) / S-0001 (Sufra support), per restaurant. */
export function nextNumber(kind: SupportTicket["kind"], existing: Pick<SupportTicket, "number" | "kind">[]): string {
  const prefix = kind === "guest" ? "G" : "S";
  const base = kind === "guest" ? 1000 : 0;
  let max = base;
  for (const e of existing) {
    if (e.kind !== kind) continue;
    const n = parseInt(e.number.split("-")[1] ?? "", 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

/** Guest complaint → priority from the category + words (food safety / allergy / overcharge are urgent). */
export function guessPriority(category: string, text: string): TicketPriority {
  const t = `${category} ${text}`.toLowerCase();
  if (/allerg|حساسي|تسمم|poison|food safety|صرصار|حشر|insect|hair|شعر|glass|زجاج/.test(t)) return "urgent";
  if (category === "billing" || /overcharg|اتحاسب|زيادة|refund|فلوس|money/.test(t)) return "high";
  if (category === "suggestion" || category === "praise") return "low";
  return "normal";
}

export const GUEST_CATEGORIES = ["food", "service", "billing", "delivery", "cleanliness", "suggestion", "praise", "other"] as const;
export const SUFRA_CATEGORIES = ["bug", "pos", "printer", "payments", "eta", "delivery", "account", "feature", "other"] as const;

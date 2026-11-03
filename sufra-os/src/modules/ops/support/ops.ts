/**
 * Ticket data operations. Guest complaints come in through `submitGuestComplaint` (public pages: local rows, or the
 * anon RPC guest_complaint_submit in 0013_ops.sql); staff tickets to Sufra through `requestSufraSupport`, which also
 * forwards to /api/support-ticket (email/webhook from env) when it is deployed.
 */
import type { Db } from "@/data/hooks";
import type { Repo } from "@/data/repo";
import { normalizePhone } from "@/modules/guest/api/service";
import { nowIso } from "@/lib/time";
import { uuid } from "@/lib/id";
import type { Diagnostics, SupportTicket, TicketNote, TicketPriority, TicketStatus } from "../types";
import { canMove, guessPriority, nextNumber } from "./tickets";

type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> };

export interface GuestComplaintInput {
  name: string;
  phone: string;
  category: string;
  body: string;
  tableCode?: string | null;
  orderId?: string | null;
  channel?: SupportTicket["channel"];
}

export class ComplaintError extends Error {}

const EMPTY: Omit<SupportTicket, "id" | "restaurantId" | "createdAt" | "updatedAt" | "kind" | "number" | "subject" | "body" | "category" | "channel" | "priority"> = {
  branchId: null, status: "new", customerId: null, contactName: "", contactPhone: "", orderId: null, checkId: null, tableId: null, raisedBy: null, assigneeId: null,
  notes: [], resolution: "", followUp: null, followUpAt: null, firstResponseAt: null, resolvedAt: null, escalatedAt: null, diagnostics: null, forwardedAt: null,
};

export const subjectOf = (body: string) => {
  const s = body.trim().split(/[\n.!؟?]/)[0].trim();
  return (s.length > 70 ? s.slice(0, 68) + "…" : s) || body.trim().slice(0, 70);
};

/** Public: a guest complains from the restaurant page / QR menu / tracking page. */
export async function submitGuestComplaint(repo: Repo, slug: string, x: GuestComplaintInput): Promise<{ number: string }> {
  const body = x.body.trim().slice(0, 2000);
  if (body.length < 5) throw new ComplaintError("too_short");
  const phone = x.phone.trim() ? normalizePhone(x.phone) : null;
  if (x.phone.trim() && !phone) throw new ComplaintError("bad_phone");
  if (repo.kind !== "local") {
    const client = (repo as unknown as { client?: Rpc }).client;
    if (!client) throw new ComplaintError("no_backend");
    const { data, error } = await client.rpc("guest_complaint_submit", { p_slug: slug, p_name: x.name.trim().slice(0, 80), p_phone: phone, p_category: x.category, p_body: body, p_table_code: x.tableCode ?? null, p_order_id: x.orderId ?? null, p_channel: x.channel ?? "qr" });
    if (error) throw new ComplaintError(error.message);
    return { number: String((data as { number?: string } | null)?.number ?? "") };
  }
  const [r] = await repo.list("restaurants", { where: { slug } });
  if (!r) throw new ComplaintError("not_found");
  const customer = phone ? (await repo.list("customers", { where: { restaurantId: r.id, phone } }))[0] ?? null : null;
  const table = x.tableCode ? (await repo.list("tables", { where: { restaurantId: r.id, code: x.tableCode.toUpperCase() } }))[0] ?? null : null;
  const check = table ? (await repo.list("checks", { where: { restaurantId: r.id, status: ["open", "bill_requested"] }, contains: { tableIds: table.id } }))[0] ?? null : null;
  const order = x.orderId ? await repo.get("orders", x.orderId) : null;
  const existing = await repo.list("supportTickets", { where: { restaurantId: r.id, kind: "guest" } });
  const branches = await repo.list("branches", { where: { restaurantId: r.id } });
  const t = await repo.insert("supportTickets", {
    ...EMPTY,
    restaurantId: r.id,
    branchId: table?.branchId ?? order?.branchId ?? branches.find((b) => b.isDefault)?.id ?? null,
    kind: "guest",
    number: nextNumber("guest", existing),
    subject: subjectOf(body),
    body,
    category: x.category,
    channel: x.channel ?? (x.tableCode ? "qr" : "online"),
    priority: guessPriority(x.category, body),
    customerId: customer?.id ?? order?.customerId ?? check?.customerId ?? null,
    contactName: x.name.trim().slice(0, 80) || customer?.name || "",
    contactPhone: phone ?? "",
    orderId: order?.id && order.restaurantId === r.id ? order.id : null,
    checkId: check?.id ?? (order?.restaurantId === r.id ? order.checkId : null) ?? null,
    tableId: table?.id ?? null,
  });
  return { number: t.number };
}

const note = (db: Db, byName: string, kind: TicketNote["kind"], text: string): TicketNote => ({ id: uuid(), at: nowIso(), by: db.actorId, byName, kind, text: text.trim().slice(0, 2000) });

export async function addNote(db: Db, t: SupportTicket, byName: string, kind: "internal" | "reply", text: string) {
  if (!text.trim()) return t;
  const first = kind === "reply" && !t.firstResponseAt ? { firstResponseAt: nowIso() } : {};
  const status: TicketStatus = t.status === "new" ? "open" : t.status;
  return db.update("supportTickets", t.id, { notes: [...t.notes, note(db, byName, kind, text)], status, ...first });
}

export async function setStatus(db: Db, t: SupportTicket, byName: string, to: TicketStatus, resolution?: string) {
  if (!canMove(t.status, to)) throw new Error(`illegal ${t.status} → ${to}`);
  const now = nowIso();
  const patch: Partial<SupportTicket> = { status: to, notes: [...t.notes, note(db, byName, "system", `${t.status} → ${to}`)] };
  if (to === "resolved") Object.assign(patch, { resolvedAt: now, resolution: resolution ?? t.resolution, firstResponseAt: t.firstResponseAt ?? now });
  if (to === "open" && (t.status === "resolved" || t.status === "closed")) patch.resolvedAt = null;
  if (to !== "new" && !t.firstResponseAt && to !== "open") patch.firstResponseAt = now;
  const out = await db.update("supportTickets", t.id, patch);
  await db.audit(`ticket.${to}`, "supportTickets", t.id, { number: t.number });
  return out;
}

export const assign = (db: Db, t: SupportTicket, assigneeId: string | null) => db.update("supportTickets", t.id, { assigneeId, status: t.status === "new" ? "open" : t.status });
export const setPriority = (db: Db, t: SupportTicket, priority: TicketPriority) => db.update("supportTickets", t.id, { priority });

export async function escalate(db: Db, t: SupportTicket, priority: TicketPriority) {
  await db.update("supportTickets", t.id, { priority, escalatedAt: nowIso(), notes: [...t.notes, { id: uuid(), at: nowIso(), by: null, byName: "SLA", kind: "system", text: `escalated ${t.priority} → ${priority}` }] });
}

/** WhatsApp click-to-chat link (Egypt numbers → +20). */
export function waLink(phone: string, text: string) {
  const d = phone.replace(/\D/g, "");
  const e164 = d.startsWith("0") ? "20" + d.slice(1) : d;
  return `https://wa.me/${e164}?text=${encodeURIComponent(text)}`;
}

export async function recordFollowUp(db: Db, t: SupportTicket, byName: string, text: string) {
  return db.update("supportTickets", t.id, { followUp: text, followUpAt: nowIso(), notes: [...t.notes, note(db, byName, "reply", text)], firstResponseAt: t.firstResponseAt ?? nowIso() });
}

/** Staff → Sufra technical support. */
export async function requestSufraSupport(db: Db, x: { subject: string; body: string; category: string; priority: TicketPriority; name: string; phone: string; diagnostics: Diagnostics; restaurantName: string }): Promise<SupportTicket> {
  const existing = await db.list("supportTickets", { where: { kind: "sufra" } });
  const t = await db.insert("supportTickets", {
    ...EMPTY,
    branchId: db.branchId,
    kind: "sufra",
    number: nextNumber("sufra", existing),
    subject: x.subject.trim().slice(0, 120) || subjectOf(x.body),
    body: x.body.trim().slice(0, 4000),
    category: x.category,
    channel: "app",
    priority: x.priority,
    raisedBy: db.actorId,
    contactName: x.name,
    contactPhone: x.phone,
    diagnostics: x.diagnostics,
  });
  void forwardToSufra(db, t, x.restaurantName);
  return t;
}

/** Best effort: POST to /api/support-ticket (501 when SUPPORT_WEBHOOK_URL isn't configured — the row is the source of truth). */
export async function forwardToSufra(db: Db, t: SupportTicket, restaurantName: string) {
  try {
    const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
    const session = (db.repo as unknown as { client?: { auth?: { getSession(): Promise<{ data: { session: { access_token: string } | null } }> } } }).client;
    const token = session?.auth ? (await session.auth.getSession()).data.session?.access_token : null;
    const r = await fetch(`${base}/api/support-ticket`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ restaurantId: t.restaurantId, restaurantName, ticketId: t.id, number: t.number, subject: t.subject, body: t.body, category: t.category, priority: t.priority, contact: { name: t.contactName, phone: t.contactPhone }, diagnostics: t.diagnostics }),
    });
    if (r.ok) await db.update("supportTickets", t.id, { forwardedAt: nowIso() });
  } catch {
    /* offline / not deployed */
  }
}

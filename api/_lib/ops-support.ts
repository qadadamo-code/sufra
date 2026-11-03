/**
 * Sufra technical-support ticket forwarding (used by api/support-ticket.ts). Edge-safe: WebCrypto, fetch.
 *
 *   POST { restaurantId, restaurantName, ticketId, number, subject, body, category, priority, contact{name,phone}, diagnostics }
 *   GET  → { configured, email } (no secrets)
 *
 * The ticket ROW (support_tickets, 0013_ops.sql) is the source of truth — this only notifies Sufra's team.
 * Auth: Supabase user JWT of an active member of that restaurant, or — without Supabase — x-sufra-api-key = SUFRA_API_KEY.
 * Neither configured → 501 (never an open relay). In-memory rate limit per restaurant.
 *
 * Env (Vercel; never in the browser):
 *   SUPPORT_WEBHOOK_URL      where to POST (Slack incoming webhook → {text}; anything else → the JSON ticket)
 *   SUPPORT_WEBHOOK_SECRET   optional HMAC-SHA256 of the body → header X-Sufra-Signature: sha256=<hex>
 *   RESEND_API_KEY + SUPPORT_EMAIL_TO (+ SUPPORT_EMAIL_FROM)   optional e-mail copy via Resend
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY | SUFRA_API_KEY     auth
 */
import { RateLimiter } from "./wa-ratelimit";

export type Env = Partial<Record<string, string | undefined>>;
export interface SupportDeps {
  env: Env;
  fetch: typeof fetch;
  limiter: RateLimiter;
}

const limiter = new RateLimiter(10, 1 / 60); // 10 burst, 1/min per restaurant
export const makeSupportDeps = (env: Env): SupportDeps => ({ env, fetch: globalThis.fetch.bind(globalThis), limiter });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIORITIES = ["low", "normal", "high", "urgent"];

export interface ForwardTicket {
  restaurantId: string;
  restaurantName: string;
  ticketId: string;
  number: string;
  subject: string;
  body: string;
  category: string;
  priority: string;
  contact: { name: string; phone: string };
  diagnostics: unknown;
}

const s = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export function validateTicket(x: unknown): ForwardTicket | null {
  const o = (x ?? {}) as Record<string, unknown>;
  if (typeof o.restaurantId !== "string" || !UUID.test(o.restaurantId)) return null;
  if (typeof o.ticketId !== "string" || !UUID.test(o.ticketId)) return null;
  const body = s(o.body, 4000);
  if (!body.trim()) return null;
  const c = (o.contact ?? {}) as Record<string, unknown>;
  const diag = JSON.stringify(o.diagnostics ?? null);
  return {
    restaurantId: o.restaurantId,
    restaurantName: s(o.restaurantName, 120),
    ticketId: o.ticketId,
    number: s(o.number, 20),
    subject: s(o.subject, 160),
    body,
    category: s(o.category, 30),
    priority: PRIORITIES.includes(String(o.priority)) ? String(o.priority) : "normal",
    contact: { name: s(c.name, 80), phone: s(c.phone, 30) },
    diagnostics: diag.length <= 20_000 ? o.diagnostics ?? null : { truncated: true },
  };
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authorize(req: Request, restaurantId: string, d: SupportDeps): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const url = (d.env.SUPABASE_URL || d.env.VITE_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = (d.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (url && key) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
    if (!m) return { ok: false, status: 401, error: "missing_token" };
    const u = await d.fetch(`${url}/auth/v1/user`, { headers: { apikey: key, authorization: `Bearer ${m[1].trim()}` } });
    const user = u.ok ? ((await u.json()) as { id?: string }) : null;
    if (!user?.id) return { ok: false, status: 401, error: "bad_token" };
    const r = await d.fetch(`${url}/rest/v1/memberships?select=id&active=eq.true&user_id=eq.${encodeURIComponent(user.id)}&restaurant_id=eq.${encodeURIComponent(restaurantId)}`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
    const rows = r.ok ? ((await r.json()) as unknown[]) : [];
    return rows.length ? { ok: true } : { ok: false, status: 403, error: "not_a_member" };
  }
  const shared = d.env.SUFRA_API_KEY?.trim();
  if (!shared) return { ok: false, status: 501, error: "auth_not_configured" };
  const given = req.headers.get("x-sufra-api-key") ?? "";
  return given && safeEqual(given, shared) ? { ok: true } : { ok: false, status: 401, error: "bad_api_key" };
}

export function slackText(t: ForwardTicket): string {
  const d = (t.diagnostics ?? {}) as { appVersion?: string; platform?: string; sync?: { mode?: string; pending?: number }; errors?: unknown[] };
  return [
    `*${t.number}* [${t.priority}] ${t.subject}`,
    `${t.restaurantName} (${t.restaurantId}) · ${t.category} · ${t.contact.name} ${t.contact.phone}`,
    "```" + t.body.slice(0, 1500) + "```",
    `app ${d.appVersion ?? "?"} · ${d.platform ?? "?"} · sync ${d.sync?.mode ?? "?"} pending ${d.sync?.pending ?? "?"} · errors ${Array.isArray(d.errors) ? d.errors.length : 0}`,
  ].join("\n");
}

export async function handleSupportTicket(req: Request, d: SupportDeps): Promise<Response> {
  const hook = d.env.SUPPORT_WEBHOOK_URL?.trim();
  const email = !!(d.env.RESEND_API_KEY && d.env.SUPPORT_EMAIL_TO);
  if (req.method === "GET") return json(200, { configured: !!hook || email, webhook: !!hook, email });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!hook && !email) return json(501, { error: "not_configured", message: "Set SUPPORT_WEBHOOK_URL (and/or RESEND_API_KEY + SUPPORT_EMAIL_TO) on the server." });
  const raw = await req.text();
  if (raw.length > 64_000) return json(413, { error: "too_large" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json(400, { error: "bad_json" });
  }
  const t = validateTicket(parsed);
  if (!t) return json(400, { error: "invalid_ticket" });
  const auth = await authorize(req, t.restaurantId, d);
  if (!auth.ok) return json(auth.status, { error: auth.error });
  const rl = d.limiter.take(t.restaurantId);
  if (!rl.ok) return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { "content-type": "application/json", "retry-after": String(rl.retryAfterSec) } });

  const sent: string[] = [];
  if (hook) {
    let target: URL;
    try {
      target = new URL(hook);
    } catch {
      return json(500, { error: "bad_webhook_url" });
    }
    const body = target.hostname === "hooks.slack.com" ? JSON.stringify({ text: slackText(t) }) : JSON.stringify({ type: "sufra.support_ticket", ticket: t });
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (d.env.SUPPORT_WEBHOOK_SECRET) headers["x-sufra-signature"] = "sha256=" + (await hmacHex(d.env.SUPPORT_WEBHOOK_SECRET, body));
    const r = await d.fetch(target.toString(), { method: "POST", headers, body });
    if (!r.ok) return json(502, { error: "webhook_failed", status: r.status });
    sent.push("webhook");
  }
  if (email) {
    const r = await d.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${d.env.RESEND_API_KEY}` },
      body: JSON.stringify({ from: d.env.SUPPORT_EMAIL_FROM || "Sufra OS <support@sufra.app>", to: [d.env.SUPPORT_EMAIL_TO], subject: `[${t.priority}] ${t.number} ${t.subject}`, text: slackText(t).replace(/```/g, "") }),
    });
    if (r.ok) sent.push("email");
  }
  return json(200, { ok: true, sent });
}

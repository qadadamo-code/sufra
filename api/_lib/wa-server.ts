/**
 * Server side of WhatsApp messaging (Node runtime). Used by api/whatsapp-send.ts and api/whatsapp-webhook.ts.
 * Pure helpers (payload building, webhook parsing, validation) come from sufra-os/src/lib/notify/core.ts, which the
 * browser app uses too. Secrets only ever come from process.env (Vercel environment variables) or Supabase Vault.
 *
 * Environment (see sufra-os/docs/WHATSAPP-SETUP.md):
 *   WHATSAPP_TOKEN              platform-default Cloud API access token (system user, permanent)
 *   WHATSAPP_PHONE_NUMBER_ID    platform-default sender (Phone number ID, not the phone number)
 *   WHATSAPP_VERIFY_TOKEN       any random string; typed into Meta's webhook settings
 *   WHATSAPP_APP_SECRET         Meta app secret — verifies X-Hub-Signature-256 on webhooks
 *   WHATSAPP_DEFAULT_RESTAURANT_ID  the tenant the default number belongs to (unset = single-tenant: any)
 *   WHATSAPP_GRAPH_VERSION      default v21.0
 *   WHATSAPP_PROVIDER           "cloud" (default) | "360dialog" (+ D360_API_KEY)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   storage + JWT auth + per-tenant credentials (Vault)
 *   SUFRA_API_KEY               shared key for deployments WITHOUT Supabase (header x-sufra-api-key)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { buildSendPayload, parseWebhook, validateSendRequest, type SendRequest, type WebhookEvent } from "../../sufra-os/src/lib/notify/core";
import { RateLimiter } from "./wa-ratelimit";

export type WaEnv = Partial<Record<string, string | undefined>>;

export interface WaDeps {
  env: WaEnv;
  fetch: typeof fetch;
  limiter: RateLimiter;
  now: () => number;
  log: (msg: string, data?: Record<string, unknown>) => void;
}

/** one limiter per warm instance: burst 20, then 1 message/second per restaurant */
const sharedLimiter = new RateLimiter(20, 1);

export function makeWaDeps(env: WaEnv = process.env): WaDeps {
  return { env, fetch: globalThis.fetch.bind(globalThis), limiter: sharedLimiter, now: Date.now, log: (m, d) => console.log(`[whatsapp] ${m}`, d ? JSON.stringify(d) : "") };
}

/* ───────────────────────── crypto ───────────────────────── */

/** Constant-time string compare (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) {
    timingSafeEqual(x, x); // keep timing similar
    return false;
  }
  return timingSafeEqual(x, y);
}

/** Meta signs the RAW body: X-Hub-Signature-256: sha256=<hex hmac(app secret, body)> */
export function signBody(raw: string, appSecret: string): string {
  return "sha256=" + createHmac("sha256", appSecret).update(raw, "utf8").digest("hex");
}

export function verifySignature(raw: string, header: string | null | undefined, appSecret: string | undefined): boolean {
  if (!appSecret || !header || !/^sha256=[0-9a-f]{64}$/i.test(header.trim())) return false;
  return safeEqual(signBody(raw, appSecret), header.trim().toLowerCase());
}

/* ───────────────────────── helpers ───────────────────────── */

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

/** +201005551201 → +2010*****201 (logs never hold full numbers) */
export const mask = (p: string) => (p.length > 7 ? `${p.slice(0, 5)}${"*".repeat(p.length - 8)}${p.slice(-3)}` : "***");

async function readRaw(req: Request, max: number): Promise<string | null> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > max) return null;
  const raw = await req.text();
  return raw.length > max ? null : raw;
}

/* ───────────────────────── Supabase (service role, server only) ───────────────────────── */

export interface Sb {
  url: string;
  rest(path: string, init?: RequestInit): Promise<Response>;
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
  /** the auth user for a JWT, or null */
  user(jwt: string): Promise<{ id: string } | null>;
}

export function supabase(d: WaDeps): Sb | null {
  const url = (d.env.SUPABASE_URL || d.env.VITE_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = (d.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
  return {
    url,
    rest: (path, init = {}) => d.fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } }),
    async rpc<T>(fn: string, args: Record<string, unknown>) {
      const r = await d.fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) });
      if (!r.ok) throw new Error(`rpc ${fn}: ${r.status} ${(await r.text()).slice(0, 200)}`);
      return (await r.json()) as T;
    },
    async user(jwt) {
      const r = await d.fetch(`${url}/auth/v1/user`, { headers: { apikey: key, authorization: `Bearer ${jwt}` } });
      if (!r.ok) return null;
      const u = (await r.json()) as { id?: string };
      return u.id ? { id: u.id } : null;
    },
  };
}

/* ───────────────────────── auth ───────────────────────── */

const SENDER_ROLES = ["owner", "admin", "manager", "cashier"];

/**
 * Supabase configured → a valid user JWT that belongs to an active owner/admin/manager/cashier of the restaurant.
 * Otherwise → the shared SUFRA_API_KEY in x-sufra-api-key. Neither configured → refuse (never an open relay).
 */
export async function authorize(req: Request, restaurantId: string, d: WaDeps): Promise<{ ok: true; userId: string | null } | { ok: false; status: number; error: string }> {
  const sb = supabase(d);
  if (sb) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
    if (!m) return { ok: false, status: 401, error: "missing_token" };
    const user = await sb.user(m[1].trim());
    if (!user) return { ok: false, status: 401, error: "bad_token" };
    const q = `memberships?select=role&active=eq.true&user_id=eq.${encodeURIComponent(user.id)}&restaurant_id=eq.${encodeURIComponent(restaurantId)}`;
    const r = await sb.rest(q);
    const rows = r.ok ? ((await r.json()) as { role: string }[]) : [];
    if (!rows.some((x) => SENDER_ROLES.includes(x.role))) return { ok: false, status: 403, error: "not_allowed" };
    return { ok: true, userId: user.id };
  }
  const key = d.env.SUFRA_API_KEY?.trim();
  if (!key) return { ok: false, status: 501, error: "auth_not_configured" };
  const given = req.headers.get("x-sufra-api-key") ?? "";
  if (!given || !safeEqual(given, key)) return { ok: false, status: 401, error: "bad_api_key" };
  return { ok: true, userId: null };
}

/* ───────────────────────── credentials + Graph API ───────────────────────── */

export interface Creds {
  provider: "cloud" | "360dialog";
  phoneNumberId: string;
  token: string;
  source: "tenant" | "env";
}

/** Per-tenant WABA (whatsapp_accounts + Vault) first, then the platform default from env. */
export async function credentialsFor(restaurantId: string, d: WaDeps, sb: Sb | null = supabase(d)): Promise<Creds | null> {
  if (sb) {
    try {
      const rows = await sb.rpc<{ phone_number_id: string; token: string; provider: string }[] | null>("messaging_wa_credentials", { p_restaurant_id: restaurantId });
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row?.token && row.phone_number_id) return { provider: row.provider === "360dialog" ? "360dialog" : "cloud", phoneNumberId: row.phone_number_id, token: row.token, source: "tenant" };
    } catch (e) {
      d.log("credentials lookup failed", { error: (e as Error).message });
    }
  }
  const owner = d.env.WHATSAPP_DEFAULT_RESTAURANT_ID?.trim();
  if (owner && owner !== restaurantId) return null;
  const provider = d.env.WHATSAPP_PROVIDER === "360dialog" ? "360dialog" : "cloud";
  const token = (provider === "360dialog" ? d.env.D360_API_KEY : d.env.WHATSAPP_TOKEN)?.trim();
  const phoneNumberId = d.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || (provider === "360dialog" ? "-" : "");
  if (!token || !phoneNumberId) return null;
  return { provider, phoneNumberId, token, source: "env" };
}

export interface GraphResult {
  ok: boolean;
  status: number;
  id?: string;
  error?: string;
  code?: number;
}

export async function graphSend(c: Creds, payload: Record<string, unknown>, d: WaDeps): Promise<GraphResult> {
  const version = (d.env.WHATSAPP_GRAPH_VERSION || "v21.0").trim();
  const url = c.provider === "360dialog" ? "https://waba-v2.360dialog.io/messages" : `https://graph.facebook.com/${version}/${encodeURIComponent(c.phoneNumberId)}/messages`;
  const headers: Record<string, string> = c.provider === "360dialog" ? { "D360-API-KEY": c.token, "content-type": "application/json" } : { authorization: `Bearer ${c.token}`, "content-type": "application/json" };
  let r: Response;
  try {
    r = await d.fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  } catch (e) {
    return { ok: false, status: 502, error: `network: ${(e as Error).message}` };
  }
  const j = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number; error_data?: { details?: string } } };
  if (r.ok && j.messages?.[0]?.id) return { ok: true, status: r.status, id: j.messages[0].id };
  return { ok: false, status: r.status, error: j.error?.error_data?.details || j.error?.message || `graph_${r.status}`, code: j.error?.code };
}

/* ───────────────────────── POST /api/whatsapp-send ───────────────────────── */

export async function handleSend(req: Request, d: WaDeps): Promise<Response> {
  if (req.method === "GET") {
    // configuration status for Settings → Messaging (no secrets)
    const sb = supabase(d);
    return json(200, {
      configured: !!(d.env.WHATSAPP_TOKEN && d.env.WHATSAPP_PHONE_NUMBER_ID) || !!sb,
      platformDefault: !!(d.env.WHATSAPP_TOKEN && d.env.WHATSAPP_PHONE_NUMBER_ID),
      storage: sb ? "supabase" : "none",
      auth: sb ? "supabase" : d.env.SUFRA_API_KEY ? "api_key" : "none",
      webhook: { verifyToken: !!d.env.WHATSAPP_VERIFY_TOKEN, appSecret: !!d.env.WHATSAPP_APP_SECRET },
      provider: d.env.WHATSAPP_PROVIDER === "360dialog" ? "360dialog" : "cloud",
    });
  }
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "GET, POST" });
  const raw = await readRaw(req, 64_000);
  if (raw === null) return json(413, { error: "too_large" });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "bad_json" });
  }
  const v = validateSendRequest(body);
  if (!v.ok) return json(400, { error: v.error });
  const r: SendRequest & { to: string } = v.value;

  const auth = await authorize(req, r.restaurantId, d);
  if (!auth.ok) return json(auth.status, { error: auth.error, message: auth.status === 501 ? "Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or SUFRA_API_KEY, on the server (see docs/WHATSAPP-SETUP.md)." : undefined });

  const sb = supabase(d);
  const creds = await credentialsFor(r.restaurantId, d, sb);
  if (!creds)
    return json(501, { error: "not_configured", message: "WhatsApp Cloud API is not configured for this restaurant: set WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID (or connect a WABA). Use click-to-chat meanwhile." });

  const limit = d.limiter.take(r.restaurantId, d.now());
  if (!limit.ok) return json(429, { error: "rate_limited", retryAfter: limit.retryAfterSec }, { "retry-after": String(limit.retryAfterSec) });
  if (sb) {
    try {
      const ok = await sb.rpc<boolean>("messaging_rate_take", { p_restaurant_id: r.restaurantId, p_limit: 600, p_window_sec: 600 });
      if (ok === false) return json(429, { error: "rate_limited", retryAfter: 60 }, { "retry-after": "60" });
    } catch {
      /* table missing → in-memory limit only */
    }
    // opt-out is final: never message someone who said STOP
    const c = await sb.rest(`messaging_consents?select=status&channel=eq.whatsapp&restaurant_id=eq.${encodeURIComponent(r.restaurantId)}&phone=eq.${encodeURIComponent(r.to)}`).catch(() => null);
    const rows = c?.ok ? ((await c.json()) as { status: string }[]) : [];
    if (rows.some((x) => x.status === "opted_out")) return json(409, { error: "opted_out" });
  }

  const result = await graphSend(creds, buildSendPayload(r), d);
  d.log(result.ok ? "sent" : "send failed", { restaurant: r.restaurantId, to: mask(r.to), kind: r.template ? `template:${r.template.name}` : r.text ? "text" : "media", status: result.status, code: result.code, source: creds.source });
  if (sb && r.messageId) {
    const patch = result.ok ? { provider_id: result.id, status: "sent", sent_at: new Date(d.now()).toISOString(), error: null } : { status: "failed", error: `${result.code ?? ""} ${result.error ?? ""}`.trim().slice(0, 500) };
    await sb
      .rest(`wa_messages?id=eq.${encodeURIComponent(r.messageId)}&restaurant_id=eq.${encodeURIComponent(r.restaurantId)}`, { method: "PATCH", body: JSON.stringify(patch), headers: { prefer: "return=minimal" } })
      .catch(() => undefined);
  }
  if (!result.ok) return json(result.status >= 400 && result.status < 500 ? 422 : 502, { error: result.error, code: result.code });
  return json(200, { id: result.id, status: "sent" });
}

/* ───────────────────────── /api/whatsapp-webhook ───────────────────────── */

/** GET: Meta's subscription check. */
export function handleVerify(req: Request, d: WaDeps): Response {
  const token = d.env.WHATSAPP_VERIFY_TOKEN?.trim();
  if (!token) return new Response("WHATSAPP_VERIFY_TOKEN is not set", { status: 501 });
  const u = new URL(req.url);
  const mode = u.searchParams.get("hub.mode");
  const given = u.searchParams.get("hub.verify_token") ?? "";
  const challenge = u.searchParams.get("hub.challenge") ?? "";
  if (mode === "subscribe" && given && safeEqual(given, token) && /^[\w-]{1,200}$/.test(challenge)) return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  return new Response("forbidden", { status: 403 });
}

interface IngestResult {
  replies?: { restaurant_id: string; to: string; text: string; message_id?: string }[];
}

/** POST: verify signature → parse → store (Supabase) or log → send auto-replies (opt-out confirmation, closed hours). */
export async function handleWebhookPost(req: Request, d: WaDeps): Promise<Response> {
  const secret = d.env.WHATSAPP_APP_SECRET?.trim();
  if (!secret) return new Response("WHATSAPP_APP_SECRET is not set", { status: 501 });
  const raw = await readRaw(req, 1_000_000);
  if (raw === null) return new Response("too large", { status: 413 });
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    d.log("bad signature");
    return new Response("bad signature", { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const events: WebhookEvent[] = parseWebhook(body);
  const sb = supabase(d);
  if (!sb) {
    d.log("webhook (no storage configured)", {
      events: events.map((e) => (e.kind === "message" ? { kind: e.kind, from: mask(e.from), type: e.type, optOut: e.optOut } : { kind: e.kind, status: e.status, id: e.id.slice(-8) })),
    });
    return new Response("ok", { status: 200 });
  }
  let res: IngestResult = {};
  try {
    res = (await sb.rpc<IngestResult>("messaging_ingest_webhook", { p_events: events, p_default_restaurant: d.env.WHATSAPP_DEFAULT_RESTAURANT_ID?.trim() || null })) ?? {};
  } catch (e) {
    // 500 → Meta retries (ingest is idempotent on provider ids)
    d.log("ingest failed", { error: (e as Error).message });
    return new Response("storage error", { status: 500 });
  }
  for (const r of res.replies ?? []) {
    const creds = await credentialsFor(r.restaurant_id, d, sb);
    if (!creds) continue;
    const out = await graphSend(creds, buildSendPayload({ to: r.to, text: r.text }), d);
    if (r.message_id)
      await sb
        .rest(`wa_messages?id=eq.${encodeURIComponent(r.message_id)}`, { method: "PATCH", body: JSON.stringify(out.ok ? { status: "sent", provider_id: out.id } : { status: "failed", error: out.error ?? "failed" }), headers: { prefer: "return=minimal" } })
        .catch(() => undefined);
  }
  return new Response("ok", { status: 200 });
}

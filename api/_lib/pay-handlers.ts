/**
 * Request handlers behind /api/pay-intent, /api/pay-webhook-*, /api/pay-callback, /api/pay-refund, /api/pay-status.
 * Web-standard Request → Response (Vercel Edge runtime). Dependencies are injected so the tests can run them with a fake
 * Supabase and a fake gateway (sufra-os/src/modules/payments/server.test.ts).
 *
 * Rules: secrets only from env / Vault · amounts re-validated against the check · redirects are hints, webhooks (verified)
 * or a server-side status call are proof · recording is idempotent (guest_record_payment locks the intent row and returns
 * early once it is final; provider_ref is unique per provider).
 */
import {
  bpOfUnits, CURRENCIES, envStatus, isExpired, KINDS, kashierStatus, linkExpiry, METHODS, moyasarStatus, notConfigured, paymobStatus,
  PROVIDER_ENV, randomId, safeReturnUrl, SERVER_PROVIDERS, unitsToMinor, validateCharge, verifyKashier, verifyMoyasar, verifyPaymob,
  verifyPaymobQuery, minorToUnits, type Currency, type Env, type IntentKind, type IntentStatus, type Method, type ProviderId,
} from "./pay-core";
import { payDb, type IntentRecord, type PayDb } from "./pay-db";
import { credsFor, gateways, ProviderError, type ProviderCreds } from "./pay-providers";

export interface Deps {
  env: Env;
  db: PayDb | null;
  fetch: typeof fetch;
  now: () => number;
  log: (event: string, data?: Record<string, unknown>) => void;
}

export function makeDeps(env: Env): Deps {
  return {
    env,
    db: payDb(env),
    fetch: (...a) => fetch(...a),
    now: () => Date.now(),
    log: (event, data = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), scope: "pay", event, ...data })),
  };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const bad = (code: string, status = 400) => json(status, { error: code });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF_ROLES = ["owner", "admin", "manager", "cashier", "waiter"];
const MANAGERS = ["owner", "admin", "manager"];
/** cap for check-less kinds (gift cards, top-ups, deposits): 20 000 in the currency */
const MAX_CHECKLESS = 20_000 * 100_000;

const bearer = (req: Request) => {
  const h = req.headers.get("authorization") ?? "";
  return /^Bearer\s+(.+)$/i.exec(h)?.[1]?.trim() || null;
};
async function readJson(req: Request, max = 20_000): Promise<{ raw: string; body: Record<string, unknown> } | null> {
  const raw = await req.text();
  if (raw.length > max) return null;
  try {
    const body = JSON.parse(raw);
    return body && typeof body === "object" && !Array.isArray(body) ? { raw, body } : null;
  } catch {
    return null;
  }
}
const baseUrl = (req: Request, env: Env) => (env.PAY_PUBLIC_BASE_URL?.trim() || new URL(req.url).origin).replace(/\/$/, "");
const origins = (req: Request, env: Env) => [...new Set([new URL(req.url).origin, env.PAY_PUBLIC_BASE_URL?.trim(), ...(env.PAY_ALLOWED_ORIGINS ?? "").split(",")].filter(Boolean).map((o) => new URL(o!.trim()).origin))];

/** what the browser may see of an intent (same shape as the client's PaymentIntent) */
export function publicIntent(r: IntentRecord, extra: { iframeUrl?: string | null; clientSecret?: string | null } = {}) {
  return {
    id: r.id, provider: r.provider, kind: r.kind, status: r.status, charge: Number(r.amount) + Number(r.tip) + Number((r.request?.surcharge as number) ?? 0),
    amount: Number(r.amount), tip: Number(r.tip), currency: r.currency, method: r.method, redirectUrl: r.status === "requires_action" ? r.redirect_url : null,
    iframeUrl: extra.iframeUrl ?? null, clientSecret: extra.clientSecret ?? null, reference: r.provider_ref, failureReason: r.failure_reason, note: r.note,
    checkId: r.check_id, createdAt: r.created_at, expiresAt: r.expires_at, request: r.request,
  };
}

async function credsForRestaurant(d: Deps, rid: string | null, provider: ProviderId): Promise<{ creds: ProviderCreds; missing: string[] }> {
  const tenant = d.db && rid ? await d.db.account(rid, provider) : null;
  const creds = credsFor(provider, d.env, tenant);
  return { creds, missing: PROVIDER_ENV[provider].required.filter((k) => !creds.get(k)) };
}

/** record a verified outcome (idempotent); logs when Supabase isn't configured */
async function settle(d: Deps, intentId: string, status: IntentStatus, ref: string | null, failure: string | null, feeUnits: number | null = null) {
  if (!d.db) {
    d.log("settle.unrecorded", { intentId, status, ref, note: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — logged only" });
    return { status, paymentId: null, recorded: false };
  }
  if (feeUnits !== null) await d.db.patchIntent(intentId, { fee: feeUnits }).catch(() => undefined);
  const r = await d.db.record(intentId, status, ref, failure);
  d.log("settle", { intentId, status, ref, result: r.status });
  return { ...r, recorded: true };
}

/* ───────────────────────── /api/pay-intent ───────────────────────── */

export async function handleIntent(req: Request, d: Deps): Promise<Response> {
  if (req.method === "GET") return getIntent(req, d);
  if (req.method !== "POST") return bad("method_not_allowed", 405);
  const parsed = await readJson(req);
  if (!parsed) return bad("bad_json");
  const b = parsed.body;
  if (b.action === "cancel") return cancelIntent(String(b.id ?? ""), d);

  const rid = typeof b.restaurantId === "string" && UUID.test(b.restaurantId) ? b.restaurantId : null;
  if (!rid) return bad("restaurant_required");
  const kind: IntentKind = KINDS.includes(b.kind as IntentKind) ? (b.kind as IntentKind) : b.orderId ? "online_order" : "guest";
  const method: Method | null = METHODS.includes(b.method as Method) ? (b.method as Method) : null;
  const amount = Number(b.amount);
  const tip = Number(b.tip ?? 0);
  let checkId = typeof b.checkId === "string" && UUID.test(b.checkId) ? b.checkId : null;
  const orderId = typeof b.orderId === "string" && UUID.test(b.orderId) ? b.orderId : null;
  const returnUrl = safeReturnUrl(b.returnUrl, origins(req, d.env));
  if (!returnUrl) return bad("bad_return_url");
  const c = (b.customer ?? null) as Record<string, unknown> | null;
  const customer = c && typeof c === "object" ? { name: String(c.name ?? "").slice(0, 80), phone: String(c.phone ?? "").replace(/[^\d+]/g, "").slice(0, 20), email: c.email ? String(c.email).slice(0, 120) : null } : null;

  const settings = d.db ? await d.db.settings(rid) : null;
  const ps = (settings?.payments ?? {}) as { provider?: string; methods?: string[]; absorbFees?: boolean; surchargeBp?: number; linkExpiryMin?: number; mode?: string };
  const currency: Currency = CURRENCIES.includes(settings?.locale?.currency as Currency) ? (settings!.locale!.currency as Currency) : CURRENCIES.includes(b.currency as Currency) ? (b.currency as Currency) : "EGP";
  const configuredFirst = SERVER_PROVIDERS.find((p) => envStatus(d.env).providers[p].configured);
  const provider = ([ps.provider, d.env.PAY_PROVIDER, b.provider, configuredFirst].find((p) => SERVER_PROVIDERS.includes(p as ProviderId)) ?? null) as ProviderId | null;
  if (!provider) return json(501, notConfigured("payments", ["PAY_PROVIDER", ...PROVIDER_ENV.paymob.required]));
  const { creds, missing } = await credsForRestaurant(d, rid, provider);
  if (missing.length) return json(501, notConfigured(provider, missing));
  if (method && ps.methods?.length && !ps.methods.includes(method)) return bad("method_not_enabled");

  // staff-only kinds: links and deposits are created from the POS / messaging
  const jwt = bearer(req);
  let createdBy: string | null = null;
  if (kind === "link" || kind === "deposit") {
    if (d.db) {
      if (!jwt || !(await d.db.hasRole(jwt, rid, STAFF_ROLES))) return bad("staff_only", 401);
      createdBy = await d.db.membershipOf(jwt, rid);
    } else d.log("intent.unverified_staff", { kind });
  }

  // amount: re-validated against the check on the server
  let due: number | null = null;
  let branchId: string | null = null;
  if (d.db) {
    if (!checkId && orderId) {
      const o = await d.db.order(orderId);
      if (!o || o.restaurant_id !== rid) return bad("order_not_found", 404);
      checkId = o.check_id;
      branchId = o.branch_id;
    }
    if (checkId) {
      const ch = await d.db.check(checkId);
      if (!ch || ch.restaurant_id !== rid) return bad("check_not_found", 404);
      if (ch.status !== "open" && ch.status !== "bill_requested") return bad("check_closed", 409);
      due = Number(ch.total) - Number(ch.paid) - (await d.db.pendingOnCheck(checkId));
      branchId = ch.branch_id;
    } else if (kind === "guest" || kind === "link" || kind === "online_order") return bad("check_required");
  }
  const checkless = kind === "gift_card" || kind === "wallet_topup" || kind === "deposit";
  const err = validateCharge({ amount, tip, due: checkless ? null : due, max: checkless ? MAX_CHECKLESS : undefined });
  if (err) return json(422, { error: err, due });

  const surcharge = ps.absorbFees === false && (ps.surchargeBp ?? 0) > 0 ? bpOfUnits(amount + tip, Math.min(1000, ps.surchargeBp!)) : 0;
  const charge = amount + tip + surcharge;
  const now = d.now();
  const id = randomId("pi_");
  // links send the payer back to the link page, which only knows its URL once the id exists: "{pi}" is replaced
  const back = returnUrl.replace(/%7Bpi%7D|\{pi\}/gi, id);
  const expiresAt = kind === "link" || kind === "deposit" ? linkExpiry(now, b.expiresInMin, ps.linkExpiryMin ?? 60) : linkExpiry(now, 15);
  const req0 = (b.request ?? {}) as Record<string, unknown>;
  const lang = b.lang === "en" ? "en" : "ar";
  const row: Partial<IntentRecord> = {
    id, restaurant_id: rid, branch_id: branchId, check_id: checkId, order_id: orderId, kind, provider, mode: creds.mode, method, status: "requires_action",
    amount, tip, currency, fee: null, refunded: 0, split_label: typeof b.splitLabel === "string" ? b.splitLabel.slice(0, 40) : null, redirect_url: null,
    provider_ref: null, provider_order_id: null, failure_reason: null, payment_id: null,
    purpose_ref: typeof b.purposeRef === "string" ? b.purposeRef.slice(0, 80) : null, note: typeof b.note === "string" ? b.note.slice(0, 200) : "", customer, created_by: createdBy,
    expires_at: expiresAt,
    request: { restaurantSlug: String(req0.restaurantSlug ?? b.restaurantSlug ?? "").slice(0, 80), tableCode: req0.tableCode ?? b.tableCode ?? null, returnUrl: back, lang, surcharge, purpose: kind },
    created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
  };
  if (d.db) await d.db.insertIntent(row);
  else d.log("intent.unstored", { id, provider, amount: charge, note: "Supabase not configured — the webhook will only be logged" });

  const base = baseUrl(req, d.env);
  try {
    const out = await gateways.create(creds, {
      intentId: id, amountMinor: unitsToMinor(charge), currency, method, methods: (ps.methods as Method[] | undefined) ?? (method ? [method] : ["card"]),
      description: String(b.description ?? (kind === "link" ? "Sufra payment link" : "Sufra bill")).slice(0, 120), customer,
      callbackUrl: `${base}/api/pay-callback?pi=${id}${d.db ? "" : `&r=${encodeURIComponent(back)}`}`, webhookUrl: `${base}/api/pay-webhook-${provider}`, lang, expiresAt,
    }, d.fetch);
    row.redirect_url = out.redirectUrl;
    row.provider_order_id = out.providerOrderId;
    if (d.db) await d.db.patchIntent(id, { redirect_url: out.redirectUrl, provider_order_id: out.providerOrderId });
    d.log("intent.created", { id, provider, kind, amount: charge });
    return json(201, publicIntent(row as IntentRecord, { iframeUrl: out.iframeUrl, clientSecret: out.clientSecret }));
  } catch (e) {
    const msg = e instanceof ProviderError ? `${e.provider} ${e.status}` : String((e as Error).message);
    d.log("intent.provider_error", { id, provider, msg });
    if (d.db) await d.db.patchIntent(id, { status: "failed", failure_reason: "provider_error" }).catch(() => undefined);
    return json(502, { error: "provider_error", provider, message: { ar: "بوابة الدفع مش بترد دلوقتي — جرّب كمان شوية", en: "The payment gateway didn't answer — try again shortly" } });
  }
}

async function getIntent(req: Request, d: Deps) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^pi_[a-z0-9_]{6,64}$/i.test(id)) return bad("bad_id");
  if (!d.db) return json(501, notConfigured("supabase", ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]));
  const r = await d.db.intent(id);
  if (!r) return bad("not_found", 404);
  if (r.status === "requires_action" && isExpired(r.expires_at, d.now())) {
    await settle(d, r.id, "expired", null, "expired");
    r.status = "expired";
  }
  return json(200, publicIntent(r));
}

async function cancelIntent(id: string, d: Deps) {
  if (!/^pi_[a-z0-9_]{6,64}$/i.test(id)) return bad("bad_id");
  if (!d.db) return json(501, notConfigured("supabase", ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]));
  const r = await d.db.intent(id);
  if (!r) return bad("not_found", 404);
  if (r.status === "requires_action") await settle(d, id, "cancelled", null, "cancelled");
  return json(200, { ok: true });
}

/* ───────────────────────── webhooks ───────────────────────── */

export async function handleWebhook(provider: ProviderId, req: Request, d: Deps): Promise<Response> {
  if (req.method !== "POST") return bad("method_not_allowed", 405);
  const parsed = await readJson(req, 200_000);
  if (!parsed) return bad("bad_json");
  const b = parsed.body;

  let intentId: string | null = null;
  let providerOrderId: string | null = null;
  let status: IntentStatus | null = null;
  let ref: string | null = null;
  let failure: string | null = null;
  let feeMinor: number | null = null;
  let verify: (creds: ProviderCreds) => Promise<boolean>;

  if (provider === "paymob") {
    const obj = (b.obj ?? {}) as Record<string, unknown>;
    const order = (obj.order ?? {}) as Record<string, unknown>;
    // Intention API: special_reference comes back as order.merchant_order_id; extras under payment_key_claims.extra
    const extras = (((obj.payment_key_claims ?? {}) as Record<string, unknown>).extra ?? {}) as Record<string, unknown>;
    intentId = typeof order.merchant_order_id === "string" ? order.merchant_order_id : typeof extras.intent_id === "string" ? extras.intent_id : null;
    const hmac = new URL(req.url).searchParams.get("hmac") ?? (typeof b.hmac === "string" ? b.hmac : null);
    verify = (c) => verifyPaymob(obj, hmac, c.get("PAYMOB_HMAC"));
    if (b.type && b.type !== "TRANSACTION") return json(200, { ignored: String(b.type) });
    status = obj.is_refunded || obj.is_voided ? null : paymobStatus(obj);
    ref = obj.id !== undefined ? String(obj.id) : null;
    failure = status === "failed" ? String(((obj.data ?? {}) as Record<string, unknown>).message ?? "declined").slice(0, 120) : null;
  } else if (provider === "kashier") {
    const data = (b.data ?? {}) as Record<string, unknown>;
    intentId = String(data.merchantOrderId ?? data.orderReference ?? "") || null;
    const sig = req.headers.get("x-kashier-signature");
    verify = (c) => verifyKashier(data, sig, c.get("KASHIER_API_KEY"));
    const event = String(b.event ?? "pay");
    status = event === "pay" || event === "authorize" ? kashierStatus(data.status) : null;
    ref = data.transactionId ? String(data.transactionId) : null;
    failure = status === "failed" ? String(data.transactionResponseMessage ?? data.status ?? "declined").slice(0, 120) : null;
  } else {
    const data = (b.data ?? {}) as Record<string, unknown>;
    const meta = (data.metadata ?? {}) as Record<string, unknown>;
    intentId = typeof meta.intent_id === "string" ? meta.intent_id : null;
    providerOrderId = typeof data.invoice_id === "string" ? data.invoice_id : null;
    verify = async (c) => verifyMoyasar(b, c.get("MOYASAR_WEBHOOK_SECRET"));
    status = moyasarStatus(String(b.type ?? ""), data.status);
    ref = data.id ? String(data.id) : null;
    feeMinor = typeof data.fee === "number" && Number.isSafeInteger(data.fee) ? data.fee : null;
    failure = status === "failed" ? String(((data.source ?? {}) as Record<string, unknown>).message ?? "declined").slice(0, 120) : null;
  }

  // find the intent (only to pick the tenant's key — nothing is trusted before the signature checks out)
  let intent: IntentRecord | null = null;
  if (d.db) {
    if (intentId && /^pi_[a-z0-9_]{6,64}$/i.test(intentId)) intent = await d.db.intent(intentId);
    if (!intent && providerOrderId) intent = await d.db.intentByProviderOrder(provider, providerOrderId);
  }
  const { creds, missing } = await credsForRestaurant(d, intent?.restaurant_id ?? null, provider);
  const secretName = provider === "paymob" ? "PAYMOB_HMAC" : provider === "kashier" ? "KASHIER_API_KEY" : "MOYASAR_WEBHOOK_SECRET";
  if (!creds.get(secretName)) return json(501, notConfigured(provider, missing.length ? missing : [secretName]));
  if (!(await verify(creds))) {
    d.log("webhook.bad_signature", { provider, intentId });
    return bad("bad_signature", 401);
  }
  if (!status) {
    d.log("webhook.ignored", { provider, intentId, type: b.type ?? b.event ?? null });
    return json(200, { ok: true, ignored: true });
  }
  const id = intent?.id ?? intentId;
  if (!id) return json(200, { ok: true, ignored: "no_intent" });
  if (d.db && !intent) {
    d.log("webhook.unknown_intent", { provider, intentId: id });
    return json(200, { ok: true, ignored: "unknown_intent" });
  }
  const r = await settle(d, id, status, ref, failure, feeMinor === null ? null : minorToUnits(feeMinor));
  return json(200, { ok: true, status: r.status });
}

/* ───────────────────────── /api/pay-callback (browser return) ───────────────────────── */

export async function handleCallback(req: Request, d: Deps): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const id = q.get("pi") ?? "";
  const base = baseUrl(req, d.env);
  const home = `${base}/app/`;
  const go = (to: string) => new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store" } });
  if (!/^pi_[a-z0-9_]{6,64}$/i.test(id)) return go(home);
  const withPi = (u: string) => {
    const x = new URL(u);
    x.searchParams.set("pi", id);
    return x.toString();
  };
  if (!d.db) {
    const r = safeReturnUrl(q.get("r"), origins(req, d.env));
    return go(r ? withPi(r) : home);
  }
  const intent = await d.db.intent(id);
  if (!intent) return go(home);
  const back = safeReturnUrl(intent.request?.returnUrl, origins(req, d.env)) ?? home;
  if (intent.status === "requires_action" || intent.status === "processing") {
    // never trust the redirect's query: ask the provider (or wait for the webhook)
    try {
      if (SERVER_PROVIDERS.includes(intent.provider as ProviderId)) {
        const { creds } = await credsForRestaurant(d, intent.restaurant_id, intent.provider as ProviderId);
        let txn = intent.provider_ref;
        if (intent.provider === "paymob" && !txn && (await verifyPaymobQuery(q, creds.get("PAYMOB_HMAC")))) txn = q.get("id");
        const s = await gateways.status(creds, { providerOrderId: intent.provider_order_id, providerRef: txn }, d.fetch);
        if (s && s.status !== "requires_action" && s.status !== "processing") await settle(d, id, s.status, s.providerRef ?? txn, s.failure, s.fee === null ? null : minorToUnits(s.fee));
        else if (intent.status === "requires_action") await d.db.patchIntent(id, { status: "processing" });
      }
    } catch (e) {
      d.log("callback.status_error", { id, msg: String((e as Error).message) });
    }
  }
  return go(withPi(back === home ? home : back));
}

/* ───────────────────────── /api/pay-refund ───────────────────────── */

export async function handleRefund(req: Request, d: Deps): Promise<Response> {
  if (req.method !== "POST") return bad("method_not_allowed", 405);
  if (!d.db) return json(501, notConfigured("supabase", ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]));
  const jwt = bearer(req);
  if (!jwt) return bad("staff_only", 401);
  const parsed = await readJson(req);
  if (!parsed) return bad("bad_json");
  const b = parsed.body;
  const intent = typeof b.intentId === "string" ? await d.db.intent(b.intentId) : null;
  if (!intent) return bad("not_found", 404);
  if (!(await d.db.hasRole(jwt, intent.restaurant_id, MANAGERS))) return bad("manager_only", 403);
  if (intent.status !== "succeeded") return bad("not_paid", 409);
  const amount = Number(b.amount);
  const refundable = Number(intent.amount) + Number(intent.tip) - Number(intent.refunded);
  const err = validateCharge({ amount, tip: 0, due: refundable });
  if (err) return json(422, { error: err, refundable });
  if (!SERVER_PROVIDERS.includes(intent.provider as ProviderId)) return bad("provider_not_supported");
  const { creds, missing } = await credsForRestaurant(d, intent.restaurant_id, intent.provider as ProviderId);
  if (missing.length) return json(501, notConfigured(intent.provider, missing));
  const requestedBy = await d.db.membershipOf(jwt, intent.restaurant_id);
  const approvedBy = typeof b.approvedBy === "string" && UUID.test(b.approvedBy) ? b.approvedBy : requestedBy;
  const reason = String(b.reason ?? "").slice(0, 200);
  const rf = await d.db.insertRefund({ restaurant_id: intent.restaurant_id, intent_id: intent.id, payment_id: intent.payment_id, amount, reason, status: "pending", requested_by: requestedBy, approved_by: approvedBy });
  try {
    const out = await gateways.refund(creds, { intentId: intent.id, providerRef: intent.provider_ref, providerOrderId: intent.provider_order_id }, unitsToMinor(amount), reason, d.fetch);
    await d.db.patchRefund(rf.id, { status: "succeeded", provider_ref: out.providerRef });
    await d.db.patchIntent(intent.id, { refunded: Number(intent.refunded) + amount });
    d.log("refund.ok", { intentId: intent.id, amount });
    return json(200, { ok: true, refundId: rf.id, refunded: Number(intent.refunded) + amount });
  } catch (e) {
    const msg = e instanceof ProviderError ? `${e.provider} ${e.status}` : String((e as Error).message);
    await d.db.patchRefund(rf.id, { status: "failed", error: msg.slice(0, 200) }).catch(() => undefined);
    d.log("refund.failed", { intentId: intent.id, msg });
    return json(502, { error: "provider_error", message: { ar: "الاسترداد ماتمّش عند بوابة الدفع", en: "The gateway rejected the refund" } });
  }
}

/* ───────────────────────── /api/pay-status ───────────────────────── */

/** which keys are present (booleans only — never values) + the webhook URLs to paste into provider dashboards */
export function handleStatus(req: Request, d: Deps): Response {
  const base = baseUrl(req, d.env);
  const s = envStatus(d.env);
  return json(200, {
    ...s,
    webhooks: Object.fromEntries(SERVER_PROVIDERS.map((p) => [p, `${base}/api/pay-webhook-${p}`])),
    callback: `${base}/api/pay-callback`,
  });
}

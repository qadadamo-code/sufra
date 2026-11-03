/**
 * Gateway adapters (server side): create a hosted payment, read its status, refund.
 * Endpoints/fields as documented (checked 2026-11); anything marked UNCONFIRMED must be verified with the
 * provider's sandbox during merchant onboarding — see sufra-os/src/modules/guest/pay/DESIGN.md.
 */
import { minorToDecimal, kashierStatus, type Currency, type Env, type IntentStatus, type Method, type ProviderId } from "./pay-core";

export interface ProviderCreds {
  provider: ProviderId;
  mode: "test" | "live";
  get(name: string): string;
}

export interface CreateArgs {
  intentId: string;
  amountMinor: number;
  currency: Currency;
  method: Method | null;
  methods: Method[];
  description: string;
  customer: { name: string; phone: string; email?: string | null } | null;
  /** our /api/pay-callback?pi=… — where the provider sends the browser back */
  callbackUrl: string;
  /** our /api/pay-webhook-<provider> */
  webhookUrl: string;
  lang: "ar" | "en";
  expiresAt: string;
}
export interface CreateResult {
  redirectUrl: string | null;
  iframeUrl: string | null;
  clientSecret: string | null;
  providerOrderId: string;
}
export interface StatusResult {
  status: IntentStatus;
  providerRef: string | null;
  fee: number | null; // minor units
  failure: string | null;
}

export class ProviderError extends Error {
  constructor(public provider: ProviderId, public status: number, message: string) {
    super(message);
  }
}

type F = typeof fetch;
const json = async (res: Response) => {
  const t = await res.text();
  try {
    return t ? JSON.parse(t) : {};
  } catch {
    return { raw: t.slice(0, 300) };
  }
};
const split = (name: string) => {
  const parts = (name || "Guest").trim().split(/\s+/);
  return { first: parts[0] || "Guest", last: parts.slice(1).join(" ") || "-" };
};

/** credentials: per-tenant Vault secrets first, then deployment env vars */
export function credsFor(provider: ProviderId, env: Env, tenant?: { mode?: string; public_config?: Record<string, string>; secrets?: Record<string, string> } | null): ProviderCreds {
  const modeEnv = provider === "kashier" ? env.KASHIER_MODE : env[`${provider.toUpperCase()}_MODE`];
  const mode = (tenant?.mode ?? modeEnv ?? "test") === "live" ? "live" : "test";
  return {
    provider,
    mode,
    get: (n) => (tenant?.secrets?.[n] ?? tenant?.public_config?.[n] ?? env[n] ?? "").trim(),
  };
}

/* ───────────────────────── Paymob (Intention API + Unified Checkout) ───────────────────────── */
// POST {base}/v1/intention/  Authorization: Token <secret key>  → { id, client_secret, … }
// Browser → {base}/unifiedcheckout/?publicKey=<public key>&clientSecret=<client_secret>
// Egypt base https://accept.paymob.com (KSA: https://ksa.paymob.com, set PAYMOB_BASE_URL)

const paymobBase = (c: ProviderCreds) => c.get("PAYMOB_BASE_URL") || "https://accept.paymob.com";

function paymobIntegrations(c: ProviderCreds, methods: Method[]): number[] {
  const map: Partial<Record<Method, string>> = { card: "PAYMOB_INTEGRATION_CARD", mada: "PAYMOB_INTEGRATION_CARD", meeza: "PAYMOB_INTEGRATION_CARD", wallet: "PAYMOB_INTEGRATION_WALLET", kiosk: "PAYMOB_INTEGRATION_KIOSK", applepay: "PAYMOB_INTEGRATION_APPLEPAY" };
  const ids = new Set<number>();
  for (const m of methods) for (const id of (c.get(map[m] ?? "") || "").split(",")) if (/^\d+$/.test(id.trim())) ids.add(Number(id.trim()));
  if (!ids.size) for (const id of c.get("PAYMOB_INTEGRATION_CARD").split(",")) if (/^\d+$/.test(id.trim())) ids.add(Number(id.trim()));
  return [...ids];
}

async function paymobCreate(c: ProviderCreds, a: CreateArgs, f: F): Promise<CreateResult> {
  const n = split(a.customer?.name ?? "");
  const body = {
    amount: a.amountMinor,
    currency: a.currency,
    payment_methods: paymobIntegrations(c, a.method ? [a.method] : a.methods),
    items: [{ name: a.description.slice(0, 50), amount: a.amountMinor, description: a.description.slice(0, 255), quantity: 1 }],
    billing_data: { first_name: n.first, last_name: n.last, phone_number: a.customer?.phone || "+200000000000", email: a.customer?.email || "guest@sufra.app", country: a.currency === "SAR" ? "SA" : "EG" },
    special_reference: a.intentId,
    notification_url: a.webhookUrl,
    redirection_url: a.callbackUrl,
    expiration: Math.max(300, Math.round((Date.parse(a.expiresAt) - Date.now()) / 1000)),
    extras: { intent_id: a.intentId },
  };
  const res = await f(`${paymobBase(c)}/v1/intention/`, { method: "POST", headers: { authorization: `Token ${c.get("PAYMOB_SECRET_KEY")}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await json(res);
  if (!res.ok || !j.client_secret) throw new ProviderError("paymob", res.status, JSON.stringify(j).slice(0, 300));
  const url = `${paymobBase(c)}/unifiedcheckout/?publicKey=${encodeURIComponent(c.get("PAYMOB_PUBLIC_KEY"))}&clientSecret=${encodeURIComponent(j.client_secret)}`;
  return { redirectUrl: url, iframeUrl: null, clientSecret: j.client_secret, providerOrderId: String(j.id ?? j.intention_order_id ?? "") };
}

/** Transaction inquiry needs the legacy auth token (POST /api/auth/tokens {api_key}). Only when PAYMOB_API_KEY is set. */
async function paymobStatus(c: ProviderCreds, txnId: string | null, f: F): Promise<StatusResult | null> {
  const apiKey = c.get("PAYMOB_API_KEY");
  if (!apiKey || !txnId) return null;
  const t = await json(await f(`${paymobBase(c)}/api/auth/tokens`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: apiKey }) }));
  if (!t.token) return null;
  const res = await f(`${paymobBase(c)}/api/acceptance/transactions/${encodeURIComponent(txnId)}`, { headers: { authorization: `Bearer ${t.token}` } });
  if (!res.ok) return null;
  const x = await json(res);
  const status: IntentStatus = x.pending ? "processing" : x.success && !x.is_voided && !x.is_refunded ? "succeeded" : "failed";
  return { status, providerRef: String(x.id), fee: null, failure: status === "failed" ? String(x.data?.message ?? "declined") : null };
}

// UNCONFIRMED for secret-key auth: POST {base}/api/acceptance/void_refund/refund { transaction_id, amount_cents }
async function paymobRefund(c: ProviderCreds, txnId: string, minor: number, f: F) {
  const res = await f(`${paymobBase(c)}/api/acceptance/void_refund/refund`, { method: "POST", headers: { authorization: `Token ${c.get("PAYMOB_SECRET_KEY")}`, "content-type": "application/json" }, body: JSON.stringify({ transaction_id: txnId, amount_cents: minor }) });
  const j = await json(res);
  if (!res.ok || j.success === false) throw new ProviderError("paymob", res.status, JSON.stringify(j).slice(0, 300));
  return { providerRef: String(j.id ?? "") };
}

/* ───────────────────────── Kashier (Payment Sessions v3) ───────────────────────── */
// POST https://{test-api|api}.kashier.io/v3/payment/sessions   headers: Authorization: <secret key>, api-key: <API key>
//   body { expireAt, maxFailureAttempts, paymentType:"credit", amount:"185.50", currency, order, merchantRedirect,
//          serverWebhook, display, type:"one-time", allowedMethods:"card,wallet", merchantId, customer{email,reference}, … }
//   → { sessionUrl, _id }   status: GET /v3/payment/sessions/:id/payment

const kashierApi = (c: ProviderCreds) => (c.mode === "live" ? "https://api.kashier.io" : "https://test-api.kashier.io");
const kashierHeaders = (c: ProviderCreds) => ({ authorization: c.get("KASHIER_SECRET_KEY"), "api-key": c.get("KASHIER_API_KEY"), "content-type": "application/json" });

async function kashierCreate(c: ProviderCreds, a: CreateArgs, f: F): Promise<CreateResult> {
  const allowed = [...new Set((a.method ? [a.method] : a.methods).map((m) => (m === "wallet" ? "wallet" : m === "kiosk" ? "fawry" : m === "valu" ? "bnpl" : "card")))].join(",");
  const body = {
    expireAt: a.expiresAt, maxFailureAttempts: 3, paymentType: "credit", amount: minorToDecimal(a.amountMinor), currency: a.currency, order: a.intentId,
    merchantRedirect: a.callbackUrl, serverWebhook: a.webhookUrl, display: a.lang, type: "one-time", allowedMethods: allowed || "card",
    merchantId: c.get("KASHIER_MERCHANT_ID"), failureRedirect: true, description: a.description.slice(0, 120),
    customer: { email: a.customer?.email || "guest@sufra.app", reference: a.customer?.phone || a.intentId }, interactionSource: "ECOMMERCE", enable3DS: true,
    metaData: { intentId: a.intentId },
  };
  const res = await f(`${kashierApi(c)}/v3/payment/sessions`, { method: "POST", headers: kashierHeaders(c), body: JSON.stringify(body) });
  const j = await json(res);
  if (!res.ok || !j.sessionUrl) throw new ProviderError("kashier", res.status, JSON.stringify(j).slice(0, 300));
  return { redirectUrl: j.sessionUrl, iframeUrl: j.sessionUrl, clientSecret: null, providerOrderId: String(j._id ?? j.id ?? "") };
}

// Response fields of /payment are UNCONFIRMED (docs don't show them); we read status / transactionId defensively.
async function kashierStatusOf(c: ProviderCreds, sessionId: string, f: F): Promise<StatusResult | null> {
  if (!sessionId) return null;
  const res = await f(`${kashierApi(c)}/v3/payment/sessions/${encodeURIComponent(sessionId)}/payment`, { headers: kashierHeaders(c) });
  if (!res.ok) return null;
  const j = await json(res);
  const d = j.data ?? j;
  if (!d.status) return null;
  return { status: kashierStatus(d.status), providerRef: d.transactionId ? String(d.transactionId) : null, fee: null, failure: kashierStatus(d.status) === "failed" ? String(d.message ?? d.status) : null };
}

// UNCONFIRMED: PUT https://{test-}fep.kashier.io/v3/orders/:orderId/  { apiOperation: "REFUND", reason, transaction: { amount } }
async function kashierRefund(c: ProviderCreds, orderId: string, minor: number, reason: string, f: F) {
  const host = c.mode === "live" ? "https://fep.kashier.io" : "https://test-fep.kashier.io";
  const res = await f(`${host}/v3/orders/${encodeURIComponent(orderId)}/`, { method: "PUT", headers: kashierHeaders(c), body: JSON.stringify({ apiOperation: "REFUND", reason, transaction: { amount: Number(minorToDecimal(minor)) } }) });
  const j = await json(res);
  if (!res.ok || (j.status && String(j.status).toUpperCase() !== "SUCCESS")) throw new ProviderError("kashier", res.status, JSON.stringify(j).slice(0, 300));
  return { providerRef: String(j.response?.transactionId ?? j.transactionId ?? "") };
}

/* ───────────────────────── Moyasar (Invoices = hosted checkout, KSA) ───────────────────────── */
// POST https://api.moyasar.com/v1/invoices  Basic <secret key>:   { amount (halalas), currency, description, callback_url,
//   success_url, back_url, expired_at, metadata } → { id, url, status: "initiated" }
// Webhook (dashboard or POST /v1/webhooks) carries secret_token. Refund: POST /v1/payments/:id/refund { amount }

const moyasarAuth = (c: ProviderCreds) => `Basic ${btoa(`${c.get("MOYASAR_SECRET_KEY")}:`)}`;

async function moyasarCreate(c: ProviderCreds, a: CreateArgs, f: F): Promise<CreateResult> {
  const body = { amount: a.amountMinor, currency: a.currency, description: a.description.slice(0, 255), callback_url: a.webhookUrl, success_url: a.callbackUrl, back_url: a.callbackUrl, expired_at: a.expiresAt, metadata: { intent_id: a.intentId } };
  const res = await f("https://api.moyasar.com/v1/invoices", { method: "POST", headers: { authorization: moyasarAuth(c), "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await json(res);
  if (!res.ok || !j.url) throw new ProviderError("moyasar", res.status, JSON.stringify(j).slice(0, 300));
  const url = `${j.url}${j.url.includes("?") ? "&" : "?"}lang=${a.lang}`;
  return { redirectUrl: url, iframeUrl: null, clientSecret: null, providerOrderId: String(j.id) };
}

async function moyasarStatusOf(c: ProviderCreds, invoiceId: string, f: F): Promise<StatusResult | null> {
  if (!invoiceId) return null;
  const res = await f(`https://api.moyasar.com/v1/invoices/${encodeURIComponent(invoiceId)}`, { headers: { authorization: moyasarAuth(c) } });
  if (!res.ok) return null;
  const j = await json(res);
  const paid = (j.payments ?? []).find((p: { status: string }) => p.status === "paid");
  const status: IntentStatus = j.status === "paid" || paid ? "succeeded" : j.status === "expired" ? "expired" : j.status === "canceled" ? "cancelled" : j.status === "failed" ? "failed" : "processing";
  return { status, providerRef: paid?.id ?? null, fee: typeof paid?.fee === "number" ? paid.fee : null, failure: status === "failed" ? "declined" : null };
}

async function moyasarRefund(c: ProviderCreds, paymentId: string, minor: number, f: F) {
  const res = await f(`https://api.moyasar.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, { method: "POST", headers: { authorization: moyasarAuth(c), "content-type": "application/json" }, body: JSON.stringify({ amount: minor }) });
  const j = await json(res);
  if (!res.ok) throw new ProviderError("moyasar", res.status, JSON.stringify(j).slice(0, 300));
  return { providerRef: String(j.id ?? paymentId) };
}

/* ───────────────────────── dispatch ───────────────────────── */

export const gateways = {
  create(c: ProviderCreds, a: CreateArgs, f: F = fetch): Promise<CreateResult> {
    return c.provider === "paymob" ? paymobCreate(c, a, f) : c.provider === "kashier" ? kashierCreate(c, a, f) : moyasarCreate(c, a, f);
  },
  /** server-side status lookup; null = provider can't be asked (wait for the webhook) */
  status(c: ProviderCreds, ids: { providerOrderId: string | null; providerRef: string | null }, f: F = fetch): Promise<StatusResult | null> {
    if (c.provider === "paymob") return paymobStatus(c, ids.providerRef, f);
    if (c.provider === "kashier") return kashierStatusOf(c, ids.providerOrderId ?? "", f);
    return moyasarStatusOf(c, ids.providerOrderId ?? "", f);
  },
  refund(c: ProviderCreds, ids: { intentId: string; providerRef: string | null; providerOrderId: string | null }, minor: number, reason: string, f: F = fetch) {
    if (c.provider === "paymob") return paymobRefund(c, ids.providerRef ?? "", minor, f);
    if (c.provider === "kashier") return kashierRefund(c, ids.intentId, minor, reason, f);
    return moyasarRefund(c, ids.providerRef ?? "", minor, f);
  },
};


/**
 * Payment gateway core — pure helpers shared by the /api/pay-* functions and their tests
 * (sufra-os/src/modules/payments/server.test.ts). No npm deps: Web Crypto (Edge + Node ≥ 20) only.
 *
 * Money: the app's `Units` are integers of 0.00001 of the currency (1 EGP = 100 000 units, 1 piastre/halala = 1 000).
 * Gateways want minor units (piastres / halalas) or a 2-decimal string — converted here with integer math only.
 *
 * Sources (checked 2026-11, see sufra-os/src/modules/guest/pay/DESIGN.md):
 *   Paymob   HMAC (transaction callback) https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac/hmac-transaction-callback
 *   Kashier  webhooks                    https://developers.kashier.io/docs/webhooks
 *   Moyasar  webhook reference            https://docs.moyasar.com/docs/api/other/webhooks/webhook-reference.md
 */

export const UNITS_PER_MINOR = 1000;
export type Currency = "EGP" | "SAR";
export const CURRENCIES: Currency[] = ["EGP", "SAR"];

export type ProviderId = "paymob" | "kashier" | "moyasar";
export const SERVER_PROVIDERS: ProviderId[] = ["paymob", "kashier", "moyasar"];
export type Method = "card" | "wallet" | "kiosk" | "applepay" | "mada" | "stcpay" | "meeza" | "valu";
export const METHODS: Method[] = ["card", "wallet", "kiosk", "applepay", "mada", "stcpay", "meeza", "valu"];
export type IntentStatus = "requires_action" | "processing" | "succeeded" | "failed" | "cancelled" | "expired";
export type IntentKind = "guest" | "link" | "online_order" | "gift_card" | "wallet_topup" | "deposit";
export const KINDS: IntentKind[] = ["guest", "link", "online_order", "gift_card", "wallet_topup", "deposit"];

/* ───────────────────────── amounts ───────────────────────── */

export class AmountError extends Error {}

/** Units → minor units (piastres / halalas). Refuses fractions of a piastre and non-integers (no float drift). */
export function unitsToMinor(u: number): number {
  if (!Number.isSafeInteger(u)) throw new AmountError("amount_not_integer");
  if (u % UNITS_PER_MINOR !== 0) throw new AmountError("amount_not_whole_minor");
  return u / UNITS_PER_MINOR;
}
export const minorToUnits = (m: number): number => {
  if (!Number.isSafeInteger(m)) throw new AmountError("minor_not_integer");
  return m * UNITS_PER_MINOR;
};
/** 18550 → "185.50" (Kashier) */
export function minorToDecimal(m: number): string {
  if (!Number.isSafeInteger(m)) throw new AmountError("minor_not_integer");
  const neg = m < 0;
  const a = Math.abs(m);
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}
/** "185.5" / "185.50" / "185" / 185.5 → 18550, parsed as text so 0.1 + 0.2 never happens. */
export function decimalToMinor(v: string | number): number {
  const s = typeof v === "number" ? v.toFixed(2) : String(v).trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new AmountError("bad_decimal");
  const minor = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -minor : minor;
}
/** basis points of an amount, rounded half-up to a whole minor unit (surcharges, fee estimates) */
export function bpOfUnits(u: number, bp: number): number {
  const minor = unitsToMinor(u);
  const v = Math.floor((minor * bp + 5000) / 10_000);
  return v * UNITS_PER_MINOR;
}

export interface ChargeCheck {
  amount: number;
  tip: number;
  /** what is still owed on the check (total − paid − other pending intents); null when there is no check */
  due: number | null;
  /** cap for check-less kinds (gift cards, top-ups) */
  max?: number;
}
/** null = ok, else an error code. Tip ≤ 100% of the share. */
export function validateCharge(c: ChargeCheck): string | null {
  for (const v of [c.amount, c.tip]) if (!Number.isSafeInteger(v)) return "amount_not_integer";
  if (c.amount <= 0) return "amount_not_positive";
  if (c.tip < 0) return "tip_negative";
  if (c.amount % UNITS_PER_MINOR || c.tip % UNITS_PER_MINOR) return "amount_not_whole_minor";
  if (c.tip > c.amount) return "tip_too_large";
  if (c.due !== null && c.amount > c.due) return "amount_exceeds_due";
  if (c.max !== undefined && c.amount > c.max) return "amount_exceeds_max";
  return null;
}

/* ───────────────────────── crypto ───────────────────────── */

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function hmacHex(alg: "SHA-256" | "SHA-512", key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: alg }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}

/** constant-time string compare (lengths leak, contents don't) */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || !a.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function randomId(prefix: string, bytes = 12): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return prefix + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/* ───────────────────────── Paymob ───────────────────────── */

/**
 * Transaction callback HMAC (SHA-512, hex) over these values concatenated with no separator, in THIS order
 * (Paymob docs, "HMAC Transaction Callback"). POST (processed callback) reads them from `obj`; the GET redirect
 * (response callback) sends them flattened in the query string with `id` and `order_id` instead of `obj.id` / `order.id`.
 */
export const PAYMOB_HMAC_FIELDS = [
  "amount_cents", "created_at", "currency", "error_occured", "has_parent_transaction", "id", "integration_id", "is_3d_secure", "is_auth",
  "is_capture", "is_refunded", "is_standalone_payment", "is_voided", "order.id", "owner", "pending", "source_data.pan", "source_data.sub_type",
  "source_data.type", "success",
] as const;

const str = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? "" : String(v));
const dig = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Record<string, unknown>)[k] : undefined), o);

/** concatenation for the POST body's `obj` */
export function paymobHmacString(obj: Record<string, unknown>): string {
  return PAYMOB_HMAC_FIELDS.map((f) => str(dig(obj, f))).join("");
}
/** concatenation for the GET redirect query (flat keys) */
export function paymobHmacStringFromQuery(q: URLSearchParams): string {
  return PAYMOB_HMAC_FIELDS.map((f) => {
    if (f === "order.id") return q.get("order_id") ?? q.get("order") ?? "";
    return q.get(f) ?? "";
  }).join("");
}
export async function verifyPaymob(obj: Record<string, unknown>, hmac: string | null, secret: string): Promise<boolean> {
  if (!hmac || !secret) return false;
  return safeEqual((await hmacHex("SHA-512", secret, paymobHmacString(obj))).toLowerCase(), hmac.toLowerCase());
}
export async function verifyPaymobQuery(q: URLSearchParams, secret: string): Promise<boolean> {
  const h = q.get("hmac");
  if (!h || !secret) return false;
  return safeEqual((await hmacHex("SHA-512", secret, paymobHmacStringFromQuery(q))).toLowerCase(), h.toLowerCase());
}
export function paymobStatus(obj: Record<string, unknown>): IntentStatus {
  if (obj.pending === true) return "processing";
  if (obj.success === true && !obj.is_voided && !obj.is_refunded) return "succeeded";
  return "failed";
}

/* ───────────────────────── Kashier ───────────────────────── */

/** RFC 3986 encoding, like the `query-string` package in Kashier's Node sample (encodes !'()* too). */
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/**
 * Webhook signature payload (Kashier docs, "Webhooks"): sort `data.signatureKeys` alphabetically, pick those keys from
 * `data`, build `key=value&…` with only the values URL-encoded; HMAC-SHA256 (hex) with the merchant's Payment API key;
 * compare with the `x-kashier-signature` header.
 */
export function kashierSignaturePayload(data: Record<string, unknown>): string {
  const keys = Array.isArray(data.signatureKeys) ? [...(data.signatureKeys as unknown[])].map(String).sort() : [];
  return keys.filter((k) => data[k] !== undefined).map((k) => `${k}=${rfc3986(str(data[k]))}`).join("&");
}
export async function verifyKashier(data: Record<string, unknown>, signature: string | null, apiKey: string): Promise<boolean> {
  if (!signature || !apiKey || !Array.isArray(data.signatureKeys) || !data.signatureKeys.length) return false;
  return safeEqual(await hmacHex("SHA-256", apiKey, kashierSignaturePayload(data)), signature.toLowerCase());
}
export function kashierStatus(s: unknown): IntentStatus {
  const v = String(s ?? "").toUpperCase();
  if (v === "SUCCESS" || v === "CAPTURED" || v === "PAID" || v === "APPROVED") return "succeeded";
  if (v === "PENDING" || v === "INITIATED" || v === "OPENED") return "processing";
  if (v === "EXPIRED") return "expired";
  if (v === "CANCELLED" || v === "CANCELED") return "cancelled";
  return "failed";
}

/* ───────────────────────── Moyasar ───────────────────────── */

/** Moyasar sends the endpoint's `secret_token` (set when registering the webhook) in the JSON body. */
export function verifyMoyasar(body: { secret_token?: unknown }, secret: string): boolean {
  return !!secret && typeof body.secret_token === "string" && safeEqual(body.secret_token, secret);
}
export function moyasarStatus(eventType: string, paymentStatus?: unknown): IntentStatus | null {
  switch (eventType) {
    case "payment_paid":
    case "payment_captured":
      return "succeeded";
    case "payment_failed":
    case "payment_faild": // sic — spelled this way in Moyasar's event list
      return "failed";
    case "payment_authorized":
    case "payment_verified":
      return "processing";
    case "payment_voided":
      return "cancelled";
    default:
      return paymentStatus === "paid" ? "succeeded" : null;
  }
}

/* ───────────────────────── config ───────────────────────── */

export type Env = Record<string, string | undefined>;

/** env var names per provider (deployment-wide merchant; per-tenant overrides come from Supabase Vault) */
export const PROVIDER_ENV: Record<ProviderId, { required: string[]; optional: string[] }> = {
  paymob: { required: ["PAYMOB_SECRET_KEY", "PAYMOB_PUBLIC_KEY", "PAYMOB_HMAC", "PAYMOB_INTEGRATION_CARD"], optional: ["PAYMOB_INTEGRATION_WALLET", "PAYMOB_INTEGRATION_KIOSK", "PAYMOB_INTEGRATION_APPLEPAY", "PAYMOB_API_KEY", "PAYMOB_BASE_URL"] },
  kashier: { required: ["KASHIER_MERCHANT_ID", "KASHIER_API_KEY", "KASHIER_SECRET_KEY"], optional: ["KASHIER_MODE"] },
  moyasar: { required: ["MOYASAR_SECRET_KEY", "MOYASAR_WEBHOOK_SECRET"], optional: ["MOYASAR_PUBLISHABLE_KEY"] },
};
export const SERVER_ENV = { required: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"], optional: ["PAY_PUBLIC_BASE_URL", "PAY_PROVIDER"] };

export function envStatus(env: Env) {
  const has = (k: string) => !!env[k]?.trim();
  const providers = Object.fromEntries(
    SERVER_PROVIDERS.map((p) => {
      const { required, optional } = PROVIDER_ENV[p];
      const keys = Object.fromEntries([...required, ...optional].map((k) => [k, has(k)]));
      return [p, { configured: required.every(has), missing: required.filter((k) => !has(k)), keys }];
    }),
  ) as Record<ProviderId, { configured: boolean; missing: string[]; keys: Record<string, boolean> }>;
  return {
    supabase: SERVER_ENV.required.every(has),
    publicBaseUrl: env.PAY_PUBLIC_BASE_URL?.trim() || null,
    defaultProvider: (env.PAY_PROVIDER?.trim() as ProviderId) || null,
    providers,
  };
}

/** Bilingual "not configured" message for 501 responses — names the env vars, never their values. */
export function notConfigured(provider: string, missing: string[]) {
  return {
    error: "not_configured",
    provider,
    missing,
    message: {
      ar: `بوابة الدفع (${provider}) مش متظبطة على السيرفر لسه. ضيف المفاتيح دي في Vercel ← Settings ← Environment Variables (أو Supabase Vault): ${missing.join("، ")}`,
      en: `The ${provider} gateway isn't configured on the server yet. Add these in Vercel → Settings → Environment Variables (or Supabase Vault): ${missing.join(", ")}`,
    },
  };
}

/** Only send guests back to our own site (no open redirects). */
export function safeReturnUrl(raw: unknown, allowedOrigins: string[]): string | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return null;
    return allowedOrigins.includes(u.origin) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Link expiry: 5 minutes … 7 days, default 60. */
export function linkExpiry(now: number, minutes: unknown, fallback = 60): string {
  const m = typeof minutes === "number" && Number.isFinite(minutes) ? Math.min(7 * 24 * 60, Math.max(5, Math.round(minutes))) : fallback;
  return new Date(now + m * 60_000).toISOString();
}
export const isExpired = (expiresAt: string, now: number) => Date.parse(expiresAt) <= now;

/**
 * Payments API for the rest of the app (POS pay-by-link, messaging, CRM gift cards / wallet top-ups, reservations deposits).
 *
 *   const pi = await createPaymentIntent(repo, { restaurantId, restaurantSlug, kind: "gift_card", amount, purposeRef: card.id, customer, returnUrl });
 *   window.location.assign(pi.redirectUrl)            // or share paymentLinkUrl(slug, pi.id)
 *   onIntentSucceeded("gift_card", (row) => …)         // local; cloud: watch paymentIntents (kind, status 'succeeded')
 *
 * Local backend → DemoProvider (rows in `paymentIntents`, recorded like the webhook would). Cloud → POST /api/pay-intent,
 * which re-validates the amount, picks the restaurant's gateway and returns the hosted-checkout URL.
 */
import type { Repo } from "@/data/repo";
import type { Check, PaymentIntentKind, PaymentIntentRow, OnlineMethod } from "@/data/types";
import type { Currency, Units } from "@/lib/money";
import { attachDemoRepo, demoProvider, PAY_API, payFetch, PayApiError, PROVIDERS, type PaymentIntent } from "@/modules/guest/pay";

const paymobProvider = PROVIDERS.paymob;

export { onIntentSucceeded, recordIntentLocal } from "./record";
export { PayApiError };

const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/app/";
const origin = () => (typeof window !== "undefined" ? window.location.origin : "https://sufra-planet-crm.vercel.app");

/** public pay-by-link page (shareable): /app/r/:slug/link/:intentId */
export const paymentLinkUrl = (slug: string, intentId: string) => `${origin()}${BASE}r/${encodeURIComponent(slug)}/link/${intentId}`;

export interface CreateIntentInput {
  restaurantId: string;
  restaurantSlug: string;
  kind: PaymentIntentKind;
  checkId?: string | null;
  orderId?: string | null;
  amount: Units;
  tip?: Units;
  currency: Currency;
  method?: OnlineMethod | null;
  customer?: { name: string; phone: string; email?: string | null } | null;
  note?: string;
  expiresInMin?: number;
  purposeRef?: string | null;
  splitLabel?: string | null;
  /** where the payer lands after paying; "{pi}" is replaced by the intent id. Default: the link page. */
  returnUrl?: string;
  createdBy?: string | null;
  lang?: "ar" | "en";
}

export async function createPaymentIntent(repo: Repo, x: CreateIntentInput): Promise<PaymentIntent> {
  const returnUrl = x.returnUrl ?? `${origin()}${BASE}r/${encodeURIComponent(x.restaurantSlug)}/link/{pi}`;
  const req = {
    restaurantSlug: x.restaurantSlug, restaurantId: x.restaurantId, purpose: (x.orderId && !x.checkId ? "order" : "check") as "order" | "check", kind: x.kind,
    checkId: x.checkId ?? null, orderId: x.orderId ?? null, tableCode: null, amount: x.amount, tip: x.tip ?? 0, currency: x.currency, splitLabel: x.splitLabel ?? null,
    customer: x.customer ?? null, returnUrl, lang: x.lang ?? "ar", method: x.method ?? null, note: x.note ?? "", expiresInMin: x.expiresInMin, purposeRef: x.purposeRef ?? null,
    createdBy: x.createdBy ?? null,
  };
  if (repo.kind === "local") {
    attachDemoRepo(repo);
    return demoProvider.createIntent(req);
  }
  return paymobProvider.createIntent(req); // provider hint only — the server uses the restaurant's gateway
}

/** pay-by-link for (part of) a check */
export function createPayLink(repo: Repo, check: Pick<Check, "id" | "restaurantId">, x: { restaurantSlug: string; amount: Units; currency: Currency; note: string; expiresInMin: number; customer: { name: string; phone: string } | null; createdBy: string | null; lang: "ar" | "en" }) {
  return createPaymentIntent(repo, { ...x, restaurantId: check.restaurantId, kind: "link", checkId: check.id });
}

export async function cancelIntent(repo: Repo, id: string) {
  if (repo.kind === "local" || id.startsWith("pi_demo_")) {
    attachDemoRepo(repo);
    await demoProvider.cancel(id);
    const row = await repo.get("paymentIntents", id);
    if (row && row.status === "requires_action") await repo.update("paymentIntents", id, { status: "cancelled", redirectUrl: null });
    return;
  }
  await paymobProvider.cancel(id);
}

/** Refund through the gateway (manager PIN is asked by the caller). Cloud: /api/pay-refund; local: simulated. */
export async function refundIntent(repo: Repo, pi: PaymentIntentRow, amount: Units, reason: string, by: { requestedBy: string | null; approvedBy: string | null }): Promise<void> {
  const refundable = pi.amount + pi.tip - pi.refunded;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount % 1000 || amount > refundable) throw new Error("bad_amount");
  if (repo.kind === "local" || pi.provider === "demo") {
    await repo.insert("paymentRefunds", {
      restaurantId: pi.restaurantId, intentId: pi.id, paymentId: pi.paymentId, amount, reason, status: "succeeded", providerRef: `DEMO-RF-${Math.floor(10000 + Math.random() * 89999)}`,
      error: null, requestedBy: by.requestedBy, approvedBy: by.approvedBy,
    });
    await repo.update("paymentIntents", pi.id, { refunded: pi.refunded + amount });
    return;
  }
  await payFetch("pay-refund", { method: "POST", body: JSON.stringify({ intentId: pi.id, amount, reason, approvedBy: by.approvedBy }) });
}

export interface PayServerStatus {
  supabase: boolean;
  publicBaseUrl: string | null;
  defaultProvider: string | null;
  providers: Record<"paymob" | "kashier" | "moyasar", { configured: boolean; missing: string[]; keys: Record<string, boolean> }>;
  webhooks: Record<string, string>;
  callback: string;
}
/** booleans only (never values) from /api/pay-status; null when the functions aren't deployed (local dev / preview) */
export async function fetchPayServerStatus(): Promise<PayServerStatus | null> {
  if (!PAY_API) return null;
  try {
    const res = await fetch(`${PAY_API}/pay-status`, { headers: { accept: "application/json" } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    const j = await res.json();
    return j && typeof j === "object" && "providers" in j ? (j as PayServerStatus) : null;
  } catch {
    return null;
  }
}

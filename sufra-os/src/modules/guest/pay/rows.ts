/** PaymentIntent (what the browser flow uses) ↔ PaymentIntentRow (the `paymentIntents` collection / payment_intents table). */
import type { PaymentIntentRow } from "@/data/types";
import type { Currency } from "@/lib/money";
import type { PaymentIntent, PaymentRequest, ProviderId } from "./types";

export function intentFromRow(r: PaymentIntentRow): PaymentIntent {
  const req = (r.request ?? {}) as Partial<PaymentRequest> & { surcharge?: number };
  return {
    id: r.id,
    provider: (["demo", "paymob", "kashier", "moyasar"].includes(r.provider) ? r.provider : "paymob") as ProviderId,
    kind: r.kind,
    method: r.method,
    status: r.status,
    charge: r.amount + r.tip + (req.surcharge ?? 0),
    amount: r.amount,
    tip: r.tip,
    currency: r.currency,
    redirectUrl: r.status === "requires_action" ? r.redirectUrl : null,
    reference: r.providerRef,
    failureReason: r.failureReason,
    note: r.note,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    request: {
      restaurantSlug: req.restaurantSlug ?? "", restaurantId: r.restaurantId, purpose: req.purpose ?? (r.orderId && !r.checkId ? "order" : "check"), kind: r.kind,
      checkId: r.checkId, orderId: r.orderId, tableCode: req.tableCode ?? null, amount: r.amount, tip: r.tip, currency: r.currency as Currency,
      splitLabel: r.splitLabel, customer: r.customer, returnUrl: req.returnUrl ?? "", lang: req.lang ?? "ar", note: r.note, method: r.method, purposeRef: r.purposeRef,
    },
  };
}

export function rowFromIntent(pi: PaymentIntent, extra: { restaurantId: string; branchId: string | null; createdBy?: string | null; mode?: "test" | "live" }): PaymentIntentRow {
  const q = pi.request;
  return {
    id: pi.id, restaurantId: extra.restaurantId, createdAt: pi.createdAt, updatedAt: pi.createdAt, branchId: extra.branchId, checkId: q.checkId, orderId: q.orderId,
    kind: q.kind ?? pi.kind ?? (q.purpose === "order" ? "online_order" : "guest"), provider: pi.provider, mode: extra.mode ?? "test", method: q.method ?? pi.method ?? null,
    status: pi.status, amount: pi.amount, tip: pi.tip, currency: pi.currency, fee: null, refunded: 0, splitLabel: q.splitLabel, redirectUrl: pi.redirectUrl,
    providerRef: pi.reference, providerOrderId: null, failureReason: pi.failureReason,
    request: { restaurantSlug: q.restaurantSlug, tableCode: q.tableCode, returnUrl: q.returnUrl, lang: q.lang, purpose: q.purpose },
    paymentId: null, purposeRef: q.purposeRef ?? null, note: q.note ?? "", customer: q.customer, createdBy: extra.createdBy ?? null, expiresAt: pi.expiresAt, payoutId: null,
  };
}

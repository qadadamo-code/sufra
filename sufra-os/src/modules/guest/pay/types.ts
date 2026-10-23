/**
 * Payment-provider abstraction for guest payments (pay-at-table and online orders).
 * See ./DESIGN.md for the server side (intents, webhooks, per-tenant merchant keys).
 *
 * The browser NEVER holds a provider secret. `createIntent` asks our server function to create the
 * provider-side payment (it holds the merchant's secret/HMAC keys) and gets back only a redirect URL
 * (hosted checkout / iframe). The payment counts once the server has verified the provider's webhook
 * signature — the redirect back to us is a hint to start polling, not proof of payment.
 */
import type { Localized } from "@/data/types";
import type { Currency, Units } from "@/lib/money";

export type ProviderId = "demo" | "paymob" | "kashier";
export type PayMethod = "card" | "wallet" | "meeza" | "apple_pay" | "valu" | "instapay";

export interface PaymentRequest {
  restaurantSlug: string;
  /** what is being paid */
  purpose: "check" | "order";
  checkId: string | null;
  orderId: string | null;
  tableCode: string | null;
  /** bill share (without tip) */
  amount: Units;
  tip: Units;
  currency: Currency;
  /** "Ahmed's share", "2 of 4" … shown to the cashier */
  splitLabel: string | null;
  customer: { name: string; phone: string; email?: string | null } | null;
  /** where the provider sends the guest back (our page, with ?pi=<intent id>) */
  returnUrl: string;
  lang: "ar" | "en";
}

export type IntentStatus = "requires_action" | "processing" | "succeeded" | "failed" | "cancelled" | "expired";

export interface PaymentIntent {
  id: string;
  provider: ProviderId;
  status: IntentStatus;
  /** amount + tip, what the card is charged */
  charge: Units;
  amount: Units;
  tip: Units;
  currency: Currency;
  /** hosted checkout / iframe URL — null once finished */
  redirectUrl: string | null;
  /** provider transaction id once paid */
  reference: string | null;
  failureReason: string | null;
  createdAt: string;
  expiresAt: string;
  request: PaymentRequest;
}

export interface PaymentProvider {
  id: ProviderId;
  label: Localized;
  methods: PayMethod[];
  /** configured for this deployment (public config present + server endpoint reachable) */
  available(): boolean;
  /** server-side: create the provider payment and return where to send the guest */
  createIntent(req: PaymentRequest): Promise<PaymentIntent>;
  /** server-side status (after the webhook was verified) */
  retrieve(id: string): Promise<PaymentIntent | null>;
  cancel(id: string): Promise<void>;
}

export class PaymentConfigError extends Error {
  constructor(public provider: ProviderId, message: string) {
    super(message);
  }
}

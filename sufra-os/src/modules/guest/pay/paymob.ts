/**
 * Paymob (Egypt) adapter — STUB on the browser side; the work happens in the server function.
 *
 * Server (`POST {VITE_PAY_API}/paymob/intent`), per tenant from `payment_accounts` (secrets in Supabase Vault):
 *   - PAYMOB_SECRET_KEY        "Authorization: Token <secret>" for the Intention API (never in the browser)
 *   - PAYMOB_PUBLIC_KEY        used in the Unified Checkout URL (public, may be returned to the client)
 *   - PAYMOB_HMAC_SECRET       verifies the transaction-processed callback (HMAC-SHA512 over the documented field list)
 *   - PAYMOB_INTEGRATION_IDS   card / wallet / valU integration ids enabled on the merchant account
 *
 *   1. POST https://accept.paymob.com/v1/intention/  { amount (piastres), currency: "EGP", payment_methods: [ids],
 *      items, billing_data {first_name, last_name, phone_number, email…}, special_reference: <our intent id>,
 *      notification_url: {VITE_PAY_API}/paymob/webhook, redirection_url: <returnUrl> }
 *   2. Respond to the browser with { id, redirectUrl: https://accept.paymob.com/unifiedcheckout/?publicKey=…&clientSecret=… }
 *   3. Webhook: verify `hmac` → upsert payment_intents.status → on success call guest_record_payment() (service role)
 *      which inserts the `payments` row (method "online", reference = Paymob transaction id) and bumps checks.paid.
 *   4. The browser polls `retrieve()` (→ guest_payment_status RPC) after the redirect back.
 *
 * Amounts: Units → piastres = units / 1000 (always whole after roundMinor). Verify field names against the current
 * Paymob docs when onboarding — they have changed between the legacy Accept API and the Intention API.
 */
import { PAY_API, payServer } from "./server";
import type { PaymentProvider } from "./types";

const PUBLIC_KEY = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_PAYMOB_PUBLIC_KEY?.trim() || null;

export const paymobProvider: PaymentProvider = {
  id: "paymob",
  label: { ar: "كارت أو محفظة (Paymob)", en: "Card or wallet (Paymob)" },
  methods: ["card", "wallet", "meeza", "valu", "apple_pay"],
  available: () => !!PAY_API && !!PUBLIC_KEY,
  createIntent: (req) => payServer.createIntent("paymob", req),
  retrieve: (id) => payServer.retrieve("paymob", id),
  cancel: (id) => payServer.cancel("paymob", id),
};

/**
 * Kashier (Egypt) adapter — STUB on the browser side; the work happens in the server function.
 *
 * Server (`POST {VITE_PAY_API}/kashier/intent`), per tenant from `payment_accounts` (secrets in Supabase Vault):
 *   - KASHIER_MERCHANT_ID   "MID-xxxx-xxx" (public)
 *   - KASHIER_API_KEY       Payment API key — signs the order hash and verifies callbacks (never in the browser)
 *   - KASHIER_MODE          "test" | "live"
 *
 *   1. orderId = our intent id; amount as a decimal string ("185.50"); currency "EGP".
 *      hash = HMAC-SHA256(key = API key, msg = `/?payment=${mid}.${orderId}.${amount}.${currency}`)  (hex)
 *   2. Respond with { id, redirectUrl: https://checkout.kashier.io/?merchantId=…&orderId=…&amount=…&currency=EGP
 *      &hash=…&mode=…&merchantRedirect=<returnUrl>&serverWebhook={VITE_PAY_API}/kashier/webhook&display=ar|en }
 *   3. Webhook (and the redirect query) carry a `signature`: rebuild the documented query string, HMAC-SHA256 with
 *      the API key, constant-time compare → on success guest_record_payment() (service role) as for Paymob.
 *   4. The browser polls `retrieve()` (→ guest_payment_status RPC) after the redirect back.
 *
 * Verify parameter names against Kashier's current docs during onboarding.
 */
import { PAY_API, payServer } from "./server";
import type { PaymentProvider } from "./types";

const MID = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_KASHIER_MERCHANT_ID?.trim() || null;

export const kashierProvider: PaymentProvider = {
  id: "kashier",
  label: { ar: "كارت أو محفظة (Kashier)", en: "Card or wallet (Kashier)" },
  methods: ["card", "wallet", "meeza", "valu"],
  available: () => !!PAY_API && !!MID,
  createIntent: (req) => payServer.createIntent("kashier", req),
  retrieve: (id) => payServer.retrieve("kashier", id),
  cancel: (id) => payServer.cancel("kashier", id),
};

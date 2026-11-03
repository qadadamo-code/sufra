/**
 * Paymob (Egypt; also KSA/Oman/UAE with PAYMOB_BASE_URL) — Intention API + Unified Checkout.
 * Browser side is thin: our /api/pay-intent creates the intention with the merchant's SECRET key and returns
 * `https://accept.paymob.com/unifiedcheckout/?publicKey=…&clientSecret=…`. The verified webhook
 * (/api/pay-webhook-paymob, HMAC-SHA512 with PAYMOB_HMAC) records the payment. See ./DESIGN.md.
 */
import { PAY_API, payServer } from "./server";
import type { PaymentProvider } from "./types";

export const paymobProvider: PaymentProvider = {
  id: "paymob",
  label: { ar: "كارت أو محفظة (Paymob)", en: "Card or wallet (Paymob)" },
  methods: ["card", "wallet", "kiosk", "meeza", "valu", "applepay"],
  available: () => !!PAY_API,
  createIntent: (req) => payServer.createIntent("paymob", req),
  retrieve: (id) => payServer.retrieve("paymob", id),
  cancel: (id) => payServer.cancel("paymob", id),
};

/**
 * Kashier (Egypt) — Payment Sessions v3 (hosted page / iframe). /api/pay-intent creates the session with the merchant's
 * secret key + API key and returns its `sessionUrl`; /api/pay-webhook-kashier verifies `x-kashier-signature`
 * (HMAC-SHA256 with the Payment API key over the sorted `signatureKeys`). See ./DESIGN.md.
 */
import { PAY_API, payServer } from "./server";
import type { PaymentProvider } from "./types";

export const kashierProvider: PaymentProvider = {
  id: "kashier",
  label: { ar: "كارت أو محفظة (Kashier)", en: "Card or wallet (Kashier)" },
  methods: ["card", "wallet", "meeza", "valu", "kiosk"],
  available: () => !!PAY_API,
  createIntent: (req) => payServer.createIntent("kashier", req),
  retrieve: (id) => payServer.retrieve("kashier", id),
  cancel: (id) => payServer.cancel("kashier", id),
};

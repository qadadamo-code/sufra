/**
 * Moyasar (KSA, SAMA-licensed) — mada, Visa/Mastercard, Apple Pay, STC Pay. /api/pay-intent creates an Invoice
 * (hosted checkout, amounts in halalas) with the secret key; /api/pay-webhook-moyasar checks the endpoint's
 * `secret_token`. Apple Pay on our own domain (embedded form) needs domain verification in the Moyasar dashboard;
 * on the hosted invoice page Moyasar's domain is used. See ./DESIGN.md.
 */
import { PAY_API, payServer } from "./server";
import type { PaymentProvider } from "./types";

export const moyasarProvider: PaymentProvider = {
  id: "moyasar",
  label: { ar: "مدى أو Apple Pay (Moyasar)", en: "mada or Apple Pay (Moyasar)" },
  methods: ["mada", "card", "applepay", "stcpay"],
  available: () => !!PAY_API,
  createIntent: (req) => payServer.createIntent("moyasar", req),
  retrieve: (id) => payServer.retrieve("moyasar", id),
  cancel: (id) => payServer.cancel("moyasar", id),
};

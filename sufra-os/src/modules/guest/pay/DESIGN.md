# Online payments — design notes (Wave 2)

Pay-at-table (split, tip), online-order prepayment, **pay-by-link** (POS / WhatsApp), gift cards & wallet top-ups (CRM)
and deposits — one gateway layer. Browser code: this folder (`src/modules/guest/pay`) + `src/modules/payments`.
Server: Vercel functions in the repo root `api/` (`pay-*.ts`, shared code in `api/_lib/pay-*.ts`). Schema:
`supabase/migrations/0005_guest.sql` + `0008_payments.sql`. Setup guide for owners: `sufra-os/docs/PAYMENTS-SETUP.md`.

## Rule zero: no secrets in the browser

Secret keys, HMAC secrets and API keys live only in **Vercel env vars** (one merchant per deployment) or **Supabase
Vault** (per restaurant: `payment_accounts.vault_secret_id` → JSON of env-style names, read by `pay_account_config()`,
service role only). The browser only ever sees our intent id, a hosted-checkout URL and booleans from `/api/pay-status`.
Settings → Payments shows which keys are present, never their values.

## Flow

```
browser ──POST /api/pay-intent {restaurantId, checkId|orderId, amount, tip, method, kind, returnUrl}──▶ (Edge function)
          · picks the restaurant's gateway (settings.payments.provider), loads its keys (Vault → env)
          · 501 + Arabic/English message naming the missing env vars when keys are missing
          · re-validates the amount: whole piastres/halalas, ≤ check.total − check.paid − other open intents, tip ≤ share
          · links/deposits need a staff JWT (has_role); returnUrl must be our own origin ("{pi}" → intent id)
          · inserts payment_intents (requires_action), creates the provider payment, stores provider_order_id
       ◀── { id, redirectUrl, iframeUrl?, clientSecret?, expiresAt, … }
browser ──▶ provider hosted checkout ──▶ /api/pay-callback?pi=… ──303──▶ returnUrl?pi=…
                                          (asks the provider's status API server-side; the query alone proves nothing)
provider ──POST /api/pay-webhook-{paymob|kashier|moyasar}──▶ verify signature ──▶ guest_record_payment(intent, status, ref)
          (idempotent: row lock + final statuses never change; payments.reference = intent id; provider_ref unique)
browser ──polls GET /api/pay-intent?id= (or guest_payment_status RPC)──▶ succeeded → receipt / POS closes the check
```

Local mode (no backend): the **DemoProvider** plays the gateway — intents are rows of the `paymentIntents` collection,
`/r/:slug/pay/:id` is the "hosted page", and `complete()` runs `recordIntentLocal()` (the webhook's twin, same rules).

## Providers (checked 2026-11; ⚠ = not confirmable from public docs, verify in the sandbox during onboarding)

| | Create | Webhook verification | Status (callback) | Refund |
| --- | --- | --- | --- | --- |
| **Paymob** (EG; KSA/OM/AE via `PAYMOB_BASE_URL`) | `POST {base}/v1/intention/`, `Authorization: Token <secret>`; body `amount` (cents), `currency`, `payment_methods` (integration ids), `items`, `billing_data`, `special_reference` (= our id), `notification_url`, `redirection_url`, `expiration` → `client_secret`; browser → `{base}/unifiedcheckout/?publicKey=…&clientSecret=…` | HMAC-SHA512 (hex) with `PAYMOB_HMAC` over the values of `amount_cents, created_at, currency, error_occured, has_parent_transaction, obj.id, integration_id, is_3d_secure, is_auth, is_capture, is_refunded, is_standalone_payment, is_voided, order.id, owner, pending, source_data.pan, source_data.sub_type, source_data.type, success` concatenated in that order; `?hmac=` query. GET redirect uses `id` / `order_id`. Our test reproduces Paymob's documented example string. | ⚠ `GET /api/acceptance/transactions/:id` with a legacy auth token (only if `PAYMOB_API_KEY` set); otherwise wait for the webhook | ⚠ `POST {base}/api/acceptance/void_refund/refund {transaction_id, amount_cents}` with `Token <secret>` |
| **Kashier** (EG) | `POST https://{test-api\|api}.kashier.io/v3/payment/sessions`, headers `Authorization: <secret key>`, `api-key: <API key>`; body `amount` "185.50", `currency`, `order` (= our id), `merchantRedirect`, `serverWebhook`, `display`, `allowedMethods`, `merchantId`, `expireAt`, `customer` → `sessionUrl` (redirect or iframe) | sort `data.signatureKeys`, pick those keys from `data`, `k=v&…` with values RFC3986-encoded, HMAC-SHA256 (hex) with the **Payment API key**, compare to header `x-kashier-signature` | `GET …/v3/payment/sessions/:id/payment` ⚠ response fields not documented publicly — read defensively | ⚠ `PUT https://{test-}fep.kashier.io/v3/orders/:orderId/ {apiOperation:"REFUND", reason, transaction:{amount}}` |
| **Moyasar** (KSA) | `POST https://api.moyasar.com/v1/invoices` (Basic `secret:`), `amount` (halalas), `currency`, `description`, `callback_url`, `success_url`, `back_url`, `expired_at`, `metadata.intent_id` → `url` | body `secret_token` equals the token set on the webhook (`MOYASAR_WEBHOOK_SECRET`), constant-time compare. Events `payment_paid`, `payment_failed` (spelled `payment_faild` in their list — both handled), `payment_refunded`, … | `GET /v1/invoices/:id` → `status` + `payments[]` | `POST /v1/payments/:id/refund {amount}` |

Sources: Paymob [Create Intention](https://developers.paymob.com/paymob-docs/developers/payment-integration/create-intention),
[HMAC transaction callback](https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac/hmac-transaction-callback),
[Unified checkout](https://developers.paymob.com/paymob-docs/developers/checkout-experiences/unified-checkout-redirection) ·
Kashier [Payment sessions](https://developers.kashier.io/docs/accept-payments/payment-sessions), [Webhooks](https://developers.kashier.io/docs/webhooks) ·
Moyasar [Webhook reference](https://docs.moyasar.com/docs/api/other/webhooks/webhook-reference.md), [Creating invoices](https://docs.moyasar.com/guides/invoices/creating-invoices).
Fawry, Geidea, HyperPay and Tap are listed in Settings → Payments for onboarding only (next wave).

**Apple Pay / mada.** Moyasar's hosted invoice page offers mada, Apple Pay and STC Pay without extra work; Apple Pay on
*our* domain (embedded form, `MOYASAR_PUBLISHABLE_KEY`) needs domain verification in the Moyasar dashboard
(`/.well-known/apple-developer-merchantid-domain-association` served from `sufra-web/public`). Paymob's Apple Pay is a
separate integration id (`PAYMOB_INTEGRATION_APPLEPAY`). The guest method picker hides Apple Pay on non-Apple devices.

**Saved cards (later).** Kashier `saveCard/retrieveSavedCard` and Paymob card tokens come back in the webhook; the hook
is `payment_intents.customer` + a future `payment_tokens(customer_id, provider, token_ref, last4, brand)` table written
only by the webhook — the browser would get `{last4, brand}`, never the token.

## State machine (client)

`machine.ts` — `idle → creating → redirect → verifying → succeeded → done`, with `failed / cancelled / expired → RETRY → idle`.
Invalid events are ignored (double taps, late polls). Tested in `machine.test.ts`.

## Amounts

`Units` (0.00001 EGP/SAR) everywhere; gateways get minor units (`units / 1000`, must be whole — refused otherwise),
Kashier a 2-decimal string built with integer math (`minorToDecimal`). Surcharge (when the restaurant doesn't absorb
fees) is basis points rounded half-up to whole piastres. Tests: `src/modules/payments/server.test.ts`.

## Pay-by-link

POS → Payment → "Pay link" tender (`PayLinkPanel`): amount (keypad), expiry (15 min … 3 days), guest mobile, note →
`/app/r/:slug/link/:pi` with QR, copy, WhatsApp click-to-chat (`wa.me`), share. The panel watches `paymentIntents`
live; when the verified payment lands (`payments` row, `checks.paid` bumped by `guest_record_payment`) the POS closes
the check (receipt + ETA e-receipt + ledger) by itself. Expired links show as expired everywhere (`guest_payment_status`).

# Guest payments — design notes

Pay-at-table (split, tip) and online-order prepayment. Browser code in this folder; server pieces
described here are **not built yet** (Wave 2) — the `DemoProvider` simulates them end-to-end in local mode.

## Rule zero: no secrets in the browser

Provider secret keys, HMAC secrets and API keys live **only** server-side, per tenant, in Supabase Vault
(referenced from a `payment_accounts` row: `restaurant_id, provider, mode, public_config jsonb, vault_secret_id`).
The browser only ever sees: our intent id, a hosted-checkout URL and public identifiers (Paymob public key,
Kashier merchant id).

## Flow

```
guest phone ──createIntent(req)──▶ POST /api/pay/:provider/intent          (Vercel function, service role)
                                     · loads check/order, re-computes amount server-side (never trusts req.amount
                                       beyond "≤ due"), inserts payment_intents (status requires_action)
                                     · creates the provider payment (Paymob Intention / Kashier order hash)
              ◀── { id, redirectUrl } ┘
guest ──redirect──▶ provider hosted checkout ──▶ back to returnUrl?pi=<id>
provider ──webhook──▶ POST /api/pay/:provider/webhook
                       · verify signature (Paymob HMAC-SHA512 / Kashier HMAC-SHA256), idempotent on provider txn id
                       · payment_intents.status = succeeded|failed
                       · guest_record_payment(intent_id)  (SECURITY DEFINER, service role only):
                           insert payments(method 'online', amount, tip, reference, split_label) + checks.paid += amount
                           + a service call "bill" so the waiter closes the table / prints the receipt
guest phone ──poll guest_payment_status(intent_id)──▶ succeeded → e-receipt + feedback + loyalty
```

The redirect back is only a hint: a payment exists when the **webhook** was verified.

## Required server env / per-tenant secrets

| Provider | Server-side (Vault) | Public (client env) |
| --- | --- | --- |
| Paymob | `PAYMOB_SECRET_KEY`, `PAYMOB_HMAC_SECRET`, `PAYMOB_INTEGRATION_IDS` | `VITE_PAYMOB_PUBLIC_KEY` |
| Kashier | `KASHIER_API_KEY`, `KASHIER_MODE` | `VITE_KASHIER_MERCHANT_ID` |
| All | `SUPABASE_SERVICE_ROLE_KEY` (function only) | `VITE_PAY_API=/api/pay`, `VITE_PAY_PROVIDER=paymob\|kashier` |

Owner-side: merchant account (CR, tax card, bank account, KYC), Apple Pay domain verification for the ordering domain.

## State machine (client)

`machine.ts` — `idle → creating → redirect → verifying → succeeded → done`, with `failed / cancelled / expired → RETRY → idle`.
Invalid events are ignored (double taps, late polls). Tested in `machine.test.ts`.

## Amounts

`Units` (0.00001 EGP) everywhere; shares are whole piastres (`split.ts` largest remainder), so the shares of a
table always add up to the check total. Paymob wants piastres (`units / 1000`), Kashier a decimal string.

## Schema (supabase/migrations/0005_guest.sql)

`payment_intents` (RLS: staff read; anon only via `guest_payment_status`), `guest_feedback`, `delivery_zones`,
and the guest RPCs `guest_venue`, `guest_place_order_v2`, `guest_table_bill`, `guest_order_track`,
`guest_call_status`, `guest_feedback_submit`, `guest_join_loyalty`, `guest_payment_status`, `guest_record_payment`.

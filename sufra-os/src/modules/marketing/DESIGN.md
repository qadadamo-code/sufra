# CRM, loyalty, promotions & ads — design notes

Code: `src/lib/promo` (pure rules, tested) · `src/modules/customers` · `src/modules/marketing` · `src/modules/platform` ·
schema `supabase/migrations/0009_crm.sql` (tests: `supabase/tests/crm_run.sh`).

## Promotions engine (`src/lib/promo/engine.ts`)

- Coupons (shared code or unique single-use codes, per-customer / total limits, min spend, max discount, date + day +
  hour windows incl. past midnight, channels pos/qr/online, order types, items/categories, segments/tiers, first order)
  and automatic offers (happy hour %, BOGO / buy X get Y, combo price, free delivery over X, free item).
- **Every discount is a line discount before tax.** Bill-level amounts are allocated over the eligible lines in whole
  piastres (largest remainder) so `@finance/tax` prices service + VAT on the discounted net, and receipts/ETA show it per line.
- Stacking: stackable offers apply in priority order (each on what is left); a non-stackable offer applies alone; the
  engine picks the option that saves the guest most and reports the rest as `not_stackable`.
- POS: `PromoDialog` (key **C**) → `applyToCheck` writes the line discounts + `promo_redemptions` (status `applied`).
  Removing restores manual discounts exactly (per-line amounts are kept on the redemption). Re-open the dialog after
  changing the check to re-apply.
- Online/QR checkout: `CouponBox` previews with the same engine; after `placeOrder`, `PromoPublic.applyToOrder` applies it.
  Cloud: `guest_check_coupon` returns the promotion rows the browser prices; `guest_apply_promos` records the codes for the
  staff app (audit `guest.promo_codes`) — nothing is discounted server-side without the engine. A server port of the
  engine (Edge Function sharing `src/lib/promo`) is the next step.

## After payment — `onCheckPaid(db, checkId)`

Called by POS `closeCheck` (any other path that closes a check should call it too; idempotent per check):
redemptions → `redeemed` (promotion uses, unique codes used, campaign attribution), points redeemed, visit + points
earned (tier multiplier, excluded categories, channels), stamp cards (a full card issues a free-item code), tier refresh,
referral reward on the friend's first paid visit. Cloud: the `promo_redemptions_uses` trigger counts uses.

## Loyalty

Points are a ledger (`loyalty_ledger`: earn / redeem / expire / adjust / bonus); the customer row caches the balance.
Expiry is FIFO per earned lot (`computeBalance`, `pendingExpiry`); `refreshLoyalty` writes due expiries. A server cron
should run expiry + `runJourneys` hourly (`api/crm-cron.ts`, not built: service role, per restaurant).

### Guest sign-in (`/r/:slug/me`)

Demo: phone + the number of any past order (no orders yet → last 4 digits of the phone). **Production:** a WhatsApp OTP —
`guest_loyalty_otp_request(slug, phone)` sends a 6-digit code with the `authentication` template (rate-limited 3/10 min,
hashed, 5-minute expiry) and `guest_loyalty_otp_verify` returns a short-lived signed token the card page keeps in
`sessionStorage`; `guest_loyalty_card` then takes the token instead of the order number.

### Apple / Google Wallet pass

Server-side only (signing keys never in the browser): `api/wallet-pass.ts` builds a `.pkpass` (storeCard, barcode =
`SUFRA:<phone>`, fields: points, tier, name) signed with the Pass Type ID certificate, and a Google Wallet LoyaltyObject
(JWT "Save to Google Wallet" link). On every `loyalty_ledger` insert a webhook pushes an update (APNs for Apple,
`loyaltyobject.patch` for Google). The card page shows the buttons as "soon" until the function exists.

## Gift cards (ledger)

| Event | Entry |
| --- | --- |
| Sell (POS/online) | Dr cash 1101 / card 1102 / wallet 1103 — Cr **2204 Deposits & gift cards** (not revenue, no VAT) |
| Redeem as a tender | the sale posts the tender to **house → 1201 receivables** (`finMethod("gift_card") = "house"`); `redeemGiftCard` reclasses Dr 2204 / Cr 1201 |
| Tender voided | Dr 1201 / Cr 2204 (back on the card) |
| Expiry (breakage) | Dr 2204 / Cr other income — job not built; the Gift cards page shows the expired balance |

Online purchase: `createPaymentIntent({kind:"gift_card", purposeRef: <reserved code>})` → hosted checkout →
`onIntentSucceeded("gift_card")` / the return page issues the card idempotently (`payment_ref` = intent id).

## Campaigns & journeys

`sendCampaign` / `runJourneys` → `MessagingService.send({ template: "win_back_offer" | "campaign_generic" })` from
`src/lib/notify`, so consent / opt-out, quiet hours, the 24h window, the weekly marketing cap and logging all apply;
click-to-chat mode keeps a `wa.me` link per message for staff to tap. Unique codes per recipient give attribution
(redemptions + revenue, per A/B variant).

## Sufra sponsored placements — public API for sufra-web

```sql
select public.public_sponsored('cairo', null);      -- anon; city / cuisine (null = any)
-- → [{ bookingId, slot: home_banner|marketplace_top|city_top|cuisine_top, restaurantId, slug, name{ar,en}, brandColor,
--      headline{ar,en}, imageUrl, city, cuisine, label{ar:"مُموَّل",en:"Sponsored"} }]
select public.public_sponsored_track('<bookingId>', 'impression' | 'click' | 'order');
```

Supabase JS: `supabase.rpc("public_sponsored", { p_city: "cairo", p_cuisine: null })`. Placements serve while approved/live,
in their dates and under budget (CPM/CPC); ordered by slot, rotated daily. Always show the "مُموَّل / Sponsored" label.
Local equivalent: `publicFeed()` in `src/lib/promo/sponsored.ts` (`PromoPublic.sponsored`).

Flow: restaurant owner → Marketing → "اشتري إعلان" (availability via `ad_slot_availability`, quote, pay online through
the payments intent API or invoice) → `requested` → Sufra platform admin approves (`live` if started) / rejects / pauses.
Platform admins are `platform_admins` rows (Sufra staff) — not a restaurant role; RLS `is_platform_admin()`.

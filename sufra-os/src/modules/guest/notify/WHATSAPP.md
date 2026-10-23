# WhatsApp order notifications — setup notes (Wave 2)

Templates: `templates.ts` (AR + EN, all **Utility**). Interface: `notifier.ts` (`Notifier`, `LogNotifier` today).

## What the restaurant owner must provide (Meta)

1. **Meta Business Portfolio** (Business Manager) + **business verification** (commercial register, tax card,
   website/domain, utility bill).
2. **WhatsApp Business Account (WABA)** and a **dedicated phone number** that is not active on the WhatsApp app
   (or migrate it), with an approved **display name**.
3. A **payment method** on the WABA (or a BSP contract — Unifonic, Infobip, 360dialog, Cequens …).
4. **Template approval**: submit each template in `templates.ts` via `toMeta(id, lang)` (positional `{{1}}`
   placeholders + `example` values). Approval takes minutes to 24h. Keep wording transactional: promotional
   words reclassify a template as Marketing (≈18× the Egypt utility rate).
5. **Opt-in**: the online checkout records consent ("send me order updates on WhatsApp"); honour "STOP".

## What Sufra runs (server side, never in the browser)

- Embedded Signup (Sufra as Tech Provider) → per-tenant `waba_id`, `phone_number_id`, system-user **access token**
  stored in Supabase Vault.
- `POST /api/notify/whatsapp` (service role): resolves the tenant's token, sends
  `POST https://graph.facebook.com/v{N}/{phone_number_id}/messages` with `type: "template"`,
  `template: { name, language: { code }, components: [{ type: "body", parameters: [...] }, { type: "button", sub_type: "url", index: 0, parameters: [...] }] }`.
- Webhook `/api/notify/whatsapp/webhook` (verify token + `X-Hub-Signature-256` with the app secret) for
  `sent/delivered/read/failed` statuses and inbound "STOP".
- Triggers: a DB trigger / queue on `orders` + `order_items` status changes maps stages → templates
  (`STAGE_TEMPLATE`), deduped per `orderId:stage`. SMS fallback when the number has no WhatsApp.

## Pricing reminders (from the feature catalogue)

Per delivered template, by category and country. Utility templates inside the 24h customer-service window
become charged from 1 Oct 2026 beyond the free tier — keep notifications to the stages that matter.

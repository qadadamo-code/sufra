# واتساب في سُفرة — دليل التجهيز · WhatsApp in Sufra — setup guide

> **ابدأ النهارده من غير أي حساب:** الإعدادات ← الرسايل ← «إرسال بالضغط (wa.me)». الرسالة بتتفتح جاهزة في واتساب الجهاز والموظف يدوس إرسال.
> **Start today with no account:** Settings → Messaging → “Click-to-chat (wa.me)”. The message opens ready in the device's WhatsApp; staff tap send.
>
> لما توثيق Meta يخلص انقل لـ «واتساب Cloud API» عشان الإرسال الأوتوماتيك وعلامات «وصلت/اتقرت» وصندوق الوارد المشترك.
> Once Meta verification is done, switch to “WhatsApp Cloud API” for automatic sending, delivered/read ticks and the shared inbox.

| | |
|---|---|
| Webhook URL | `https://sufra-planet-crm.vercel.app/api/whatsapp-webhook` |
| Send API (used by the app) | `https://sufra-planet-crm.vercel.app/api/whatsapp-send` |
| Graph API | `POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages` |
| Database | `supabase/migrations/0007_messaging.sql` |

---

## 1. متغيرات Vercel · Vercel environment variables

Vercel → Project → Settings → Environment Variables (Production + Preview). **Never** put these in `VITE_*` variables — those end up in the browser bundle.

| Variable | Required | What it is |
|---|---|---|
| `WHATSAPP_TOKEN` | for sending | Permanent **System User** access token (scopes `whatsapp_business_messaging`, `whatsapp_business_management`). Platform default sender. |
| `WHATSAPP_PHONE_NUMBER_ID` | for sending | The **Phone number ID** from WhatsApp → API Setup (a long number — *not* the phone number itself). |
| `WHATSAPP_VERIFY_TOKEN` | for the webhook | Any random string you invent; paste the same value in Meta's webhook settings. |
| `WHATSAPP_APP_SECRET` | for the webhook | Meta app → App settings → Basic → **App secret**. Verifies `X-Hub-Signature-256` on every webhook call. Without it the webhook answers 501. |
| `SUPABASE_URL` | recommended | Your Supabase project URL (storage of inbox/statuses + JWT auth). `VITE_SUPABASE_URL` is used as a fallback. |
| `SUPABASE_SERVICE_ROLE_KEY` | recommended | Service-role key — **server only**. Lets the functions write `wa_messages`, ingest webhooks, read tenant credentials from Vault. |
| `SUFRA_API_KEY` | only without Supabase | Shared key for single-restaurant / local-mode deployments. The app sends it in `x-sufra-api-key`; staff paste it once per device in Settings → Messaging (kept in that browser only). |
| `WHATSAPP_DEFAULT_RESTAURANT_ID` | multi-tenant | The restaurant the platform-default number belongs to. When set, other restaurants can't send through it, and webhooks for that number are filed under it. Leave empty for a single-restaurant deployment. |
| `WHATSAPP_GRAPH_VERSION` | optional | Default `v21.0`. |
| `WHATSAPP_PROVIDER` / `D360_API_KEY` | optional | `360dialog` to send through 360dialog's Cloud-API-compatible endpoint with `D360-API-KEY`. |

Auth rules of `/api/whatsapp-send`:
- **Supabase configured** → requires `Authorization: Bearer <Supabase user JWT>` of an active **owner / admin / manager / cashier** of that restaurant (checked against `memberships`).
- **No Supabase** → requires `x-sufra-api-key: <SUFRA_API_KEY>`.
- **Neither** → `501` (the function never acts as an open relay). Missing WhatsApp credentials → `501 not_configured` (the app then tells staff to use click-to-chat).
- Rate limit: 20 burst + 1/s per restaurant per instance (in-memory) and 600 / 10 min across instances (`messaging_rate_take()` in Postgres). Opted-out numbers get `409`.

`GET /api/whatsapp-send` returns which pieces are configured (no secrets) — Settings → Messaging shows it as “Server status”.

---

## 2. خطوات Meta (صاحب المطعم بيعملها مرة واحدة)

1. **محفظة أعمال:** افتح [business.facebook.com](https://business.facebook.com) واعمل Business Portfolio باسم المطعم الرسمي.
2. **توثيق النشاط (Business verification):** سجل تجاري، بطاقة ضريبية، فاتورة مرافق أو كشف حساب بنفس العنوان، ودومين/موقع باسم المطعم. من يوم لكام يوم.
3. **التطبيق والـ WABA:** في [developers.facebook.com/apps](https://developers.facebook.com/apps) اعمل App نوعه Business وضيف منتج **WhatsApp** — كده اتعمل WhatsApp Business Account.
4. **الرقم:** رقم موبايل مخصوص مش متفعّل على تطبيق واتساب (أو امسحه منه الأول)، أكّده بكود SMS، واختار **الاسم الظاهر** (Meta بتراجعه).
5. **الدفع:** ضيف كارت على الـ WABA. Meta بتحاسب على كل قالب اتسلّم حسب الفئة والبلد.
6. **التوكن الدائم:** Business Settings ← Users ← **System users** ← Add (Admin) ← Assign assets (التطبيق + الـ WABA) ← Generate token بصلاحيات `whatsapp_business_messaging` و `whatsapp_business_management`. ده `WHATSAPP_TOKEN`.
7. **Vercel:** حط المتغيرات اللي فوق، وبعدين Redeploy.
8. **الـ Webhook:** WhatsApp ← Configuration ← Callback URL = `https://sufra-planet-crm.vercel.app/api/whatsapp-webhook` و Verify token = نفس `WHATSAPP_VERIFY_TOKEN` ← Verify and save ← اشترك في حقل **messages**.
9. **القوالب:** في سُفرة: الرسايل ← القوالب ← «انسخ JSON لـ Meta» لكل قالب، وابعته من WhatsApp Manager ← Message templates (أو `POST /{WABA_ID}/message_templates`). المراجعة من دقايق لـ ٢٤ ساعة. بعد الموافقة غيّر الحالة لـ «معتمد».
10. **التشغيل:** الإعدادات ← الرسايل ← «واتساب Cloud API» ← «ابعت hello_world» لرقمك.

## 2. Meta steps (the owner does this once)

1. **Business Portfolio** at business.facebook.com with the restaurant's legal name.
2. **Business verification**: commercial register, tax card, a utility bill or bank statement at the same address, and a domain/website in the restaurant's name.
3. **App + WABA**: create a *Business* app at developers.facebook.com and add the **WhatsApp** product.
4. **Phone number**: a dedicated number not active in the WhatsApp app (or deleted there first), SMS-verified, with an approved **display name**.
5. **Payment method** on the WABA.
6. **Permanent token**: Business Settings → System users → Admin → assign the app and WABA → generate a token with `whatsapp_business_messaging` + `whatsapp_business_management` → `WHATSAPP_TOKEN`.
7. **Vercel**: set the variables above and redeploy.
8. **Webhook**: WhatsApp → Configuration → callback URL above + the same verify token → subscribe to **messages**.
9. **Templates**: Messages → Templates → “Copy Meta JSON” → submit in WhatsApp Manager (or the API). Mark them “Approved” in Sufra when Meta approves.
10. **Go live**: Settings → Messaging → “WhatsApp Cloud API” → “Send hello_world” to your own number.

---

## 3. How it works

```
staff app / delivery notifyOrderStage()                Meta
        │  MessagingService (src/lib/notify/service.ts)   ▲
        │  consent · 24h window · dedupe · quiet hours    │ Graph API
        ▼                                                 │
  wa_messages row ──► notifier (Settings → Messaging) ──► /api/whatsapp-send ──┘
                        ├─ click_to_chat → wa.me/<number>?text=… (staff taps send)
                        ├─ cloud / 360dialog → server function (token from env / Vault)
                        └─ off → skipped (logged)
Meta ──► /api/whatsapp-webhook ── HMAC verified ──► messaging_ingest_webhook() ──► inbox + statuses (+ STOP/وقف → opt-out)
```

- **Order statuses**: the delivery module calls `notifyOrderStage(order, stage)`; messaging registers itself as the sender at start-up (`registerOrderNotifier()`), so each stage is sent once per order (`orderId:stage` dedupe), only if enabled in Settings → Messaging, and never to opted-out numbers.
- **Feedback**: after a delivered order or a paid dine-in check (with a customer), a `feedback_request` template is scheduled N minutes later with the guest rating link (`/r/<slug>/o/<orderId>#rate`). Open staff screens send due messages every minute; for fully server-side scheduling add a cron that selects `wa_messages where status = 'scheduled' and send_at <= now()` and posts them.
- **24-hour window**: free-form replies through the Cloud API only within 24h of the customer's last message; otherwise the inbox offers an approved template. Click-to-chat has no such limit (it's the staff's own WhatsApp).
- **Consent**: online checkout (“Send me order updates on WhatsApp”) and the QR loyalty card (“points and offers on WhatsApp”) record consent with the exact wording; staff can record it in the conversation menu. Marketing needs an explicit opt-in; utility messages are allowed for the customer's own order unless they opted out. **STOP / إلغاء / وقف** (whole message) opts out and confirms; **START / اشتراك** opts back in.
- **Per-restaurant numbers** (multi-tenant): `whatsapp_accounts` (one row per restaurant, `phone_number_id`, `token_secret_id` → **Supabase Vault**). Store a token with `select vault.create_secret('<token>', 'wa-<restaurant>')` and put the returned id in `token_secret_id`, `status = 'connected'`. `messaging_wa_credentials()` (service role only) decrypts it for the send function; app users can never read it.
- **Costs**: each outgoing Cloud API message carries an estimate (`cost_micros`, micro-USD) from Settings → Messaging rates (defaults are estimates — update from Meta's rate card). Since 1 Oct 2026 utility templates inside the 24h window and service messages beyond 1,000/month are charged.

## 4. Test it

```bash
cd sufra-os && npx vitest run src/lib/notify          # phones, wa.me, window, templates, webhook parsing, signature, rate limit, handlers
sufra-os/node_modules/.bin/tsc -p api                 # the Vercel functions type-check
# database (any local Postgres 15+):
for f in tests/supabase_stubs.sql migrations/000{1,2,4,5,7}_*.sql seed.sql tests/messaging_test.sql; do psql -v ON_ERROR_STOP=1 -q -d $DB -f supabase/$f; done
# webhook handshake once deployed:
curl "https://sufra-planet-crm.vercel.app/api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=$WHATSAPP_VERIFY_TOKEN&hub.challenge=42"   # → 42
```

In local/demo mode the conversation menu has **“Demo: message from customer”**, which runs the same ingest logic as the webhook (try «وقف» or STOP).

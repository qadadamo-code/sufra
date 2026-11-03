# تجهيز الدفع الأونلاين — Online payments setup

> **العربي أولًا، والإنجليزي تحت.** English below.
> Design and API details for developers: `src/modules/guest/pay/DESIGN.md`. Schema: `supabase/migrations/0008_payments.sql`.

---

## بالعربي

### الفكرة في سطرين
الضيف بيدفع في **صفحة شركة الدفع** (Paymob أو Kashier أو Moyasar) — إحنا عمرنا ما بنشوف بيانات الكارت. الدفع بيتحسب
بس لما شركة الدفع تبعت **إشعار موقّع (webhook)** للسيرفر بتاعنا ونتأكد من التوقيع. المفاتيح السرية بتتحط في **Vercel**
(أو Supabase Vault) — **مش في التطبيق**.

### ١. اختار البوابة
| البلد | البوابة | جاهزة؟ | طرق الدفع |
| --- | --- | --- | --- |
| 🇪🇬 مصر | **Paymob** | ✅ | كارت، محافظ (فودافون كاش…)، أمان/مصاري، ميزة، ڤاليو، Apple Pay |
| 🇪🇬 مصر | **Kashier** | ✅ | كارت، محافظ، ميزة، ڤاليو |
| 🇪🇬 مصر | Fawry، Geidea | الموجة الجاية | — |
| 🇸🇦 السعودية | **Moyasar** | ✅ | مدى، فيزا/ماستركارد، Apple Pay، STC Pay |
| 🇸🇦 السعودية | HyperPay، Tap، Geidea | الموجة الجاية | — |

### ٢. الورق اللي هتحتاجه لفتح حساب تاجر
- **مصر:** سجل تجاري ساري، بطاقة ضريبية، حساب بنكي باسم الشركة/المنشأة، بطاقة الرقم القومي للمفوّض بالتوقيع، عقد إيجار أو عنوان المحل، رخصة المحل لو موجودة.
- **السعودية:** سجل تجاري، شهادة ضريبة القيمة المضافة، حساب بنكي سعودي باسم المنشأة (IBAN)، هوية المفوّض، عنوان وطني.
- **Apple Pay:** بيشتغل في صفحة الدفع المستضافة بعد ما البوابة تفعّله. لو عايزه على دومينك نفسه محتاج Domain verification من لوحة البوابة.

### ٣. حط المفاتيح في Vercel
Vercel ← المشروع ← **Settings ← Environment Variables** ← ضيف المتغيرات دي (Production + Preview) وبعدين اعمل Redeploy.

**مشتركة (لازم):**
| المتغير | منين |
| --- | --- |
| `SUPABASE_URL` | Supabase ← Project Settings ← API |
| `SUPABASE_SERVICE_ROLE_KEY` | نفس الصفحة ← service_role (**سري جدًا**) |
| `SUPABASE_ANON_KEY` | نفس الصفحة ← anon (اختياري، لفحص صلاحيات الموظفين) |
| `PAY_PUBLIC_BASE_URL` | `https://sufra-planet-crm.vercel.app` |
| `PAY_PROVIDER` | اختياري: `paymob` أو `kashier` أو `moyasar` (الافتراضي من الإعدادات) |

**Paymob:** `PAYMOB_SECRET_KEY` (سري)، `PAYMOB_PUBLIC_KEY`، `PAYMOB_HMAC` (سري)، `PAYMOB_INTEGRATION_CARD`، واختياري: `PAYMOB_INTEGRATION_WALLET`، `PAYMOB_INTEGRATION_KIOSK`، `PAYMOB_INTEGRATION_APPLEPAY`، `PAYMOB_API_KEY` (لسؤال حالة العملية)، `PAYMOB_BASE_URL` (للسعودية: `https://ksa.paymob.com`).

**Kashier:** `KASHIER_MERCHANT_ID`، `KASHIER_API_KEY` (سري — Payment API Key)، `KASHIER_SECRET_KEY` (سري)، `KASHIER_MODE` = `test` أو `live`.

**Moyasar:** `MOYASAR_SECRET_KEY` (سري)، `MOYASAR_WEBHOOK_SECRET` (سري — كلمة سر إنت بتختارها)، `MOYASAR_PUBLISHABLE_KEY` (اختياري).

> أكتر من مطعم على نفس النشر؟ خزّن مفاتيح كل مطعم في **Supabase Vault** كـ JSON بنفس الأسماء، واربطها بصف في `payment_accounts`:
> `select vault.create_secret('{"PAYMOB_SECRET_KEY":"…","PAYMOB_HMAC":"…"}', 'pay:<restaurant id>:paymob');`

### ٤. روابط تحطها في لوحة البوابة
| البوابة | فين | الرابط |
| --- | --- | --- |
| Paymob | كل Payment Integration ← **Transaction processed callback** | `https://sufra-planet-crm.vercel.app/api/pay-webhook-paymob` |
| Paymob | **Transaction response callback** | `https://sufra-planet-crm.vercel.app/api/pay-callback` |
| Kashier | بيتبعت تلقائيًا مع كل عملية (`serverWebhook`)؛ وممكن كمان Settings ← Webhooks | `https://sufra-planet-crm.vercel.app/api/pay-webhook-kashier` |
| Moyasar | Settings ← Webhooks ← Add (اختار payment_paid و payment_failed و payment_refunded واكتب Secret token = `MOYASAR_WEBHOOK_SECRET`) | `https://sufra-planet-crm.vercel.app/api/pay-webhook-moyasar` |

### ٥. في التطبيق
1. **الإعدادات ← الدفع**: اختار البلد والبوابة، Test أو Live، طرق الدفع اللي تظهر للضيف، والرسوم (المطعم يتحملها ولا تتضاف نسبة)، ومدة لينك الدفع.
2. الصفحة بتوريك كل مفتاح **موجود ولا ناقص** (من غير ما تعرض قيمته).
3. جرّب في وضع **Test** بكروت البوابة التجريبية: ادفع من QR ترابيزة، وابعت لينك دفع من الكاشير.
4. شغّل **Live** بعد ما البوابة تفعّل الحساب وتغيّر المفاتيح لمفاتيح Live.

### ٦. الاستخدام اليومي
- **لينك دفع من الكاشير:** الدفع ← «لينك دفع» ← رقم العميل + ملاحظة + المدة ← «اعمل لينك» ← واتساب / نسخ / QR. أول ما العميل يدفع الشيك بيتقفل والإيصال يطلع لوحده.
- **المدفوعات** (`/payments`): كل العمليات، الرسوم، الاسترداد (PIN مدير)، التسويات (سجّل التحويل لما يوصل البنك)، والمطابقة مع الكاشير، وتصدير CSV.

---

## English

### In two lines
Guests pay on the **gateway's hosted page** — card data never touches Sufra. A payment counts only after the gateway's
**signed webhook** is verified by our server. Secret keys live in **Vercel env vars** (or Supabase Vault), never in the app.

### 1. Pick a gateway
Egypt: **Paymob** (cards, wallets, Aman/Masary kiosks, Meeza, valU, Apple Pay) or **Kashier** (cards, wallets, Meeza, valU).
KSA: **Moyasar** (mada, Visa/Mastercard, Apple Pay, STC Pay). Fawry, Geidea, HyperPay and Tap are listed for onboarding (next wave).

### 2. Merchant onboarding documents
- **Egypt:** valid commercial register, tax card, company bank account, signatory national ID, premises lease/address, shop licence if any.
- **KSA:** commercial registration, VAT certificate, Saudi company bank account (IBAN), signatory ID, national address.
- **Apple Pay:** works on the hosted page once the gateway enables it; on your own domain it needs domain verification in the gateway dashboard.

### 3. Environment variables (Vercel → Project → Settings → Environment Variables, then redeploy)

| Variable | Required | Secret | Notes |
| --- | --- | --- | --- |
| `SUPABASE_URL` | ✔ | | Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | ✔ | ✔ | records payments via `guest_record_payment` |
| `SUPABASE_ANON_KEY` | | | used as `apikey` when checking a staff JWT (`has_role`) |
| `PAY_PUBLIC_BASE_URL` | ✔ | | `https://sufra-planet-crm.vercel.app` — webhook/return URLs |
| `PAY_PROVIDER` | | | default gateway if a restaurant hasn't chosen one |
| `PAY_ALLOWED_ORIGINS` | | | extra comma-separated origins allowed as return URLs |
| `PAYMOB_SECRET_KEY` | Paymob | ✔ | Intention API `Authorization: Token …` |
| `PAYMOB_PUBLIC_KEY` | Paymob | | Unified Checkout URL |
| `PAYMOB_HMAC` | Paymob | ✔ | webhook HMAC-SHA512 |
| `PAYMOB_INTEGRATION_CARD` | Paymob | | integration id(s), comma-separated |
| `PAYMOB_INTEGRATION_WALLET` / `_KIOSK` / `_APPLEPAY` | | | optional integration ids |
| `PAYMOB_API_KEY` | | ✔ | optional: server-side transaction inquiry on return |
| `PAYMOB_BASE_URL` | | | default `https://accept.paymob.com` (KSA `https://ksa.paymob.com`) |
| `KASHIER_MERCHANT_ID` | Kashier | | `MID-…` |
| `KASHIER_API_KEY` | Kashier | ✔ | Payment API key — signs webhooks |
| `KASHIER_SECRET_KEY` | Kashier | ✔ | creates payment sessions |
| `KASHIER_MODE` | | | `test` (default) / `live` |
| `MOYASAR_SECRET_KEY` | Moyasar | ✔ | `sk_test_…` / `sk_live_…` |
| `MOYASAR_WEBHOOK_SECRET` | Moyasar | ✔ | the secret token you set on the webhook |
| `MOYASAR_PUBLISHABLE_KEY` | | | optional (embedded form / Apple Pay on your domain) |
| `VITE_PAY_API` (client) | | | default `/api`; `off` hides online payment |

Missing keys → the functions answer **501** with an Arabic + English message naming the missing variables; the demo
gateway keeps working in local mode. Multi-tenant: put each restaurant's keys as JSON in **Supabase Vault** and point
`payment_accounts.vault_secret_id` at it — `pay_account_config()` (service role only) merges them over the env vars.

### 4. URLs for the gateway dashboard
- Paymob → each integration: **Transaction processed callback** `https://sufra-planet-crm.vercel.app/api/pay-webhook-paymob`,
  **Transaction response callback** `https://sufra-planet-crm.vercel.app/api/pay-callback`.
- Kashier → sent with every session (`serverWebhook`); optionally also Settings → Webhooks: `https://sufra-planet-crm.vercel.app/api/pay-webhook-kashier`.
- Moyasar → Settings → Webhooks: `https://sufra-planet-crm.vercel.app/api/pay-webhook-moyasar`, events `payment_paid`,
  `payment_failed`, `payment_refunded`, secret token = `MOYASAR_WEBHOOK_SECRET`.

### 5. Database
Run `supabase/migrations/0008_payments.sql` after 0005 (Dashboard SQL editor or `supabase db push`). Local check on
plain Postgres: `PGUSER=postgres supabase/tests/payments_run.sh` (idempotent recording, check-less intents, expiry, grants).

### 6. In the app
**Settings → Payments**: country, gateway, test/live, guest methods, fees (absorb or surcharge %), link lifetime, fee
estimate and payout days; shows which server keys are present (booleans from `/api/pay-status`, never values) and the
webhook URLs with copy buttons. **POS → Payment → Pay link**: QR / WhatsApp / copy; the check closes by itself when the
verified payment lands. **/payments**: transactions, refunds (manager PIN → `/api/pay-refund`), settlements, reconciliation, CSV.

### 7. Go-live checklist
- [ ] Keys in Vercel (Production) are the **live** ones; `KASHIER_MODE=live` / Moyasar `sk_live_`.
- [ ] Webhook URL saved in the gateway dashboard; a test payment shows **Paid** in `/payments` within seconds.
- [ ] Settings → Payments mode = Live; methods match what the gateway enabled.
- [ ] Refund a small live payment end-to-end once.
- [ ] Unverified items from DESIGN.md (⚠: Paymob refund endpoint with secret-key auth, Kashier status/refund fields) confirmed in the sandbox.

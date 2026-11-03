/**
 * Payment settings defaults + the provider catalogue shown in Settings → Payments (per country), with the env var names
 * each integrated provider needs on the server and the merchant onboarding steps. No secrets here — ever.
 */
import type { Localized, OnlineMethod, PayProviderId, PaymentSettings, Settings } from "@/data/types";
import { major } from "@/lib/money";

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  country: "EG",
  provider: "paymob",
  mode: "test",
  methods: ["card", "wallet", "applepay"],
  absorbFees: true,
  surchargeBp: 0,
  linkExpiryMin: 60,
  feeBp: 275,
  feeFixed: major(3),
  payoutDays: 2,
};

export const paySettingsOf = (s: Settings | null | undefined): PaymentSettings => ({ ...DEFAULT_PAYMENT_SETTINGS, ...(s?.payments ?? {}) });

export const METHOD_LABEL: Record<OnlineMethod, Localized> = {
  card: { ar: "كارت (فيزا / ماستركارد)", en: "Card (Visa / Mastercard)" },
  wallet: { ar: "محفظة موبايل (فودافون كاش …)", en: "Mobile wallet (Vodafone Cash …)" },
  kiosk: { ar: "كود دفع في منافذ (أمان / مصاري / فوري)", en: "Cash reference at outlets (Aman / Masary / Fawry)" },
  applepay: { ar: "Apple Pay", en: "Apple Pay" },
  mada: { ar: "مدى", en: "mada" },
  stcpay: { ar: "STC Pay", en: "STC Pay" },
  meeza: { ar: "ميزة", en: "Meeza" },
  valu: { ar: "ڤاليو (قسّط)", en: "valU (instalments)" },
};
export const METHOD_SHORT: Record<OnlineMethod, Localized> = {
  card: { ar: "كارت", en: "Card" }, wallet: { ar: "محفظة", en: "Wallet" }, kiosk: { ar: "منافذ", en: "Kiosk" }, applepay: { ar: "Apple Pay", en: "Apple Pay" },
  mada: { ar: "مدى", en: "mada" }, stcpay: { ar: "STC Pay", en: "STC Pay" }, meeza: { ar: "ميزة", en: "Meeza" }, valu: { ar: "ڤاليو", en: "valU" },
};

export interface ProviderInfo {
  id: PayProviderId;
  name: string;
  country: "EG" | "SA";
  /** integrated = server functions exist; listed = onboarding info only (next wave) */
  status: "integrated" | "listed";
  methods: OnlineMethod[];
  currency: "EGP" | "SAR";
  env: { name: string; secret: boolean; hint: Localized }[];
  /** where to paste our webhook URL / which callback to set */
  webhook: string | null;
  steps: Localized[];
  docs: string;
  note?: Localized;
}

const WEBHOOK_BASE = "https://sufra-planet-crm.vercel.app";
export const webhookUrl = (p: PayProviderId, base = WEBHOOK_BASE) => `${base.replace(/\/$/, "")}/api/pay-webhook-${p}`;
export const callbackUrl = (base = WEBHOOK_BASE) => `${base.replace(/\/$/, "")}/api/pay-callback`;

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "paymob", name: "Paymob", country: "EG", status: "integrated", currency: "EGP", methods: ["card", "wallet", "kiosk", "meeza", "valu", "applepay"],
    webhook: webhookUrl("paymob"), docs: "https://developers.paymob.com/",
    env: [
      { name: "PAYMOB_SECRET_KEY", secret: true, hint: { ar: "Settings ← Account Info ← Secret Key", en: "Settings → Account Info → Secret Key" } },
      { name: "PAYMOB_PUBLIC_KEY", secret: false, hint: { ar: "نفس الصفحة ← Public Key", en: "Same page → Public Key" } },
      { name: "PAYMOB_HMAC", secret: true, hint: { ar: "نفس الصفحة ← HMAC", en: "Same page → HMAC" } },
      { name: "PAYMOB_INTEGRATION_CARD", secret: false, hint: { ar: "Developers ← Payment Integrations ← رقم الكارت", en: "Developers → Payment Integrations → card id" } },
      { name: "PAYMOB_INTEGRATION_WALLET", secret: false, hint: { ar: "رقم integration المحافظ (اختياري)", en: "Wallet integration id (optional)" } },
      { name: "PAYMOB_INTEGRATION_KIOSK", secret: false, hint: { ar: "رقم integration أمان/مصاري (اختياري)", en: "Kiosk (Aman/Masary) integration id (optional)" } },
      { name: "PAYMOB_INTEGRATION_APPLEPAY", secret: false, hint: { ar: "رقم integration Apple Pay (اختياري)", en: "Apple Pay integration id (optional)" } },
    ],
    steps: [
      { ar: "افتح حساب تاجر في Paymob (سجل تجاري، بطاقة ضريبية، حساب بنكي باسم الشركة، بطاقة الرقم القومي للمفوّض).", en: "Open a Paymob merchant account (commercial register, tax card, company bank account, signatory ID)." },
      { ar: "من لوحة Paymob انسخ Secret Key و Public Key و HMAC، وأرقام الـ integrations (كارت، محفظة، أمان، Apple Pay).", en: "In the Paymob dashboard copy the Secret Key, Public Key, HMAC and the integration ids (card, wallet, kiosk, Apple Pay)." },
      { ar: "حطهم في Vercel ← Project ← Settings ← Environment Variables (أو Supabase Vault لكل مطعم) — مش هنا.", en: "Put them in Vercel → Project → Settings → Environment Variables (or Supabase Vault per restaurant) — not here." },
      { ar: "في كل integration حط Transaction processed callback = رابط الـ webhook تحت، و Transaction response callback = رابط الرجوع.", en: "On each integration set Transaction processed callback = the webhook URL below and Transaction response callback = the return URL." },
      { ar: "جرّب في وضع Test بكارت Paymob التجريبي، وبعدها اطلب التفعيل Live وغيّر المفاتيح.", en: "Test with Paymob's test card in Test mode, then request Live activation and swap the keys." },
    ],
  },
  {
    id: "kashier", name: "Kashier", country: "EG", status: "integrated", currency: "EGP", methods: ["card", "wallet", "meeza", "valu", "kiosk"],
    webhook: webhookUrl("kashier"), docs: "https://developers.kashier.io/",
    env: [
      { name: "KASHIER_MERCHANT_ID", secret: false, hint: { ar: "MID-xxxx-xxx من الـ Dashboard", en: "MID-xxxx-xxx from the dashboard" } },
      { name: "KASHIER_API_KEY", secret: true, hint: { ar: "Integrations ← Payment API Key (بيوقّع الـ webhooks)", en: "Integrations → Payment API Key (signs webhooks)" } },
      { name: "KASHIER_SECRET_KEY", secret: true, hint: { ar: "Integrations ← Secret Key (لإنشاء الـ sessions)", en: "Integrations → Secret Key (creates sessions)" } },
      { name: "KASHIER_MODE", secret: false, hint: { ar: "test أو live", en: "test or live" } },
    ],
    steps: [
      { ar: "سجّل في Kashier وكمّل الـ KYC (سجل تجاري، بطاقة ضريبية، حساب بنكي).", en: "Sign up with Kashier and complete KYC (commercial register, tax card, bank account)." },
      { ar: "من Integrations انسخ Merchant ID و Payment API Key و Secret Key (مختلفين في test و live).", en: "From Integrations copy the Merchant ID, Payment API Key and Secret Key (test and live differ)." },
      { ar: "حطهم في Vercel env. رابط الـ webhook بيتبعت مع كل session تلقائيًا، وممكن تحطه كمان في Webhooks في اللوحة.", en: "Add them to Vercel env. The webhook URL is sent with every session; you can also set it under Webhooks in the dashboard." },
      { ar: "جرّب بكروت Kashier التجريبية، وبعدها KASHIER_MODE=live.", en: "Test with Kashier's test cards, then set KASHIER_MODE=live." },
    ],
  },
  {
    id: "fawry", name: "Fawry (FawryPay)", country: "EG", status: "listed", currency: "EGP", methods: ["kiosk", "card", "wallet"], webhook: null, docs: "https://developer.fawrystaging.com/",
    env: [], note: { ar: "كود دفع في ~٣٠٠ ألف منفذ — جاي في الموجة الجاية. دلوقتي استخدم كود أمان/مصاري من Paymob.", en: "Reference codes at ~300k outlets — next wave. For now use Paymob's Aman/Masary kiosk." },
    steps: [{ ar: "اطلب حساب FawryPay (Merchant Code + Security Key).", en: "Request a FawryPay account (merchant code + security key)." }],
  },
  {
    id: "geidea", name: "Geidea", country: "EG", status: "listed", currency: "EGP", methods: ["card", "applepay", "meeza"], webhook: null, docs: "https://docs.geidea.net/",
    env: [], note: { ar: "ماكينات POS + أونلاين — الربط مع الكاشير (ECR) في الموجة الجاية.", en: "Terminals + online — POS (ECR) integration in the next wave." },
    steps: [{ ar: "اطلب Merchant Public Key + API Password من Geidea.", en: "Request a merchant public key + API password from Geidea." }],
  },
  {
    id: "moyasar", name: "Moyasar", country: "SA", status: "integrated", currency: "SAR", methods: ["mada", "card", "applepay", "stcpay"],
    webhook: webhookUrl("moyasar"), docs: "https://docs.moyasar.com/",
    env: [
      { name: "MOYASAR_SECRET_KEY", secret: true, hint: { ar: "Settings ← API Keys ← Secret key (sk_test_/sk_live_)", en: "Settings → API Keys → Secret key (sk_test_/sk_live_)" } },
      { name: "MOYASAR_WEBHOOK_SECRET", secret: true, hint: { ar: "كلمة سر تختارها إنت لما تضيف الـ webhook", en: "A secret you choose when adding the webhook" } },
      { name: "MOYASAR_PUBLISHABLE_KEY", secret: false, hint: { ar: "pk_… (اختياري — للفورم المدمج و Apple Pay على دومينك)", en: "pk_… (optional — embedded form / Apple Pay on your domain)" } },
    ],
    steps: [
      { ar: "افتح حساب في Moyasar (سجل تجاري سعودي، حساب بنكي، رقم ضريبي).", en: "Open a Moyasar account (Saudi CR, bank account, VAT number)." },
      { ar: "من Settings ← Webhooks ضيف رابط الـ webhook تحت، واختار payment_paid و payment_failed و payment_refunded، واكتب Secret token.", en: "In Settings → Webhooks add the webhook URL below, pick payment_paid, payment_failed, payment_refunded and set a secret token." },
      { ar: "حط MOYASAR_SECRET_KEY و MOYASAR_WEBHOOK_SECRET (نفس الـ token) في Vercel env.", en: "Put MOYASAR_SECRET_KEY and MOYASAR_WEBHOOK_SECRET (the same token) in Vercel env." },
      { ar: "Apple Pay: على صفحة الدفع المستضافة شغّال من غير إعداد؛ على دومينك محتاج Domain verification من لوحة Moyasar.", en: "Apple Pay: works on the hosted page out of the box; on your own domain it needs domain verification in the Moyasar dashboard." },
    ],
  },
  {
    id: "hyperpay", name: "HyperPay", country: "SA", status: "listed", currency: "SAR", methods: ["mada", "card", "applepay", "stcpay"], webhook: null, docs: "https://wordpresshyperpay.docs.oppwa.com/",
    env: [], note: { ar: "مدى، Apple Pay، STC Pay، تابي/تمارا — الموجة الجاية.", en: "mada, Apple Pay, STC Pay, Tabby/Tamara — next wave." },
    steps: [{ ar: "اطلب Entity IDs (مدى / فيزا / Apple Pay) و Access token.", en: "Request entity ids (mada / Visa / Apple Pay) and an access token." }],
  },
  {
    id: "tap", name: "Tap Payments", country: "SA", status: "listed", currency: "SAR", methods: ["mada", "card", "applepay", "stcpay"], webhook: null, docs: "https://developers.tap.company/",
    env: [], note: { ar: "الموجة الجاية.", en: "Next wave." }, steps: [{ ar: "اطلب Secret key + Publishable key.", en: "Request a secret + publishable key." }],
  },
  {
    id: "geidea", name: "Geidea", country: "SA", status: "listed", currency: "SAR", methods: ["mada", "card", "applepay"], webhook: null, docs: "https://docs.geidea.net/",
    env: [], note: { ar: "ماكينات و SoftPOS — الموجة الجاية.", en: "Terminals and SoftPOS — next wave." }, steps: [{ ar: "اطلب Merchant Public Key + API Password.", en: "Request a merchant public key + API password." }],
  },
];

export const providersFor = (country: "EG" | "SA") => PROVIDERS.filter((p) => p.country === country);
export const providerInfo = (id: PayProviderId, country?: "EG" | "SA") => PROVIDERS.find((p) => p.id === id && (!country || p.country === country)) ?? PROVIDERS.find((p) => p.id === id) ?? null;
export const PROVIDER_NAME: Record<PayProviderId, string> = { demo: "Demo", paymob: "Paymob", kashier: "Kashier", moyasar: "Moyasar", fawry: "Fawry", geidea: "Geidea", hyperpay: "HyperPay", tap: "Tap" };

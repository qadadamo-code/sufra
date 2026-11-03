/**
 * The restaurant's WhatsApp template catalogue (feature catalogue §6), AR + EN.
 *
 * Order-status templates come from the guest module (src/modules/guest/notify/templates.ts — unchanged);
 * this file adds feedback, reservations, payments, authentication and marketing templates and gives one
 * generic API over all of them:
 *
 *   renderTemplate("feedback_request", "ar", vars)        → the text the customer sees
 *   templateSendParams("order_out_for_delivery", "ar", vars, publicBase) → { name, lang, params, buttonParams }
 *   metaSubmission("order_received", "ar", publicBase)    → JSON for POST /{waba-id}/message_templates
 *
 * Names are lowercase_underscore; every variable has a sample (Meta review). Utility templates stay free of
 * promotional wording — otherwise Meta reclassifies them as Marketing (≈18× the Egypt utility rate).
 */
import type { Lang } from "@/i18n/i18n";
import { TEMPLATES as ORDER_TEMPLATES, type TemplateId as OrderTemplateId } from "@/modules/guest/notify/templates";
import { placeholders, sanitizeParam, toPositional } from "./core";

export type TemplateCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION";
export type TemplateGroup = "order" | "payment" | "reservation" | "feedback" | "auth" | "marketing";

export interface CatalogTemplate {
  id: string;
  category: TemplateCategory;
  group: TemplateGroup;
  title: { ar: string; en: string };
  body: Record<Lang, string>;
  footer?: Record<Lang, string>;
  /** URL button whose dynamic suffix comes from a variable (Meta: one {{1}} at the end of the URL) */
  button?: { label: Record<Lang, string>; urlVar: string };
  /** quick-reply buttons (fixed labels) */
  quickReplies?: Record<Lang, string>[];
  sample: Record<string, string>;
}

/** Partial: templates the delivery module adds later fall back to their id */
const ORDER_TITLES: Partial<Record<OrderTemplateId, { ar: string; en: string }>> = {
  order_received: { ar: "الطلب وصل", en: "Order received" },
  order_accepted_eta: { ar: "المطبخ بدأ", en: "Preparing + ETA" },
  order_ready_pickup: { ar: "جاهز للاستلام", en: "Ready for pickup" },
  order_out_for_delivery: { ar: "خرج مع الطيار", en: "Out for delivery" },
  order_arriving: { ar: "الطيار وصل", en: "Driver arriving" },
  order_delivered_receipt: { ar: "اتسلّم + الإيصال", en: "Delivered + receipt" },
  order_cancelled: { ar: "الطلب اتلغى", en: "Order cancelled" },
  order_delayed: { ar: "الطلب متأخر", en: "Order delayed" },
  payment_received: { ar: "الدفع وصل", en: "Payment received" },
};

const fromOrder = (id: OrderTemplateId): CatalogTemplate => {
  const t = ORDER_TEMPLATES[id];
  return { id, category: "UTILITY", group: id === "payment_received" ? "payment" : "order", title: ORDER_TITLES[id] ?? { ar: id.replace(/_/g, " "), en: id.replace(/_/g, " ") }, body: t.body, button: t.button, sample: t.sample };
};

const OPT_OUT_FOOTER = { ar: "لإلغاء الرسايل ابعت «وقف»", en: "Reply STOP to unsubscribe" };
const LINK = "https://sufra-planet-crm.vercel.app/app/r/sufra-zamalek";

const EXTRA: CatalogTemplate[] = [
  {
    id: "feedback_request",
    category: "UTILITY",
    group: "feedback",
    title: { ar: "طلب تقييم", en: "Feedback request" },
    body: {
      ar: "شكرًا يا {{name}} إنك اخترت {{restaurant}} 🌿\nإيه رأيك في طلبك #{{number}}؟ التقييم بياخد ثانية: {{rate_link}}",
      en: "Thanks for choosing {{restaurant}}, {{name}} 🌿\nHow was order #{{number}}? Rating takes a second: {{rate_link}}",
    },
    button: { label: { ar: "قيّم", en: "Rate" }, urlVar: "rate_link" },
    sample: { name: "دينا", restaurant: "سُفرة الزمالك", number: "42", rate_link: `${LINK}/o/123#rate` },
  },
  {
    id: "reservation_confirmed",
    category: "UTILITY",
    group: "reservation",
    title: { ar: "تأكيد الحجز", en: "Reservation confirmed" },
    body: {
      ar: "حجزك في {{restaurant}} اتأكد يا {{name}} ✅\nيوم {{date}} الساعة {{time}} — {{party}} أفراد.\nلو حابب تعدّل: {{link}}",
      en: "Your table at {{restaurant}} is confirmed, {{name}} ✅\n{{date}} at {{time}} — party of {{party}}.\nTo change it: {{link}}",
    },
    sample: { name: "دينا", restaurant: "سُفرة الزمالك", date: "الخميس ٥ نوفمبر", time: "20:30", party: "4", link: `${LINK}/book` },
  },
  {
    id: "reservation_reminder",
    category: "UTILITY",
    group: "reservation",
    title: { ar: "تذكير بالحجز", en: "Reservation reminder" },
    body: {
      ar: "تذكير يا {{name}}: حجزك في {{restaurant}} النهارده الساعة {{time}} 🍽️\nهتيجي؟",
      en: "Reminder, {{name}}: your table at {{restaurant}} is today at {{time}} 🍽️\nAre you coming?",
    },
    quickReplies: [{ ar: "أيوه جاي", en: "Yes, coming" }, { ar: "ألغي الحجز", en: "Cancel booking" }],
    sample: { name: "Dina", restaurant: "Sufra Zamalek", time: "20:30" },
  },
  {
    id: "waitlist_table_ready",
    category: "UTILITY",
    group: "reservation",
    title: { ar: "الترابيزة جاهزة", en: "Table ready (waitlist)" },
    body: {
      ar: "ترابيزتك جاهزة يا {{name}} 🎉\nمستنيينك في {{restaurant}} خلال {{minutes}} دقيقة.",
      en: "Your table is ready, {{name}} 🎉\nPlease come to {{restaurant}} within {{minutes}} minutes.",
    },
    sample: { name: "Dina", restaurant: "Sufra Zamalek", minutes: "10" },
  },
  {
    id: "payment_link",
    category: "UTILITY",
    group: "payment",
    title: { ar: "لينك الدفع", en: "Payment link" },
    body: {
      ar: "أهلاً {{name}}، ده لينك دفع {{amount}} لـ {{restaurant}}:\n{{link}}\nاللينك صالح لمدة ٢٤ ساعة.",
      en: "Hi {{name}}, here is the link to pay {{amount}} to {{restaurant}}:\n{{link}}\nThe link is valid for 24 hours.",
    },
    button: { label: { ar: "ادفع", en: "Pay" }, urlVar: "link" },
    sample: { name: "Dina", amount: "520.00 EGP", restaurant: "Sufra Zamalek", link: `${LINK}/pay/demo` },
  },
  {
    id: "refund_processed",
    category: "UTILITY",
    group: "payment",
    title: { ar: "المبلغ رجع", en: "Refund processed" },
    body: {
      ar: "يا {{name}}، رجّعنالك {{amount}} عن الطلب #{{number}}.\nهيظهر في حسابك خلال {{days}} أيام عمل.",
      en: "{{name}}, we refunded {{amount}} for order #{{number}}.\nIt will show in your account within {{days}} business days.",
    },
    sample: { name: "Dina", amount: "185.00 EGP", number: "42", days: "3–5" },
  },
  {
    id: "otp_login",
    category: "AUTHENTICATION",
    group: "auth",
    title: { ar: "كود التحقق", en: "Verification code" },
    // Meta fixes the wording of authentication templates; this is how it renders.
    body: { ar: "{{code}} هو كود التحقق بتاعك. للأمان، ماتشاركوش مع حد.", en: "{{code}} is your verification code. For your security, do not share this code." },
    footer: { ar: "الكود صالح ١٠ دقايق.", en: "This code expires in 10 minutes." },
    sample: { code: "482913" },
  },
  {
    id: "win_back_offer",
    category: "MARKETING",
    group: "marketing",
    title: { ar: "وحشتنا (عرض)", en: "Win-back offer" },
    body: {
      ar: "وحشتنا يا {{name}} 💚\n{{offer}} في {{restaurant}} بالكود {{code}} لحد {{until}}.\nاطلب من هنا: {{link}}",
      en: "We miss you, {{name}} 💚\n{{offer}} at {{restaurant}} with code {{code}} until {{until}}.\nOrder here: {{link}}",
    },
    footer: OPT_OUT_FOOTER,
    button: { label: { ar: "اطلب دلوقتي", en: "Order now" }, urlVar: "link" },
    sample: { name: "دينا", offer: "خصم ٢٠٪ على أي طاجن", restaurant: "سُفرة الزمالك", code: "BACK20", until: "١٥ نوفمبر", link: LINK },
  },
  {
    id: "birthday_offer",
    category: "MARKETING",
    group: "marketing",
    title: { ar: "عيد ميلاد سعيد", en: "Birthday treat" },
    body: {
      ar: "كل سنة وإنت طيب يا {{name}} 🎂\nهديتك من {{restaurant}}: {{offer}} — كودك {{code}} صالح لحد {{until}}.",
      en: "Happy birthday, {{name}} 🎂\nA treat from {{restaurant}}: {{offer}} — your code {{code}} is valid until {{until}}.",
    },
    footer: OPT_OUT_FOOTER,
    sample: { name: "Dina", restaurant: "Sufra Zamalek", offer: "أم علي هدية", code: "BDAY-7K2", until: "٣٠ نوفمبر" },
  },
  {
    id: "campaign_generic",
    category: "MARKETING",
    group: "marketing",
    title: { ar: "حملة عامة", en: "Generic campaign" },
    body: { ar: "أهلاً {{name}} 👋\n{{message}}\nالتفاصيل: {{link}}", en: "Hi {{name}} 👋\n{{message}}\nDetails: {{link}}" },
    footer: OPT_OUT_FOOTER,
    button: { label: { ar: "شوف العرض", en: "See the offer" }, urlVar: "link" },
    sample: { name: "Dina", message: "منيو رمضان نزل — فطار وسحور لحد الباب", link: LINK },
  },
];

export const CATALOG: CatalogTemplate[] = [...(Object.keys(ORDER_TEMPLATES) as OrderTemplateId[]).map(fromOrder), ...EXTRA];
const BY_ID = new Map(CATALOG.map((t) => [t.id, t]));
export const templateById = (id: string) => BY_ID.get(id) ?? null;

export class TemplateRenderError extends Error {
  constructor(public template: string, public missing: string[]) {
    super(`template ${template}: missing ${missing.join(", ")}`);
  }
}

/** Variables a template needs (both languages). */
export function varsOf(id: string): string[] {
  const t = templateById(id);
  if (!t) return [];
  return [...new Set([...placeholders(t.body.ar), ...placeholders(t.body.en)])];
}

/** Fill a template (body + footer). Throws on a missing/empty variable — never send "{{name}}" to a customer. */
export function renderTemplate(id: string, lang: Lang, vars: Record<string, string | number>): string {
  const t = templateById(id);
  if (!t) throw new TemplateRenderError(id, ["<unknown template>"]);
  const names = placeholders(t.body[lang]);
  const missing = names.filter((k) => vars[k] === undefined || vars[k] === null || String(vars[k]).trim() === "");
  if (missing.length) throw new TemplateRenderError(id, missing);
  const body = t.body[lang].replace(/\{\{(\w+)\}\}/g, (_, k: string) => sanitizeParam(vars[k]));
  return t.footer ? `${body}\n\n${t.footer[lang]}` : body;
}

/** Template preview with its sample values. */
export const renderSample = (id: string, lang: Lang) => renderTemplate(id, lang, templateById(id)?.sample ?? {});

/** Meta language code for our UI language. */
export const metaLang = (lang: Lang) => (lang === "ar" ? "ar" : "en");

/**
 * The public site the URL buttons point at. Meta URL buttons have a fixed base + one dynamic suffix:
 * https://sufra-planet-crm.vercel.app/app/{{1}} — the suffix is the path after /app/.
 */
export const PUBLIC_BASE = "https://sufra-planet-crm.vercel.app/app/";

export function urlSuffix(link: string, base = PUBLIC_BASE): string {
  if (link.startsWith(base)) return link.slice(base.length) || "/";
  try {
    const u = new URL(link);
    const i = u.pathname.indexOf("/app/");
    return (i >= 0 ? u.pathname.slice(i + 5) : u.pathname.replace(/^\//, "")) + u.search + u.hash || "/";
  } catch {
    return link;
  }
}

/** What our /api/whatsapp-send expects for a template. */
export function templateSendParams(id: string, lang: Lang, vars: Record<string, string | number>, base = PUBLIC_BASE) {
  const t = templateById(id);
  if (!t) throw new TemplateRenderError(id, ["<unknown template>"]);
  const { params } = toPositional(t.body[lang], vars);
  const buttonParams = t.button ? [sanitizeParam(urlSuffix(String(vars[t.button.urlVar] ?? ""), base))] : undefined;
  return { name: t.id, lang: metaLang(lang), params, buttonParams };
}

/** JSON body for Meta's "create message template" (POST /{waba-id}/message_templates) — copy from the templates manager. */
export function metaSubmission(id: string, lang: Lang, base = PUBLIC_BASE): Record<string, unknown> {
  const t = templateById(id);
  if (!t) throw new Error(`unknown template ${id}`);
  if (t.category === "AUTHENTICATION") {
    return {
      name: t.id,
      language: metaLang(lang),
      category: "AUTHENTICATION",
      components: [
        { type: "BODY", add_security_recommendation: true },
        { type: "FOOTER", code_expiration_minutes: 10 },
        { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: lang === "ar" ? "انسخ الكود" : "Copy code" }] },
      ],
    };
  }
  const { body, params } = toPositional(t.body[lang], Object.fromEntries(placeholders(t.body[lang]).map((k) => [k, t.sample[k] ?? k])));
  const components: Record<string, unknown>[] = [{ type: "BODY", text: body, ...(params.length ? { example: { body_text: [params] } } : {}) }];
  if (t.footer) components.push({ type: "FOOTER", text: t.footer[lang] });
  const buttons: Record<string, unknown>[] = [];
  if (t.button) buttons.push({ type: "URL", text: t.button.label[lang], url: `${base}{{1}}`, example: [`${base}${urlSuffix(t.sample[t.button.urlVar] ?? "", base)}`] });
  for (const q of t.quickReplies ?? []) buttons.push({ type: "QUICK_REPLY", text: q[lang] });
  if (buttons.length) components.push({ type: "BUTTONS", buttons });
  return { name: t.id, language: metaLang(lang), category: t.category, components };
}

export const priceCategoryOf = (c: TemplateCategory) => (c === "MARKETING" ? "marketing" : c === "AUTHENTICATION" ? "authentication" : "utility") as "marketing" | "authentication" | "utility";

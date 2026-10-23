/**
 * WhatsApp order-status templates (AR/EN), WhatsApp Cloud API ready.
 *
 * All are category UTILITY (transactional, no promotional wording — promo words get a template
 * reclassified as Marketing, which costs far more in Egypt). Names are lowercase_underscore as Meta requires.
 * Placeholders are named here ({{driver_name}}); `toMeta()` converts them to Meta's positional {{1}}, {{2}}…
 * and lists the parameter order to send. Every variable needs a sample value for Meta review (`sample`).
 *
 * Sending is Wave 2 (see ./WHATSAPP.md). Today `LogNotifier` (./notifier.ts) records the rendered
 * messages so staff can preview them.
 */
import type { Lang } from "@/i18n/i18n";

export type TemplateId =
  | "order_received"
  | "order_accepted_eta"
  | "order_ready_pickup"
  | "order_out_for_delivery"
  | "order_delivered_receipt"
  | "order_cancelled"
  | "order_delayed"
  | "payment_received";

export interface Template {
  id: TemplateId;
  category: "UTILITY";
  body: Record<Lang, string>;
  /** quick-reply / URL button label (URL buttons carry {{link}}-style dynamic suffixes in Meta) */
  button?: { label: Record<Lang, string>; urlVar: string };
  sample: Record<string, string>;
}

const t = (x: Template) => x;

export const TEMPLATES: Record<TemplateId, Template> = {
  order_received: t({
    id: "order_received",
    category: "UTILITY",
    body: {
      ar: "أهلاً {{name}} 👋\nطلبك رقم #{{number}} من {{restaurant}} وصلنا.\n{{items}}\nالإجمالي: {{total}} — الدفع: {{payment}}\nتابع طلبك من هنا: {{link}}",
      en: "Hi {{name}} 👋\nWe've received your order #{{number}} from {{restaurant}}.\n{{items}}\nTotal: {{total}} — Payment: {{payment}}\nTrack it here: {{link}}",
    },
    button: { label: { ar: "تابع الطلب", en: "Track order" }, urlVar: "link" },
    sample: { name: "دينا", number: "42", restaurant: "سُفرة الزمالك", items: "٢× كفتة مشوية، ١× أم علي", total: "985.00 ج.م", payment: "كاش عند الاستلام", link: "https://sufra.app/app/r/sufra-zamalek/o/123" },
  }),
  order_accepted_eta: t({
    id: "order_accepted_eta",
    category: "UTILITY",
    body: {
      ar: "{{name}}، المطبخ بدأ يجهز طلبك #{{number}} 🍳\nالوقت المتوقع: {{eta}}\n{{link}}",
      en: "{{name}}, the kitchen is preparing your order #{{number}} 🍳\nEstimated time: {{eta}}\n{{link}}",
    },
    sample: { name: "Dina", number: "42", eta: "20:45", link: "https://sufra.app/app/r/sufra-zamalek/o/123" },
  }),
  order_ready_pickup: t({
    id: "order_ready_pickup",
    category: "UTILITY",
    body: {
      ar: "طلبك #{{number}} جاهز للاستلام يا {{name}} ✅\nمن فرع {{branch}}\nاللوكيشن: {{map_link}}",
      en: "Your order #{{number}} is ready for pickup, {{name}} ✅\nAt {{branch}}\nLocation: {{map_link}}",
    },
    sample: { name: "Dina", number: "42", branch: "الزمالك", map_link: "https://maps.google.com/?q=30.06,31.22" },
  }),
  order_out_for_delivery: t({
    id: "order_out_for_delivery",
    category: "UTILITY",
    body: {
      ar: "طلبك #{{number}} خرج مع الطيار {{driver_name}} 🛵\nرقم الطيار: {{driver_phone}}\nهيوصلك حوالي {{eta}}\nتتبع مباشر: {{link}}",
      en: "Your order #{{number}} is on its way with {{driver_name}} 🛵\nDriver: {{driver_phone}}\nArriving around {{eta}}\nLive tracking: {{link}}",
    },
    button: { label: { ar: "تتبع الطيار", en: "Track driver" }, urlVar: "link" },
    sample: { number: "42", driver_name: "إسلام", driver_phone: "01000000000", eta: "21:05", link: "https://sufra.app/app/r/sufra-zamalek/o/123" },
  }),
  order_delivered_receipt: t({
    id: "order_delivered_receipt",
    category: "UTILITY",
    body: {
      ar: "بالهنا والشفا يا {{name}} 🌿\nطلبك #{{number}} اتسلم. الإيصال: {{receipt_link}}\nقيّم طلبك في ثانية: {{rate_link}}",
      en: "Enjoy your meal, {{name}} 🌿\nOrder #{{number}} was delivered. Receipt: {{receipt_link}}\nRate your order: {{rate_link}}",
    },
    button: { label: { ar: "قيّم الطلب", en: "Rate order" }, urlVar: "rate_link" },
    sample: { name: "Dina", number: "42", receipt_link: "https://sufra.app/app/r/sufra-zamalek/o/123", rate_link: "https://sufra.app/app/r/sufra-zamalek/o/123#rate" },
  }),
  order_cancelled: t({
    id: "order_cancelled",
    category: "UTILITY",
    body: {
      ar: "للأسف طلبك #{{number}} اتلغى يا {{name}}.\nالسبب: {{reason}}\n{{refund}}\nلو محتاج حاجة كلمنا: {{phone}}",
      en: "Sorry {{name}}, your order #{{number}} was cancelled.\nReason: {{reason}}\n{{refund}}\nNeed help? Call us: {{phone}}",
    },
    sample: { name: "Dina", number: "42", reason: "الفرع قفل بدري", refund: "هيرجعلك المبلغ خلال ٣–٥ أيام عمل", phone: "0227350000" },
  }),
  order_delayed: t({
    id: "order_delayed",
    category: "UTILITY",
    body: {
      ar: "{{name}}، طلبك #{{number}} هيتأخر شوية — آسفين 🙏\nالوقت الجديد: {{eta}}\nالسبب: {{reason}}",
      en: "{{name}}, your order #{{number}} is running late — sorry 🙏\nNew time: {{eta}}\nReason: {{reason}}",
    },
    sample: { name: "Dina", number: "42", eta: "21:20", reason: "ضغط في المطبخ" },
  }),
  payment_received: t({
    id: "payment_received",
    category: "UTILITY",
    body: {
      ar: "وصلنا {{amount}} من {{name}} في {{restaurant}} ✅\nرقم العملية: {{reference}}\nالإيصال: {{receipt_link}}",
      en: "{{restaurant}} received {{amount}} from {{name}} ✅\nReference: {{reference}}\nReceipt: {{receipt_link}}",
    },
    sample: { name: "Dina", amount: "520.00 EGP", restaurant: "Sufra Zamalek", reference: "DEMO-123456", receipt_link: "https://sufra.app/app/r/sufra-zamalek/t/ZM05?receipt=1" },
  }),
};

const VAR = /\{\{(\w+)\}\}/g;

/** Names of the variables a template uses (in order of first appearance, both languages). */
export function templateVars(id: TemplateId): string[] {
  const tpl = TEMPLATES[id];
  const seen: string[] = [];
  for (const s of [tpl.body.ar, tpl.body.en]) for (const m of s.matchAll(VAR)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}

export class TemplateError extends Error {
  constructor(public template: TemplateId, public missing: string[]) {
    super(`template ${template}: missing ${missing.join(", ")}`);
  }
}

/** Fill a template. Throws if any placeholder has no (non-empty) value — never send "{{name}}" to a customer. */
export function render(id: TemplateId, lang: Lang, vars: Record<string, string | number>): string {
  const body = TEMPLATES[id].body[lang];
  const missing = [...new Set([...body.matchAll(VAR)].map((m) => m[1]).filter((k) => vars[k] === undefined || vars[k] === null || String(vars[k]).trim() === ""))];
  if (missing.length) throw new TemplateError(id, missing);
  // WhatsApp params cannot contain newlines/tabs or 4+ consecutive spaces
  return body.replace(VAR, (_, k: string) => String(vars[k]).replace(/[\t\n]+/g, " ").replace(/ {4,}/g, "   "));
}

/** Meta format: positional placeholders + the parameter order to send. */
export function toMeta(id: TemplateId, lang: Lang): { name: TemplateId; language: string; category: "UTILITY"; body: string; params: string[]; example: string[] } {
  const params = [...new Set([...TEMPLATES[id].body[lang].matchAll(VAR)].map((m) => m[1]))];
  const body = TEMPLATES[id].body[lang].replace(VAR, (_, k: string) => `{{${params.indexOf(k) + 1}}}`);
  return { name: id, language: lang === "ar" ? "ar" : "en", category: "UTILITY", body, params, example: params.map((p) => TEMPLATES[id].sample[p] ?? p) };
}

/* ───────── order stage → template ───────── */

export type NotifyStage = "received" | "accepted" | "ready_pickup" | "out_for_delivery" | "delivered" | "cancelled" | "delayed" | "paid";

export const STAGE_TEMPLATE: Record<NotifyStage, TemplateId> = {
  received: "order_received",
  accepted: "order_accepted_eta",
  ready_pickup: "order_ready_pickup",
  out_for_delivery: "order_out_for_delivery",
  delivered: "order_delivered_receipt",
  cancelled: "order_cancelled",
  delayed: "order_delayed",
  paid: "payment_received",
};

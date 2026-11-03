/**
 * Notifier — how a customer message leaves Sufra. One interface, one adapter per channel:
 *
 *   WhatsAppCloudNotifier  POST /api/whatsapp-send (our Vercel function holds the Meta token)       automatic
 *   ClickToChatNotifier    wa.me/<number>?text=… — staff taps send in their own WhatsApp          needs a tap
 *   BspNotifier            Unifonic / Infobip / 360dialog / Twilio — documented stubs              not yet
 *   SmsNotifier            stub (NTRA/CST-registered sender via an aggregator)                     not yet
 *   LogNotifierAdapter     the guest module's LogNotifier (preview outbox)                         automatic
 *
 *   const n = notifierFor(settings, { fetch, auth });
 *   const r = await n.sendTemplate({ to, template: "order_received", lang: "ar", vars });
 *
 * `notifierFor` picks the adapter from Settings → Messaging (mode: off / click_to_chat / cloud / bsp).
 */
import type { Lang } from "@/i18n/i18n";
import type { MessageChannel, MessageStatus } from "@/data/types";
import { getNotifier as getLogNotifier } from "@/modules/guest/notify/notifier";
import type { TemplateId } from "@/modules/guest/notify/templates";
import { clickToChatUrl, explainMetaError, toE164, type Country, type MediaKind } from "./core";
import { renderTemplate, templateById, templateSendParams } from "./templates";
import type { BspProvider, MessagingSettings } from "./settings";

export interface TemplateSend {
  restaurantId: string;
  to: string;
  template: string;
  lang: Lang;
  vars: Record<string, string | number>;
  /** our message row id (lets the server write the provider id back) */
  messageId?: string;
}
export interface TextSend {
  restaurantId: string;
  to: string;
  text: string;
  messageId?: string;
}
export interface MediaSend {
  restaurantId: string;
  to: string;
  kind: MediaKind;
  link: string;
  caption?: string;
  messageId?: string;
}

export type SendResult =
  | { ok: true; status: MessageStatus; providerId?: string | null; url?: string }
  | { ok: false; status: "failed" | "skipped"; error: string; code?: string | number; hint?: { ar: string; en: string } | null };

export interface Notifier {
  readonly channel: MessageChannel;
  /** true = delivers without a person (cloud/BSP/log); false = staff must tap (click-to-chat) */
  readonly automatic: boolean;
  sendTemplate(m: TemplateSend): Promise<SendResult>;
  /** free-form text — Cloud API only inside the 24h customer-service window */
  sendText(m: TextSend): Promise<SendResult>;
  sendMedia(m: MediaSend): Promise<SendResult>;
}

/* ───────── WhatsApp Cloud API (through our server function) ───────── */

export interface CloudOptions {
  endpoint?: string;
  fetch?: typeof fetch;
  /** headers proving who we are: { Authorization: "Bearer <supabase jwt>" } or { "x-sufra-api-key": "…" } */
  auth?: () => Promise<Record<string, string>>;
  country?: Country;
}

export class WhatsAppCloudNotifier implements Notifier {
  readonly channel = "whatsapp" as const;
  readonly automatic = true;
  constructor(private o: CloudOptions = {}) {}

  private async post(body: Record<string, unknown>): Promise<SendResult> {
    const f = this.o.fetch ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
    if (!f) return { ok: false, status: "failed", error: "no_fetch" };
    let res: Response;
    try {
      res = await f(this.o.endpoint ?? "/api/whatsapp-send", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await this.o.auth?.()) },
        body: JSON.stringify({ ...body, country: this.o.country ?? "EG" }),
      });
    } catch (e) {
      return { ok: false, status: "failed", error: "network", hint: { ar: "مفيش اتصال بالسيرفر", en: "Couldn't reach the server" }, code: (e as Error).message };
    }
    const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string; message?: string; code?: number | string };
    if (res.ok && j.id) return { ok: true, status: "sent", providerId: j.id };
    const hint =
      res.status === 501
        ? { ar: "واتساب Cloud API مش متوصّل على السيرفر لسه — شوف دليل الإعداد", en: "WhatsApp Cloud API isn't configured on the server yet — see the setup guide" }
        : res.status === 401 || res.status === 403
          ? { ar: "السيرفر رفض الطلب (صلاحيات)", en: "The server refused the request (auth)" }
          : res.status === 429
            ? { ar: "رسايل كتير في وقت قصير — هنحاول تاني", en: "Rate limited — will retry" }
            : res.status === 409
              ? { ar: "الزبون لغى الاشتراك", en: "The customer opted out" }
              : explainMetaError(j.code);
    return { ok: false, status: "failed", error: j.error ?? `http_${res.status}`, code: j.code ?? res.status, hint };
  }

  sendTemplate(m: TemplateSend) {
    const t = templateSendParams(m.template, m.lang, m.vars);
    return this.post({ restaurantId: m.restaurantId, to: m.to, template: t, messageId: m.messageId });
  }
  sendText(m: TextSend) {
    return this.post({ restaurantId: m.restaurantId, to: m.to, text: m.text, messageId: m.messageId });
  }
  sendMedia(m: MediaSend) {
    return this.post({ restaurantId: m.restaurantId, to: m.to, media: { kind: m.kind, link: m.link, caption: m.caption }, messageId: m.messageId });
  }
}

/* ───────── click to chat (works today, no Meta account) ───────── */

/**
 * Builds the wa.me link. `open` is called with it — pass `(u) => window.open(u, "_blank")` from a click handler
 * (browsers block pop-ups outside a user gesture). Without `open` the message waits as "pending_tap" in the inbox.
 */
export class ClickToChatNotifier implements Notifier {
  readonly channel = "click_to_chat" as const;
  readonly automatic = false;
  constructor(private o: { open?: (url: string) => void; country?: Country } = {}) {}

  private go(to: string, text: string): SendResult {
    const url = clickToChatUrl(to, text, this.o.country ?? "EG");
    if (!this.o.open) return { ok: true, status: "pending_tap", url };
    this.o.open(url);
    return { ok: true, status: "opened", url };
  }
  async sendTemplate(m: TemplateSend) {
    return this.go(m.to, renderTemplate(m.template, m.lang, m.vars));
  }
  async sendText(m: TextSend) {
    return this.go(m.to, m.text);
  }
  async sendMedia(m: MediaSend) {
    return this.go(m.to, [m.caption, m.link].filter(Boolean).join("\n"));
  }
}

/* ───────── BSPs (documented stubs) ───────── */

/**
 * Business Solution Providers popular in Egypt/KSA. Each one is a server-side adapter to add to
 * api/whatsapp-send.ts (never call a BSP from the browser — their keys are secrets):
 *
 *   360dialog  Cloud-API compatible: POST https://waba-v2.360dialog.io/messages, header D360-API-KEY,
 *              same JSON body as buildSendPayload() → set WHATSAPP_PROVIDER=360dialog + D360_API_KEY.
 *   Unifonic   POST https://apis.unifonic.com/v1/messages (header PublicId + Secret), template { name, language, parameters }.
 *   Infobip    POST https://{base}.api.infobip.com/whatsapp/1/message/template (Authorization: App <key>),
 *              { messages: [{ from, to, content: { templateName, templateData: { body: { placeholders } }, language } }] }.
 *   Twilio     POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json (basic auth),
 *              From=whatsapp:+…, To=whatsapp:+…, ContentSid=HX… + ContentVariables (templates are Twilio "Content").
 */
export class BspNotifier implements Notifier {
  readonly channel = "whatsapp" as const;
  readonly automatic = true;
  constructor(readonly provider: BspProvider | null) {}
  private stub(): SendResult {
    return {
      ok: false,
      status: "failed",
      error: "bsp_not_implemented",
      hint: { ar: `ربط ${this.provider ?? "BSP"} لسه مش متاح — استخدم Cloud API أو الإرسال بالضغط`, en: `${this.provider ?? "BSP"} isn't wired yet — use the Cloud API or click-to-chat` },
    };
  }
  async sendTemplate() {
    return this.stub();
  }
  async sendText() {
    return this.stub();
  }
  async sendMedia() {
    return this.stub();
  }
}

/* ───────── SMS (stub) ───────── */

/** SMS fallback — needs a registered sender ID (Egypt: NTRA via Cequens/Victory Link/Vodafone; KSA: CST via Unifonic/Taqnyat/Msegat). */
export class SmsNotifier implements Notifier {
  readonly channel = "sms" as const;
  readonly automatic = true;
  private stub(): SendResult {
    return { ok: false, status: "failed", error: "sms_not_configured", hint: { ar: "رسايل SMS محتاجة اسم مرسل متسجل", en: "SMS needs a registered sender ID" } };
  }
  async sendTemplate() {
    return this.stub();
  }
  async sendText() {
    return this.stub();
  }
  async sendMedia() {
    return this.stub();
  }
}

/* ───────── log (preview) ───────── */

/** Wraps the guest module's LogNotifier (localStorage outbox the QR settings page previews). */
export class LogNotifierAdapter implements Notifier {
  readonly channel = "log" as const;
  readonly automatic = true;
  async sendTemplate(m: TemplateSend): Promise<SendResult> {
    if (!templateById(m.template)) return { ok: false, status: "failed", error: "unknown_template" };
    try {
      // the guest outbox only knows the order templates; others are rendered and kept as free text
      await getLogNotifier().send({ restaurantId: m.restaurantId, to: m.to, lang: m.lang, template: m.template as TemplateId, vars: m.vars });
    } catch {
      /* non-order template: rendering already validated by the caller */
    }
    return { ok: true, status: "sent", providerId: null };
  }
  async sendText(): Promise<SendResult> {
    return { ok: true, status: "sent", providerId: null };
  }
  async sendMedia(): Promise<SendResult> {
    return { ok: true, status: "sent", providerId: null };
  }
}

/** Mode "off": everything is skipped (and recorded as such). */
export class OffNotifier implements Notifier {
  readonly channel = "log" as const;
  readonly automatic = true;
  private skip(): SendResult {
    return { ok: false, status: "skipped", error: "messaging_off" };
  }
  async sendTemplate() {
    return this.skip();
  }
  async sendText() {
    return this.skip();
  }
  async sendMedia() {
    return this.skip();
  }
}

/* ───────── registry ───────── */

export interface NotifierEnv {
  fetch?: typeof fetch;
  auth?: () => Promise<Record<string, string>>;
  /** click-to-chat: open the wa.me link (only from a click handler) */
  open?: (url: string) => void;
  endpoint?: string;
}

/** Picks the adapter for the restaurant's messaging mode. */
export function notifierFor(s: Pick<MessagingSettings, "mode" | "bsp" | "country">, env: NotifierEnv = {}): Notifier {
  switch (s.mode) {
    case "off":
      return new OffNotifier();
    case "cloud":
      return new WhatsAppCloudNotifier({ fetch: env.fetch, auth: env.auth, endpoint: env.endpoint, country: s.country });
    case "bsp":
      return s.bsp === "360dialog" ? new WhatsAppCloudNotifier({ fetch: env.fetch, auth: env.auth, endpoint: env.endpoint, country: s.country }) : new BspNotifier(s.bsp);
    case "click_to_chat":
    default:
      return new ClickToChatNotifier({ open: env.open, country: s.country });
  }
}

/** E.164 or throws — notifiers expect a valid number. */
export function mustE164(phone: string, country: Country = "EG"): string {
  const e = toE164(phone, country);
  if (!e) throw new Error("bad_phone");
  return e;
}

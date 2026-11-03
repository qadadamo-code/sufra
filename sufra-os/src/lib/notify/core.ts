/**
 * WhatsApp core — PURE helpers shared by the browser app and the Vercel functions in /api.
 *
 *   browser: import { toE164, clickToChatUrl, windowState } from "@/lib/notify/core";
 *   server:  import { buildSendPayload, parseWebhook } from "../../sufra-os/src/lib/notify/core";
 *
 * Rules for this file: NO imports (not even type imports from "@/…"), no DOM, no Node APIs —
 * so Vercel can bundle it into a function and Vite into the app, and vitest can test it as is.
 */

/* ───────────────────────── phone numbers ───────────────────────── */

export type Country = "EG" | "SA";

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
export function latin(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => String(ARABIC_DIGITS.includes(d) ? ARABIC_DIGITS.indexOf(d) : PERSIAN_DIGITS.indexOf(d)));
}

/**
 * Normalise a phone number to E.164 ("+201005551201"), or null when it isn't a mobile we can message.
 *   Egypt  01[0125]xxxxxxxx  (11 digits)  → +20 1x…        Saudi  05xxxxxxxx (10 digits) → +966 5x…
 *   20…/966… with or without + / 00, Arabic-Indic digits, spaces and dashes are all accepted.
 *   Bare national numbers without the trunk 0 (1xxxxxxxxx / 5xxxxxxxx) use `defaultCountry`.
 *   Other countries: only with an explicit + or 00 prefix (8–15 digits).
 */
export function toE164(raw: string | null | undefined, defaultCountry: Country = "EG"): string | null {
  if (!raw) return null;
  const s = latin(String(raw)).trim();
  const intl = s.startsWith("+") || s.startsWith("00");
  let d = s.replace(/\D/g, "");
  if (s.startsWith("00")) d = d.slice(2);
  // Egypt
  if (/^01[0125]\d{8}$/.test(d)) return `+2${d}`;
  if (/^201[0125]\d{8}$/.test(d)) return `+${d}`;
  if (/^2001[0125]\d{8}$/.test(d)) return `+20${d.slice(3)}`; // +20 01… (trunk 0 typed after the code)
  // Saudi Arabia
  if (/^05\d{8}$/.test(d)) return `+966${d.slice(1)}`;
  if (/^9665\d{8}$/.test(d)) return `+${d}`;
  if (/^96605\d{8}$/.test(d)) return `+966${d.slice(4)}`;
  if (!intl) {
    if (defaultCountry === "EG" && /^1[0125]\d{8}$/.test(d)) return `+20${d}`;
    if (defaultCountry === "SA" && /^5\d{8}$/.test(d)) return `+966${d}`;
    return null;
  }
  return /^[1-9]\d{7,14}$/.test(d) ? `+${d}` : null;
}

/** "+201005551201" → "201005551201" (what wa.me and the Graph API "to" field want). */
export const waDigits = (e164: string) => e164.replace(/\D/g, "");

export function countryOf(e164: string): Country | "other" {
  if (e164.startsWith("+20")) return "EG";
  if (e164.startsWith("+966")) return "SA";
  return "other";
}

/** Egyptian/Saudi numbers back to the national format people recognise (01005551201 / 0512345678). */
export function nationalFormat(e164: string): string {
  if (/^\+201\d{9}$/.test(e164)) return `0${e164.slice(3)}`;
  if (/^\+9665\d{8}$/.test(e164)) return `0${e164.slice(4)}`;
  return e164;
}

/** +20 100 555 1201 · +966 51 234 5678 */
export function prettyPhone(e164: string): string {
  if (/^\+201\d{9}$/.test(e164)) return `+20 ${e164.slice(3, 6)} ${e164.slice(6, 9)} ${e164.slice(9)}`;
  if (/^\+9665\d{8}$/.test(e164)) return `+966 ${e164.slice(4, 6)} ${e164.slice(6, 9)} ${e164.slice(9)}`;
  return e164;
}

/* ───────────────────────── click to chat ───────────────────────── */

/**
 * https://wa.me/<digits>?text=<prefilled> — opens WhatsApp (app or web) on the staff device with the message
 * typed in; staff taps send. No Meta account needed. Without a number, WhatsApp asks which chat to use.
 */
export function clickToChatUrl(phone: string | null | undefined, text: string, defaultCountry: Country = "EG"): string {
  const e164 = phone ? toE164(phone, defaultCountry) : null;
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${e164 ? waDigits(e164) : ""}${q}`;
}

/* ───────────────────────── 24-hour customer service window ───────────────────────── */

export const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface WindowState {
  open: boolean;
  /** ISO time the window closes (null when the customer never wrote) */
  expiresAt: string | null;
  msLeft: number;
  /** under 2 hours left */
  closingSoon: boolean;
}

/** The window opens/resets whenever the customer messages; inside it free-form messages are allowed. */
export function windowState(lastInboundAt: string | null | undefined, now: number = Date.now()): WindowState {
  if (!lastInboundAt) return { open: false, expiresAt: null, msLeft: 0, closingSoon: false };
  const t = Date.parse(lastInboundAt);
  if (!Number.isFinite(t)) return { open: false, expiresAt: null, msLeft: 0, closingSoon: false };
  const end = t + WINDOW_MS;
  const msLeft = Math.max(0, end - now);
  return { open: msLeft > 0, expiresAt: new Date(end).toISOString(), msLeft, closingSoon: msLeft > 0 && msLeft < 2 * 60 * 60 * 1000 };
}

/* ───────────────────────── opt-out / opt-in keywords ───────────────────────── */

/** lower-case, strip tashkeel/tatweel/punctuation/emoji, unify alef/yeh forms */
export function normalizeKeyword(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const OPT_OUT = new Set(["stop", "stop all", "stopall", "unsubscribe", "opt out", "optout", "الغاء", "الغاء الاشتراك", "وقف", "ايقاف", "اوقف", "بطل", "كفايه", "لا ترسل", "stop رسائل"]);
const OPT_IN = new Set(["start", "subscribe", "unstop", "اشتراك", "اشترك", "ابدا", "تفعيل"]);

/** Whole-message match only — "I'll stop by at 8" is not an opt-out. */
export const isOptOut = (text: string | null | undefined) => !!text && OPT_OUT.has(normalizeKeyword(text));
export const isOptIn = (text: string | null | undefined) => !!text && OPT_IN.has(normalizeKeyword(text));

/* ───────────────────────── template parameters ───────────────────────── */

/** Meta rules for a template parameter: no newlines/tabs, no more than 3 consecutive spaces, ≤ 1024 chars, not empty. */
export function sanitizeParam(v: unknown): string {
  const s = String(v ?? "")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/ {4,}/g, "   ")
    .trim()
    .slice(0, 1024);
  if (!s) throw new Error("empty_param");
  return s;
}

const VAR = /\{\{(\w+)\}\}/g;

/** Named placeholders in order of first appearance: "Hi {{name}} #{{number}}" → ["name","number"] */
export function placeholders(body: string): string[] {
  return [...new Set([...body.matchAll(VAR)].map((m) => m[1]))];
}

/** Named → positional for Meta: body with {{1}}, {{2}}… and the ordered parameter values. */
export function toPositional(body: string, vars: Record<string, string | number>): { body: string; params: string[] } {
  const names = placeholders(body);
  const missing = names.filter((n) => vars[n] === undefined || vars[n] === null || String(vars[n]).trim() === "");
  if (missing.length) throw new Error(`missing_vars:${missing.join(",")}`);
  return { body: body.replace(VAR, (_, k: string) => `{{${names.indexOf(k) + 1}}}`), params: names.map((n) => sanitizeParam(vars[n])) };
}

/* ───────────────────────── Cloud API send payload ───────────────────────── */

export type MediaKind = "image" | "document" | "video";

export interface SendRequest {
  restaurantId: string;
  /** any phone format; normalised server side */
  to: string;
  /** Meta template name + language code ("ar", "en", "en_US") + positional body params */
  template?: { name: string; lang: string; params?: string[]; buttonParams?: string[]; headerParams?: string[] };
  /** free-form text — only inside the 24h window */
  text?: string;
  media?: { kind: MediaKind; link: string; caption?: string; filename?: string };
  /** our wa_messages row id (the server writes the provider id + status back to it) */
  messageId?: string;
  /** country for national numbers */
  country?: Country;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
const LANG = /^[a-z]{2,3}(_[A-Z]{2})?$/;

/** Checks a send request from an untrusted client. Normalises the phone and parameters. */
export function validateSendRequest(input: unknown): Validated<SendRequest & { to: string }> {
  if (!input || typeof input !== "object") return { ok: false, error: "bad_json" };
  const b = input as Record<string, unknown>;
  const restaurantId = typeof b.restaurantId === "string" ? b.restaurantId.trim() : "";
  if (!/^[0-9a-f-]{8,64}$/i.test(restaurantId)) return { ok: false, error: "bad_restaurant" };
  const country = b.country === "SA" ? "SA" : "EG";
  const to = toE164(typeof b.to === "string" ? b.to : "", country);
  if (!to) return { ok: false, error: "bad_phone" };
  const kinds = [b.template, b.text, b.media].filter((x) => x !== undefined && x !== null);
  if (kinds.length !== 1) return { ok: false, error: "one_of_template_text_media" };
  const messageId = typeof b.messageId === "string" && /^[0-9a-zA-Z-]{1,64}$/.test(b.messageId) ? b.messageId : undefined;
  const out: SendRequest & { to: string } = { restaurantId, to, country, messageId };
  try {
    if (b.template !== undefined && b.template !== null) {
      const t = b.template as Record<string, unknown>;
      const name = String(t.name ?? "");
      const lang = String(t.lang ?? "");
      if (!TEMPLATE_NAME.test(name)) return { ok: false, error: "bad_template_name" };
      if (!LANG.test(lang)) return { ok: false, error: "bad_lang" };
      const list = (v: unknown, max: number) => {
        if (v === undefined || v === null) return undefined;
        if (!Array.isArray(v) || v.length > max) throw new Error("bad_params");
        return v.map(sanitizeParam);
      };
      out.template = { name, lang, params: list(t.params, 20) ?? [], buttonParams: list(t.buttonParams, 3), headerParams: list(t.headerParams, 1) };
    } else if (b.text !== undefined && b.text !== null) {
      const text = String(b.text).trim();
      if (!text || text.length > 4096) return { ok: false, error: "bad_text" };
      out.text = text;
    } else {
      const m = b.media as Record<string, unknown>;
      const kind = m?.kind;
      if (kind !== "image" && kind !== "document" && kind !== "video") return { ok: false, error: "bad_media_kind" };
      const link = String(m.link ?? "");
      if (!/^https:\/\/[^\s]+$/.test(link) || link.length > 2048) return { ok: false, error: "bad_media_link" };
      const caption = m.caption ? String(m.caption).slice(0, 1024) : undefined;
      const filename = m.filename ? String(m.filename).slice(0, 240) : undefined;
      out.media = { kind, link, caption, filename };
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message === "empty_param" ? "empty_param" : "bad_params" };
  }
  return { ok: true, value: out };
}

/** Graph API body for POST /{phone-number-id}/messages */
export function buildSendPayload(r: Pick<SendRequest, "to" | "template" | "text" | "media">): Record<string, unknown> {
  const to = waDigits(r.to);
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (r.template) {
    const components: Record<string, unknown>[] = [];
    if (r.template.headerParams?.length) components.push({ type: "header", parameters: r.template.headerParams.map((text) => ({ type: "text", text })) });
    if (r.template.params?.length) components.push({ type: "body", parameters: r.template.params.map((text) => ({ type: "text", text })) });
    (r.template.buttonParams ?? []).forEach((text, i) => components.push({ type: "button", sub_type: "url", index: String(i), parameters: [{ type: "text", text }] }));
    return { ...base, type: "template", template: { name: r.template.name, language: { code: r.template.lang }, ...(components.length ? { components } : {}) } };
  }
  if (r.text) return { ...base, type: "text", text: { body: r.text, preview_url: /https?:\/\//.test(r.text) } };
  if (r.media) {
    const m: Record<string, unknown> = { link: r.media.link };
    if (r.media.caption) m.caption = r.media.caption;
    if (r.media.kind === "document" && r.media.filename) m.filename = r.media.filename;
    return { ...base, type: r.media.kind, [r.media.kind]: m };
  }
  throw new Error("empty_message");
}

/** Meta error codes worth explaining to staff. */
export function explainMetaError(code: number | string | undefined): { ar: string; en: string } | null {
  switch (Number(code)) {
    case 131047:
      return { ar: "فات ٢٤ ساعة من آخر رسالة من الزبون — ابعت قالب معتمد", en: "More than 24h since the customer wrote — send an approved template" };
    case 131026:
      return { ar: "الرقم ده مش على واتساب أو مش قادر يستقبل", en: "This number isn't on WhatsApp or can't receive messages" };
    case 132001:
      return { ar: "القالب مش موجود أو مش معتمد باللغة دي", en: "Template doesn't exist or isn't approved in this language" };
    case 132000:
      return { ar: "عدد المتغيرات في القالب مش مظبوط", en: "Wrong number of template parameters" };
    case 131056:
    case 130429:
      return { ar: "رسايل كتير بسرعة — استنى شوية", en: "Too many messages too fast — slow down" };
    case 190:
      return { ar: "توكن واتساب منتهي أو غلط", en: "WhatsApp access token expired or invalid" };
    case 131031:
      return { ar: "حساب واتساب البيزنس موقوف", en: "The WhatsApp Business account is locked" };
    default:
      return null;
  }
}

/* ───────────────────────── webhook payload ───────────────────────── */

export interface InboundEvent {
  kind: "message";
  phoneNumberId: string;
  /** E.164 */
  from: string;
  name: string;
  id: string;
  at: string;
  type: string;
  text: string;
  mediaId: string | null;
  mimeType: string | null;
  /** id of the business message this replies to (button reply / quoted) */
  context: string | null;
  optOut: boolean;
  optIn: boolean;
}

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";
export interface StatusEvent {
  kind: "status";
  phoneNumberId: string;
  id: string;
  status: DeliveryStatus;
  at: string;
  recipient: string;
  category: string | null;
  billable: boolean | null;
  errorCode: number | null;
  errorTitle: string | null;
}

export type WebhookEvent = InboundEvent | StatusEvent;

const isoFromUnix = (ts: unknown) => {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));

function messageText(m: Record<string, unknown>): string {
  const type = str(m.type);
  switch (type) {
    case "text":
      return str(obj(m.text).body);
    case "button":
      return str(obj(m.button).text) || str(obj(m.button).payload);
    case "interactive": {
      const i = obj(m.interactive);
      return str(obj(i.button_reply).title) || str(obj(i.list_reply).title) || str(obj(i.nfm_reply).body);
    }
    case "image":
    case "video":
    case "document":
    case "sticker":
    case "audio":
      return str(obj(m[type]).caption) || (type === "document" ? str(obj(m.document).filename) : "");
    case "location": {
      const l = obj(m.location);
      return `📍 ${str(l.name) || ""} ${str(l.latitude)},${str(l.longitude)}`.trim();
    }
    case "reaction":
      return str(obj(m.reaction).emoji);
    case "contacts":
      return arr(m.contacts).map((c) => str(obj(obj(c).name).formatted_name)).join(", ");
    default:
      return "";
  }
}

/** Flattens a WhatsApp Cloud API webhook body into inbound messages and delivery statuses. Unknown parts are ignored. */
export function parseWebhook(body: unknown): WebhookEvent[] {
  const out: WebhookEvent[] = [];
  const b = obj(body);
  if (b.object !== "whatsapp_business_account") return out;
  for (const entry of arr(b.entry))
    for (const change of arr(obj(entry).changes)) {
      const c = obj(change);
      if (c.field !== "messages") continue;
      const v = obj(c.value);
      const phoneNumberId = str(obj(v.metadata).phone_number_id);
      const names = new Map(arr(v.contacts).map((x) => [str(obj(x).wa_id), str(obj(obj(x).profile).name)]));
      for (const raw of arr(v.messages)) {
        const m = obj(raw);
        const from = toE164(`+${str(m.from)}`) ?? `+${str(m.from).replace(/\D/g, "")}`;
        const type = str(m.type) || "unknown";
        const text = messageText(m);
        const media = obj(m[type]);
        out.push({
          kind: "message",
          phoneNumberId,
          from,
          name: names.get(str(m.from)) ?? "",
          id: str(m.id),
          at: isoFromUnix(m.timestamp),
          type,
          text,
          mediaId: str(media.id) || null,
          mimeType: str(media.mime_type) || null,
          context: str(obj(m.context).id) || null,
          optOut: (type === "text" || type === "button" || type === "interactive") && isOptOut(text),
          optIn: (type === "text" || type === "button" || type === "interactive") && isOptIn(text),
        });
      }
      for (const raw of arr(v.statuses)) {
        const s = obj(raw);
        const status = str(s.status);
        if (status !== "sent" && status !== "delivered" && status !== "read" && status !== "failed") continue;
        const pricing = obj(s.pricing);
        const err = obj(arr(s.errors)[0]);
        out.push({
          kind: "status",
          phoneNumberId,
          id: str(s.id),
          status,
          at: isoFromUnix(s.timestamp),
          recipient: toE164(`+${str(s.recipient_id)}`) ?? str(s.recipient_id),
          category: str(pricing.category) || null,
          billable: typeof pricing.billable === "boolean" ? pricing.billable : null,
          errorCode: err.code !== undefined ? Number(err.code) : null,
          errorTitle: str(err.title) || str(err.message) || null,
        });
      }
    }
  return out;
}

/* ───────────────────────── pricing estimate ───────────────────────── */

export type PriceCategory = "marketing" | "utility" | "authentication" | "service";
export type RateCard = Record<Country, Record<PriceCategory, number>>;

/**
 * USD per delivered message — ESTIMATES to start from. Meta charges per delivered template by category and
 * recipient country (since 1 Jul 2025). Egypt marketing ≈ 18× utility; KSA marketing was raised Apr + Oct 2026.
 * From 1 Oct 2026 utility templates inside the 24h window and service messages beyond the 1,000/month free tier
 * are charged too. Replace with the current Meta rate-card CSV in Settings → Messaging.
 */
export const DEFAULT_RATES: RateCard = {
  EG: { marketing: 0.0644, utility: 0.0036, authentication: 0.0036, service: 0 },
  SA: { marketing: 0.0598, utility: 0.0107, authentication: 0.0107, service: 0 },
};

/** micro-USD (integer) for one message */
export function estimateCostMicros(category: PriceCategory, phone: string, rates: RateCard = DEFAULT_RATES, fallback: Country = "EG"): number {
  const c = countryOf(phone);
  const card = rates[c === "other" ? fallback : c] ?? DEFAULT_RATES[fallback];
  return Math.round((card[category] ?? 0) * 1_000_000);
}

/* ───────────────────────── hours ───────────────────────── */

/** minutes since local midnight in a time zone */
export function localMinutes(at: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return (h % 24) * 60 + m;
  } catch {
    return at.getHours() * 60 + at.getMinutes();
  }
}

const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return ((h || 0) % 24) * 60 + (m || 0);
};

/** "12:00"–"01:00" wraps past midnight. Equal open/close = always open. */
export function withinHours(open: string, close: string, minutes: number): boolean {
  const o = hm(open);
  const c = hm(close);
  if (o === c) return true;
  return o < c ? minutes >= o && minutes < c : minutes >= o || minutes < c;
}

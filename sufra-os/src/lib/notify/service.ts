/**
 * MessagingService — the rules around every customer message, on top of the tenant-scoped Db:
 *
 *   conversation per phone · consent (opt-in / opt-out) · 24h window · quiet hours · dedupe · scheduling
 *   → a `messages` row (the log) → the channel adapter from Settings → Messaging → status written back.
 *
 *   const svc = await MessagingService.load(db, env);
 *   await svc.send({ to: "01005551201", template: "order_received", lang: "ar", vars, dedupeKey: `${orderId}:received`, transactional: true });
 *   await svc.send({ conversationId, text: "تمام، الترابيزة محجوزة 👍" });
 *   await svc.ingest(parseWebhook(body));          // local mirror of api/whatsapp-webhook (demo + tests)
 *
 * In cloud mode the server (api/whatsapp-webhook → messaging_ingest_webhook) does `ingest` itself.
 */
import type { Db } from "@/data/hooks";
import type { Branch, Conversation, ConsentSource, Message, MessageCategory, MessagingConsent, Restaurant } from "@/data/types";
import type { Lang } from "@/i18n/i18n";
import { seedId, uuid } from "@/lib/id";
import { estimateCostMicros, localMinutes, nationalFormat, toE164, windowState, withinHours, type WebhookEvent } from "./core";
import { notifierFor, type Notifier, type NotifierEnv, type SendResult } from "./notifier";
import { messagingSettingsOf, type MessagingSettings } from "./settings";
import { priceCategoryOf, renderTemplate, templateById } from "./templates";

export interface SendInput {
  /** either an existing conversation or a phone */
  conversationId?: string;
  to?: string;
  name?: string;
  customerId?: string | null;
  template?: string;
  vars?: Record<string, string | number>;
  text?: string;
  media?: { kind: "image" | "document" | "video"; link: string; caption?: string };
  lang?: Lang;
  dedupeKey?: string;
  orderId?: string | null;
  /** a message about the customer's own order/booking (implied consent for Utility unless opted out) */
  transactional?: boolean;
  /** send later (feedback after N minutes) */
  sendAt?: string | null;
  /** staff member sending (membership id) */
  sentBy?: string | null;
}

export type BlockReason = "opted_out" | "no_consent" | "window_closed" | "messaging_off";

export const AUTO_REPLY_GAP_MS = 12 * 60 * 60 * 1000;

export const OPT_OUT_REPLY = "تم إلغاء اشتراكك في رسايلنا ✅ ابعت «اشتراك» لو حبيت ترجع.\nYou're unsubscribed. Reply START to opt back in.";
export const OPT_IN_REPLY = "أهلاً بيك تاني 💚 هتوصلك رسايلنا من جديد.\nWelcome back — you're subscribed again.";

export class MessagingService {
  readonly notifier: Notifier;
  constructor(
    readonly db: Db,
    readonly settings: MessagingSettings,
    readonly restaurant: Pick<Restaurant, "id" | "name" | "slug" | "timezone" | "country">,
    readonly branch: Pick<Branch, "openingHours"> | null,
    notifier?: Notifier,
    readonly now: () => number = Date.now,
  ) {
    this.notifier = notifier ?? notifierFor(settings);
  }

  static async load(db: Db, env: NotifierEnv = {}, now?: () => number): Promise<MessagingService> {
    const [settingsRow] = await db.list("settings");
    const [restaurant] = await db.list("restaurants");
    const branches = await db.list("branches");
    const branch = branches.find((b) => b.isDefault) ?? branches[0] ?? null;
    const s = messagingSettingsOf(settingsRow);
    const r = restaurant ?? { id: db.restaurantId, name: { ar: "", en: "" }, slug: "", timezone: "Africa/Cairo", country: s.country };
    return new MessagingService(db, { ...s, country: s.country ?? r.country }, r, branch, notifierFor(s, env), now);
  }

  /** same service, another channel (e.g. click-to-chat with a window.open from a click handler) */
  with(notifier: Notifier) {
    return new MessagingService(this.db, this.settings, this.restaurant, this.branch, notifier, this.now);
  }

  private iso(offsetMs = 0) {
    return new Date(this.now() + offsetMs).toISOString();
  }

  /* ───────── conversations & consent ───────── */

  e164(phone: string) {
    const e = toE164(phone, this.settings.country);
    if (!e) throw new Error("bad_phone");
    return e;
  }

  async conversationFor(phone: string, hint: { name?: string; customerId?: string | null } = {}): Promise<Conversation> {
    const e = this.e164(phone);
    const [existing] = await this.db.list("conversations", { where: { phone: e } });
    if (existing) {
      const patch: Partial<Conversation> = {};
      if (!existing.customerId && hint.customerId) patch.customerId = hint.customerId;
      if ((!existing.name || existing.name === existing.phone) && hint.name) patch.name = hint.name;
      return Object.keys(patch).length ? this.db.update("conversations", existing.id, patch) : existing;
    }
    let customerId = hint.customerId ?? null;
    let name = hint.name ?? "";
    if (!customerId) {
      const [c] = await this.db.list("customers", { where: { phone: [nationalFormat(e), e] } });
      if (c) {
        customerId = c.id;
        name ||= c.name;
      }
    }
    return this.db.insert("conversations", {
      id: seedId(`${this.db.restaurantId}:conv:${e}`),
      phone: e, name: name || e, customerId, status: "open", assignedTo: null, unread: 0,
      lastMessageAt: null, lastInboundAt: null, lastPreview: "", lastAutoReplyAt: null, tags: [],
    });
  }

  async consentOf(phone: string): Promise<MessagingConsent | null> {
    const e = toE164(phone, this.settings.country);
    if (!e) return null;
    const [c] = await this.db.list("messagingConsents", { where: { phone: e, channel: "whatsapp" } });
    return c ?? null;
  }

  /** consent register row, else the CRM flag on the customer (customer.consent.whatsapp — 0009_crm) as an implied opt-in */
  async effectiveConsent(conv: Pick<Conversation, "phone" | "customerId">): Promise<MessagingConsent | null> {
    const row = await this.consentOf(conv.phone);
    if (row || !conv.customerId) return row;
    const cu = await this.db.get("customers", conv.customerId);
    const flag = (cu as { consent?: { whatsapp?: boolean; at?: string | null } } | null)?.consent;
    if (!flag?.whatsapp) return null;
    const at = flag.at ?? this.iso();
    return { id: "crm", restaurantId: this.db.restaurantId, createdAt: at, updatedAt: at, phone: conv.phone, customerId: conv.customerId, channel: "whatsapp", status: "opted_in", source: "import", wording: "", capturedAt: at, capturedBy: null, history: [] };
  }

  /** keeps the CRM's customer.consent.whatsapp flag in step with the register */
  private async syncCustomer(customerId: string | null, status: "opted_in" | "opted_out", source: ConsentSource, at: string) {
    if (!customerId) return;
    try {
      const cu = await this.db.get("customers", customerId);
      if (!cu) return;
      const prev = (cu as { consent?: Record<string, unknown> }).consent ?? { whatsapp: false, sms: false, email: false, push: false };
      await this.db.update("customers", customerId, { consent: { ...prev, whatsapp: status === "opted_in", at, via: source } } as never);
    } catch {
      /* CRM columns not migrated yet */
    }
  }

  async recordConsent(input: { phone: string; status: "opted_in" | "opted_out"; source: ConsentSource; wording?: string; customerId?: string | null; by?: string | null }): Promise<MessagingConsent> {
    const row = await this.writeConsent(input);
    await this.syncCustomer(row.customerId, row.status, row.source, row.capturedAt);
    return row;
  }

  private async writeConsent(input: { phone: string; status: "opted_in" | "opted_out"; source: ConsentSource; wording?: string; customerId?: string | null; by?: string | null }): Promise<MessagingConsent> {
    const e = this.e164(input.phone);
    const at = this.iso();
    const prev = await this.consentOf(e);
    const entry = { status: input.status, source: input.source, at };
    if (prev) {
      return this.db.update("messagingConsents", prev.id, {
        status: input.status, source: input.source, wording: input.wording ?? prev.wording, capturedAt: at, capturedBy: input.by ?? null,
        customerId: prev.customerId ?? input.customerId ?? null, history: [...prev.history, entry].slice(-50),
      });
    }
    let customerId = input.customerId ?? null;
    if (!customerId) customerId = (await this.db.list("customers", { where: { phone: [nationalFormat(e), e] } }))[0]?.id ?? null;
    return this.db.insert("messagingConsents", {
      id: seedId(`${this.db.restaurantId}:consent:whatsapp:${e}`),
      phone: e, customerId, channel: "whatsapp", status: input.status, source: input.source, wording: input.wording ?? "", capturedAt: at, capturedBy: input.by ?? null, history: [entry],
    });
  }

  /**
   * Can we send this? Opted out → never. Marketing → explicit opt-in. Utility/authentication → opt-in or the
   * customer's own transaction. Free-form text/media through the Cloud API → only inside the 24h window.
   */
  policy(x: { category: MessageCategory; consent: MessagingConsent | null; conversation: Conversation | null; transactional?: boolean }): { ok: true } | { ok: false; reason: BlockReason } {
    if (this.settings.mode === "off") return { ok: false, reason: "messaging_off" };
    if (x.consent?.status === "opted_out") return { ok: false, reason: "opted_out" };
    if (x.category === "marketing" && x.consent?.status !== "opted_in") return { ok: false, reason: "no_consent" };
    if ((x.category === "utility" || x.category === "authentication") && x.consent?.status !== "opted_in" && !x.transactional) return { ok: false, reason: "no_consent" };
    if (x.category === "service" && this.notifier.automatic && this.notifier.channel === "whatsapp" && !windowState(x.conversation?.lastInboundAt, this.now()).open) return { ok: false, reason: "window_closed" };
    return { ok: true };
  }

  /** local minutes in the restaurant's time zone */
  private minutesNow() {
    return localMinutes(new Date(this.now()), this.restaurant.timezone || "Africa/Cairo");
  }

  inQuietHours(): boolean {
    const q = this.settings.quietHours;
    return q.enabled && withinHours(q.start, q.end, this.minutesNow());
  }

  /** when quiet hours end (for postponing marketing) */
  private quietEndIso(): string {
    const [h, m] = this.settings.quietHours.end.split(":").map(Number);
    const target = (h || 0) * 60 + (m || 0);
    const diff = (target - this.minutesNow() + 1440) % 1440;
    return this.iso(diff * 60_000);
  }

  isOpenNow(): boolean {
    const bh = this.settings.businessHours;
    const hours = bh.useBranchHours && this.branch?.openingHours ? this.branch.openingHours : { open: bh.open, close: bh.close };
    return withinHours(hours.open, hours.close, this.minutesNow());
  }

  /* ───────── sending ───────── */

  /** Records the message and sends it (or schedules / parks it). Never throws for policy blocks — the row says why. */
  async send(input: SendInput): Promise<Message> {
    const lang: Lang = input.lang ?? "ar";
    if (input.dedupeKey) {
      const [dupe] = await this.db.list("messages", { where: { dedupeKey: input.dedupeKey } });
      if (dupe) return dupe;
    }
    const conv = input.conversationId ? await this.db.get("conversations", input.conversationId) : await this.conversationFor(input.to ?? "", { name: input.name, customerId: input.customerId });
    if (!conv) throw new Error("no_conversation");
    const tpl = input.template ? templateById(input.template) : null;
    if (input.template && !tpl) throw new Error("unknown_template");
    const body = tpl ? renderTemplate(tpl.id, lang, input.vars ?? {}) : input.text ? input.text.trim() : [input.media?.caption, input.media?.link].filter(Boolean).join("\n");
    if (!body) throw new Error("empty_message");
    const category: MessageCategory = tpl ? priceCategoryOf(tpl.category) : "service";
    const consent = await this.effectiveConsent(conv);
    const verdict = this.policy({ category, consent, conversation: conv, transactional: input.transactional });

    let sendAt = input.sendAt && Date.parse(input.sendAt) > this.now() ? input.sendAt : null;
    if (!sendAt && category === "marketing" && this.inQuietHours()) sendAt = this.quietEndIso();

    const channel = this.notifier.channel;
    const row = await this.db.insert("messages", {
      id: input.dedupeKey ? seedId(`${this.db.restaurantId}:msg:${input.dedupeKey}`) : uuid(),
      conversationId: conv.id,
      direction: "out",
      channel,
      kind: tpl ? "template" : input.media ? "media" : "text",
      template: tpl?.id ?? null,
      lang,
      category,
      body,
      params: Object.fromEntries(Object.entries(input.vars ?? {}).map(([k, v]) => [k, String(v)])),
      media: input.media ?? null,
      status: verdict.ok ? (sendAt ? "scheduled" : "queued") : "skipped",
      providerId: null,
      error: verdict.ok ? null : verdict.reason,
      sentBy: input.sentBy ?? this.db.actorId ?? null,
      sendAt,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      orderId: input.orderId ?? null,
      dedupeKey: input.dedupeKey ?? null,
      costMicros: channel === "whatsapp" && verdict.ok ? estimateCostMicros(category, conv.phone, this.settings.rates, this.settings.country) : 0,
    });
    if (!verdict.ok || sendAt) return row;
    return this.dispatch(row, conv);
  }

  /** Hands a queued/scheduled row to the channel and writes the outcome back. */
  async dispatch(row: Message, conv?: Conversation | null): Promise<Message> {
    const c = conv ?? (await this.db.get("conversations", row.conversationId));
    if (!c) return this.db.update("messages", row.id, { status: "failed", error: "no_conversation" });
    let r: SendResult;
    try {
      const base = { restaurantId: this.db.restaurantId, to: c.phone, messageId: row.id };
      r =
        row.kind === "template" && row.template
          ? await this.notifier.sendTemplate({ ...base, template: row.template, lang: row.lang, vars: row.params })
          : row.media
            ? await this.notifier.sendMedia({ ...base, kind: row.media.kind, link: row.media.link, caption: row.media.caption })
            : await this.notifier.sendText({ ...base, text: row.body });
    } catch (e) {
      r = { ok: false, status: "failed", error: (e as Error).message };
    }
    const at = this.iso();
    const patch: Partial<Message> = r.ok
      ? { status: r.status, providerId: r.providerId ?? row.providerId, sentAt: r.status === "pending_tap" ? null : at, error: null, channel: this.notifier.channel }
      : { status: r.status, error: r.hint ? `${r.error}: ${r.hint.en}` : r.error };
    const updated = await this.db.update("messages", row.id, patch);
    await this.db.update("conversations", c.id, { lastMessageAt: at, lastPreview: row.body.slice(0, 120) });
    return updated;
  }

  /** Staff tapped "send" in WhatsApp for a click-to-chat message. */
  async markOpened(messageId: string) {
    return this.db.update("messages", messageId, { status: "opened", sentAt: this.iso(), error: null });
  }

  /** Sends every scheduled message that is due (feedback requests, postponed marketing). */
  async flushDue(): Promise<number> {
    const due = await this.db.list("messages", { where: { status: "scheduled" }, lte: { sendAt: this.iso() }, limit: 50 });
    let n = 0;
    for (const m of due) {
      if (m.category === "marketing" && this.inQuietHours()) continue;
      const c = await this.db.get("conversations", m.conversationId);
      const consent = c ? await this.effectiveConsent(c) : null;
      const verdict = this.policy({ category: m.category ?? "service", consent, conversation: c, transactional: !!m.orderId });
      if (!verdict.ok) {
        await this.db.update("messages", m.id, { status: "skipped", error: verdict.reason });
        continue;
      }
      await this.dispatch({ ...m, status: "queued" }, c);
      n++;
    }
    return n;
  }

  /* ───────── conversation actions ───────── */

  markRead(conversationId: string) {
    return this.db.update("conversations", conversationId, { unread: 0 });
  }
  assign(conversationId: string, membershipId: string | null) {
    return this.db.update("conversations", conversationId, { assignedTo: membershipId });
  }
  setStatus(conversationId: string, status: Conversation["status"]) {
    return this.db.update("conversations", conversationId, { status, ...(status === "closed" ? { unread: 0 } : {}) });
  }

  /* ───────── inbound (webhook mirror) ───────── */

  /**
   * Applies webhook events: inbound messages open/refresh the 24h window and bump unread; STOP/وقف opts out
   * (and confirms); START opts back in; outside business hours an auto-reply goes once per 12h; statuses update
   * the matching outbound row. Same behaviour as messaging_ingest_webhook() in 0007_messaging.sql.
   */
  async ingest(events: WebhookEvent[]): Promise<{ messages: number; statuses: number; replies: Message[] }> {
    let messages = 0;
    let statuses = 0;
    const replies: Message[] = [];
    for (const ev of events) {
      if (ev.kind === "status") {
        const [m] = await this.db.list("messages", { where: { providerId: ev.id } });
        if (!m) continue;
        const rank = { queued: 0, scheduled: 0, pending_tap: 0, opened: 1, sent: 1, delivered: 2, read: 3, failed: 4, received: 0, skipped: 0 } as const;
        if (ev.status !== "failed" && rank[ev.status] <= rank[m.status]) continue;
        await this.db.update("messages", m.id, {
          status: ev.status,
          ...(ev.status === "delivered" ? { deliveredAt: ev.at } : ev.status === "read" ? { readAt: ev.at, deliveredAt: m.deliveredAt ?? ev.at } : ev.status === "sent" ? { sentAt: m.sentAt ?? ev.at } : {}),
          ...(ev.status === "failed" ? { error: [ev.errorCode, ev.errorTitle].filter(Boolean).join(" ") || "failed" } : {}),
        });
        statuses++;
        continue;
      }
      if ((await this.db.list("messages", { where: { providerId: ev.id } })).length) continue; // webhook retries
      const conv = await this.conversationFor(ev.from, { name: ev.name });
      await this.db.insert("messages", {
        conversationId: conv.id, direction: "in", channel: "whatsapp", kind: ev.type === "text" ? "text" : ev.type === "button" || ev.type === "interactive" ? "interactive" : "media",
        template: null, lang: /[؀-ۿ]/.test(ev.text) ? "ar" : "en", category: null, body: ev.text || `[${ev.type}]`, params: {},
        media: null, status: "received", providerId: ev.id, error: null, sentBy: null, sendAt: null, sentAt: ev.at, deliveredAt: null, readAt: null,
        orderId: null, dedupeKey: null, costMicros: 0, createdAt: ev.at,
      });
      messages++;
      const fresh = await this.db.update("conversations", conv.id, {
        lastInboundAt: ev.at, lastMessageAt: ev.at, lastPreview: (ev.text || `[${ev.type}]`).slice(0, 120), unread: conv.unread + 1, status: "open",
        name: conv.name === conv.phone && ev.name ? ev.name : conv.name,
      });
      if (ev.optOut || ev.optIn) {
        await this.recordConsent({ phone: ev.from, status: ev.optOut ? "opted_out" : "opted_in", source: "inbound_keyword", wording: ev.text });
        replies.push(await this.systemReply(fresh, ev.optOut ? OPT_OUT_REPLY : OPT_IN_REPLY));
        continue;
      }
      const bh = this.settings.businessHours;
      const recent = conv.lastAutoReplyAt && this.now() - Date.parse(conv.lastAutoReplyAt) < AUTO_REPLY_GAP_MS;
      if (bh.enabled && !this.isOpenNow() && !recent && this.notifier.automatic && this.settings.mode !== "off") {
        await this.db.update("conversations", conv.id, { lastAutoReplyAt: this.iso() });
        replies.push(await this.systemReply(fresh, /[؀-ۿ]/.test(ev.text) || !ev.text ? bh.reply.ar : bh.reply.en));
      }
    }
    return { messages, statuses, replies };
  }

  /** an automatic reply inside the window (opt-out confirmation, closed-hours note) */
  private async systemReply(conv: Conversation, text: string): Promise<Message> {
    const row = await this.db.insert("messages", {
      conversationId: conv.id, direction: "out", channel: this.notifier.channel, kind: "system", template: null, lang: "ar", category: "service",
      body: text, params: {}, media: null, status: "queued", providerId: null, error: null, sentBy: null, sendAt: null, sentAt: null,
      deliveredAt: null, readAt: null, orderId: null, dedupeKey: null, costMicros: 0,
    });
    if (!this.notifier.automatic || this.settings.mode === "off") return this.db.update("messages", row.id, { status: "skipped", error: "manual_channel" });
    return this.dispatch(row, conv);
  }
}

/** feedback link for an order (guest tracking page shows the rating card when the order is finished) */
export function rateLink(slug: string, orderId: string, origin?: string) {
  const base = origin ?? (typeof window !== "undefined" ? `${window.location.origin}${import.meta.env?.BASE_URL ?? "/app/"}` : "https://sufra-planet-crm.vercel.app/app/");
  return `${base.replace(/\/?$/, "/")}r/${slug}/o/${orderId}#rate`;
}

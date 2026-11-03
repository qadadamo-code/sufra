import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "@/data/local/LocalAdapter";
import { DEMO_RESTAURANT_ID } from "@/data/seed";
import { makeDb } from "@/data/hooks";
import { ClickToChatNotifier, LogNotifierAdapter, WhatsAppCloudNotifier, notifierFor, type Notifier, type SendResult } from "./notifier";
import { MessagingService } from "./service";
import { DEFAULT_MESSAGING, messagingSettingsOf } from "./settings";
import { parseWebhook } from "./core";

let n = 0;
const open: LocalAdapter[] = [];
afterEach(() => {
  while (open.length) open.pop()!.close();
});

/** records every call, answers like the Cloud API */
class FakeCloud implements Notifier {
  readonly channel = "whatsapp" as const;
  readonly automatic = true;
  calls: { kind: string; to: string; body?: unknown }[] = [];
  async sendTemplate(m: { to: string; template: string }): Promise<SendResult> {
    this.calls.push({ kind: "template", to: m.to, body: m.template });
    return { ok: true, status: "sent", providerId: `wamid.${this.calls.length}` };
  }
  async sendText(m: { to: string; text: string }): Promise<SendResult> {
    this.calls.push({ kind: "text", to: m.to, body: m.text });
    return { ok: true, status: "sent", providerId: `wamid.${this.calls.length}` };
  }
  async sendMedia(m: { to: string }): Promise<SendResult> {
    this.calls.push({ kind: "media", to: m.to });
    return { ok: true, status: "sent", providerId: `wamid.${this.calls.length}` };
  }
}

// 2026-11-03 14:00 Cairo (open: 12:00–01:00); quiet hours 23:00–10:00
const NOON = Date.parse("2026-11-03T12:00:00Z");

async function setup(mode: "cloud" | "click_to_chat" = "cloud", now = NOON) {
  const repo = new LocalAdapter({ name: `msg${++n}`, sessionKey: `msg${n}.s` });
  open.push(repo);
  await repo.ready();
  const db = makeDb(repo, DEMO_RESTAURANT_ID, null, "staff-1");
  const fake = new FakeCloud();
  const base = await MessagingService.load(db);
  const svc = new MessagingService(db, { ...base.settings, mode }, base.restaurant, base.branch, mode === "cloud" ? fake : new ClickToChatNotifier(), () => now);
  return { repo, db, svc, fake };
}

describe("MessagingService", () => {
  it("demo seed has an inbox with an opted-out customer", async () => {
    const { db } = await setup();
    expect((await db.list("conversations")).length).toBeGreaterThanOrEqual(4);
    const rana = await db.list("messagingConsents", { where: { phone: "+201005551209" } });
    expect(rana[0].status).toBe("opted_out");
  });

  it("utility order messages: transactional consent is enough; dedupe per order+stage; cost estimated", async () => {
    const { svc, fake, db } = await setup();
    const vars = { name: "مريم", number: 7, restaurant: "سُفرة", items: "١× كفتة", total: "120 ج.م", payment: "كاش", link: "https://sufra-planet-crm.vercel.app/app/r/x/o/1" };
    const m = await svc.send({ to: "01005551205", template: "order_received", lang: "ar", vars, dedupeKey: "o1:received", transactional: true, orderId: null });
    expect(m).toMatchObject({ status: "sent", providerId: "wamid.1", category: "utility", costMicros: 3600, channel: "whatsapp" });
    expect(m.body).toContain("مريم");
    const again = await svc.send({ to: "01005551205", template: "order_received", lang: "ar", vars, dedupeKey: "o1:received", transactional: true });
    expect(again.id).toBe(m.id);
    expect(fake.calls).toHaveLength(1);
    const conv = (await db.list("conversations", { where: { phone: "+201005551205" } }))[0];
    expect(conv.customerId).toBeTruthy(); // linked to the seeded customer by phone
    expect(conv.lastPreview).toContain("مريم");
  });

  it("opted-out customers never get messages; marketing needs an explicit opt-in", async () => {
    const { svc, fake } = await setup();
    const out = await svc.send({ to: "01005551209", template: "order_delayed", lang: "ar", vars: { name: "رنا", number: 3, eta: "21:00", reason: "x" }, transactional: true });
    expect(out).toMatchObject({ status: "skipped", error: "opted_out" });
    const promo = { name: "Mariam", offer: "20% off", restaurant: "Sufra", code: "X", until: "Fri", link: "https://sufra-planet-crm.vercel.app/app/r/x" };
    expect(await svc.send({ to: "01005551205", template: "win_back_offer", lang: "en", vars: promo })).toMatchObject({ status: "skipped", error: "no_consent" });
    expect(await svc.send({ to: "01005551201", template: "win_back_offer", lang: "en", vars: promo })).toMatchObject({ status: "sent", category: "marketing", costMicros: 64400 });
    expect(fake.calls).toHaveLength(1);
  });

  it("free text through the Cloud API only inside the 24h window", async () => {
    const { svc, db } = await setup();
    const omar = (await db.list("conversations", { where: { phone: "+201005551202" } }))[0]; // last wrote 3h before the demo seed "now"
    const closed = await svc.with(new FakeCloud()).send({ conversationId: omar.id, text: "تمام" });
    expect(closed.status === "sent" || closed.error === "window_closed").toBe(true);
    await db.update("conversations", omar.id, { lastInboundAt: new Date(NOON - 25 * 3600_000).toISOString() });
    expect(await svc.send({ conversationId: omar.id, text: "تمام" })).toMatchObject({ status: "skipped", error: "window_closed" });
    await db.update("conversations", omar.id, { lastInboundAt: new Date(NOON - 3600_000).toISOString() });
    expect(await svc.send({ conversationId: omar.id, text: "تمام" })).toMatchObject({ status: "sent", category: "service", costMicros: 0 });
  });

  it("click-to-chat: no window rule, message waits for a tap, then opened", async () => {
    const { svc, db } = await setup("click_to_chat");
    const omar = (await db.list("conversations", { where: { phone: "+201005551202" } }))[0];
    await db.update("conversations", omar.id, { lastInboundAt: null });
    const m = await svc.send({ conversationId: omar.id, text: "منيو النهارده" });
    expect(m).toMatchObject({ status: "pending_tap", channel: "click_to_chat", costMicros: 0 });
    const opened: string[] = [];
    const m2 = await svc.with(new ClickToChatNotifier({ open: (u) => opened.push(u) })).send({ conversationId: omar.id, text: "hi" });
    expect(m2.status).toBe("opened");
    expect(opened[0]).toBe("https://wa.me/201005551202?text=hi");
    expect((await svc.markOpened(m.id)).status).toBe("opened");
  });

  it("feedback is scheduled and sent when due; marketing waits for quiet hours to end", async () => {
    const { db, fake } = await setup();
    let now = NOON;
    const base = await MessagingService.load(db);
    const svc = new MessagingService(db, { ...base.settings, mode: "cloud" }, base.restaurant, base.branch, fake, () => now);
    const fb = await svc.send({ to: "01005551208", template: "feedback_request", lang: "ar", vars: { name: "أسامة", restaurant: "سُفرة", number: 12, rate_link: "https://sufra-planet-crm.vercel.app/app/r/x/o/1#rate" }, dedupeKey: "d1:feedback", transactional: true, sendAt: new Date(now + 45 * 60_000).toISOString() });
    expect(fb.status).toBe("scheduled");
    expect(await svc.flushDue()).toBe(0);
    now += 46 * 60_000;
    expect(await svc.flushDue()).toBe(1);
    expect((await db.get("messages", fb.id))!.status).toBe("sent");

    now = Date.parse("2026-11-03T22:30:00Z"); // 00:30 Cairo → quiet
    const promo = { name: "Dina", offer: "x", restaurant: "Sufra", code: "X", until: "Fri", link: "https://sufra-planet-crm.vercel.app/app/r/x" };
    const late = await svc.send({ to: "01005551201", template: "win_back_offer", lang: "en", vars: promo });
    expect(late.status).toBe("scheduled");
    expect(new Date(late.sendAt!).toISOString()).toBe("2026-11-04T08:00:00.000Z"); // 10:00 Cairo
  });

  it("ingest: inbound opens the window, bumps unread, STOP opts out with a confirmation, statuses advance", async () => {
    const { svc, db, fake } = await setup();
    const hook = (messages: unknown[], statuses: unknown[] = []) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PN1" }, contacts: [{ wa_id: "201005551299", profile: { name: "Karim" } }], messages, statuses } }] }] });
    const ts = String(NOON / 1000);
    const r1 = await svc.ingest(parseWebhook(hook([{ from: "201005551299", id: "w1", timestamp: ts, type: "text", text: { body: "عندكم كشري؟" } }])));
    expect(r1).toMatchObject({ messages: 1, replies: [] }); // open hours → no auto-reply
    const conv = (await db.list("conversations", { where: { phone: "+201005551299" } }))[0];
    expect(conv).toMatchObject({ name: "Karim", unread: 1, lastInboundAt: new Date(NOON).toISOString() });
    await svc.ingest(parseWebhook(hook([{ from: "201005551299", id: "w1", timestamp: ts, type: "text", text: { body: "dup" } }])));
    expect((await db.list("messages", { where: { conversationId: conv.id } })).length).toBe(1);

    const r2 = await svc.ingest(parseWebhook(hook([{ from: "201005551299", id: "w2", timestamp: ts, type: "text", text: { body: "وقف" } }])));
    expect((await svc.consentOf("01005551299"))!.status).toBe("opted_out");
    expect(r2.replies[0].body).toContain("إلغاء");
    expect(fake.calls.at(-1)).toMatchObject({ kind: "text", to: "+201005551299" });

    const sent = await svc.send({ to: "01005551201", template: "order_delayed", lang: "ar", vars: { name: "دينا", number: 4, eta: "21:00", reason: "x" }, transactional: true });
    await svc.ingest(parseWebhook(hook([], [{ id: sent.providerId, status: "read", timestamp: ts, recipient_id: "201005551201" }])));
    await svc.ingest(parseWebhook(hook([], [{ id: sent.providerId, status: "delivered", timestamp: ts, recipient_id: "201005551201" }])));
    expect((await db.get("messages", sent.id))!.status).toBe("read");
  });

  it("closed hours: one auto-reply per 12h (automatic channels only)", async () => {
    const at = Date.parse("2026-11-03T05:00:00Z"); // 07:00 Cairo, closed
    const { svc } = await setup("cloud", at);
    const hook = (id: string) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PN1" }, messages: [{ from: "201005551288", id, timestamp: String(at / 1000), type: "text", text: { body: "صباح الخير" } }] } }] }] });
    expect((await svc.ingest(parseWebhook(hook("a")))).replies).toHaveLength(1);
    expect((await svc.ingest(parseWebhook(hook("b")))).replies).toHaveLength(0);
    const { svc: c2c } = await setup("click_to_chat", at);
    expect((await c2c.ingest(parseWebhook(hook("c")))).replies).toHaveLength(0);
  });

  it("consent capture keeps a history", async () => {
    const { svc } = await setup();
    await svc.recordConsent({ phone: "0551234567", status: "opted_in", source: "online_checkout", wording: "send me order updates" });
    const c = await svc.recordConsent({ phone: "+966551234567", status: "opted_out", source: "staff" });
    expect(c.history.map((h) => h.status)).toEqual(["opted_in", "opted_out"]);
    expect(c.wording).toBe("send me order updates");
  });
});

describe("notifier registry", () => {
  it("picks the adapter from the mode", () => {
    expect(notifierFor({ ...DEFAULT_MESSAGING, mode: "click_to_chat" })).toBeInstanceOf(ClickToChatNotifier);
    expect(notifierFor({ ...DEFAULT_MESSAGING, mode: "cloud" })).toBeInstanceOf(WhatsAppCloudNotifier);
    expect(notifierFor({ ...DEFAULT_MESSAGING, mode: "bsp", bsp: "360dialog" })).toBeInstanceOf(WhatsAppCloudNotifier);
    expect(notifierFor({ ...DEFAULT_MESSAGING, mode: "bsp", bsp: "unifonic" }).automatic).toBe(true);
    expect(notifierFor({ ...DEFAULT_MESSAGING, mode: "off" }).channel).toBe("log");
    expect(new LogNotifierAdapter().channel).toBe("log");
  });
  it("cloud notifier posts to our function with auth and explains a 501", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const n = new WhatsAppCloudNotifier({
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ error: "not_configured" }), { status: 501 });
      }) as unknown as typeof fetch,
      auth: async () => ({ authorization: "Bearer jwt" }),
    });
    const r = await n.sendTemplate({ restaurantId: "r", to: "01005551201", template: "order_delayed", lang: "ar", vars: { name: "x", number: 1, eta: "21:00", reason: "y" } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.hint?.en).toMatch(/setup guide/);
    expect(calls[0].url).toBe("/api/whatsapp-send");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer jwt");
    expect(JSON.parse(String(calls[0].init.body)).template).toMatchObject({ name: "order_delayed", lang: "ar", params: ["x", "1", "21:00", "y"] });
  });
  it("settings defaults fill partial rows", () => {
    const s = messagingSettingsOf({ messaging: { mode: "cloud", feedback: { delayMin: 10 } } as never });
    expect(s.mode).toBe("cloud");
    expect(s.feedback).toMatchObject({ enabled: true, delayMin: 10 });
    expect(s.rates.EG.utility).toBeGreaterThan(0);
    expect(messagingSettingsOf(null).mode).toBe("click_to_chat");
  });
});

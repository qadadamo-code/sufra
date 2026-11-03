import { describe, expect, it } from "vitest";
import {
  buildSendPayload, clickToChatUrl, estimateCostMicros, isOptIn, isOptOut, localMinutes, nationalFormat, parseWebhook, sanitizeParam, toE164, toPositional,
  validateSendRequest, waDigits, windowState, withinHours, WINDOW_MS,
} from "./core";

describe("phone numbers", () => {
  it("Egyptian mobiles 01xxxxxxxxx → +20…", () => {
    expect(toE164("01005551201")).toBe("+201005551201");
    expect(toE164("010 0555 1201")).toBe("+201005551201");
    expect(toE164("0122-555-0000")).toBe("+201225550000");
    expect(toE164("٠١٠٠٥٥٥١٢٠١")).toBe("+201005551201");
    expect(toE164("+20 100 555 1201")).toBe("+201005551201");
    expect(toE164("00201005551201")).toBe("+201005551201");
    expect(toE164("201005551201")).toBe("+201005551201");
    expect(toE164("+2001005551201")).toBe("+201005551201");
    expect(toE164("1005551201")).toBe("+201005551201");
  });
  it("Saudi mobiles 05xxxxxxxx → +966…", () => {
    expect(toE164("0551234567")).toBe("+966551234567");
    expect(toE164("055 123 4567")).toBe("+966551234567");
    expect(toE164("+966 55 123 4567")).toBe("+966551234567");
    expect(toE164("00966551234567")).toBe("+966551234567");
    expect(toE164("9660551234567")).toBe("+966551234567");
    expect(toE164("551234567", "SA")).toBe("+966551234567");
    expect(toE164("551234567", "EG")).toBeNull();
  });
  it("rejects landlines and junk; keeps explicit international numbers", () => {
    expect(toE164("0227350000")).toBeNull();
    expect(toE164("12345")).toBeNull();
    expect(toE164("")).toBeNull();
    expect(toE164(null)).toBeNull();
    expect(toE164("+44 7700 900123")).toBe("+447700900123");
    expect(toE164("447700900123")).toBeNull();
  });
  it("formats back", () => {
    expect(nationalFormat("+201005551201")).toBe("01005551201");
    expect(nationalFormat("+966551234567")).toBe("0551234567");
    expect(waDigits("+201005551201")).toBe("201005551201");
  });
});

describe("click to chat", () => {
  it("builds wa.me links with the prefilled text encoded", () => {
    const u = clickToChatUrl("01005551201", "أهلاً دينا 👋\nطلبك #42 & جاهز");
    expect(u.startsWith("https://wa.me/201005551201?text=")).toBe(true);
    expect(decodeURIComponent(u.split("?text=")[1])).toBe("أهلاً دينا 👋\nطلبك #42 & جاهز");
    expect(u).not.toMatch(/[\s#&](?!.*text=)/);
    expect(clickToChatUrl("0551234567", "hi")).toBe("https://wa.me/966551234567?text=hi");
  });
  it("without a valid number WhatsApp asks which chat", () => {
    expect(clickToChatUrl("", "hi")).toBe("https://wa.me/?text=hi");
    expect(clickToChatUrl("123", "hi")).toBe("https://wa.me/?text=hi");
  });
});

describe("24h customer service window", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");
  it("is closed when the customer never wrote", () => {
    expect(windowState(null, now)).toMatchObject({ open: false, expiresAt: null });
  });
  it("opens for 24h after the last inbound message", () => {
    const w = windowState(new Date(now - 60 * 60_000).toISOString(), now);
    expect(w.open).toBe(true);
    expect(w.msLeft).toBe(WINDOW_MS - 60 * 60_000);
    expect(w.closingSoon).toBe(false);
    expect(w.expiresAt).toBe(new Date(now - 60 * 60_000 + WINDOW_MS).toISOString());
  });
  it("is closing soon in the last 2 hours and closed after 24h", () => {
    expect(windowState(new Date(now - 23 * 3600_000).toISOString(), now)).toMatchObject({ open: true, closingSoon: true });
    expect(windowState(new Date(now - WINDOW_MS).toISOString(), now).open).toBe(false);
    expect(windowState(new Date(now - WINDOW_MS - 1).toISOString(), now).open).toBe(false);
    expect(windowState("not a date", now).open).toBe(false);
  });
});

describe("opt-out keywords", () => {
  it("matches the whole message in Arabic and English", () => {
    for (const s of ["STOP", "stop", " Stop! ", "إلغاء", "الغاء", "وقف", "وقف.", "إيقاف", "UNSUBSCRIBE", "الغاء الاشتراك", "إلْغَاء"]) expect(isOptOut(s), s).toBe(true);
    for (const s of ["I'll stop by at 8", "ممكن إلغاء الطلب؟", "وقفت عند الباب", "", "stopp"]) expect(isOptOut(s), s).toBe(false);
    expect(isOptIn("START")).toBe(true);
    expect(isOptIn("اشتراك")).toBe(true);
    expect(isOptIn("start my order")).toBe(false);
  });
});

describe("template params & Meta payload", () => {
  it("sanitizes params by Meta rules", () => {
    expect(sanitizeParam("a\nb\t\tc")).toBe("a b c");
    expect(sanitizeParam("x      y")).toBe("x   y");
    expect(sanitizeParam(42)).toBe("42");
    expect(() => sanitizeParam("  ")).toThrow("empty_param");
    expect(sanitizeParam("z".repeat(2000))).toHaveLength(1024);
  });
  it("maps named placeholders to positional ones", () => {
    const r = toPositional("Hi {{name}}, order #{{number}} — {{name}}", { name: "Dina", number: 42 });
    expect(r.body).toBe("Hi {{1}}, order #{{2}} — {{1}}");
    expect(r.params).toEqual(["Dina", "42"]);
    expect(() => toPositional("Hi {{name}}", {})).toThrow(/missing_vars:name/);
  });
  it("builds a template message", () => {
    const p = buildSendPayload({ to: "+201005551201", template: { name: "order_received", lang: "ar", params: ["دينا", "42"], buttonParams: ["r/x/o/1"] } });
    expect(p).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "201005551201",
      type: "template",
      template: {
        name: "order_received",
        language: { code: "ar" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "دينا" }, { type: "text", text: "42" }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "r/x/o/1" }] },
        ],
      },
    });
    const bare = buildSendPayload({ to: "+201005551201", template: { name: "hello_world", lang: "en_US" } });
    expect((bare.template as Record<string, unknown>).components).toBeUndefined();
  });
  it("builds text and media messages", () => {
    expect(buildSendPayload({ to: "+966551234567", text: "see https://x.test" })).toMatchObject({ to: "966551234567", type: "text", text: { body: "see https://x.test", preview_url: true } });
    expect(buildSendPayload({ to: "+966551234567", media: { kind: "image", link: "https://x.test/a.jpg", caption: "Kofta" } })).toMatchObject({ type: "image", image: { link: "https://x.test/a.jpg", caption: "Kofta" } });
    expect(buildSendPayload({ to: "+966551234567", media: { kind: "document", link: "https://x.test/menu.pdf", filename: "menu.pdf" } })).toMatchObject({ type: "document", document: { filename: "menu.pdf" } });
  });
  it("validates untrusted send requests", () => {
    const ok = validateSendRequest({ restaurantId: "6f1b0c1e-0000-4000-8000-000000000001", to: "01005551201", text: "hi" });
    expect(ok.ok && ok.value.to).toBe("+201005551201");
    const bad = (b: unknown) => (validateSendRequest(b) as { error?: string }).error;
    expect(bad(null)).toBe("bad_json");
    expect(bad({ restaurantId: "x", to: "01005551201", text: "hi" })).toBe("bad_restaurant");
    expect(bad({ restaurantId: "6f1b0c1e-0000", to: "123", text: "hi" })).toBe("bad_phone");
    expect(bad({ restaurantId: "6f1b0c1e-0000", to: "01005551201", text: "hi", template: { name: "a", lang: "ar" } })).toBe("one_of_template_text_media");
    expect(bad({ restaurantId: "6f1b0c1e-0000", to: "01005551201", template: { name: "Bad Name", lang: "ar" } })).toBe("bad_template_name");
    expect(bad({ restaurantId: "6f1b0c1e-0000", to: "01005551201", template: { name: "ok", lang: "arabic" } })).toBe("bad_lang");
    expect(bad({ restaurantId: "6f1b0c1e-0000", to: "01005551201", template: { name: "ok", lang: "ar", params: ["", "x"] } })).toBe("empty_param");
    expect(bad({ restaurantId: "6f1b0c1e-0000", to: "01005551201", template: { name: "ok", lang: "ar", params: "x" } })).toBe("bad_params");
    expect(bad({ restaurantId: "6f1b0c1e-0000", to: "01005551201", media: { kind: "image", link: "http://insecure" } })).toBe("bad_media_link");
    expect(bad({ restaurantId: "6f1b0c1e-0000", to: "01005551201", text: "x".repeat(5000) })).toBe("bad_text");
    const sa = validateSendRequest({ restaurantId: "6f1b0c1e-0000", to: "551234567", country: "SA", template: { name: "ok", lang: "ar", params: ["a\nb"] } });
    expect(sa.ok && sa.value.to).toBe("+966551234567");
    expect(sa.ok && sa.value.template?.params).toEqual(["a b"]);
  });
});

const hook = (value: Record<string, unknown>) => ({ object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "201000000000", phone_number_id: "PN1" }, ...value } }] }] });

describe("webhook parsing", () => {
  it("parses an inbound text with the contact name", () => {
    const ev = parseWebhook(hook({ contacts: [{ profile: { name: "Dina" }, wa_id: "201005551201" }], messages: [{ from: "201005551201", id: "wamid.1", timestamp: "1762171200", type: "text", text: { body: "عايزة أحجز" } }] }));
    expect(ev).toEqual([
      { kind: "message", phoneNumberId: "PN1", from: "+201005551201", name: "Dina", id: "wamid.1", at: "2025-11-03T12:00:00.000Z", type: "text", text: "عايزة أحجز", mediaId: null, mimeType: null, context: null, optOut: false, optIn: false },
    ]);
  });
  it("flags opt-out / opt-in keywords and parses buttons, media and locations", () => {
    const ev = parseWebhook(
      hook({
        messages: [
          { from: "201005551201", id: "a", timestamp: "1", type: "text", text: { body: "STOP" } },
          { from: "966551234567", id: "b", timestamp: "1", type: "text", text: { body: "إلغاء" } },
          { from: "966551234567", id: "c", timestamp: "1", type: "button", button: { text: "أيوه جاي", payload: "yes" }, context: { id: "wamid.out" } },
          { from: "966551234567", id: "d", timestamp: "1", type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg", caption: "the receipt" } },
          { from: "966551234567", id: "e", timestamp: "1", type: "location", location: { latitude: 30.06, longitude: 31.22 } },
          { from: "966551234567", id: "f", timestamp: "1", type: "text", text: { body: "اشتراك" } },
        ],
      }),
    );
    expect(ev.map((e) => e.kind === "message" && [e.optOut, e.optIn])).toEqual([[true, false], [true, false], [false, false], [false, false], [false, false], [false, true]]);
    const [, b, c, d, e] = ev as Extract<(typeof ev)[number], { kind: "message" }>[];
    expect(b.from).toBe("+966551234567");
    expect(c).toMatchObject({ type: "button", text: "أيوه جاي", context: "wamid.out" });
    expect(d).toMatchObject({ type: "image", text: "the receipt", mediaId: "MEDIA1", mimeType: "image/jpeg" });
    expect(e.text).toContain("30.06,31.22");
  });
  it("parses delivery statuses with pricing and errors", () => {
    const ev = parseWebhook(
      hook({
        statuses: [
          { id: "wamid.out", status: "delivered", timestamp: "1762171200", recipient_id: "201005551201", pricing: { billable: true, pricing_model: "PMP", category: "utility" } },
          { id: "wamid.out2", status: "failed", timestamp: "1762171200", recipient_id: "201005551201", errors: [{ code: 131047, title: "Re-engagement message" }] },
          { id: "x", status: "deleted", timestamp: "1", recipient_id: "1" },
        ],
      }),
    );
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ kind: "status", status: "delivered", recipient: "+201005551201", category: "utility", billable: true, errorCode: null });
    expect(ev[1]).toMatchObject({ kind: "status", status: "failed", errorCode: 131047, errorTitle: "Re-engagement message" });
  });
  it("ignores other objects, fields and garbage", () => {
    expect(parseWebhook({ object: "page", entry: [] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "account_update", value: {} }] }] })).toEqual([]);
    expect(parseWebhook({ object: "whatsapp_business_account", entry: "nope" })).toEqual([]);
  });
});

describe("cost & hours", () => {
  it("estimates per category and recipient country", () => {
    expect(estimateCostMicros("utility", "+201005551201")).toBe(3600);
    expect(estimateCostMicros("marketing", "+201005551201")).toBe(64400);
    expect(estimateCostMicros("marketing", "+201005551201") / estimateCostMicros("utility", "+201005551201")).toBeGreaterThan(17);
    expect(estimateCostMicros("utility", "+966551234567")).toBe(10700);
    expect(estimateCostMicros("service", "+966551234567")).toBe(0);
    expect(estimateCostMicros("utility", "+447700900123")).toBe(3600); // falls back to the restaurant's country
  });
  it("business hours wrap past midnight", () => {
    const m = (h: number, mm = 0) => h * 60 + mm;
    expect(withinHours("12:00", "01:00", m(23))).toBe(true);
    expect(withinHours("12:00", "01:00", m(0, 30))).toBe(true);
    expect(withinHours("12:00", "01:00", m(1))).toBe(false);
    expect(withinHours("12:00", "01:00", m(9))).toBe(false);
    expect(withinHours("09:00", "17:00", m(12))).toBe(true);
    expect(withinHours("09:00", "17:00", m(17))).toBe(false);
    expect(withinHours("00:00", "00:00", m(4))).toBe(true);
    expect(localMinutes(new Date("2026-11-03T20:30:00Z"), "Africa/Cairo")).toBe(22 * 60 + 30);
    expect(localMinutes(new Date("2026-11-03T20:30:00Z"), "Asia/Riyadh")).toBe(23 * 60 + 30);
  });
});

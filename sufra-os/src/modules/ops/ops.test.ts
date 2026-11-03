import { describe, expect, it } from "vitest";
import type { AuditEntry } from "@/data/types";
import { camerasFor, eventFromAudit, eventsFromAudit, filterEvents, type EventLookups } from "./cameras/events";
import { isBrowserUrl, playbackUrl, playMode, PLAYBACK_PATTERNS, rtspLivePath } from "./cameras/nvr";
import { estimateOccupancy } from "./cameras/occupancy";
import { DEFAULT_PTT, PTT_IDLE, pickMime, pttReduce, type PttEvent, type PttState } from "./radio/ptt";
import { canJoin, channelsFor, defaultMonitored, dmId, dmPeer, isForMe, unreadCounts } from "./radio/channels";
import { DEFAULT_SLA, canMove, guessPriority, nextNumber, slaView, toEscalate } from "./support/tickets";
import { ARTICLES, searchArticles } from "./support/articles";
import { scrub } from "./support/diagnostics";
import { buildAlerts, DEFAULT_RULES, shouldNotify } from "./alerts/alerts";
import { LocalRadioTransport } from "./radio/transport";
import type { Camera, PeopleCount, SupportTicket } from "./types";

const AT = "2026-11-03T18:22:30.000Z";
const audit = (action: string, data: Record<string, unknown> = {}, x: Partial<AuditEntry> = {}): AuditEntry => ({
  id: `a-${action}-${Math.random()}`, restaurantId: "r", createdAt: AT, updatedAt: AT, branchId: "b", actorId: "cashier", action, entity: "checks", entityId: null, data, approvedBy: null, ...x,
});
const LK: EventLookups = {
  shifts: [{ id: "s1", device: "POS2", openedBy: "cashier", branchId: "b", openedAt: "2026-11-03T08:00:00.000Z", closedAt: null, status: "open" }],
  cashMovements: [{ id: "m1", shiftId: "s1" }],
  receipts: [{ id: "rc1", device: "POS3", checkId: "c1" }],
  checks: [{ id: "c1", tableIds: ["t5"], total: 30_000_000 }],
  orderItems: [{ id: "i1", orderId: "o1", unitPrice: 12_000_000, qty: 2 }],
  orders: [{ id: "o1", checkId: "c1", tableIds: [] }],
  discountLimitPct: 10,
};
const cam = (id: string, x: Partial<Camera>): Camera => ({
  id, restaurantId: "r", createdAt: AT, updatedAt: AT, branchId: "b", name: { ar: id, en: id }, area: "", zoneId: null, brand: "hikvision", channel: 1, stream: "demo", url: "", snapshotSec: 2,
  posDevices: [], tableIds: [], drawers: [], counter: false, active: true, sort: 1, ...x,
});

describe("POS → video events", () => {
  it("maps the exception actions and ignores the rest", () => {
    expect(eventFromAudit(audit("order.void", { qty: 1, reason: "x" }, { entity: "orderItems", entityId: "i1", approvedBy: "mgr" }), LK)).toMatchObject({ kind: "void", amount: 12_000_000, tableIds: ["t5"], device: "POS2", severity: "warn" });
    expect(eventFromAudit(audit("payment.refund", { total: 5 }, { entity: "receipts", entityId: "rc1" }), LK)).toMatchObject({ kind: "refund", device: "POS3", tableIds: ["t5"], severity: "high" });
    expect(eventFromAudit(audit("drawer.open", {}, { entity: "cashMovements", entityId: "m1" }), LK)).toMatchObject({ kind: "no_sale", device: "POS2" });
    expect(eventFromAudit(audit("menu.86", { item: "Kofta" }), LK)).toMatchObject({ kind: "item_86", device: "KDS" });
    expect(eventFromAudit(audit("check.open"), LK)).toBeNull();
    expect(eventFromAudit(audit("order.send"), LK)).toBeNull();
  });
  it("discounts only above the limit (pct, basis-point rate, or amount share)", () => {
    expect(eventFromAudit(audit("check.discount", { pct: 10 }), LK)).toBeNull();
    expect(eventFromAudit(audit("check.discount", { pct: 15 }), LK)?.kind).toBe("discount");
    expect(eventFromAudit(audit("check.discount", { discount: { kind: "percent", rate: 1000 } }), LK)).toBeNull();
    expect(eventFromAudit(audit("check.discount", { discount: { kind: "percent", rate: 3500 } }), LK)).toMatchObject({ kind: "discount", severity: "high" });
    // 10 EGP off a check whose total is now 300 → 3.2% → not an exception
    expect(eventFromAudit(audit("check.discount", { discount: { kind: "amount", value: 1_000_000 } }, { entityId: "c1" }), LK)).toBeNull();
    expect(eventFromAudit(audit("item.discount", { units: 5 }, { approvedBy: "mgr" }), LK)?.kind).toBe("discount");
  });
  it("cash variance only when there is a difference; short is high severity", () => {
    expect(eventFromAudit(audit("shift.close", { difference: 0 }, { entity: "shifts", entityId: "s1" }), LK)).toBeNull();
    expect(eventFromAudit(audit("shift.close", { difference: -500_000 }, { entity: "shifts", entityId: "s1" }), LK)).toMatchObject({ kind: "cash_variance", signed: -500_000, amount: 500_000, severity: "high", device: "POS2" });
    expect(eventFromAudit(audit("delivery.settle", { difference: 200_000 }, { actorId: "nobody" }), LK)).toMatchObject({ device: "RIDER", severity: "warn" });
  });
  it("explicit device in the payload wins; unknown actor → null device", () => {
    expect(eventFromAudit(audit("drawer.open", { device: "POS9" }), LK)?.device).toBe("POS9");
    expect(eventFromAudit(audit("payment.void", {}, { actorId: "stranger" }), LK)?.device).toBeNull();
  });
  it("picks cameras by device / drawer / table, same branch, active only, device match first", () => {
    const cams = [cam("table5", { tableIds: ["t5"], sort: 1 }), cam("till", { posDevices: ["POS2"], sort: 2 }), cam("drawer", { drawers: ["POS2"], sort: 3 }), cam("off", { posDevices: ["POS2"], active: false }), cam("other", { posDevices: ["POS2"], branchId: "b2" })];
    const ev = eventFromAudit(audit("order.void", {}, { entity: "orderItems", entityId: "i1" }), LK)!;
    expect(camerasFor(ev, cams).map((c) => c.id)).toEqual(["till", "drawer", "table5"]);
    expect(camerasFor({ ...ev, device: "KDS", tableIds: [] }, cams)).toEqual([]);
  });
  it("filters and sorts newest first", () => {
    const evs = eventsFromAudit([audit("drawer.open", {}, { createdAt: "2026-11-03T10:00:00Z" }), audit("menu.86", {}, { createdAt: "2026-11-03T12:00:00Z" })], LK);
    expect(evs.map((e) => e.kind)).toEqual(["item_86", "no_sale"]);
    expect(filterEvents(evs, { kinds: ["no_sale"] })).toHaveLength(1);
    expect(filterEvents(evs, { unreviewed: true }, new Set([evs[0].id]))).toHaveLength(1);
  });
});

describe("NVR playback URL templates", () => {
  const w = { at: AT, padSec: 30 };
  it("Hikvision: track = channel×100+1, UTC ISO", () => {
    expect(playbackUrl({ brand: "hikvision", channel: 3, host: "192.168.1.64:554", window: w })).toBe("rtsp://192.168.1.64:554/Streaming/tracks/301?starttime=2026-11-03T18:22:00Z&endtime=2026-11-03T18:23:00Z");
  });
  it("Dahua: underscore times, UTC by default and local on request", () => {
    expect(playbackUrl({ brand: "dahua", channel: 2, host: "nvr:554", window: w })).toBe("rtsp://nvr:554/cam/playback?channel=2&starttime=2026_11_03_18_22_00&endtime=2026_11_03_18_23_00");
    expect(playbackUrl({ brand: "dahua", channel: 2, host: "nvr", timeZone: "Africa/Cairo", template: "rtsp://{host}/cam/playback?channel={channel}&starttime={start_local_dahua}", window: w })).toBe("rtsp://nvr/cam/playback?channel=2&starttime=2026_11_03_20_22_00");
  });
  it("Uniview: unix begin/end", () => {
    const s = Math.floor(Date.parse(AT) / 1000) - 30;
    expect(playbackUrl({ brand: "uniview", channel: 1, host: "10.0.0.2:554", window: w })).toBe(`rtsp://10.0.0.2:554/c1/b${s}/e${s + 60}/replay/`);
  });
  it("generic MediaMTX playback is a browser URL; unknown placeholders stay visible; scheme stripped from host", () => {
    const u = playbackUrl({ brand: "other", channel: 4, host: "x", gateway: "https://cams.example.com/", window: w });
    expect(u).toBe("https://cams.example.com/get?path=cam4&start=2026-11-03T18:22:00Z&duration=60");
    expect(isBrowserUrl(u)).toBe(true);
    expect(playbackUrl({ brand: "hikvision", channel: 1, host: "rtsp://h/", template: "{host}|{nope}", window: w })).toBe("h|{nope}");
  });
  it("marks confidence per brand and builds RTSP live paths for the gateway", () => {
    expect(PLAYBACK_PATTERNS.uniview.confidence).toBe("documented");
    expect(PLAYBACK_PATTERNS.hikvision.confidence).toBe("community");
    expect(rtspLivePath("hikvision", 2)).toBe("/Streaming/Channels/202");
    expect(rtspLivePath("dahua", 1, false)).toBe("/cam/realmonitor?channel=1&subtype=0");
    expect(rtspLivePath("uniview", 3)).toBe("/unicast/c3/s1/live");
  });
  it("never tries to play RTSP in the browser", () => {
    expect(playMode({ stream: "hls", url: "rtsp://x/1" })).toBe("unplayable");
    expect(playMode({ stream: "hls", url: "https://x/a.m3u8" })).toBe("hls");
    expect(playMode({ stream: "snapshot", url: "https://x/a.jpg" })).toBe("img-poll");
    expect(playMode({ stream: "demo", url: "" })).toBe("demo");
  });
});

describe("occupancy estimate (beta)", () => {
  const s = (at: string, x: Partial<PeopleCount>): PeopleCount => ({ id: at, restaurantId: "r", createdAt: at, updatedAt: at, branchId: "b", zoneId: "z", cameraId: null, source: "camera", inCount: 0, outCount: 0, occupancy: null, at, actorId: null, ...x });
  it("anchors on the last manual count and adds net flow after it, never below zero", () => {
    const now = Date.parse("2026-11-03T19:00:00Z");
    const e = estimateOccupancy([s("2026-11-03T18:00:00Z", { source: "manual", occupancy: 20 }), s("2026-11-03T18:30:00Z", { inCount: 6, outCount: 2 }), s("2026-11-03T18:50:00Z", { inCount: 1, outCount: 3 })], "z", 40, now);
    expect(e).toMatchObject({ people: 22, pct: 55, basis: "mixed", confidence: "medium", ageMin: 10 });
    expect(estimateOccupancy([s("2026-11-03T18:50:00Z", { inCount: 0, outCount: 9 })], "z", null, now)).toMatchObject({ people: 0, basis: "counter", confidence: "low", pct: null });
    expect(estimateOccupancy([], "z", 10, now).basis).toBe("none");
  });
});

describe("push-to-talk state machine", () => {
  const run = (evs: PttEvent[], s: PttState = PTT_IDLE) => evs.reduce((x, e) => pttReduce(x, e, DEFAULT_PTT), s);
  it("press → ready → hold → release sends", () => {
    expect(run([{ type: "press", t: 0 }, { type: "ready", t: 100 }, { type: "tick", t: 1100 }, { type: "release", t: 2100 }])).toEqual({ phase: "sending", durationMs: 2000, autoCut: false });
    expect(run([{ type: "press", t: 0 }, { type: "ready", t: 100 }, { type: "release", t: 2100 }, { type: "sent" }])).toEqual(PTT_IDLE);
  });
  it("too-short clips are discarded (also when released before the mic is ready)", () => {
    expect(run([{ type: "press", t: 0 }, { type: "ready", t: 50 }, { type: "release", t: 300 }])).toMatchObject({ phase: "discarded", reason: "too_short", durationMs: 250 });
    expect(run([{ type: "press", t: 0 }, { type: "release", t: 30 }])).toMatchObject({ phase: "discarded", reason: "too_short" });
    // a late "ready" after the early release changes nothing
    expect(run([{ type: "press", t: 0 }, { type: "release", t: 30 }, { type: "ready", t: 200 }]).phase).toBe("discarded");
  });
  it("auto-cuts at the max length and ignores the late release", () => {
    const s = run([{ type: "press", t: 0 }, { type: "ready", t: 0 }, { type: "tick", t: 30_000 }]);
    expect(s).toEqual({ phase: "sending", durationMs: 30_000, autoCut: true });
    expect(pttReduce(s, { type: "release", t: 31_000 })).toBe(s);
    expect(run([{ type: "press", t: 0 }, { type: "ready", t: 0 }, { type: "release", t: 99_000 }])).toMatchObject({ durationMs: 30_000 });
  });
  it("cancel, mic errors, re-press after discard, no double press", () => {
    expect(run([{ type: "press", t: 0 }, { type: "ready", t: 10 }, { type: "tick", t: 500 }, { type: "cancel" }])).toMatchObject({ phase: "discarded", reason: "cancelled", durationMs: 490 });
    expect(run([{ type: "press", t: 0 }, { type: "fail", error: "mic_denied" }])).toEqual({ phase: "error", error: "mic_denied" });
    expect(run([{ type: "press", t: 0 }, { type: "release", t: 1 }, { type: "press", t: 5 }]).phase).toBe("arming");
    const rec = run([{ type: "press", t: 0 }, { type: "ready", t: 1 }]);
    expect(pttReduce(rec, { type: "press", t: 9 })).toBe(rec);
    expect(pttReduce(PTT_IDLE, { type: "release", t: 9 })).toBe(PTT_IDLE);
  });
  it("prefers Opus/WebM, falls back to AAC/MP4 (Safari)", () => {
    expect(pickMime((m) => m.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
    expect(pickMime((m) => m.startsWith("audio/mp4"))).toBe("audio/mp4;codecs=mp4a.40.2");
    expect(pickMime(() => false)).toBeNull();
  });
});

describe("radio channels", () => {
  it("membership per role", () => {
    expect(channelsFor("delivery").map((c) => c.id)).toEqual(["all", "delivery"]);
    expect(channelsFor("kitchen").map((c) => c.id)).toEqual(["all", "kitchen"]);
    expect(canJoin("waiter", "kitchen")).toBe(true);
    expect(canJoin("waiter", "managers")).toBe(false);
    expect(canJoin("platform_admin", "all")).toBe(false);
    expect(defaultMonitored("chef")).toEqual(["all", "kitchen", "managers"]);
  });
  it("direct channels are exactly the two people", () => {
    const d = dmId("b", "a");
    expect(d).toBe(dmId("a", "b"));
    expect(dmPeer(d, "a")).toBe("b");
    expect(dmPeer(d, "c")).toBeNull();
    expect(canJoin("waiter", d, "a")).toBe(true);
    expect(canJoin("waiter", d, "c")).toBe(false);
  });
  it("auto-play + unread only for my channels, never my own clips", () => {
    expect(isForMe({ channel: "kitchen", fromId: "x" }, "me", "kitchen", ["kitchen"])).toBe(true);
    expect(isForMe({ channel: "kitchen", fromId: "x" }, "me", "kitchen", [])).toBe(false);
    expect(isForMe({ channel: "kitchen", fromId: "me" }, "me", "kitchen", ["kitchen"])).toBe(false);
    expect(isForMe({ channel: dmId("me", "x"), fromId: "x" }, "me", "delivery", [])).toBe(true);
    expect(isForMe({ channel: "managers", fromId: "x" }, "me", "delivery", ["managers"])).toBe(false);
    const clips = [{ channel: "all" as const, fromId: "x", at: "2" }, { channel: "all" as const, fromId: "x", at: "4" }, { channel: "managers" as const, fromId: "x", at: "4" }, { channel: dmId("me", "x"), fromId: "x", at: "5" }];
    expect(unreadCounts(clips, "me", "delivery", { all: "3" })).toEqual({ all: 1, [dmId("me", "x")]: 1 });
  });
});

describe("local radio transport (IndexedDB blobs, shared by tabs)", () => {
  it("stores audio in one instance and reads it from another", async () => {
    const a = new LocalRadioTransport("t1");
    const b = new LocalRadioTransport("t1");
    const path = await a.putAudio({ id: "clip1", restaurantId: "r", mime: "audio/webm" }, new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }));
    const got = await b.getAudio({ id: "clip1", storagePath: path, mime: "audio/webm" });
    expect(got?.size).toBe(3);
    expect(got?.type).toBe("audio/webm");
    expect(await b.getAudio({ id: "nope", storagePath: "nope", mime: "" })).toBeNull();
    a.close();
    b.close();
  });
});

describe("tickets: SLA, escalation, numbering", () => {
  const tk = (x: Partial<SupportTicket>): SupportTicket => ({
    id: "t", restaurantId: "r", createdAt: "2026-11-03T18:00:00.000Z", updatedAt: "", branchId: null, kind: "guest", number: "G-1001", subject: "", body: "", category: "food", channel: "qr", priority: "high", status: "new",
    customerId: null, contactName: "", contactPhone: "", orderId: null, checkId: null, tableId: null, raisedBy: null, assigneeId: null, notes: [], resolution: "", followUp: null, followUpAt: null,
    firstResponseAt: null, resolvedAt: null, escalatedAt: null, diagnostics: null, forwardedAt: null, ...x,
  });
  const t0 = Date.parse("2026-11-03T18:00:00.000Z");
  it("response clock: ok → due soon → breached; met when answered in time", () => {
    expect(slaView(tk({}), DEFAULT_SLA, t0 + 5 * 60_000).worst).toBe("ok");
    expect(slaView(tk({}), DEFAULT_SLA, t0 + 26 * 60_000).worst).toBe("due_soon");
    expect(slaView(tk({}), DEFAULT_SLA, t0 + 31 * 60_000).worst).toBe("breached");
    expect(slaView(tk({ firstResponseAt: "2026-11-03T18:10:00.000Z", status: "open" }), DEFAULT_SLA, t0 + 31 * 60_000)).toMatchObject({ response: { state: "met" }, worst: "ok" });
    expect(slaView(tk({ firstResponseAt: "2026-11-03T18:10:00.000Z", status: "resolved", resolvedAt: "2026-11-03T19:00:00.000Z" }), DEFAULT_SLA, t0 + 9 * 3600_000).worst).toBe("met");
  });
  it("escalates breached tickets one level, once per window, never closed ones", () => {
    const now = t0 + 40 * 60_000;
    expect(toEscalate([tk({})], DEFAULT_SLA, now).map((x) => x.priority)).toEqual(["urgent"]);
    expect(toEscalate([tk({ priority: "urgent", escalatedAt: new Date(now - 5 * 60_000).toISOString() })], DEFAULT_SLA, now)).toEqual([]);
    expect(toEscalate([tk({ priority: "urgent", escalatedAt: new Date(now - 11 * 60_000).toISOString() })], DEFAULT_SLA, now)[0].priority).toBe("urgent");
    expect(toEscalate([tk({ status: "resolved" })], DEFAULT_SLA, now)).toEqual([]);
    expect(toEscalate([tk({ priority: "low" })], DEFAULT_SLA, now)).toEqual([]);
  });
  it("numbers per kind, transitions, priority guess", () => {
    expect(nextNumber("guest", [{ kind: "guest", number: "G-1003" }, { kind: "sufra", number: "S-0009" }])).toBe("G-1004");
    expect(nextNumber("sufra", [])).toBe("S-0001");
    expect(canMove("closed", "open")).toBe(true);
    expect(canMove("closed", "pending")).toBe(false);
    expect(guessPriority("food", "لقيت شعر في الأكل")).toBe("urgent");
    expect(guessPriority("food", "I have a nut allergy and got nuts")).toBe("urgent");
    expect(guessPriority("billing", "")).toBe("high");
    expect(guessPriority("praise", "")).toBe("low");
  });
});

describe("help center search (Arabic normalisation)", () => {
  it("has ~25 bilingual articles", () => {
    expect(ARTICLES.length).toBeGreaterThanOrEqual(25);
    for (const a of ARTICLES) expect(a.title.ar && a.title.en && a.body.ar && a.body.en).toBeTruthy();
    expect(new Set(ARTICLES.map((a) => a.id)).size).toBe(ARTICLES.length);
  });
  it("matches across hamza/taa marbuta/yaa variants, tashkeel and the ال prefix", () => {
    expect(searchArticles("الغاء")[0].id).toBe("pos-void"); // إلغاء
    expect(searchArticles("إلْغَاء")[0].id).toBe("pos-void");
    expect(searchArticles("الوردية").some((a) => a.id === "pos-shift")).toBe(true);
    expect(searchArticles("ورديه").some((a) => a.id === "pos-shift")).toBe(true);
    expect(searchArticles("الكاميرات")[0].module).toBe("cameras");
    expect(searchArticles("واكى توكى")[0].id).toBe("radio");
    expect(searchArticles("walkie")[0].id).toBe("radio");
    expect(searchArticles("zzzz")).toEqual([]);
    expect(searchArticles("")).toHaveLength(ARTICLES.length);
  });
});

describe("diagnostics + alerts", () => {
  it("scrubs secrets before they leave the device", () => {
    expect(scrub("token=abc123&x=1 eyJhbGciOi.eyJzdWIi.sig user@x.com 01005551201")).toBe("token=[redacted]&x=1 [jwt] [email] [number]");
  });
  it("aggregates and routes alerts by rule", () => {
    const now = Date.parse("2026-11-03T20:00:00Z");
    const alerts = buildAlerts({
      now,
      calls: [{ id: "c", restaurantId: "r", createdAt: "2026-11-03T19:50:00Z", updatedAt: "", branchId: "b", tableId: "t", type: "water", text: "", status: "open", source: "qr", ackBy: null, ackAt: null, doneAt: null, table: "5" } as never],
      callSla: { warnSec: 60, escalateSec: 120, criticalSec: 300 },
      orders: [{ id: "o", number: 7, branchId: "b", status: "sent", mode: "delivery", dispatch: { stage: "picked_up", promisedAt: "2026-11-03T19:30:00Z" } as never }],
      lowStock: [{ id: "s", name: { ar: "رز", en: "Rice" }, qty: 0, unit: "kg", par: 5, branchId: "b" }],
      events: [{ id: "e", kind: "cash_variance", at: "2026-11-03T19:00:00Z", branchId: "b", actorId: null, approvedBy: null, device: "POS1", tableIds: [], amount: 5_000_000, signed: -5_000_000, reason: "", entity: "", entityId: null, severity: "high" }],
      payments: [{ id: "p", status: "failed", amount: 100, updatedAt: "2026-11-03T19:00:00Z", provider: "paymob", branchId: "b" }],
      tickets: [],
      ticketSla: DEFAULT_SLA,
      money: (u) => String(u / 100_000),
    });
    expect(alerts.map((a) => a.kind).sort()).toEqual(["call_escalated", "cash_variance", "late_delivery", "low_stock", "payment_failed"]);
    expect(alerts[0].severity).toBe("high");
    expect(shouldNotify(DEFAULT_RULES, { kind: "cash_variance" }, "accountant")).toBe(true);
    expect(shouldNotify(DEFAULT_RULES, { kind: "cash_variance" }, "waiter")).toBe(false);
    expect(shouldNotify([{ kind: "cash_variance", enabled: false, notify: ["owner"], threshold: 0 }], { kind: "cash_variance" }, "owner")).toBe(false);
  });
});

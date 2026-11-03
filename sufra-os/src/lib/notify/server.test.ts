/**
 * Server-side WhatsApp (api/_lib) — signature verification, rate limiting and the send/webhook handlers
 * with a fake fetch. Imports the real files Vercel bundles.
 */
import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { RateLimiter } from "../../../../api/_lib/wa-ratelimit";
import { handleSend, handleVerify, handleWebhookPost, safeEqual, signBody, verifySignature, type WaDeps } from "../../../../api/_lib/wa-server";

const SECRET = "test-app-secret";
const RID = "6f1b0c1e-0000-4000-8000-000000000001";

describe("X-Hub-Signature-256", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [] }] });
  const good = "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
  it("accepts a correct signature (any hex case)", () => {
    expect(signBody(body, SECRET)).toBe(good);
    expect(verifySignature(body, good, SECRET)).toBe(true);
    expect(verifySignature(body, good.toUpperCase().replace("SHA256", "sha256"), SECRET)).toBe(true);
  });
  it("rejects a wrong secret, a tampered body, a malformed or missing header", () => {
    expect(verifySignature(body, "sha256=" + createHmac("sha256", "other").update(body).digest("hex"), SECRET)).toBe(false);
    expect(verifySignature(body.replace("[]", "[{}]"), good, SECRET)).toBe(false);
    expect(verifySignature(body + " ", good, SECRET)).toBe(false);
    expect(verifySignature(body, good.slice(0, -2), SECRET)).toBe(false);
    expect(verifySignature(body, "md5=abc", SECRET)).toBe(false);
    expect(verifySignature(body, null, SECRET)).toBe(false);
    expect(verifySignature(body, good, undefined)).toBe(false);
  });
  it("constant-time compare", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("rate limiter", () => {
  it("allows a burst, then refills over time, per key", () => {
    const rl = new RateLimiter(3, 1);
    const t = 1_000_000;
    expect([1, 2, 3].map(() => rl.take("r1", t).ok)).toEqual([true, true, true]);
    const blocked = rl.take("r1", t);
    expect(blocked).toMatchObject({ ok: false, retryAfterSec: 1 });
    expect(rl.take("r2", t).ok).toBe(true);
    expect(rl.take("r1", t + 1000).ok).toBe(true);
    expect(rl.take("r1", t + 1000).ok).toBe(false);
    expect([0, 1, 2].map(() => rl.take("r1", t + 60_000).ok)).toEqual([true, true, true]);
  });
  it("evicts the oldest key beyond maxKeys", () => {
    const rl = new RateLimiter(1, 0.001, 2);
    rl.take("a", 0);
    rl.take("b", 0);
    rl.take("c", 0);
    expect(rl.take("a", 0).ok).toBe(true); // "a" was evicted → fresh bucket
  });
});

/* ───────── handlers with a fake fetch ───────── */

type Call = { url: string; init?: RequestInit };
function deps(env: Record<string, string>, routes: (c: Call) => Response | undefined = () => undefined): WaDeps & { calls: Call[]; logs: string[] } {
  const calls: Call[] = [];
  const logs: string[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const c = { url: String(url), init };
    calls.push(c);
    return routes(c) ?? new Response(JSON.stringify({ messages: [{ id: "wamid.SENT" }] }), { status: 200 });
  }) as typeof fetch;
  return { env, fetch: f, limiter: new RateLimiter(2, 0.01), now: () => 1_700_000_000_000, log: (m) => logs.push(m), calls, logs };
}
const post = (body: unknown, headers: Record<string, string> = {}) => new Request("https://x.test/api/whatsapp-send", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const ENV = { WHATSAPP_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "PN1", SUFRA_API_KEY: "k3y" };

describe("/api/whatsapp-send", () => {
  const msg = { restaurantId: RID, to: "01005551201", template: { name: "order_received", lang: "ar", params: ["دينا", "42"] } };
  it("501 when no auth method or no WhatsApp credentials are configured", async () => {
    expect((await handleSend(post(msg), deps({}))).status).toBe(501);
    const r = await handleSend(post(msg, { "x-sufra-api-key": "k3y" }), deps({ SUFRA_API_KEY: "k3y" }));
    expect(r.status).toBe(501);
    expect((await r.json()).error).toBe("not_configured");
  });
  it("requires the shared API key without Supabase", async () => {
    expect((await handleSend(post(msg), deps(ENV))).status).toBe(401);
    expect((await handleSend(post(msg, { "x-sufra-api-key": "wrong" }), deps(ENV))).status).toBe(401);
  });
  it("validates the body", async () => {
    const r = await handleSend(post({ ...msg, to: "123" }, { "x-sufra-api-key": "k3y" }), deps(ENV));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("bad_phone");
  });
  it("sends to the Graph API with the token and returns the wamid", async () => {
    const d = deps(ENV);
    const r = await handleSend(post(msg, { "x-sufra-api-key": "k3y" }), d);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id: "wamid.SENT", status: "sent" });
    expect(d.calls[0].url).toBe("https://graph.facebook.com/v21.0/PN1/messages");
    expect((d.calls[0].init!.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(String(d.calls[0].init!.body))).toMatchObject({ to: "201005551201", type: "template", template: { name: "order_received", language: { code: "ar" } } });
    expect(d.logs.join(" ")).not.toContain("201005551201");
  });
  it("rate-limits per restaurant", async () => {
    const d = deps(ENV);
    const h = { "x-sufra-api-key": "k3y" };
    expect((await handleSend(post(msg, h), d)).status).toBe(200);
    expect((await handleSend(post(msg, h), d)).status).toBe(200);
    const r = await handleSend(post(msg, h), d);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
  });
  it("maps Meta errors", async () => {
    const d = deps(ENV, () => new Response(JSON.stringify({ error: { message: "Re-engagement message", code: 131047 } }), { status: 400 }));
    const r = await handleSend(post({ restaurantId: RID, to: "01005551201", text: "hi" }, { "x-sufra-api-key": "k3y" }), d);
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ code: 131047 });
  });
  it("the platform-default number only serves its own restaurant", async () => {
    const r = await handleSend(post(msg, { "x-sufra-api-key": "k3y" }), deps({ ...ENV, WHATSAPP_DEFAULT_RESTAURANT_ID: "someone-else" }));
    expect(r.status).toBe(501);
  });
  it("with Supabase: JWT + membership role, opt-out check, status written back", async () => {
    const env = { WHATSAPP_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "PN1", SUPABASE_URL: "https://sb.test", SUPABASE_SERVICE_ROLE_KEY: "service" };
    const role = { v: "cashier" };
    const consent = { v: "opted_in" };
    const d = deps(env, ({ url }) => {
      if (url.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "user-1" }));
      if (url.includes("/rest/v1/memberships")) return new Response(JSON.stringify([{ role: role.v }]));
      if (url.includes("/rpc/messaging_wa_credentials")) return new Response("[]");
      if (url.includes("/rpc/messaging_rate_take")) return new Response("true");
      if (url.includes("/rest/v1/messaging_consents")) return new Response(JSON.stringify([{ status: consent.v }]));
      if (url.includes("/rest/v1/wa_messages")) return new Response(null, { status: 204 });
      return undefined;
    });
    expect((await handleSend(post(msg), d)).status).toBe(401);
    const auth = { authorization: "Bearer user.jwt" };
    const ok = await handleSend(post({ ...msg, messageId: "m-1" }, auth), d);
    expect(ok.status).toBe(200);
    const patch = d.calls.find((c) => c.url.includes("/rest/v1/wa_messages?id=eq.m-1"))!;
    expect(JSON.parse(String(patch.init!.body))).toMatchObject({ provider_id: "wamid.SENT", status: "sent" });
    consent.v = "opted_out";
    expect((await handleSend(post(msg, auth), d)).status).toBe(409);
    role.v = "waiter";
    expect((await handleSend(post(msg, auth), d)).status).toBe(403);
  });
  it("GET reports configuration without secrets", async () => {
    const r = await handleSend(new Request("https://x.test/api/whatsapp-send"), deps(ENV));
    const j = await r.json();
    expect(j).toMatchObject({ configured: true, auth: "api_key", storage: "none" });
    expect(JSON.stringify(j)).not.toContain("tok");
  });
});

describe("/api/whatsapp-webhook", () => {
  const env = { WHATSAPP_VERIFY_TOKEN: "verify-me", WHATSAPP_APP_SECRET: SECRET };
  it("GET verifies the subscription", () => {
    expect(handleVerify(new Request("https://x.test/api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345"), deps(env)).status).toBe(200);
    expect(handleVerify(new Request("https://x.test/api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345"), deps(env)).status).toBe(403);
    expect(handleVerify(new Request("https://x.test/api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345"), deps({})).status).toBe(501);
  });
  const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PN1" }, messages: [{ from: "201005551201", id: "wamid.in", timestamp: "1", type: "text", text: { body: "وقف" } }] } }] }] });
  const hookReq = (body: string, sig: string | null) => new Request("https://x.test/api/whatsapp-webhook", { method: "POST", headers: sig ? { "x-hub-signature-256": sig } : {}, body });
  it("POST rejects unsigned or tampered bodies", async () => {
    expect((await handleWebhookPost(hookReq(payload, null), deps(env))).status).toBe(401);
    expect((await handleWebhookPost(hookReq(payload.replace("وقف", "hi"), signBody(payload, SECRET)), deps(env))).status).toBe(401);
    expect((await handleWebhookPost(hookReq(payload, signBody(payload, SECRET)), deps({ WHATSAPP_VERIFY_TOKEN: "x" }))).status).toBe(501);
  });
  it("POST without storage logs (masked) and answers 200", async () => {
    const d = deps(env);
    const r = await handleWebhookPost(hookReq(payload, signBody(payload, SECRET)), d);
    expect(r.status).toBe(200);
    expect(d.calls).toHaveLength(0);
  });
  it("POST with Supabase ingests and sends the opt-out confirmation", async () => {
    const d = deps({ ...env, SUPABASE_URL: "https://sb.test", SUPABASE_SERVICE_ROLE_KEY: "service", WHATSAPP_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "PN1" }, ({ url }) => {
      if (url.includes("/rpc/messaging_ingest_webhook")) return new Response(JSON.stringify({ stored: 1, replies: [{ restaurant_id: RID, to: "+201005551201", text: "تم إلغاء اشتراكك", message_id: "m-9" }] }));
      if (url.includes("/rpc/messaging_wa_credentials")) return new Response("[]");
      if (url.includes("/rest/v1/wa_messages")) return new Response(null, { status: 204 });
      return undefined;
    });
    const r = await handleWebhookPost(hookReq(payload, signBody(payload, SECRET)), d);
    expect(r.status).toBe(200);
    const ingest = d.calls.find((c) => c.url.includes("messaging_ingest_webhook"))!;
    const args = JSON.parse(String(ingest.init!.body));
    expect(args.p_events[0]).toMatchObject({ kind: "message", from: "+201005551201", optOut: true });
    const graph = d.calls.find((c) => c.url.startsWith("https://graph.facebook.com"))!;
    expect(JSON.parse(String(graph.init!.body))).toMatchObject({ type: "text", text: { body: "تم إلغاء اشتراكك" } });
  });
  it("POST returns 500 when storage fails so Meta retries", async () => {
    const d = deps({ ...env, SUPABASE_URL: "https://sb.test", SUPABASE_SERVICE_ROLE_KEY: "service" }, () => new Response("boom", { status: 500 }));
    expect((await handleWebhookPost(hookReq(payload, signBody(payload, SECRET)), d)).status).toBe(500);
  });
});

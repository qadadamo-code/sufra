import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { RateLimiter } from "../../../../api/_lib/wa-ratelimit";
import { handleSupportTicket, hmacHex, validateTicket, type SupportDeps } from "../../../../api/_lib/ops-support";
import { radioProvider } from "../../../../api/_lib/ops-radio";

const T = { restaurantId: "11111111-1111-4111-8111-111111111111", ticketId: "22222222-2222-4222-8222-222222222222", restaurantName: "Sufra", number: "S-0001", subject: "printer", body: "Arabic prints garbage", category: "printer", priority: "high", contact: { name: "Saber", phone: "010" }, diagnostics: { appVersion: "0.1.0", errors: [1, 2] } };

function deps(env: Record<string, string>, calls: { url: string; init: RequestInit }[] = []): SupportDeps {
  return { env, limiter: new RateLimiter(2, 0), fetch: (async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response("{}", { status: 200 }))) as unknown as typeof fetch };
}
const post = (body: unknown, headers: Record<string, string> = {}) => new Request("https://x/api/support-ticket", { method: "POST", body: JSON.stringify(body), headers });

describe("api/support-ticket", () => {
  it("reports configuration and refuses when nothing is configured", async () => {
    expect(await (await handleSupportTicket(new Request("https://x"), deps({}))).json()).toEqual({ configured: false, webhook: false, email: false });
    expect((await handleSupportTicket(post(T), deps({}))).status).toBe(501);
    // a webhook but no auth → still 501 (never an open relay)
    expect((await handleSupportTicket(post(T), deps({ SUPPORT_WEBHOOK_URL: "https://hooks.example.com/x" }))).status).toBe(501);
  });
  it("validates, authenticates by shared key, signs, formats Slack, rate-limits", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const d = deps({ SUPPORT_WEBHOOK_URL: "https://hooks.slack.com/services/A/B", SUPPORT_WEBHOOK_SECRET: "s3", SUFRA_API_KEY: "k" }, calls);
    expect((await handleSupportTicket(post({ ...T, restaurantId: "nope" }, { "x-sufra-api-key": "k" }), d)).status).toBe(400);
    expect((await handleSupportTicket(post(T, { "x-sufra-api-key": "bad" }), d)).status).toBe(401);
    const ok = await handleSupportTicket(post(T, { "x-sufra-api-key": "k" }), d);
    expect(ok.status).toBe(200);
    const body = String(calls[0].init.body);
    expect(JSON.parse(body).text).toContain("*S-0001* [high] printer");
    expect((calls[0].init.headers as Record<string, string>)["x-sufra-signature"]).toBe("sha256=" + createHmac("sha256", "s3").update(body).digest("hex"));
    await handleSupportTicket(post(T, { "x-sufra-api-key": "k" }), d);
    expect((await handleSupportTicket(post(T, { "x-sufra-api-key": "k" }), d)).status).toBe(429);
  });
  it("WebCrypto HMAC equals node:crypto; validation trims and defaults", async () => {
    expect(await hmacHex("k", "abc")).toBe(createHmac("sha256", "k").update("abc").digest("hex"));
    expect(validateTicket({ ...T, priority: "whatever" })?.priority).toBe("normal");
    expect(validateTicket({ ...T, body: "  " })).toBeNull();
  });
  it("radio-token provider status (interface only)", () => {
    expect(radioProvider({ PTT_PROVIDER: "livekit", LIVEKIT_URL: "wss://x", LIVEKIT_API_KEY: "a", LIVEKIT_API_SECRET: "b" })).toEqual({ provider: "livekit", ready: true });
    expect(radioProvider({ PTT_PROVIDER: "agora" })).toEqual({ provider: "agora", ready: false });
    expect(radioProvider({})).toEqual({ provider: null, ready: false });
  });
});

/**
 * Server side of payments (/home/user/api/_lib): signature verification with good / bad / tampered vectors,
 * amount conversion without float errors, and the request handlers against a fake Supabase + gateway.
 * Expected HMACs are computed with node:crypto — an independent implementation from the Web Crypto code under test.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  bpOfUnits, decimalToMinor, isExpired, kashierSignaturePayload, linkExpiry, minorToDecimal, paymobHmacString, paymobHmacStringFromQuery, safeReturnUrl,
  unitsToMinor, validateCharge, verifyKashier, verifyMoyasar, verifyPaymob, verifyPaymobQuery, notConfigured,
} from "../../../../api/_lib/pay-core";
import { handleIntent, handleRefund, handleStatus, handleWebhook, type Deps } from "../../../../api/_lib/pay-handlers";
import type { IntentRecord, PayDb } from "../../../../api/_lib/pay-db";

const node = (alg: "sha256" | "sha512", key: string, msg: string) => createHmac(alg, key).update(msg).digest("hex");

/* Paymob's documented example (HMAC Transaction Callback page): the concatenated string for this transaction. */
const PAYMOB_OBJ = {
  amount_cents: 100000, created_at: "2024-06-13T11:33:44.592345", currency: "EGP", error_occured: false, has_parent_transaction: false, id: 192036465,
  integration_id: 4097558, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false,
  order: { id: 217503754, merchant_order_id: "pi_abc123def456" }, owner: 302852, pending: false, source_data: { pan: "2346", sub_type: "MasterCard", type: "card" }, success: true,
  data: { message: "Approved" },
};
const PAYMOB_DOC_STRING = "1000002024-06-13T11:33:44.592345EGPfalsefalse1920364654097558truefalsefalsefalsetruefalse217503754302852false2346MasterCardcardtrue";

describe("Paymob HMAC-SHA512", () => {
  const secret = "PAYMOB_TEST_HMAC_SECRET";
  it("builds the documented concatenation in the documented field order", () => {
    expect(paymobHmacString(PAYMOB_OBJ)).toBe(PAYMOB_DOC_STRING);
  });
  it("accepts a good signature (any hex case), rejects bad and tampered ones", async () => {
    const good = node("sha512", secret, PAYMOB_DOC_STRING);
    expect(await verifyPaymob(PAYMOB_OBJ, good, secret)).toBe(true);
    expect(await verifyPaymob(PAYMOB_OBJ, good.toUpperCase(), secret)).toBe(true);
    expect(await verifyPaymob(PAYMOB_OBJ, node("sha512", "wrong-secret", PAYMOB_DOC_STRING), secret)).toBe(false);
    expect(await verifyPaymob({ ...PAYMOB_OBJ, amount_cents: 1 }, good, secret)).toBe(false);
    expect(await verifyPaymob({ ...PAYMOB_OBJ, success: false }, good, secret)).toBe(false);
    expect(await verifyPaymob(PAYMOB_OBJ, null, secret)).toBe(false);
    expect(await verifyPaymob(PAYMOB_OBJ, good, "")).toBe(false);
  });
  it("verifies the GET redirect query (flat keys, order_id)", async () => {
    const q = new URLSearchParams({ amount_cents: "100000", created_at: "2024-06-13T11:33:44.592345", currency: "EGP", error_occured: "false", has_parent_transaction: "false", id: "192036465", integration_id: "4097558", is_3d_secure: "true", is_auth: "false", is_capture: "false", is_refunded: "false", is_standalone_payment: "true", is_voided: "false", order_id: "217503754", owner: "302852", pending: "false", "source_data.pan": "2346", "source_data.sub_type": "MasterCard", "source_data.type": "card", success: "true" });
    expect(paymobHmacStringFromQuery(q)).toBe(PAYMOB_DOC_STRING);
    q.set("hmac", node("sha512", secret, PAYMOB_DOC_STRING));
    expect(await verifyPaymobQuery(q, secret)).toBe(true);
    q.set("success", "false");
    expect(await verifyPaymobQuery(q, secret)).toBe(false);
  });
});

describe("Kashier HMAC-SHA256 over sorted signatureKeys", () => {
  const key = "kashier-payment-api-key";
  const data = { merchantOrderId: "pi_abc123def456", kashierOrderId: "9ad06b17-755b-4e21-9774-aff3e2726ac9", orderReference: "TEST-ORD-1", transactionId: "TX-1", status: "SUCCESS", method: "card", creationDate: "2026-11-03T18:00:00.000Z", amount: 185.5, currency: "EGP", cardBrand: "Visa", maskedCard: "4242*****4242", transactionResponseCode: "00", signatureKeys: ["merchantOrderId", "kashierOrderId", "orderReference", "transactionId", "status", "method", "creationDate", "amount", "currency"] };
  it("builds key=value& with only the values RFC3986-encoded, keys sorted", () => {
    const p = kashierSignaturePayload(data);
    expect(p.startsWith("amount=185.5&creationDate=2026-11-03T18%3A00%3A00.000Z&currency=EGP&kashierOrderId=")).toBe(true);
    expect(p).not.toContain("cardBrand");
    expect(kashierSignaturePayload({ a: "it's (ok)!", signatureKeys: ["a"] })).toBe("a=it%27s%20%28ok%29%21");
  });
  it("good / bad / tampered", async () => {
    const sig = node("sha256", key, kashierSignaturePayload(data));
    expect(await verifyKashier(data, sig, key)).toBe(true);
    expect(await verifyKashier(data, sig, "other-key")).toBe(false);
    expect(await verifyKashier({ ...data, amount: 1 }, sig, key)).toBe(false);
    expect(await verifyKashier({ ...data, status: "FAILED" }, sig, key)).toBe(false);
    expect(await verifyKashier({ ...data, signatureKeys: [] }, sig, key)).toBe(false);
    expect(await verifyKashier(data, null, key)).toBe(false);
  });
});

describe("Moyasar secret_token", () => {
  it("good / bad / missing", () => {
    expect(verifyMoyasar({ secret_token: "s3cr3t-token" }, "s3cr3t-token")).toBe(true);
    expect(verifyMoyasar({ secret_token: "s3cr3t-tokem" }, "s3cr3t-token")).toBe(false);
    expect(verifyMoyasar({ secret_token: "s3cr3t" }, "s3cr3t-token")).toBe(false);
    expect(verifyMoyasar({}, "s3cr3t-token")).toBe(false);
    expect(verifyMoyasar({ secret_token: "" }, "")).toBe(false);
  });
});

describe("amounts — integer units ↔ piastres / halalas", () => {
  it("converts exactly", () => {
    expect(unitsToMinor(18_550_000)).toBe(18_550);
    expect(minorToDecimal(18_550)).toBe("185.50");
    expect(minorToDecimal(5)).toBe("0.05");
    expect(decimalToMinor("185.5")).toBe(18_550);
    expect(decimalToMinor("0.1")).toBe(10);
    expect(decimalToMinor(0.1 + 0.2)).toBe(30); // 0.30000000000000004 → 30, not 30.000000000000004
    expect(() => unitsToMinor(18_550_001)).toThrow();
    expect(() => unitsToMinor(0.5)).toThrow();
    expect(() => decimalToMinor("1.005")).toThrow();
    expect(bpOfUnits(10_000_000, 275)).toBe(275_000); // 2.75% of 100 EGP = 2.75 EGP
    expect(bpOfUnits(1_000, 5000)).toBe(1_000); // half a piastre rounds up to whole piastres
  });
  it("validates a charge against what is due", () => {
    expect(validateCharge({ amount: 10_000_000, tip: 1_000_000, due: 10_000_000 })).toBeNull();
    expect(validateCharge({ amount: 10_001_000, tip: 0, due: 10_000_000 })).toBe("amount_exceeds_due");
    expect(validateCharge({ amount: 10_000_500, tip: 0, due: null })).toBe("amount_not_whole_minor");
    expect(validateCharge({ amount: 0, tip: 0, due: null })).toBe("amount_not_positive");
    expect(validateCharge({ amount: 1000, tip: -1000, due: null })).toBe("tip_negative");
    expect(validateCharge({ amount: 1000, tip: 2000, due: null })).toBe("tip_too_large");
    expect(validateCharge({ amount: 1.5, tip: 0, due: null })).toBe("amount_not_integer");
    expect(validateCharge({ amount: 5_000_000_000, tip: 0, due: null, max: 2_000_000_000 })).toBe("amount_exceeds_max");
  });
  it("links expire between 5 minutes and 7 days", () => {
    const t = Date.parse("2026-11-03T18:00:00Z");
    expect(linkExpiry(t, 60)).toBe("2026-11-03T19:00:00.000Z");
    expect(linkExpiry(t, 1)).toBe("2026-11-03T18:05:00.000Z");
    expect(linkExpiry(t, 99_999)).toBe("2026-11-10T18:00:00.000Z");
    expect(linkExpiry(t, "x")).toBe("2026-11-03T19:00:00.000Z");
    expect(isExpired("2026-11-03T19:00:00.000Z", t)).toBe(false);
    expect(isExpired("2026-11-03T19:00:00.000Z", t + 3_600_000)).toBe(true);
  });
  it("only returns to our own origins", () => {
    const ok = ["https://sufra-planet-crm.vercel.app"];
    expect(safeReturnUrl("https://sufra-planet-crm.vercel.app/app/r/x/t/ZM05", ok)).toBeTruthy();
    expect(safeReturnUrl("https://evil.example/app", ok)).toBeNull();
    expect(safeReturnUrl("javascript:alert(1)", ok)).toBeNull();
    expect(safeReturnUrl("http://sufra-planet-crm.vercel.app/app", ok)).toBeNull();
  });
});

/* ───────── handlers against a fake Supabase (same idempotency rules as guest_record_payment) ───────── */

const RID = "11111111-1111-4111-8111-111111111111";
const CID = "22222222-2222-4222-8222-222222222222";
const BID = "33333333-3333-4333-8333-333333333333";

function fakeDb() {
  const intents = new Map<string, IntentRecord>();
  const payments: { intent: string; amount: number }[] = [];
  const check = { id: CID, restaurant_id: RID, branch_id: BID, total: 50_000_000, paid: 0, status: "open" };
  const refunds: Record<string, unknown>[] = [];
  const db: PayDb = {
    check: async (id) => (id === CID ? { ...check } : null),
    order: async () => null,
    pendingOnCheck: async () => [...intents.values()].filter((i) => i.check_id === CID && (i.status === "requires_action" || i.status === "processing")).reduce((a, i) => a + i.amount, 0),
    settings: async () => ({ payments: { provider: "paymob", methods: ["card", "wallet"], absorbFees: true }, locale: { currency: "EGP" } }),
    account: async () => null,
    intent: async (id) => intents.get(id) ?? null,
    intentByProviderOrder: async (p, oid) => [...intents.values()].find((i) => i.provider === p && i.provider_order_id === oid) ?? null,
    insertIntent: async (row) => {
      intents.set(row.id!, row as IntentRecord);
      return row as IntentRecord;
    },
    patchIntent: async (id, patch) => {
      const r = intents.get(id);
      if (r) intents.set(id, { ...r, ...patch });
    },
    record: async (id, status, ref) => {
      const r = intents.get(id);
      if (!r) throw new Error("not_found");
      if (["succeeded", "failed", "cancelled", "expired"].includes(r.status)) return { status: r.status, paymentId: r.payment_id };
      let pay: string | null = null;
      if (status === "succeeded" && r.check_id) {
        payments.push({ intent: id, amount: r.amount });
        check.paid += r.amount;
        pay = `pay_${payments.length}`;
      }
      intents.set(id, { ...r, status, provider_ref: ref ?? r.provider_ref, payment_id: pay ?? r.payment_id });
      return { status, paymentId: pay };
    },
    insertRefund: async (row) => {
      refunds.push(row);
      return { id: `rf_${refunds.length}` };
    },
    patchRefund: async () => undefined,
    hasRole: async (jwt, _rid, roles) => jwt === "manager-jwt" ? roles.includes("manager") : jwt === "cashier-jwt" ? roles.includes("cashier") : false,
    membershipOf: async () => "44444444-4444-4444-8444-444444444444",
  };
  return { db, intents, payments, check, refunds };
}

const ENV = { PAYMOB_SECRET_KEY: "egy_sk_test_x", PAYMOB_PUBLIC_KEY: "egy_pk_test_x", PAYMOB_HMAC: "HMACSECRET", PAYMOB_INTEGRATION_CARD: "4097558", PAYMOB_INTEGRATION_WALLET: "4097559", PAY_PUBLIC_BASE_URL: "https://sufra-planet-crm.vercel.app", KASHIER_API_KEY: "kkey", MOYASAR_WEBHOOK_SECRET: "mtoken" };

function deps(db: PayDb | null, env: Record<string, string> = ENV) {
  const calls: { url: string; body: unknown }[] = [];
  const logs: string[] = [];
  const d: Deps = {
    env,
    db,
    now: () => Date.parse("2026-11-03T18:00:00Z"),
    log: (e) => void logs.push(e),
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      if (String(url).endsWith("/v1/intention/")) return new Response(JSON.stringify({ id: "int_1", client_secret: "egy_csk_test_abc" }), { status: 201 });
      if (String(url).includes("/void_refund/refund")) return new Response(JSON.stringify({ id: 999, success: true }), { status: 200 });
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  };
  return { d, calls, logs };
}
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => new Request(`https://sufra-planet-crm.vercel.app/api/${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const RET = "https://sufra-planet-crm.vercel.app/app/r/sufra-zamalek/t/ZM05";

describe("/api/pay-intent", () => {
  it("creates a Paymob intention for what is due, in piastres, and returns the Unified Checkout URL", async () => {
    const f = fakeDb();
    const { d, calls } = deps(f.db);
    const res = await handleIntent(post("pay-intent", { restaurantId: RID, checkId: CID, amount: 25_000_000, tip: 2_500_000, currency: "EGP", method: "card", returnUrl: RET, splitLabel: "1 / 2" }), d);
    expect(res.status).toBe(201);
    const pi = await res.json();
    expect(pi.id).toMatch(/^pi_[0-9a-f]{24}$/);
    expect(pi.redirectUrl).toBe("https://accept.paymob.com/unifiedcheckout/?publicKey=egy_pk_test_x&clientSecret=egy_csk_test_abc");
    expect(pi.charge).toBe(27_500_000);
    const body = calls[0].body as Record<string, unknown>;
    expect(body.amount).toBe(27_500);
    expect(body.special_reference).toBe(pi.id);
    expect(body.payment_methods).toEqual([4097558]);
    expect(body.notification_url).toBe("https://sufra-planet-crm.vercel.app/api/pay-webhook-paymob");
    expect(String(body.redirection_url)).toContain(`/api/pay-callback?pi=${pi.id}`);
    expect(f.intents.get(pi.id)?.provider_order_id).toBe("int_1");
  });

  it("refuses more than is due (incl. other open intents), fractions of a piastre and foreign return URLs", async () => {
    const f = fakeDb();
    const { d } = deps(f.db);
    expect((await handleIntent(post("pay-intent", { restaurantId: RID, checkId: CID, amount: 50_001_000, returnUrl: RET }), d)).status).toBe(422);
    expect((await handleIntent(post("pay-intent", { restaurantId: RID, checkId: CID, amount: 1_000_500, returnUrl: RET }), d)).status).toBe(422);
    expect((await handleIntent(post("pay-intent", { restaurantId: RID, checkId: CID, amount: 1_000_000, returnUrl: "https://evil.example/x" }), d)).status).toBe(400);
    // two phones: the first holds 40 of 50 → the second can only take 10
    expect((await handleIntent(post("pay-intent", { restaurantId: RID, checkId: CID, amount: 40_000_000, returnUrl: RET }), d)).status).toBe(201);
    const second = await handleIntent(post("pay-intent", { restaurantId: RID, checkId: CID, amount: 20_000_000, returnUrl: RET }), d);
    expect(second.status).toBe(422);
    expect((await second.json()).due).toBe(10_000_000);
  });

  it("pay-by-link needs a staff token; {pi} in the return URL becomes the id", async () => {
    const f = fakeDb();
    const { d } = deps(f.db);
    const link = { restaurantId: RID, checkId: CID, kind: "link", amount: 10_000_000, returnUrl: "https://sufra-planet-crm.vercel.app/app/r/sufra-zamalek/link/{pi}", expiresInMin: 30 };
    expect((await handleIntent(post("pay-intent", link), d)).status).toBe(401);
    const res = await handleIntent(post("pay-intent", link, { authorization: "Bearer cashier-jwt" }), d);
    expect(res.status).toBe(201);
    const pi = await res.json();
    expect(pi.request.returnUrl).toBe(`https://sufra-planet-crm.vercel.app/app/r/sufra-zamalek/link/${pi.id}`);
    expect(pi.expiresAt).toBe("2026-11-03T18:30:00.000Z");
  });

  it("501 with an Arabic + English message (names, never values) when keys are missing", async () => {
    const { d } = deps(fakeDb().db, { PAYMOB_PUBLIC_KEY: "pk" });
    const res = await handleIntent(post("pay-intent", { restaurantId: RID, checkId: CID, amount: 1_000_000, returnUrl: RET }), d);
    expect(res.status).toBe(501);
    const j = await res.json();
    expect(j.missing).toEqual(["PAYMOB_SECRET_KEY", "PAYMOB_HMAC", "PAYMOB_INTEGRATION_CARD"]);
    expect(j.message.ar).toContain("PAYMOB_SECRET_KEY");
    expect(j.message.en).toContain("Vercel");
    expect(JSON.stringify(notConfigured("x", ["A"]))).not.toContain("pk");
  });
});

describe("webhooks — verify, then record idempotently", () => {
  async function paidIntent() {
    const f = fakeDb();
    const { d } = deps(f.db);
    const pi = await (await handleIntent(post("pay-intent", { restaurantId: RID, checkId: CID, amount: 10_000_000, returnUrl: RET }), d)).json();
    return { f, d, id: pi.id as string };
  }
  const paymobBody = (id: string, over: Record<string, unknown> = {}) => {
    const obj = { ...PAYMOB_OBJ, amount_cents: 10_000, order: { id: 217503754, merchant_order_id: id }, ...over };
    return { body: { type: "TRANSACTION", obj }, hmac: node("sha512", ENV.PAYMOB_HMAC, paymobHmacString(obj)) };
  };

  it("Paymob: good signature records once even when delivered three times", async () => {
    const { f, d, id } = await paidIntent();
    const { body, hmac } = paymobBody(id);
    for (let i = 0; i < 3; i++) expect((await handleWebhook("paymob", post(`pay-webhook-paymob?hmac=${hmac}`, body), d)).status).toBe(200);
    expect(f.payments).toHaveLength(1);
    expect(f.check.paid).toBe(10_000_000);
    expect(f.intents.get(id)?.status).toBe("succeeded");
    expect(f.intents.get(id)?.provider_ref).toBe("192036465");
  });

  it("Paymob: tampered amount / bad signature → 401, nothing recorded; late failure can't un-pay", async () => {
    const { f, d, id } = await paidIntent();
    const { body, hmac } = paymobBody(id);
    const tampered = { ...body, obj: { ...body.obj, amount_cents: 1 } };
    expect((await handleWebhook("paymob", post(`pay-webhook-paymob?hmac=${hmac}`, tampered), d)).status).toBe(401);
    expect((await handleWebhook("paymob", post("pay-webhook-paymob?hmac=deadbeef", body), d)).status).toBe(401);
    expect(f.payments).toHaveLength(0);
    await handleWebhook("paymob", post(`pay-webhook-paymob?hmac=${hmac}`, body), d);
    const fail = paymobBody(id, { success: false, id: 192036466 });
    await handleWebhook("paymob", post(`pay-webhook-paymob?hmac=${fail.hmac}`, fail.body), d);
    expect(f.intents.get(id)?.status).toBe("succeeded");
    expect(f.payments).toHaveLength(1);
  });

  it("Kashier: x-kashier-signature header", async () => {
    const { f, d, id } = await paidIntent();
    const data = { merchantOrderId: id, transactionId: "TX-9", status: "SUCCESS", amount: "100.00", currency: "EGP", signatureKeys: ["merchantOrderId", "transactionId", "status", "amount", "currency"] };
    const sig = node("sha256", ENV.KASHIER_API_KEY, kashierSignaturePayload(data));
    expect((await handleWebhook("kashier", post("pay-webhook-kashier", { event: "pay", data: { ...data, amount: "1.00" } }, { "x-kashier-signature": sig }), d)).status).toBe(401);
    expect((await handleWebhook("kashier", post("pay-webhook-kashier", { event: "pay", data }, { "x-kashier-signature": sig }), d)).status).toBe(200);
    expect(f.intents.get(id)?.status).toBe("succeeded");
    expect(f.intents.get(id)?.provider_ref).toBe("TX-9");
  });

  it("Moyasar: secret_token, fee in halalas → units", async () => {
    const { f, d, id } = await paidIntent();
    const body = { id: "ev_1", type: "payment_paid", secret_token: "mtoken", data: { id: "pay_77", status: "paid", amount: 10_000, fee: 275, metadata: { intent_id: id } } };
    expect((await handleWebhook("moyasar", post("pay-webhook-moyasar", { ...body, secret_token: "nope" }), d)).status).toBe(401);
    expect((await handleWebhook("moyasar", post("pay-webhook-moyasar", body), d)).status).toBe(200);
    expect(f.intents.get(id)?.fee).toBe(275_000);
    expect(f.intents.get(id)?.status).toBe("succeeded");
  });

  it("without Supabase it verifies and logs instead of writing", async () => {
    const { d, logs } = deps(null);
    const { body, hmac } = paymobBody("pi_aaaaaaaaaaaaaaaaaaaaaaaa");
    expect((await handleWebhook("paymob", post(`pay-webhook-paymob?hmac=${hmac}`, body), d)).status).toBe(200);
    expect(logs).toContain("settle.unrecorded");
  });
});

describe("/api/pay-refund and /api/pay-status", () => {
  it("refund: managers only, never more than was charged", async () => {
    const f = fakeDb();
    const { d } = deps(f.db);
    const pi = await (await handleIntent(post("pay-intent", { restaurantId: RID, checkId: CID, amount: 10_000_000, returnUrl: RET }), d)).json();
    await f.db.record(pi.id, "succeeded", "192036465", null);
    expect((await handleRefund(post("pay-refund", { intentId: pi.id, amount: 1_000_000, reason: "x" }, { authorization: "Bearer cashier-jwt" }), d)).status).toBe(403);
    expect((await handleRefund(post("pay-refund", { intentId: pi.id, amount: 11_000_000, reason: "x" }, { authorization: "Bearer manager-jwt" }), d)).status).toBe(422);
    const ok = await handleRefund(post("pay-refund", { intentId: pi.id, amount: 4_000_000, reason: "missing item" }, { authorization: "Bearer manager-jwt" }), d);
    expect(ok.status).toBe(200);
    expect(f.intents.get(pi.id)?.refunded).toBe(4_000_000);
    expect(f.refunds).toHaveLength(1);
  });
  it("status reports booleans only", async () => {
    const { d } = deps(null);
    const j = await handleStatus(new Request("https://sufra-planet-crm.vercel.app/api/pay-status"), d).json();
    expect(j.providers.paymob.configured).toBe(true);
    expect(j.providers.kashier.missing).toContain("KASHIER_SECRET_KEY");
    expect(JSON.stringify(j)).not.toContain(ENV.PAYMOB_SECRET_KEY);
    expect(JSON.stringify(j)).not.toContain(ENV.PAYMOB_HMAC);
    expect(j.webhooks.moyasar).toBe("https://sufra-planet-crm.vercel.app/api/pay-webhook-moyasar");
  });
});

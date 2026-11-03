import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "@/data/local/LocalAdapter";
import { DEMO_SLUG } from "@/data/seed";
import type { Check, Payment, PaymentIntentRow } from "@/data/types";
import { major } from "@/lib/money";
import { attachDemoRepo, demoProvider } from "@/modules/guest/pay";
import { createPayLink, onIntentSucceeded, createPaymentIntent, refundIntent } from "./api";
import { recordIntentLocal } from "./record";
import { feeOf, linkState, reconcile, settlements, timeLeft, toCsv, unitsDecimal, waPhone, whatsappUrl } from "./reconcile";
import { DEFAULT_PAYMENT_SETTINGS } from "./config";

const now = "2026-11-03T18:00:00.000Z";
const intent = (p: Partial<PaymentIntentRow>): PaymentIntentRow => ({
  id: "pi_1", restaurantId: "r", createdAt: now, updatedAt: now, branchId: "b", checkId: "c1", orderId: null, kind: "guest", provider: "paymob", mode: "test", method: "card",
  status: "succeeded", amount: major(100), tip: 0, currency: "EGP", fee: null, refunded: 0, splitLabel: null, redirectUrl: null, providerRef: "TX1", providerOrderId: null,
  failureReason: null, request: {}, paymentId: null, purposeRef: null, note: "", customer: null, createdBy: null, expiresAt: "2026-11-03T18:15:00.000Z", payoutId: null, ...p,
});
const pay = (p: Partial<Payment>): Payment => ({ id: "p1", restaurantId: "r", createdAt: now, updatedAt: now, branchId: "b", checkId: "c1", method: "online", amount: major(100), tip: 0, tendered: null, change: null, reference: "pi_1", splitLabel: null, status: "captured", takenBy: null, refundOf: null, ...p });
const check = (p: Partial<Check>): Check => ({ id: "c1", restaurantId: "r", createdAt: now, updatedAt: now, branchId: "b", tableIds: [], status: "paid", guests: 2, reservationId: null, customerId: null, discount: null, discountApprovedBy: null, subtotal: 0, discountTotal: 0, service: 0, vat: 0, total: major(100), paid: major(100), receiptNo: null, etaUuid: null, openedAt: now, closedAt: null, ...p });

describe("reconciliation", () => {
  it("matches by payment id / reference and flags the four kinds of problems", () => {
    const intents = [
      intent({ id: "pi_1", paymentId: "p1" }), // matched
      intent({ id: "pi_2", checkId: "c2" }), // gateway paid, no POS row
      intent({ id: "pi_3", checkId: "c3", amount: major(80) }), // amounts differ
      intent({ id: "pi_4", checkId: "c4" }), // paid in full, check open
      intent({ id: "pi_5", status: "failed" }), // ignored
      intent({ id: "pi_6", kind: "gift_card", checkId: null }), // no check — not a POS matter
      intent({ id: "pi_7", kind: "online_order", checkId: "c7", paymentId: "p7" }), // prepaid delivery: open until handed over — fine
    ];
    const payments = [pay({ id: "p1" }), pay({ id: "p3", checkId: "c3", reference: "pi_3", amount: major(75) }), pay({ id: "p4", checkId: "c4", reference: "pi_4" }), pay({ id: "p9", checkId: "c9", reference: "typed-by-hand" }), pay({ id: "pc", method: "cash", reference: null }), pay({ id: "p7", checkId: "c7", reference: "pi_7" })];
    const checks = [check({}), check({ id: "c2" }), check({ id: "c3" }), check({ id: "c4", status: "bill_requested", tableIds: ["t4"] }), check({ id: "c9" }), check({ id: "c7", status: "open" })];
    const r = reconcile(intents, payments, checks);
    expect(r.matched).toBe(3);
    expect(r.issues.map((i) => i.issue).sort()).toEqual(["amount_mismatch", "check_left_open", "paid_not_recorded", "tender_without_gateway"]);
    expect(r.issues.find((i) => i.issue === "amount_mismatch")!.diff).toBe(major(5));
    expect(r.issues.find((i) => i.issue === "tender_without_gateway")!.payment!.id).toBe("p9");
  });
});

describe("settlements & fees", () => {
  it("estimates fees in whole piastres when the provider didn't report one; groups per provider/day/payout", () => {
    expect(feeOf(intent({ amount: major(185.5) }), DEFAULT_PAYMENT_SETTINGS)).toEqual({ fee: major(5.1) + major(3), estimated: true }); // 2.75% of 185.50 = 5.10125 → 5.10
    expect(feeOf(intent({ fee: major(4) }), DEFAULT_PAYMENT_SETTINGS)).toEqual({ fee: major(4), estimated: false });
    const s = settlements(
      [intent({ id: "a", fee: major(3) }), intent({ id: "b", fee: major(2), refunded: major(10) }), intent({ id: "c", provider: "kashier", fee: major(1) }), intent({ id: "d", status: "failed" }), intent({ id: "e", createdAt: "2026-11-02T10:00:00.000Z", fee: 0, payoutId: "po1" })],
      [{ id: "po1", restaurantId: "r", createdAt: now, updatedAt: now, provider: "paymob", periodStart: "2026-11-02", periodEnd: "2026-11-02", gross: major(100), fees: 0, net: major(100), reference: "TR-1", paidAt: now, note: "" }],
      DEFAULT_PAYMENT_SETTINGS,
    );
    const pm = s.find((x) => x.provider === "paymob" && x.day === "2026-11-03")!;
    expect(pm).toMatchObject({ count: 2, gross: major(200), fees: major(5), refunds: major(10), net: major(185), expected: "2026-11-05", payout: null });
    expect(s.find((x) => x.day === "2026-11-02")!.payout?.reference).toBe("TR-1");
    expect(s).toHaveLength(3);
  });
});

describe("links", () => {
  it("state and countdown follow the expiry", () => {
    const t = Date.parse(now);
    expect(linkState({ status: "requires_action", expiresAt: "2026-11-03T18:15:00.000Z" }, t)).toBe("waiting");
    expect(linkState({ status: "requires_action", expiresAt: "2026-11-03T18:15:00.000Z" }, t + 15 * 60_000)).toBe("expired");
    expect(linkState({ status: "succeeded", expiresAt: "2026-11-03T18:15:00.000Z" }, t + 99 * 60_000)).toBe("paid");
    expect(timeLeft("2026-11-03T18:15:00.000Z", t)).toBe("15:00");
    expect(timeLeft("2026-11-03T20:00:05.000Z", t)).toBe("2:00:05");
    expect(timeLeft("2026-11-03T18:00:00.000Z", t)).toBeNull();
  });
  it("WhatsApp click-to-chat numbers (Egypt, KSA, Arabic digits)", () => {
    expect(waPhone("01005551208")).toBe("201005551208");
    expect(waPhone("٠١٠٠٥٥٥١٢٠٨")).toBe("201005551208");
    expect(waPhone("0551234567")).toBe("966551234567");
    expect(waPhone("+20 100 555 1208")).toBe("201005551208");
    expect(whatsappUrl("", "hi there")).toBe("https://wa.me/?text=hi%20there");
  });
  it("CSV: BOM, quoting, formula guard, exact decimals", () => {
    const csv = toCsv(["a", "b"], [["=SUM(1)", 'say "hi", ok'], ["-12.50", "سفرة"]]);
    expect(csv.startsWith("﻿a,b\r\n")).toBe(true);
    expect(csv).toContain(`'=SUM(1),"say ""hi"", ok"`);
    expect(csv).toContain("-12.50,سفرة");
    expect(unitsDecimal(major(185.5))).toBe("185.50");
    expect(unitsDecimal(-major(0.05))).toBe("-0.05");
  });
});

/* ───────── local backend: DemoProvider + recorder (the webhook's twin) ───────── */

let n = 0;
const open: LocalAdapter[] = [];
afterEach(() => {
  attachDemoRepo(null);
  while (open.length) open.pop()!.close();
});
async function local() {
  const repo = new LocalAdapter({ name: `pay${++n}`, sessionKey: `pay${n}.s` });
  open.push(repo);
  await repo.ready();
  const [r] = await repo.list("restaurants", { where: { slug: DEMO_SLUG } });
  const c = (await repo.list("checks", { where: { status: "open", restaurantId: r.id } })).find((x) => x.tableIds.length)!;
  return { repo, r, c };
}

describe("pay-by-link on the local backend", () => {
  it("creates a link row, the demo checkout records the payment exactly once, and the check is covered", async () => {
    const { repo, c } = await local();
    const due = c.total - c.paid;
    const pi = await createPayLink(repo, c, { restaurantSlug: DEMO_SLUG, amount: due, currency: "EGP", note: "test", expiresInMin: 30, customer: { name: "", phone: "01005551209" }, createdBy: null, lang: "ar" });
    expect(pi.redirectUrl).toContain(`/r/${DEMO_SLUG}/pay/${pi.id}`);
    expect(pi.request.returnUrl).toContain(`/link/${pi.id}`);
    const row = (await repo.get("paymentIntents", pi.id))!;
    expect(row).toMatchObject({ kind: "link", status: "requires_action", checkId: c.id, branchId: c.branchId, note: "test" });
    expect(Date.parse(row.expiresAt) - Date.parse(row.createdAt)).toBe(30 * 60_000);

    await demoProvider.complete(pi.id, "succeeded");
    await demoProvider.complete(pi.id, "succeeded"); // retried webhook
    expect((await recordIntentLocal(repo, pi.id)).duplicate).toBe(true);
    const pays = await repo.list("payments", { where: { checkId: c.id, reference: pi.id } });
    expect(pays).toHaveLength(1);
    expect(pays[0].method).toBe("online");
    expect((await repo.get("checks", c.id))!.paid).toBe(c.total);
    expect((await repo.get("paymentIntents", pi.id))!).toMatchObject({ status: "succeeded", paymentId: pays[0].id });
  });

  it("expired links can't be paid; amounts must be whole piastres", async () => {
    const { repo, c } = await local();
    const pi = await createPayLink(repo, c, { restaurantSlug: DEMO_SLUG, amount: major(10), currency: "EGP", note: "", expiresInMin: 5, customer: null, createdBy: null, lang: "en" });
    await repo.update("paymentIntents", pi.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect((await demoProvider.retrieve(pi.id))!.status).toBe("expired");
    expect((await demoProvider.complete(pi.id, "succeeded"))!.status).toBe("expired");
    expect(await repo.list("payments", { where: { reference: pi.id } })).toHaveLength(0);
    await expect(createPayLink(repo, c, { restaurantSlug: DEMO_SLUG, amount: major(10) + 500, currency: "EGP", note: "", expiresInMin: 5, customer: null, createdBy: null, lang: "en" })).rejects.toThrow();
  });

  it("check-less intents (gift cards) call the registered handler once; refunds can't exceed the charge", async () => {
    const { repo, r } = await local();
    const seen: string[] = [];
    const off = onIntentSucceeded("gift_card", (row) => void seen.push(row.purposeRef ?? ""));
    const pi = await createPaymentIntent(repo, { restaurantId: r.id, restaurantSlug: DEMO_SLUG, kind: "gift_card", amount: major(500), currency: "EGP", purposeRef: "GC-1", returnUrl: "http://localhost/app/x" });
    await demoProvider.complete(pi.id, "succeeded");
    await demoProvider.complete(pi.id, "succeeded");
    off();
    expect(seen).toEqual(["GC-1"]);
    const row = (await repo.get("paymentIntents", pi.id))!;
    expect(row.paymentId).toBeNull();
    await refundIntent(repo, row, major(200), "test", { requestedBy: null, approvedBy: null });
    const after = (await repo.get("paymentIntents", pi.id))!;
    expect(after.refunded).toBe(major(200));
    await expect(refundIntent(repo, after, major(301), "x", { requestedBy: null, approvedBy: null })).rejects.toThrow("bad_amount");
    expect(await repo.list("paymentRefunds", { where: { intentId: pi.id } })).toHaveLength(1);
  });

  it("seeded demo rows reconcile: the delivery link matches, table 15 is flagged", async () => {
    const { repo } = await local();
    const intents = await repo.list("paymentIntents");
    const r = reconcile(intents, await repo.list("payments"), await repo.list("checks"));
    expect(intents.length).toBeGreaterThanOrEqual(6);
    expect(r.matched).toBeGreaterThanOrEqual(1);
    expect(r.issues.some((i) => i.issue === "paid_not_recorded" && i.intent?.id === "pi_seed_t15")).toBe(true);
  });
});

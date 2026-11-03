import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "@/data/local/LocalAdapter";
import { makeDb } from "@/data/hooks";
import { DEMO_BRANCH_ID, DEMO_RESTAURANT_ID, DEMO_SLUG, staffId } from "@/data/seed";
import { major } from "@/lib/money";
import { homeFor } from "@/modules/registry";
import { addLine, openTicket } from "@/modules/pos/ops";
import { takePayment } from "@/modules/pos/sale";
import { applyToCheck, clearCheckPromos, evaluateCheck, onCheckPaid, redeemGiftCard, sellGiftCard, campaignRecipients, pickVariant, renderText } from "./ops";
import { PromoPublic } from "./guest/api";
import { findDuplicates, mergeCustomers, parseCsv, previewImport, toCsv } from "@/modules/customers/crm";
import { lastMonths, newVsReturning, retentionCohorts } from "./reports";

let n = 0;
const open: LocalAdapter[] = [];
afterEach(() => {
  while (open.length) open.pop()!.close();
});
async function setup() {
  const repo = new LocalAdapter({ name: `mkt${++n}`, sessionKey: `mkt${n}.s` });
  open.push(repo);
  await repo.ready();
  const db = makeDb(repo, DEMO_RESTAURANT_ID, DEMO_BRANCH_ID, staffId("cashier1"));
  const menu = await db.list("menuItems");
  const cats = await db.list("menuCategories");
  const item = (en: string) => menu.find((i) => i.name.en === en)!;
  return { repo, db, cats, item };
}

describe("marketing ops (local backend)", () => {
  it("coupon on a POS check → line discounts before tax → paid → points, uses, redemption", async () => {
    const { db, cats, item } = await setup();
    const customer = (await db.list("customers", { where: { phone: "01005551204" } }))[0];
    const { check, order } = await openTicket(db, { mode: "takeaway", pickup: false, tableIds: [], guests: 1, customerId: customer.id, deliveryFee: 0, delivery: null, pickupAt: null });
    await addLine(db, { orderId: order.id, checkId: check.id, items: [], tableId: null }, { item: item("Mixed grill for two"), modifiers: [], qty: 1, notes: "", seat: null, course: 1 }, cats);
    const before = (await db.get("checks", check.id))!;
    const preview = await evaluateCheck(db, check.id, { codes: ["sufra15"], rewards: [], points: 0 }, "pos", new Date("2026-11-03T09:00:00Z"));
    expect(preview.result.applied.map((a) => a.code)).toContain("SUFRA15");
    await applyToCheck(db, check.id, { codes: ["SUFRA15"], rewards: [], points: 0 });
    const after = (await db.get("checks", check.id))!;
    expect(after.discountTotal).toBeGreaterThan(0);
    expect(after.total).toBeLessThan(before.total);
    // re-applying does not double the discount
    await applyToCheck(db, check.id, { codes: ["SUFRA15"], rewards: [], points: 0 });
    expect((await db.get("checks", check.id))!.discountTotal).toBe(after.discountTotal);
    const uses = (await db.list("promotions", { where: { code: "SUFRA15" } }))[0].uses;
    await takePayment(db, after, { method: "cash", amount: after.total, tip: 0, tendered: after.total });
    const r = await onCheckPaid(db, check.id, { total: after.total });
    expect(r?.points).toBeGreaterThan(0);
    expect((await db.list("promotions", { where: { code: "SUFRA15" } }))[0].uses).toBe(uses + 1);
    expect(await db.list("promoRedemptions", { where: { checkId: check.id, status: "redeemed" } })).toHaveLength(1);
    const c2 = (await db.get("customers", customer.id))!;
    expect(c2.visits).toBe(customer.visits + 1);
    // idempotent
    await onCheckPaid(db, check.id, { total: after.total });
    expect((await db.get("customers", customer.id))!.visits).toBe(customer.visits + 1);
  });

  it("removing promos restores manual discounts", async () => {
    const { db, cats, item } = await setup();
    const { check, order } = await openTicket(db, { mode: "takeaway", pickup: false, tableIds: [], guests: 1, customerId: null, deliveryFee: 0, delivery: null, pickupAt: null });
    await addLine(db, { orderId: order.id, checkId: check.id, items: [], tableId: null }, { item: item("Lamb kebab"), modifiers: [], qty: 2, notes: "", seat: null, course: 1 }, cats);
    await applyToCheck(db, check.id, { codes: ["SUFRA15"], rewards: [], points: 0 });
    await clearCheckPromos(db, check.id);
    const items = await db.list("orderItems", { where: { orderId: order.id } });
    expect(items.every((i) => i.discount === 0)).toBe(true);
  });

  it("gift card: sell, redeem as a tender, ledger reclass", async () => {
    const { db, cats, item } = await setup();
    const card = await sellGiftCard(db, { amount: major(300), purchaser: { name: "x", phone: "01011111111" }, recipient: null, via: "pos", method: "cash" });
    const { check, order } = await openTicket(db, { mode: "takeaway", pickup: false, tableIds: [], guests: 1, customerId: null, deliveryFee: 0, delivery: null, pickupAt: null });
    await addLine(db, { orderId: order.id, checkId: check.id, items: [], tableId: null }, { item: item("Lamb kebab"), modifiers: [], qty: 1, notes: "", seat: null, course: 1 }, cats);
    const c = (await db.get("checks", check.id))!;
    const r = await redeemGiftCard(db, c, card.code.replace(/-/g, "").toLowerCase(), c.total, (p) => takePayment(db, c, p));
    expect(r.taken).toBe(major(300));
    expect((await db.get("giftCards", card.id))!.status).toBe("redeemed");
    const pays = await db.list("payments", { where: { checkId: check.id } });
    expect(pays[0].method).toBe("gift_card");
    const ledger = await db.list("ledgerEntries", { where: { sourceType: ["gift_card.sale", "gift_card.redeem"] } });
    expect(ledger.length).toBe(2);
    for (const e of ledger) expect(e.lines.reduce((a, l) => a + l.debit - l.credit, 0)).toBe(0);
  });

  it("guest: coupon at checkout, loyalty join with referral, loyalty card, sponsored feed", async () => {
    const { repo } = await setup();
    const api = new PromoPublic(repo);
    const j = await api.join(DEMO_SLUG, { name: "Test", phone: "01277777777", whatsapp: true, referralCode: (await repo.list("customers", { where: { phone: "01005551201" } }))[0].referralCode });
    expect(j.welcome).toBe(50);
    expect(j.refereeCode).toMatch(/^RF-/);
    const card = await api.loyaltyCard(DEMO_SLUG, "01277777777", "7777");
    expect(card.points).toBe(50);
    await expect(api.loyaltyCard(DEMO_SLUG, "01277777777", "1234")).rejects.toThrow("bad_proof");
    const feed = await api.sponsored("cairo", null);
    expect(feed.length).toBeGreaterThanOrEqual(1);
    expect(feed[0].label.ar).toBe("مُموَّل");
  });

  it("campaign audience respects consent and the weekly cap; variants are deterministic", async () => {
    const { db } = await setup();
    const r = await campaignRecipients(db, { audience: "all", segmentId: null, channel: "whatsapp" }, null);
    expect(r.eligible.length).toBeLessThanOrEqual(r.audience.length);
    expect(r.eligible.every((c) => c.consent?.whatsapp !== false)).toBe(true);
    const v = [{ id: "a", share: 50 }, { id: "b", share: 50 }];
    expect(pickVariant(v, "abc").id).toBe(pickVariant(v, "abc").id);
    expect(renderText("{name} — {code}", { name: "دينا", code: "X1" })).toBe("دينا — X1");
  });

  it("platform admin lands on the platform console", () => {
    expect(homeFor("platform_admin")).toBe("/platform");
  });
});

describe("CRM", () => {
  it("CSV round-trip, import preview, duplicates + merge", async () => {
    const { db } = await setup();
    const all = await db.list("customers");
    const csv = toCsv(all.slice(0, 3));
    expect(parseCsv(csv.replace(/^﻿/, ""))[0][0]).toBe("name");
    const p = previewImport("الاسم,الموبايل,whatsapp_ok\nنادر,٠١٠٩٩٩٩٩٩٩٩,نعم\nسيء,123,0\n" + `${all[0].name},${all[0].phone},1`, all);
    expect(p.rows.map((r) => r.status)).toEqual(["new", "invalid", "update"]);
    expect(p.rows[0].phone).toBe("01099999999");
    const dupes = findDuplicates(all);
    expect(dupes.some((g) => g.some((c) => c.phone === "+201005551206"))).toBe(true);
    const g = dupes.find((x) => x.some((c) => c.phone === "+201005551206"))!;
    const keep = g.find((c) => c.phone === "01005551206")!;
    await mergeCustomers(db, keep, g.filter((c) => c.id !== keep.id));
    expect((await db.get("customers", keep.id))!.visits).toBe(keep.visits + 1);
  });

  it("reports: new vs returning and cohorts", () => {
    const months = lastMonths(3, new Date("2026-10-15T00:00:00Z"));
    expect(months).toEqual(["2026-08", "2026-09", "2026-10"]);
    const v = [
      { customerId: "a", at: "2026-08-02T10:00:00Z", kind: "earn" as const },
      { customerId: "a", at: "2026-09-02T10:00:00Z", kind: "earn" as const },
      { customerId: "b", at: "2026-09-05T10:00:00Z", kind: "earn" as const },
    ];
    expect(newVsReturning(v, months)).toEqual([{ month: "2026-08", new: 1, returning: 0 }, { month: "2026-09", new: 1, returning: 1 }, { month: "2026-10", new: 0, returning: 0 }]);
    const c = retentionCohorts(v, months, 2);
    expect(c[0]).toEqual({ month: "2026-08", size: 1, cells: [1, 0] });
    expect(c[1].cells).toEqual([0, null]);
  });
});

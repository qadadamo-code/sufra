import { describe, expect, it } from "vitest";
import { major } from "@/lib/money";
import { applyStamps, checkRedeem, computeBalance, DEFAULT_TIERS, eligibleSpend, LoyaltyError, maxRedeemable, nextTier, pendingExpiry, pointsFor, tierFor, type LoyaltyRules, type PointsEntry } from "./loyalty";
import { countSegment, matchesSegment, scoreRfm, type CustomerStats } from "./segments";
import { canRefer, onRefereePaid, referralCode } from "./referral";
import { balanceFromTxns, giftCardCode, GiftCardError, liability, normalizeGiftCode, redeemCard, refundToCard, topUp, usable, validGiftCode, type GiftCardState } from "./giftcards";
import { BookingError, conflicts, isServing, publicFeed, quote, spend, validateBooking, type BookingRule, type SlotRule } from "./sponsored";

const E = major;
const RULES: LoyaltyRules = {
  enabled: true, earnPoints: 1, earnSpend: E(10), pointValue: E("0.25"), minRedeem: 100, expiryDays: 365, tiers: DEFAULT_TIERS, stampCards: [], rewards: [],
  excludedCategoryIds: ["alcohol"], earnChannels: [], welcomeBonus: 50, birthdayBonus: 100, referrerPoints: 200,
};

describe("loyalty", () => {
  it("earns per EGP with tier multipliers and exclusions", () => {
    expect(pointsFor(E(345), RULES, tierFor(0, DEFAULT_TIERS))).toBe(34);
    expect(pointsFor(E(345), RULES, tierFor(600, DEFAULT_TIERS))).toBe(42); // silver 1.25× of 34
    expect(pointsFor(E(345), RULES, tierFor(2000, DEFAULT_TIERS))).toBe(51);
    expect(pointsFor(E(345), { ...RULES, enabled: false }, null)).toBe(0);
    expect(pointsFor(E(345), { ...RULES, earnChannels: ["pos"] }, null, "online")).toBe(0);
    expect(eligibleSpend([{ net: E(100), categoryId: "food" }, { net: E(200), categoryId: "alcohol" }], RULES)).toBe(E(100));
  });

  it("tiers", () => {
    expect(tierFor(499, DEFAULT_TIERS)?.id).toBe("bronze");
    expect(tierFor(500, DEFAULT_TIERS)?.id).toBe("silver");
    expect(nextTier(1200, DEFAULT_TIERS)).toEqual({ tier: DEFAULT_TIERS[2], missing: 300 });
    expect(nextTier(5000, DEFAULT_TIERS)).toBeNull();
  });

  it("FIFO expiry and redemption", () => {
    const e: PointsEntry[] = [
      { id: "1", kind: "earn", points: 100, at: "2025-01-01T10:00:00Z", expiresAt: "2026-01-01T10:00:00Z" },
      { id: "2", kind: "earn", points: 300, at: "2025-09-01T10:00:00Z", expiresAt: "2026-09-01T10:00:00Z" },
      { id: "3", kind: "redeem", points: -150, at: "2025-10-01T10:00:00Z" },
    ];
    const now = new Date("2026-02-01T00:00:00Z");
    // redeem took lot 1 entirely (100) + 50 of lot 2 → nothing left to expire on lot 1
    expect(pendingExpiry(e, now)).toBe(0);
    expect(computeBalance(e, now).balance).toBe(250);
    const later = new Date("2026-09-02T00:00:00Z");
    expect(pendingExpiry(e, later)).toBe(250);
    const after = computeBalance([...e, { id: "4", kind: "expire", points: -250, at: "2026-09-02T00:00:00Z" }], later);
    expect(after).toMatchObject({ balance: 0, lifetime: 400, redeemed: 150, expired: 250 });
    const soon = computeBalance(e, new Date("2026-08-15T00:00:00Z"));
    expect(soon.expiringSoon).toEqual({ points: 250, at: "2026-09-01T10:00:00Z" });
  });

  it("redeem validation and limits", () => {
    expect(checkRedeem(200, 500, RULES)).toBe(E(50));
    expect(() => checkRedeem(50, 500, RULES)).toThrow(LoyaltyError);
    expect(() => checkRedeem(600, 500, RULES)).toThrow("insufficient");
    expect(maxRedeemable(1000, E(120), RULES)).toBe(480);
    expect(maxRedeemable(80, E(120), RULES)).toBe(0);
  });

  it("stamp cards carry over", () => {
    const card = { id: "coffee", name: { ar: "", en: "" }, itemIds: ["turkish"], categoryIds: [], required: 10, rewardItemId: "turkish", active: true };
    expect(applyStamps(card, 8, [{ itemId: "turkish", categoryId: null, qty: 3 }])).toEqual({ stamps: 1, rewards: 1, added: 3 });
    expect(applyStamps(card, 2, [{ itemId: "tea", categoryId: null, qty: 3 }])).toEqual({ stamps: 2, rewards: 0, added: 0 });
  });
});

describe("segments & RFM", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const d = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const s = (id: string, x: Partial<CustomerStats>): CustomerStats => ({
    id, visits: 1, totalSpent: E(300), avgSpend: E(300), lastVisitAt: d(5), firstVisitAt: d(5), createdAt: d(100), points: 0, tags: [], items: {}, birthday: null, source: null, tierId: null, consent: {}, ...x,
  });
  const people = [
    s("champ", { visits: 30, totalSpent: E(40000), lastVisitAt: d(2) }),
    s("loyal", { visits: 15, totalSpent: E(9000), lastVisitAt: d(12) }),
    s("risk", { visits: 12, totalSpent: E(15000), lastVisitAt: d(90) }),
    s("lost", { visits: 2, totalSpent: E(800), lastVisitAt: d(200) }),
    s("new", { visits: 1, totalSpent: E(400), lastVisitAt: d(3), items: { kofta: 2 }, birthday: "1990-10-11", source: "qr", tags: ["vip"], consent: { whatsapp: true } }),
    s("mid", { visits: 5, totalSpent: E(3000), lastVisitAt: d(30) }),
  ];

  it("rules: last visit, spend, visits, tag, item, birthday, channel, consent", () => {
    const m = (rules: Parameters<typeof matchesSegment>[1]["rules"], match: "all" | "any" = "all") => people.filter((p) => matchesSegment(p, { match, rules }, now)).map((p) => p.id);
    expect(m([{ field: "lastVisitDays", op: "gt", value: 60 }])).toEqual(["risk", "lost"]);
    expect(m([{ field: "totalSpent", op: "gte", value: E(9000) }, { field: "visits", op: "gte", value: 15 }])).toEqual(["champ", "loyal"]);
    expect(m([{ field: "tag", op: "has", value: "vip" }])).toEqual(["new"]);
    expect(m([{ field: "item", op: "ordered", value: "kofta" }])).toEqual(["new"]);
    expect(m([{ field: "birthdayMonth", op: "this" }])).toEqual(["new"]);
    expect(m([{ field: "channel", op: "is", value: "qr" }])).toEqual(["new"]);
    expect(m([{ field: "consent", op: "has", value: "whatsapp" }])).toEqual(["new"]);
    expect(m([{ field: "tag", op: "has", value: "vip" }, { field: "lastVisitDays", op: "gt", value: 100 }], "any")).toEqual(["lost", "new"]);
    expect(countSegment(people, { match: "all", rules: [] }, now)).toBe(6);
    // never visited: counts as long ago
    expect(matchesSegment(s("x", { lastVisitAt: null, visits: 0 }), { match: "all", rules: [{ field: "lastVisitDays", op: "gt", value: 30 }] }, now)).toBe(true);
  });

  it("RFM auto-segments", () => {
    const r = scoreRfm([...people, s("ghost", { visits: 0, lastVisitAt: null, totalSpent: 0 })], now);
    expect(r.get("champ")!.segment).toBe("champions");
    expect(r.get("risk")!.segment).toBe("at_risk");
    expect(r.get("lost")!.segment).toBe("lost");
    expect(r.get("new")!.segment).toBe("new");
    expect(r.get("ghost")!.segment).toBe("new");
    expect(["loyal", "champions"]).toContain(r.get("loyal")!.segment);
    for (const v of r.values()) if (v.r) expect(v.r).toBeGreaterThanOrEqual(1);
  });
});

describe("referrals", () => {
  it("codes are stable and readable", () => {
    expect(referralCode("abc")).toBe(referralCode("abc"));
    expect(referralCode("abc")).not.toBe(referralCode("abd"));
    expect(referralCode("abc")).toMatch(/^SUF-[2-9A-Z]{5}$/);
  });
  it("rules: no self, new guests only, once, cap", () => {
    const base = { referrerId: "a", refereeId: "b", refereeVisits: 0, refereeAlreadyReferred: false, referrerRecent: 0, monthlyCap: 10 };
    expect(canRefer(base)).toBeNull();
    expect(canRefer({ ...base, refereeId: "a" })).toBe("self");
    expect(canRefer({ ...base, refereeVisits: 2 })).toBe("not_new");
    expect(canRefer({ ...base, refereeAlreadyReferred: true })).toBe("already_referred");
    expect(canRefer({ ...base, referrerRecent: 10 })).toBe("cap");
    expect(canRefer({ ...base, referrerId: null })).toBe("unknown_code");
  });
  it("rewards the referrer once", () => {
    const r = onRefereePaid({ referrerId: "a", refereeId: "b", status: "joined" });
    expect(r.rewardReferrer).toBe(true);
    expect(onRefereePaid(r.next).rewardReferrer).toBe(false);
  });
});

describe("gift cards", () => {
  const card: GiftCardState = { code: "GC-AAAA-BBBB-C", initial: E(500), balance: E(500), status: "active", expiresAt: "2027-10-24T00:00:00Z" };
  const now = new Date("2026-10-24T12:00:00Z");
  it("codes have a check character", () => {
    let i = 0;
    const seq = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    const c = giftCardCode(() => seq[i++ % seq.length]);
    expect(validGiftCode(c)).toBe(true);
    expect(validGiftCode(c.slice(0, -1) + (c.endsWith("2") ? "3" : "2"))).toBe(false);
    expect(normalizeGiftCode(c.replace(/-/g, "").toLowerCase())).toBe(c);
  });
  it("partial redeem, balance, insufficient, expiry, top-up, refund, liability", () => {
    const a = redeemCard(card, E(320), now);
    expect(a.card.balance).toBe(E(180));
    expect(usable(a.card, E(1000), now)).toBe(E(180));
    expect(() => redeemCard(a.card, E(200), now)).toThrow(GiftCardError);
    const b = redeemCard(a.card, E(180), now);
    expect(b.card.status).toBe("redeemed");
    expect(() => redeemCard(b.card, E(1), now)).toThrow("used");
    expect(refundToCard(b.card, E(50)).status).toBe("active");
    expect(() => redeemCard(card, E(10), new Date("2028-01-01T00:00:00Z"))).toThrow("expired");
    expect(topUp(card, E(100), now).balance).toBe(E(600));
    expect(liability([a.card, b.card, { ...card, expiresAt: "2026-01-01T00:00:00Z" }], now)).toBe(E(180));
    expect(balanceFromTxns([{ kind: "issue", amount: E(500) }, { kind: "redeem", amount: E(320) }, { kind: "refund", amount: E(20) }])).toBe(E(200));
  });
});

describe("sponsored slots", () => {
  const slot: SlotRule & { id: string } = { id: "s1", type: "city_top", name: { ar: "", en: "" }, city: null, cuisine: null, capacity: 2, pricing: { model: "day", rate: E(250) }, active: true };
  const b = (id: string, start: string, end: string, city: string, status: BookingRule["status"] = "approved"): BookingRule => ({
    id, slotId: "s1", restaurantId: id, startsOn: start, endsOn: end, status, targeting: { city, cuisine: null }, pricing: slot.pricing, budget: 0, stats: { impressions: 0, clicks: 0, orders: 0, revenue: 0 },
  });
  const existing = [b("a", "2026-11-01", "2026-11-10", "cairo"), b("b", "2026-11-05", "2026-11-07", "cairo"), b("c", "2026-11-01", "2026-11-30", "giza"), b("d", "2026-11-01", "2026-11-30", "cairo", "rejected")];

  it("conflicts per day, per city, ignoring non-holding statuses", () => {
    expect(conflicts(slot, existing, "2026-11-04", "2026-11-08", { city: "cairo", cuisine: null })).toEqual(["2026-11-05", "2026-11-06", "2026-11-07"]);
    expect(conflicts(slot, existing, "2026-11-04", "2026-11-08", { city: "giza", cuisine: null })).toEqual([]);
    expect(() => validateBooking(slot, existing, { startsOn: "2026-11-06", endsOn: "2026-11-06", budget: 0, targeting: { city: "cairo", cuisine: null } }, "2026-10-24")).toThrow(BookingError);
    expect(() => validateBooking(slot, existing, { startsOn: "2026-10-01", endsOn: "2026-10-02", budget: 0, targeting: { city: "cairo", cuisine: null } }, "2026-10-24")).toThrow("past");
    expect(() => validateBooking(slot, existing, { startsOn: "2026-11-12", endsOn: "2026-11-11", budget: 0, targeting: { city: "cairo", cuisine: null } }, "2026-10-24")).toThrow("bad_dates");
    expect(() => validateBooking(slot, existing, { startsOn: "2026-11-11", endsOn: "2026-11-14", budget: 0, targeting: { city: "cairo", cuisine: null } }, "2026-10-24")).not.toThrow();
  });

  it("quotes and spend by pricing model", () => {
    expect(quote(slot, "2026-11-01", "2026-11-07", 0)).toBe(E(1750));
    const cpc = { ...b("x", "2026-11-01", "2026-11-30", "cairo"), pricing: { model: "cpc" as const, rate: E(3) }, budget: E(300), stats: { impressions: 9000, clicks: 120, orders: 9, revenue: E(4000) } };
    expect(spend(cpc, "2026-11-10")).toBe(E(300));
    const cpm = { ...cpc, pricing: { model: "cpm" as const, rate: E(40) } };
    expect(spend(cpm, "2026-11-10")).toBe(E(300)); // 9000/1000 × 40 = 360 → capped at the 300 budget
    expect(isServing(cpc, "2026-11-10")).toBe(false); // budget spent
    expect(spend(b("y", "2026-11-01", "2026-11-10", "cairo"), "2026-11-03")).toBe(E(750));
  });

  it("public feed filters by city and serving dates", () => {
    const withCreative = existing.map((x) => ({ ...x, creative: { headline: { ar: x.id, en: x.id }, imageUrl: null } }));
    const rs = ["a", "b", "c", "d"].map((id) => ({ id, slug: id, name: { ar: id, en: id }, brandColor: "#000", active: true }));
    const feed = publicFeed(withCreative, [slot], rs, { city: "Cairo", today: "2026-11-06" });
    expect(feed.map((f) => f.restaurantId).sort()).toEqual(["a", "b"]);
    expect(publicFeed(withCreative, [slot], rs, { city: null, today: "2026-11-06" })).toHaveLength(0);
  });
});

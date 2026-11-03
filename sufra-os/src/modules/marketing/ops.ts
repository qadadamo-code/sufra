/**
 * Marketing data operations on top of the pure rules in src/lib/promo:
 *
 *   evaluateCheck / applyToCheck / clearCheckPromos   — promotions, coupons and loyalty rewards on a POS check
 *   onCheckPaid(db, checkId)                          — THE hook after payment: earn points, stamps, tiers, finalize
 *                                                        redemptions (uses, unique codes, campaign attribution), referrals
 *   sellGiftCard / redeemGiftCard / refundGiftCard    — stored value, with ledger entries (2204 liability)
 *   customerStatsAll / segmentMembers                 — CRM stats from customers + visit ledger, RFM
 *   sendCampaign / runJourneys                        — WhatsApp/SMS campaigns through src/lib/notify (click-to-chat fallback)
 *
 * Every write goes through Db (tenant scoped) so other tabs/devices see it live.
 */
import type { Db } from "@/data/hooks";
import { recomputeCheck } from "@/data/ops";
import { lineUnitPrice } from "@/data/pricing";
import type {
  Campaign, CampaignMessage, Check, Customer, GiftCard, LoyaltyEntry, LoyaltyProgram, MenuItem, Order, OrderItem, PromoRedemption, Promotion, Segment, Settings,
} from "@/data/types";
import { uuid } from "@/lib/id";
import { roundMinor, type Units } from "@/lib/money";
import { nowIso } from "@/lib/time";
import { normalizePhone } from "@/modules/guest/api/service";
import {
  applyStamps, checkRedeem, computeBalance, DEFAULT_TIERS, eligibleSpend, evaluatePromotions, expiryFor, giftCardCode, GiftCardError, matchesSegment, normalizeCode,
  normalizeGiftCode, onRefereePaid, pendingExpiry, pointsFor, redeemCard, referralCode, refundToCard, scoreRfm, tierFor, type CustomerStats, type LoyaltyRules,
  type Promo, type PromoCart, type PromoChannel, type PromoResult, type Reward, type SegmentDef,
} from "@/lib/promo";
import { clickToChatUrl } from "@/lib/notify/core";
import { messagingSettingsOf } from "@/lib/notify/settings";
import { MessagingService } from "@/lib/notify/service";

/* ───────── loyalty program ───────── */

export const DEFAULT_RULES: LoyaltyRules = {
  enabled: true, earnPoints: 1, earnSpend: 10 * 100_000, pointValue: 25_000, minRedeem: 100, expiryDays: 365, tiers: DEFAULT_TIERS, stampCards: [], rewards: [],
  excludedCategoryIds: [], earnChannels: [], welcomeBonus: 50, birthdayBonus: 100, referrerPoints: 200,
};

export async function loadProgram(db: Pick<Db, "list">): Promise<LoyaltyProgram | null> {
  const [p] = await db.list("loyaltyPrograms");
  return p ?? null;
}
export const rulesOf = (p: LoyaltyProgram | null | undefined): LoyaltyRules => (p ? p : DEFAULT_RULES);

const asPoints = (e: LoyaltyEntry) => ({ id: e.id, kind: e.kind, points: e.points, at: e.at, expiresAt: e.expiresAt });

/** Balance from the ledger (also writes due expiries) and refreshes the customer cache. */
export async function refreshLoyalty(db: Db, customer: Customer, program: LoyaltyProgram | null, now = new Date()) {
  const entries = await db.list("loyaltyLedger", { where: { customerId: customer.id } });
  const due = pendingExpiry(entries.map(asPoints), now);
  if (due > 0) {
    entries.push(
      await db.insert("loyaltyLedger", {
        customerId: customer.id, branchId: db.branchId, kind: "expire", points: -due, spend: 0, checkId: null, channel: null, rewardId: null, stamps: {}, expiresAt: null,
        note: "auto-expiry", actorId: null, at: now.toISOString(),
      }),
    );
  }
  const b = computeBalance(entries.map(asPoints), now);
  const tier = tierFor(b.lifetime, rulesOf(program).tiers);
  if (customer.loyaltyPoints !== b.balance || customer.lifetimePoints !== b.lifetime || (customer.tierId ?? null) !== (tier?.id ?? null))
    await db.update("customers", customer.id, { loyaltyPoints: b.balance, lifetimePoints: b.lifetime, tierId: tier?.id ?? null });
  return { ...b, tier, entries };
}

/* ───────── promotions on a check ───────── */

export interface CheckPromoInput {
  codes: string[];
  /** loyalty reward ids to redeem */
  rewards: string[];
  /** points to use as money off */
  points: number;
}

const rewardPromo = (r: Reward): Promo => ({
  id: `reward:${r.id}`, name: r.name, kind: "auto", code: null, channels: [], stackable: true, priority: 1000, active: true, uses: 0,
  type: r.kind === "free_item" ? "free_item" : r.kind, value: r.kind === "free_item" ? 1 : r.value, target: r.kind === "free_item" && r.itemId ? { itemIds: [r.itemId], categoryIds: [] } : null,
});
const pointsPromo = (points: number, rules: LoyaltyRules): Promo => ({
  id: "points", name: { ar: `${points} نقطة`, en: `${points} points` }, kind: "auto", code: null, channels: [], stackable: true, priority: 1001, active: true, uses: 0,
  type: "amount", value: roundMinor(points * rules.pointValue),
});

export const PROMO_REASON = "promo";

/** The check as the engine sees it: manual discounts only (promo shares removed). */
function cartOf(items: OrderItem[], menu: MenuItem[], applied: PromoRedemption[], order: Order | null, channel: PromoChannel, at = new Date(), timezone = "Africa/Cairo"): PromoCart {
  const promoShare: Record<string, Units> = {};
  for (const r of applied) for (const [k, v] of Object.entries(r.lineDiscounts)) promoShare[k] = (promoShare[k] ?? 0) + v;
  const delivery = applied.reduce((a, r) => a + r.deliveryDiscount, 0);
  return {
    lines: items
      .filter((i) => i.status !== "void")
      .map((i) => ({ id: i.id, itemId: i.itemId, categoryId: menu.find((m) => m.id === i.itemId)?.categoryId ?? null, qty: i.qty, unitPrice: lineUnitPrice(i), discount: Math.max(0, i.discount - (promoShare[i.id] ?? 0)) })),
    channel,
    mode: order?.mode ?? "dine_in",
    deliveryFee: (order?.deliveryFee ?? 0) + delivery,
    at,
    timezone,
  };
}

/** Promo context for a customer: previous orders, uses per promotion, segments, tier. */
export async function promoCustomer(db: Db, customer: Customer | null, segments?: Segment[]) {
  if (!customer) return null;
  const reds = await db.list("promoRedemptions", { where: { customerId: customer.id, status: ["applied", "redeemed"] } });
  const usesByPromo: Record<string, number> = {};
  for (const r of reds) if (r.promotionId && r.status === "redeemed") usesByPromo[r.promotionId] = (usesByPromo[r.promotionId] ?? 0) + 1;
  let segmentIds: string[] = [];
  if (segments?.length) {
    const ledger = await db.list("loyaltyLedger", { where: { customerId: customer.id } });
    const s = statsFor(customer, ledger);
    segmentIds = segments.filter((g) => matchesSegment(s, g)).map((g) => g.id);
  }
  return { id: customer.id, orders: customer.visits, usesByPromo, segmentIds, tierId: customer.tierId ?? null };
}

export interface CheckPromoState {
  result: PromoResult;
  applied: PromoRedemption[];
  promotions: Promotion[];
  program: LoyaltyProgram | null;
  pointsValue: Units;
  pendingPoints: number;
}

/** Evaluates promotions, coupons and loyalty redemptions for an open check (no writes). */
export async function evaluateCheck(db: Db, checkId: string, input: CheckPromoInput, channel: PromoChannel = "pos", at = new Date()): Promise<CheckPromoState> {
  const check = await db.get("checks", checkId);
  if (!check) throw new Error("check not found");
  const orders = await db.list("orders", { where: { checkId } });
  const items = orders.length ? await db.list("orderItems", { where: { orderId: orders.map((o) => o.id) } }) : [];
  const menu = await db.list("menuItems");
  const applied = await db.list("promoRedemptions", { where: { checkId, status: "applied" } });
  const promotions = await db.list("promotions");
  const program = await loadProgram(db);
  const rules = rulesOf(program);
  const customer = check.customerId ? await db.get("customers", check.customerId) : null;
  const segments = await db.list("segments");
  const ctxCustomer = await promoCustomer(db, customer, segments);
  const codes = input.codes.map(normalizeCode).filter(Boolean);
  const uniqueCodes = codes.length ? (await db.list("couponCodes", { where: { code: codes } })).map((c) => ({ code: c.code, promotionId: c.promotionId, customerId: c.customerId, usedAt: c.usedAt })) : [];

  const extra: Promo[] = [];
  let pendingPoints = 0;
  for (const rid of input.rewards) {
    const r = rules.rewards.find((x) => x.id === rid && x.active);
    if (!r) continue;
    extra.push({ ...rewardPromo(r), kind: "coupon", code: `REWARD:${r.id}` });
    pendingPoints += r.cost;
  }
  if (input.points > 0) {
    checkRedeem(input.points + pendingPoints, customer?.loyaltyPoints ?? 0, rules);
    extra.push({ ...pointsPromo(input.points, rules), kind: "coupon", code: "POINTS" });
    pendingPoints += input.points;
  } else if (pendingPoints > (customer?.loyaltyPoints ?? 0)) checkRedeem(pendingPoints, customer?.loyaltyPoints ?? 0, rules);

  const cart = cartOf(items, menu, applied, orders[0] ?? null, channel, at);
  const result = evaluatePromotions(cart, [...promotions, ...extra], {
    customer: ctxCustomer,
    codes: [...codes, ...extra.map((e) => e.code!)],
    uniqueCodes,
  });
  return { result, applied, promotions, program, pointsValue: input.points > 0 ? roundMinor(input.points * rules.pointValue) : 0, pendingPoints };
}

/** What is currently requested on a check (to re-evaluate after changes). */
export function inputFromApplied(applied: PromoRedemption[]): CheckPromoInput {
  const codes: string[] = [];
  const rewards: string[] = [];
  let points = 0;
  for (const r of applied) {
    if (r.rewardId === "points") points += r.points;
    else if (r.rewardId) rewards.push(r.rewardId);
    else if (r.code) codes.push(r.code);
  }
  return { codes, rewards, points };
}

/** Removes every applied (unpaid) promo from a check, restoring manual line discounts and the delivery fee. */
export async function clearCheckPromos(db: Db, checkId: string) {
  const applied = await db.list("promoRedemptions", { where: { checkId, status: "applied" } });
  if (!applied.length) return;
  const orders = await db.list("orders", { where: { checkId } });
  const items = orders.length ? await db.list("orderItems", { where: { orderId: orders.map((o) => o.id) } }) : [];
  const share: Record<string, Units> = {};
  for (const r of applied) for (const [k, v] of Object.entries(r.lineDiscounts)) share[k] = (share[k] ?? 0) + v;
  for (const i of items) if (share[i.id]) await db.update("orderItems", i.id, { discount: Math.max(0, i.discount - share[i.id]) });
  const delivery = applied.reduce((a, r) => a + r.deliveryDiscount, 0);
  if (delivery && orders[0]) await db.update("orders", orders[0].id, { deliveryFee: orders[0].deliveryFee + delivery });
  for (const r of applied) await db.update("promoRedemptions", r.id, { status: "voided" });
  await recomputeCheck(db, checkId);
}

/** Applies the evaluated result: line discounts (before tax), delivery waiver, "applied" redemption rows. */
export async function applyToCheck(db: Db, checkId: string, input: CheckPromoInput, channel: PromoChannel = "pos"): Promise<CheckPromoState> {
  const state = await evaluateCheck(db, checkId, input, channel);
  await clearCheckPromos(db, checkId);
  const check = (await db.get("checks", checkId))!;
  const orders = await db.list("orders", { where: { checkId } });
  const items = orders.length ? await db.list("orderItems", { where: { orderId: orders.map((o) => o.id) } }) : [];
  const { result } = state;
  for (const i of items) if (result.lineDiscounts[i.id]) await db.update("orderItems", i.id, { discount: i.discount + result.lineDiscounts[i.id] });
  if (result.deliveryDiscount && orders[0]) await db.update("orders", orders[0].id, { deliveryFee: Math.max(0, orders[0].deliveryFee - result.deliveryDiscount) });
  const program = state.program;
  const rules = rulesOf(program);
  const codes = input.codes.map(normalizeCode);
  const ucs = codes.length ? await db.list("couponCodes", { where: { code: codes } }) : [];
  for (const a of result.applied) {
    const isReward = a.promotionId.startsWith("reward:");
    const isPoints = a.promotionId === "points";
    const rewardId = isReward ? a.promotionId.slice(7) : isPoints ? "points" : null;
    const promo = state.promotions.find((p) => p.id === a.promotionId);
    const uc = ucs.find((u) => u.promotionId === a.promotionId);
    await db.insert("promoRedemptions", {
      promotionId: isReward || isPoints ? null : a.promotionId, rewardId, code: isReward || isPoints ? null : (uc?.code ?? a.code), customerId: check.customerId, checkId, orderId: orders[0]?.id ?? null, channel,
      status: "applied", discount: a.discount, deliveryDiscount: a.deliveryDiscount, lineDiscounts: a.lineDiscounts, revenue: 0,
      campaignId: uc?.campaignId ?? promo?.campaignId ?? null, points: isPoints ? input.points : isReward ? (rules.rewards.find((r) => r.id === rewardId)?.cost ?? 0) : 0, at: nowIso(),
    });
  }
  await recomputeCheck(db, checkId);
  if (result.applied.length) await db.audit("check.promo", "checks", checkId, { promos: result.applied.map((a) => ({ id: a.promotionId, code: a.code, discount: a.discount })) });
  return state;
}

/* ───────── after payment ───────── */

/**
 * Call once a check is fully paid (POS closeCheck, online/delivery settlement…). Idempotent per check.
 *  - finalizes "applied" redemptions → "redeemed" (promotion uses, unique codes, campaign attribution, points spent)
 *  - known customer: visit + spend + points (tier multiplier), stamp cards, tier refresh, referral reward
 */
export async function onCheckPaid(db: Db, checkId: string, opts: { channel?: PromoChannel; total?: Units } = {}) {
  const check = await db.get("checks", checkId);
  if (!check) return null;
  const orders = await db.list("orders", { where: { checkId } });
  const order = orders[0] ?? null;
  const channel: PromoChannel = opts.channel ?? (order?.source === "qr" ? "qr" : order?.source === "online" ? "online" : "pos");
  const total = opts.total ?? check.total;
  const now = nowIso();

  // 1) promotions
  const applied = await db.list("promoRedemptions", { where: { checkId, status: "applied" } });
  const campaignsTouched = new Set<string>();
  for (const r of applied) {
    await db.update("promoRedemptions", r.id, { status: "redeemed", revenue: total, customerId: r.customerId ?? check.customerId, at: now });
    if (r.promotionId) {
      const p = await db.get("promotions", r.promotionId);
      if (p) await db.update("promotions", p.id, { uses: p.uses + 1 });
    }
    if (r.code) {
      const [uc] = await db.list("couponCodes", { where: { code: r.code } });
      if (uc && !uc.usedAt) await db.update("couponCodes", uc.id, { usedAt: now, checkId });
    }
    if (r.campaignId) campaignsTouched.add(r.campaignId);
  }

  if (!check.customerId) return { points: 0 };
  const already = await db.list("loyaltyLedger", { where: { checkId, kind: "earn" } });
  if (already.length) return { points: already[0].points };
  const customer = await db.get("customers", check.customerId);
  if (!customer) return { points: 0 };
  const program = await loadProgram(db);
  const rules = rulesOf(program);

  // points spent on this check
  const spent = applied.reduce((a, r) => a + (r.points || 0), 0);
  if (spent > 0)
    await db.insert("loyaltyLedger", {
      customerId: customer.id, branchId: check.branchId, kind: "redeem", points: -spent, spend: 0, checkId, channel, rewardId: applied.find((r) => r.points)?.rewardId ?? null, stamps: {},
      expiresAt: null, note: "", actorId: db.actorId, at: now,
    });

  // 2) earn
  const items = orders.length ? (await db.list("orderItems", { where: { orderId: orders.map((o) => o.id) } })).filter((i) => i.status !== "void") : [];
  const menu = await db.list("menuItems");
  const catOf = (itemId: string) => menu.find((m) => m.id === itemId)?.categoryId ?? null;
  const spend = eligibleSpend(items.map((i) => ({ net: lineUnitPrice(i) * i.qty - i.discount, categoryId: catOf(i.itemId) })), rules);
  const tier = tierFor(customer.lifetimePoints ?? 0, rules.tiers);
  const points = pointsFor(spend, rules, tier, channel);
  const stamps: Record<string, number> = { ...(customer.stamps ?? {}) };
  const stampAdds: Record<string, number> = {};
  for (const card of rules.stampCards) {
    const r = applyStamps(card, stamps[card.id] ?? 0, items.map((i) => ({ itemId: i.itemId, categoryId: catOf(i.itemId), qty: i.qty })));
    if (r.added) {
      stamps[card.id] = r.stamps;
      stampAdds[card.id] = r.added;
      // a completed card issues a one-time reward code (free item)
      for (let k = 0; k < r.rewards; k++) await issueStampReward(db, customer, card.id, card.rewardItemId);
    }
  }
  const itemsMap: Record<string, number> = {};
  for (const i of items) itemsMap[i.itemId] = (itemsMap[i.itemId] ?? 0) + i.qty;
  await db.insert("loyaltyLedger", {
    customerId: customer.id, branchId: check.branchId, kind: "earn", points, spend: total, checkId, channel, rewardId: null, stamps: stampAdds,
    expiresAt: expiryFor(now, rules), note: "", actorId: db.actorId, at: now, items: itemsMap,
  });
  await db.update("customers", customer.id, { visits: customer.visits + 1, lastVisitAt: now, totalSpent: customer.totalSpent + total, stamps });
  const fresh = (await db.get("customers", customer.id))!;
  await refreshLoyalty(db, fresh, program);

  // 3) referral: the friend's first paid visit rewards the referrer
  if (customer.referredBy && customer.visits === 0) {
    const [ref] = await db.list("referrals", { where: { refereeId: customer.id } });
    if (ref) {
      const r = onRefereePaid({ referrerId: ref.referrerId, refereeId: ref.refereeId, status: ref.status });
      if (r.rewardReferrer) {
        await db.update("referrals", ref.id, { status: "rewarded", rewardedAt: now });
        await db.insert("loyaltyLedger", { customerId: ref.referrerId, branchId: check.branchId, kind: "bonus", points: rules.referrerPoints, spend: 0, checkId: null, channel: null, rewardId: null, stamps: {}, expiresAt: expiryFor(now, rules), note: "referral", actorId: null, at: now });
        const referrer = await db.get("customers", ref.referrerId);
        if (referrer) await refreshLoyalty(db, referrer, program);
      }
    }
  }

  // 4) campaign attribution: message redeemed + campaign stats
  for (const cid of campaignsTouched) await refreshCampaignStats(db, cid);
  const msgs = await db.list("campaignMessages", { where: { customerId: customer.id } });
  for (const m of msgs.filter((x) => !x.redeemedAt && x.code && applied.some((r) => r.code === x.code))) await db.update("campaignMessages", m.id, { redeemedAt: now, revenue: total });
  return { points };
}

async function issueStampReward(db: Db, customer: Customer, cardId: string, itemId: string | null) {
  let [p] = await db.list("promotions", { where: { code: null, kind: "coupon", type: "free_item" }, limit: 50 }).then((xs) => xs.filter((x) => x.name.en.startsWith("Stamp card")));
  if (!p)
    p = await db.insert("promotions", {
      name: { ar: "مكافأة كارت الأختام", en: "Stamp card reward" }, kind: "coupon", type: "free_item", code: null, value: 1, target: itemId ? { itemIds: [itemId], categoryIds: [] } : null,
      channels: [], stackable: true, priority: 20, active: true, uses: 0, createdBy: null, campaignId: null, limits: null,
    });
  await db.insert("couponCodes", { promotionId: p.id, code: `ST-${uuid().slice(0, 6).toUpperCase()}`, customerId: customer.id, campaignId: null, usedAt: null, checkId: null, expiresAt: null });
  await db.audit("loyalty.stamp_reward", "customers", customer.id, { card: cardId });
}

/* ───────── gift cards ───────── */

const toLedgerLines = (lines: [account: string, debit: Units, credit: Units][]) => lines.map(([account, debit, credit]) => ({ account, debit, credit }));

export async function sellGiftCard(
  db: Db,
  x: { amount: Units; purchaser: GiftCard["purchaser"]; recipient: GiftCard["recipient"]; via: GiftCard["soldVia"]; method: "cash" | "card" | "wallet" | "online"; reference?: string | null; expiresInDays?: number; code?: string },
): Promise<GiftCard> {
  if (x.amount <= 0) throw new GiftCardError("bad_amount");
  const amount = roundMinor(x.amount);
  const dup = x.reference ? await db.list("giftCards", { where: { paymentRef: x.reference } }) : [];
  if (dup[0]) return dup[0];
  const expires = new Date(Date.now() + (x.expiresInDays ?? 365) * 86_400_000).toISOString();
  const card = await db.insert("giftCards", {
    code: x.code ?? giftCardCode(), initial: amount, balance: amount, status: "active", expiresAt: expires, purchaser: x.purchaser, recipient: x.recipient, soldVia: x.via,
    soldBy: db.actorId, paymentRef: x.reference ?? null, customerId: null,
  });
  await db.insert("giftCardTxns", { giftCardId: card.id, kind: "issue", amount, balanceAfter: amount, checkId: null, paymentId: null, actorId: db.actorId, note: x.method });
  const debit = x.method === "cash" ? "1101" : x.method === "wallet" ? "1103" : "1102";
  await db.insert("ledgerEntries", {
    branchId: db.branchId, date: nowIso().slice(0, 10), sourceType: "gift_card.sale", sourceId: card.id, memo: `Gift card ${card.code}`, lines: toLedgerLines([[debit, amount, 0], ["2204", 0, amount]]),
  });
  await db.audit("giftcard.sell", "giftCards", card.id, { amount, via: x.via, method: x.method });
  return card;
}

export async function findGiftCard(db: Db, code: string): Promise<GiftCard | null> {
  const [c] = await db.list("giftCards", { where: { code: normalizeGiftCode(code) } });
  return c ?? null;
}

/**
 * Gift card as a tender: takes up to `amount` from the card, records the payment (method gift_card, reference = code)
 * and reclasses the house receivable the sale posts into the 2204 liability.
 */
export async function redeemGiftCard(db: Db, check: Check, code: string, amount: Units, take: (p: { method: "gift_card"; amount: Units; tip: Units; tendered: null; reference: string }) => Promise<{ id: string }>) {
  const card = await findGiftCard(db, code);
  if (!card) throw new GiftCardError("not_found");
  const r = redeemCard({ code: card.code, initial: card.initial, balance: card.balance, status: card.status, expiresAt: card.expiresAt }, Math.min(amount, card.balance));
  const pay = await take({ method: "gift_card", amount: r.taken, tip: 0, tendered: null, reference: card.code });
  await db.update("giftCards", card.id, { balance: r.card.balance, status: r.card.status });
  await db.insert("giftCardTxns", { giftCardId: card.id, kind: "redeem", amount: r.taken, balanceAfter: r.card.balance, checkId: check.id, paymentId: pay.id, actorId: db.actorId, note: "" });
  await db.insert("ledgerEntries", {
    branchId: check.branchId, date: nowIso().slice(0, 10), sourceType: "gift_card.redeem", sourceId: pay.id, memo: `Gift card ${card.code} → check`, lines: toLedgerLines([["2204", r.taken, 0], ["1201", 0, r.taken]]),
  });
  return { taken: r.taken, balance: r.card.balance };
}

/** A voided gift-card tender goes back on the card. */
export async function refundGiftCard(db: Db, paymentId: string, code: string, amount: Units) {
  const card = await findGiftCard(db, code);
  if (!card) return;
  const next = refundToCard({ code: card.code, initial: card.initial, balance: card.balance, status: card.status, expiresAt: card.expiresAt }, amount);
  await db.update("giftCards", card.id, { balance: next.balance, status: next.status });
  await db.insert("giftCardTxns", { giftCardId: card.id, kind: "refund", amount, balanceAfter: next.balance, checkId: null, paymentId, actorId: db.actorId, note: "payment voided" });
  await db.insert("ledgerEntries", { branchId: db.branchId, date: nowIso().slice(0, 10), sourceType: "gift_card.refund", sourceId: paymentId, memo: `Gift card ${card.code} refund`, lines: toLedgerLines([["1201", amount, 0], ["2204", 0, amount]]) });
}

/* ───────── CRM stats ───────── */

export function statsFor(c: Customer, ledger: LoyaltyEntry[], tierId?: string | null): CustomerStats {
  const visits = ledger.filter((e) => e.kind === "earn" && e.customerId === c.id);
  const items: Record<string, number> = {};
  for (const v of visits) for (const [k, n] of Object.entries(v.items ?? {})) items[k] = (items[k] ?? 0) + n;
  const first = visits.map((v) => v.at).sort()[0] ?? c.lastVisitAt;
  return {
    id: c.id, visits: c.visits, totalSpent: c.totalSpent, avgSpend: c.visits ? Math.round(c.totalSpent / c.visits) : 0, lastVisitAt: c.lastVisitAt, firstVisitAt: first ?? null,
    createdAt: c.createdAt, points: c.loyaltyPoints, tags: c.tags, items, birthday: c.birthday, source: c.source ?? null, tierId: tierId ?? c.tierId ?? null,
    consent: { whatsapp: c.consent?.whatsapp ?? true, sms: c.consent?.sms ?? false, email: c.consent?.email ?? false, push: c.consent?.push ?? false },
  };
}

/** Stats + RFM for the whole base (live customers, merged duplicates excluded). */
export function customerStatsAll(customers: Customer[], ledger: LoyaltyEntry[], now = new Date()): CustomerStats[] {
  const live = customers.filter((c) => !c.mergedInto);
  const byCustomer = new Map<string, LoyaltyEntry[]>();
  for (const e of ledger) byCustomer.set(e.customerId, [...(byCustomer.get(e.customerId) ?? []), e]);
  const stats = live.map((c) => statsFor(c, byCustomer.get(c.id) ?? []));
  const rfm = scoreRfm(stats, now);
  for (const s of stats) s.rfm = rfm.get(s.id)?.segment;
  return stats;
}

/** Audience of a campaign: a saved segment, "all", or "rfm:<segment>". */
export function audienceDef(audience: string, segment: Segment | null): SegmentDef {
  if (segment) return segment;
  if (audience.startsWith("rfm:")) return { match: "all", rules: [{ field: "rfm", op: "is", value: audience.slice(4) as never }] };
  return { match: "all", rules: [] };
}

/* ───────── campaigns ───────── */

/** {name} {restaurant} {code} {points} {link} {tier} */
export function renderText(text: string, v: Record<string, string | number | null | undefined>) {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (v[k] != null ? String(v[k]) : m)).replace(/\s+\n/g, "\n").trim();
}

/** Deterministic variant by customer id and shares (%). */
export function pickVariant<V extends { id: string; share: number }>(variants: V[], customerId: string): V {
  if (variants.length <= 1) return variants[0];
  let h = 0;
  for (let i = 0; i < customerId.length; i++) h = (h * 31 + customerId.charCodeAt(i)) % 10_007;
  const total = variants.reduce((a, v) => a + Math.max(0, v.share), 0) || 1;
  let x = (h % 1000) / 1000 * total;
  for (const v of variants) {
    x -= Math.max(0, v.share);
    if (x < 0) return v;
  }
  return variants[variants.length - 1];
}

export interface SendContext {
  restaurantName: string;
  slug: string;
  origin: string;
  lang: "ar" | "en";
  settings: Settings | null;
}

/** Who would get it: audience ∩ consent for the channel ∩ weekly marketing cap. */
export async function campaignRecipients(db: Db, campaign: Pick<Campaign, "audience" | "segmentId" | "channel">, settings: Settings | null, now = new Date()) {
  const customers = (await db.list("customers")).filter((c) => !c.mergedInto);
  const ledger = await db.list("loyaltyLedger", { where: { kind: "earn" } });
  const segment = campaign.segmentId ? await db.get("segments", campaign.segmentId) : null;
  const def = audienceDef(campaign.audience, segment);
  const stats = customerStatsAll(customers, ledger, now);
  const inAudience = new Set(stats.filter((s) => matchesSegment(s, def, now)).map((s) => s.id));
  const consentKey = campaign.channel === "sms" ? "sms" : campaign.channel === "push" ? "push" : "whatsapp";
  const cap = messagingSettingsOf(settings).marketingCapPerWeek;
  const week = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const recent = await db.list("campaignMessages", { gte: { createdAt: week } });
  const count = new Map<string, number>();
  for (const m of recent) count.set(m.customerId, (count.get(m.customerId) ?? 0) + 1);
  const audience = customers.filter((c) => inAudience.has(c.id));
  const eligible = audience.filter((c) => (c.consent ? !!c.consent[consentKey] : consentKey === "whatsapp") && !!normalizePhone(c.phone) && (cap <= 0 || (count.get(c.id) ?? 0) < cap));
  return { audience, eligible, noConsent: audience.filter((c) => !(c.consent ? c.consent[consentKey] : consentKey === "whatsapp")).length, capped: audience.length - eligible.length };
}

/**
 * One marketing message through the messaging service (consent, opt-out, quiet hours, 24h window, logging): approved
 * Meta marketing templates — win_back_offer when an offer code is attached, else campaign_generic.
 */
async function deliver(svc: MessagingService | null, db: Db, c: Customer, text: string, x: { code: string | null; offer: string; link: string; restaurant: string; lang: "ar" | "en"; channel: Campaign["channel"]; dedupeKey: string }): Promise<CampaignMessage["status"]> {
  if (!svc || x.channel !== "whatsapp") return db.repo.kind === "local" ? "sent" : "queued";
  try {
    const m = await svc.send({
      to: c.phone, name: c.name, customerId: c.id, lang: x.lang, dedupeKey: x.dedupeKey, sentBy: db.actorId,
      ...(x.code
        ? { template: "win_back_offer", vars: { name: c.name.split(" ")[0], offer: x.offer, restaurant: x.restaurant, code: x.code, until: "", link: x.link } }
        : { template: "campaign_generic", vars: { name: c.name.split(" ")[0], message: text, link: x.link } }),
    });
    const s = m.status as string;
    if (s === "skipped" || s === "failed") return "failed";
    if (s === "sent" || s === "delivered" || s === "read") return s;
    // click-to-chat / scheduled (quiet hours): waits for a tap or the send time; the local demo counts it as sent
    return db.repo.kind === "local" ? "sent" : "queued";
  } catch {
    return "failed";
  }
}

/** Sends (or queues click-to-chat links for) a campaign. Unique code per recipient when an offer is attached. */
export async function sendCampaign(db: Db, campaign: Campaign, ctx: SendContext): Promise<{ sent: number; queued: number; failed: number }> {
  const { eligible } = await campaignRecipients(db, campaign, ctx.settings);
  const promo = campaign.promotionId ? await db.get("promotions", campaign.promotionId) : null;
  const svc = await MessagingService.load(db).catch(() => null);
  await db.update("campaigns", campaign.id, { status: "sending" });
  let sent = 0;
  let queued = 0;
  let failed = 0;
  const link = `${ctx.origin}${import.meta.env?.BASE_URL ?? "/app/"}r/${ctx.slug}`;
  for (const c of eligible) {
    const v = pickVariant(campaign.variants, c.id);
    let code: string | null = null;
    if (promo) {
      code = referralCode(`${campaign.id}:${c.id}`, promo.code ? normalizeCode(promo.code).slice(0, 3) : "CP");
      await db.insert("couponCodes", { promotionId: promo.id, code, customerId: c.id, campaignId: campaign.id, usedAt: null, checkId: null, expiresAt: promo.window?.endsAt ?? null });
    }
    const text = renderText(v.text[ctx.lang] || v.text.ar, { name: c.name.split(" ")[0], restaurant: ctx.restaurantName, code, points: c.loyaltyPoints, link: `${link}/me`, tier: c.tierId });
    const url = campaign.channel === "whatsapp" ? clickToChatUrl(c.phone, text) : null;
    const status = await deliver(svc, db, c, text, { code, offer: promo ? (promo.name[ctx.lang] || promo.name.ar) : "", link: `${link}/me`, restaurant: ctx.restaurantName, lang: ctx.lang, channel: campaign.channel, dedupeKey: `campaign:${campaign.id}:${c.id}` });
    if (status === "failed") failed++;
    else if (status === "queued") queued++;
    else sent++;
    await db.insert("campaignMessages", {
      campaignId: campaign.id, variantId: v.id, customerId: c.id, to: c.phone, text, code, status, link: url, sentAt: status === "queued" ? null : nowIso(), readAt: null, redeemedAt: null, revenue: 0,
    });
  }
  await db.update("campaigns", campaign.id, { status: "sent", sentAt: nowIso() });
  await refreshCampaignStats(db, campaign.id);
  await db.audit("campaign.send", "campaigns", campaign.id, { recipients: eligible.length, sent, queued, failed });
  return { sent, queued, failed };
}

export async function refreshCampaignStats(db: Db, campaignId: string) {
  const c = await db.get("campaigns", campaignId);
  if (!c) return;
  const msgs = await db.list("campaignMessages", { where: { campaignId } });
  const reds = await db.list("promoRedemptions", { where: { campaignId, status: "redeemed" } });
  const ok = msgs.filter((m) => m.status !== "failed" && m.status !== "queued");
  const redeemedMsgs = msgs.filter((m) => m.redeemedAt);
  await db.update("campaigns", campaignId, {
    stats: {
      targeted: msgs.length, sent: ok.length, delivered: msgs.filter((m) => m.status === "delivered" || m.status === "read").length, read: msgs.filter((m) => m.status === "read").length,
      clicked: c.stats.clicked, redeemed: Math.max(reds.length, redeemedMsgs.length), revenue: Math.max(reds.reduce((a, r) => a + r.revenue, 0), redeemedMsgs.reduce((a, m) => a + m.revenue, 0)),
      cost: ok.length * c.costPerMessage,
    },
  });
}

/** Per-variant results for A/B. */
export function variantResults(msgs: CampaignMessage[]) {
  const by = new Map<string, { sent: number; read: number; redeemed: number; revenue: Units }>();
  for (const m of msgs) {
    const x = by.get(m.variantId) ?? { sent: 0, read: 0, redeemed: 0, revenue: 0 };
    if (m.status !== "failed" && m.status !== "queued") x.sent++;
    if (m.status === "read") x.read++;
    if (m.redeemedAt) {
      x.redeemed++;
      x.revenue += m.revenue;
    }
    by.set(m.variantId, x);
  }
  return by;
}

/* ───────── journeys ───────── */

/** Runs the automated journeys once (a server cron does this every hour in cloud mode). Returns messages sent. */
export async function runJourneys(db: Db, ctx: SendContext, now = new Date()): Promise<number> {
  const journeys = (await db.list("journeys")).filter((j) => j.enabled && j.trigger !== "referral");
  const customers = (await db.list("customers")).filter((c) => !c.mergedInto);
  const DAY = 86_400_000;
  let total = 0;
  for (const j of journeys) {
    const due = customers.filter((c) => {
      if (j.trigger === "birthday") {
        if (!c.birthday) return false;
        const b = new Date(`${now.getFullYear()}-${c.birthday.slice(5)}T12:00:00Z`);
        const d = Math.round((b.getTime() - now.getTime()) / DAY);
        return d >= 0 && d <= j.delay;
      }
      if (j.trigger === "winback") return !!c.lastVisitAt && now.getTime() - Date.parse(c.lastVisitAt) >= j.delay * DAY && now.getTime() - Date.parse(c.lastVisitAt) < (j.delay + 7) * DAY;
      if (j.trigger === "welcome") return now.getTime() - Date.parse(c.createdAt) <= Math.max(1, j.delay) * 3_600_000 * 24;
      if (j.trigger === "post_visit") return !!c.lastVisitAt && now.getTime() - Date.parse(c.lastVisitAt) <= Math.max(1, j.delay) * 3_600_000 && now.getTime() - Date.parse(c.lastVisitAt) >= 30 * 60_000;
      if (j.trigger === "second_visit") return c.visits === 1 && !!c.lastVisitAt && now.getTime() - Date.parse(c.lastVisitAt) >= j.delay * DAY;
      return false;
    });
    if (!due.length) continue;
    // one campaign row per journey collects its messages (dedupe: once per customer per journey per 30 days)
    let [camp] = await db.list("campaigns", { where: { journeyId: j.id } });
    if (!camp)
      camp = await db.insert("campaigns", {
        name: `⚙ ${j.name.ar}`, segmentId: null, audience: "journey", channel: j.channel, status: "sent", variants: [{ id: "a", label: "A", text: j.text, share: 100 }], promotionId: j.promotionId,
        scheduledAt: null, sentAt: nowIso(), costPerMessage: j.channel === "sms" ? 35_000 : 320_000, journeyId: j.id, createdBy: null,
        stats: { targeted: 0, sent: 0, delivered: 0, read: 0, clicked: 0, redeemed: 0, revenue: 0, cost: 0 },
      });
    const prior = await db.list("campaignMessages", { where: { campaignId: camp.id }, gte: { createdAt: new Date(now.getTime() - 30 * DAY).toISOString() } });
    const fresh = due.filter((c) => !prior.some((m) => m.customerId === c.id) && (c.consent ? (j.channel === "sms" ? c.consent.sms : c.consent.whatsapp) : true));
    if (!fresh.length) continue;
    const promo = j.promotionId ? await db.get("promotions", j.promotionId) : null;
    const svc = await MessagingService.load(db).catch(() => null);
    for (const c of fresh) {
      const code = promo ? referralCode(`${j.id}:${c.id}:${now.toISOString().slice(0, 7)}`, j.trigger.slice(0, 2).toUpperCase()) : null;
      if (promo && code) await db.insert("couponCodes", { promotionId: promo.id, code, customerId: c.id, campaignId: camp.id, usedAt: null, checkId: null, expiresAt: new Date(now.getTime() + 14 * DAY).toISOString() });
      const text = renderText(j.text[ctx.lang] || j.text.ar, { name: c.name.split(" ")[0], restaurant: ctx.restaurantName, code, points: c.loyaltyPoints, link: `${ctx.origin}${import.meta.env?.BASE_URL ?? "/app/"}r/${ctx.slug}/me` });
      const status = await deliver(svc, db, c, text, { code, offer: promo ? (promo.name[ctx.lang] || promo.name.ar) : "", link: `${ctx.origin}${import.meta.env?.BASE_URL ?? "/app/"}r/${ctx.slug}/me`, restaurant: ctx.restaurantName, lang: ctx.lang, channel: j.channel, dedupeKey: `journey:${j.id}:${c.id}:${now.toISOString().slice(0, 7)}` });
      await db.insert("campaignMessages", { campaignId: camp.id, variantId: "a", customerId: c.id, to: c.phone, text, code, status, link: clickToChatUrl(c.phone, text), sentAt: status === "queued" ? null : nowIso(), readAt: null, redeemedAt: null, revenue: 0 });
      if (j.trigger === "birthday") {
        const program = await loadProgram(db);
        const bonus = rulesOf(program).birthdayBonus;
        if (bonus > 0) await db.insert("loyaltyLedger", { customerId: c.id, branchId: null, kind: "bonus", points: bonus, spend: 0, checkId: null, channel: null, rewardId: null, stamps: {}, expiresAt: expiryFor(nowIso(), rulesOf(program)), note: "birthday", actorId: null, at: nowIso() });
      }
    }
    total += fresh.length;
    await db.update("journeys", j.id, { lastRunAt: nowIso(), stats: { ...j.stats, sent: j.stats.sent + fresh.length } });
    await refreshCampaignStats(db, camp.id);
  }
  return total;
}

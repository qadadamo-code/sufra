/**
 * Loyalty rules (pure): earning on paid checks, tiers with multipliers, FIFO point expiry, redemption value,
 * stamp cards ("buy 9, the 10th is free").
 *
 * Points are integers. Every movement is a ledger entry (earn / redeem / expire / adjust / bonus); the balance on
 * the customer row is only a cache of `computeBalance(entries)`.
 */
import type { Localized } from "@/data/types";
import { roundMinor, type Units } from "@/lib/money";
import type { PromoChannel } from "./types";

export interface Tier {
  id: string;
  name: Localized;
  /** lifetime earned points to reach it */
  minPoints: number;
  /** earn multiplier, bp (10000 = 1×) */
  multiplier: number;
  perks: Localized[];
  color: string;
}

export interface StampCard {
  id: string;
  name: Localized;
  itemIds: string[];
  categoryIds: string[];
  /** stamps needed for the reward */
  required: number;
  /** the free item (any unit of the card's items when null) */
  rewardItemId: string | null;
  active: boolean;
}

export interface Reward {
  id: string;
  name: Localized;
  /** points it costs */
  cost: number;
  kind: "free_item" | "percent" | "amount";
  /** percent: bp; amount: Units; free_item: ignored */
  value: number;
  itemId: string | null;
  active: boolean;
}

export interface LoyaltyRules {
  enabled: boolean;
  /** earn `earnPoints` for every `earnSpend` of eligible spend */
  earnPoints: number;
  earnSpend: Units;
  /** what one point is worth when redeemed as money off */
  pointValue: Units;
  /** smallest redemption */
  minRedeem: number;
  /** points expire this many days after they were earned (null = never) */
  expiryDays: number | null;
  tiers: Tier[];
  stampCards: StampCard[];
  rewards: Reward[];
  excludedCategoryIds: string[];
  /** empty = everywhere */
  earnChannels: PromoChannel[];
  welcomeBonus: number;
  birthdayBonus: number;
  /** referral: points for the referrer once the friend's first paid visit lands */
  referrerPoints: number;
}

export type LedgerKind = "earn" | "redeem" | "expire" | "adjust" | "bonus";
export interface PointsEntry {
  id: string;
  kind: LedgerKind;
  /** + for earn/bonus/adjust up, − for redeem/expire/adjust down */
  points: number;
  at: string;
  /** set on earn/bonus lots when the program expires points */
  expiresAt?: string | null;
}

export const DEFAULT_TIERS: Tier[] = [
  { id: "bronze", name: { ar: "برونزي", en: "Bronze" }, minPoints: 0, multiplier: 10_000, perks: [{ ar: "نقطة على كل ١٠ ج", en: "1 point per EGP 10" }], color: "#a8700c" },
  { id: "silver", name: { ar: "فضي", en: "Silver" }, minPoints: 500, multiplier: 12_500, perks: [{ ar: "نقاط ×١٫٢٥", en: "1.25× points" }, { ar: "حلو مجاني في عيد ميلادك", en: "Free dessert on your birthday" }], color: "#6b7a76" },
  { id: "gold", name: { ar: "ذهبي", en: "Gold" }, minPoints: 1500, multiplier: 15_000, perks: [{ ar: "نقاط ×١٫٥", en: "1.5× points" }, { ar: "أولوية في الحجز", en: "Priority booking" }, { ar: "قهوة ترحيب", en: "Welcome coffee" }], color: "#b8860b" },
];

/** Highest tier whose threshold the lifetime points reach. */
export function tierFor(lifetimePoints: number, tiers: Tier[]): Tier | null {
  const sorted = [...tiers].sort((a, b) => a.minPoints - b.minPoints);
  let hit: Tier | null = null;
  for (const t of sorted) if (lifetimePoints >= t.minPoints) hit = t;
  return hit;
}

/** Next tier and how many points are missing. */
export function nextTier(lifetimePoints: number, tiers: Tier[]): { tier: Tier; missing: number } | null {
  const t = [...tiers].sort((a, b) => a.minPoints - b.minPoints).find((x) => x.minPoints > lifetimePoints);
  return t ? { tier: t, missing: t.minPoints - lifetimePoints } : null;
}

/** Spend that earns: line nets (after discounts, before service/VAT) outside excluded categories. */
export function eligibleSpend(lines: { net: Units; categoryId: string | null }[], rules: Pick<LoyaltyRules, "excludedCategoryIds">): Units {
  return lines.reduce((a, l) => a + (l.categoryId && rules.excludedCategoryIds.includes(l.categoryId) ? 0 : Math.max(0, l.net)), 0);
}

/** Points for a paid check. */
export function pointsFor(spend: Units, rules: LoyaltyRules, tier: Tier | null, channel?: PromoChannel): number {
  if (!rules.enabled || spend <= 0 || rules.earnSpend <= 0 || rules.earnPoints <= 0) return 0;
  if (channel && rules.earnChannels.length && !rules.earnChannels.includes(channel)) return 0;
  const mult = tier?.multiplier ?? 10_000;
  // integer math: floor(spend / earnSpend × earnPoints × mult / 10000)
  return Math.floor((Math.floor((spend * rules.earnPoints) / rules.earnSpend) * mult) / 10_000);
}

export function expiryFor(earnedAt: string, rules: Pick<LoyaltyRules, "expiryDays">): string | null {
  if (!rules.expiryDays) return null;
  return new Date(Date.parse(earnedAt) + rules.expiryDays * 86_400_000).toISOString();
}

export interface Balance {
  balance: number;
  /** all earned + bonus + positive adjustments */
  lifetime: number;
  redeemed: number;
  expired: number;
  /** lots that run out within `soonDays` */
  expiringSoon: { points: number; at: string } | null;
  /** remaining points per lot (earned lots, FIFO) */
  lots: { id: string; remaining: number; expiresAt: string | null }[];
}

/**
 * FIFO: redemptions and expiries consume the oldest lots first. Lots past their expiry at `now` that still have
 * points are counted as `toExpire` by `pendingExpiry` (and written as "expire" entries by the caller).
 */
export function computeBalance(entries: PointsEntry[], now: Date = new Date(), soonDays = 30): Balance {
  const sorted = [...entries].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const lots: { id: string; remaining: number; expiresAt: string | null }[] = [];
  let lifetime = 0;
  let redeemed = 0;
  let expired = 0;
  let debt = 0; // negative movements with no lot to take from (e.g. imported balances)
  const take = (n: number) => {
    let need = n;
    for (const l of lots) {
      if (need <= 0) break;
      const x = Math.min(l.remaining, need);
      l.remaining -= x;
      need -= x;
    }
    debt += need;
  };
  for (const e of sorted) {
    if (e.points > 0) {
      lifetime += e.kind === "adjust" ? 0 : e.points;
      let p = e.points;
      if (debt > 0) {
        const x = Math.min(debt, p);
        debt -= x;
        p -= x;
      }
      lots.push({ id: e.id, remaining: p, expiresAt: e.expiresAt ?? null });
    } else if (e.points < 0) {
      if (e.kind === "redeem") redeemed += -e.points;
      if (e.kind === "expire") expired += -e.points;
      // an expire entry consumes the lots that expired (oldest first) — same as FIFO
      take(-e.points);
    }
  }
  const balance = lots.reduce((a, l) => a + l.remaining, 0) - debt;
  const soonAt = now.getTime() + soonDays * 86_400_000;
  const soon = lots.filter((l) => l.remaining > 0 && l.expiresAt && Date.parse(l.expiresAt) > now.getTime() && Date.parse(l.expiresAt) <= soonAt);
  const expiringSoon = soon.length ? { points: soon.reduce((a, l) => a + l.remaining, 0), at: soon.map((l) => l.expiresAt!).sort()[0] } : null;
  return { balance, lifetime, redeemed, expired, expiringSoon, lots };
}

/** Points that should be expired now: remaining points on lots whose expiry has passed. */
export function pendingExpiry(entries: PointsEntry[], now: Date = new Date()): number {
  const b = computeBalance(entries, now);
  return b.lots.filter((l) => l.remaining > 0 && l.expiresAt && Date.parse(l.expiresAt) <= now.getTime()).reduce((a, l) => a + l.remaining, 0);
}

export class LoyaltyError extends Error {
  constructor(public code: "disabled" | "below_min" | "insufficient" | "bad_points" | "reward_inactive") {
    super(code);
  }
}

/** Money off for redeeming `points` as cash value. */
export function redeemValue(points: number, rules: Pick<LoyaltyRules, "pointValue">): Units {
  return roundMinor(points * rules.pointValue);
}

/** Validates a redemption and returns its money value (cash points) — throws LoyaltyError. */
export function checkRedeem(points: number, balance: number, rules: LoyaltyRules): Units {
  if (!rules.enabled) throw new LoyaltyError("disabled");
  if (!Number.isInteger(points) || points <= 0) throw new LoyaltyError("bad_points");
  if (points < rules.minRedeem) throw new LoyaltyError("below_min");
  if (points > balance) throw new LoyaltyError("insufficient");
  return redeemValue(points, rules);
}

/** Most points usable on a bill of `due` (whole points, never more than the bill). */
export function maxRedeemable(balance: number, due: Units, rules: LoyaltyRules): number {
  if (!rules.enabled || rules.pointValue <= 0) return 0;
  const byBill = Math.floor(due / rules.pointValue);
  const n = Math.min(balance, byBill);
  return n >= rules.minRedeem ? n : 0;
}

/** Stamp progress after a visit: stamps from the qualifying units, rewards earned, the carry-over. */
export function applyStamps(card: StampCard, current: number, lines: { itemId: string; categoryId: string | null; qty: number }[]): { stamps: number; rewards: number; added: number } {
  if (!card.active || card.required <= 0) return { stamps: current, rewards: 0, added: 0 };
  const added = lines.reduce((a, l) => a + (card.itemIds.includes(l.itemId) || (!!l.categoryId && card.categoryIds.includes(l.categoryId)) ? l.qty : 0), 0);
  const total = current + added;
  return { stamps: total % card.required, rewards: Math.floor(total / card.required), added };
}

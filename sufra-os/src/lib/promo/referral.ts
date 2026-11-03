/**
 * Referrals (pure): "give X, get Y". Each customer has a referral code; a friend who joins with it gets a welcome
 * coupon (the referee promotion) and, once the friend's first visit is paid, the referrer gets points.
 */
import { seedId } from "@/lib/id";

const ALPHA = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Deterministic, readable code from the customer id: "SUF-7K2Q9". */
export function referralCode(customerId: string, prefix = "SUF"): string {
  const hex = seedId(`referral:${customerId}`).replace(/-/g, "");
  let n = BigInt("0x" + hex.slice(0, 15));
  let s = "";
  for (let i = 0; i < 5; i++) {
    s += ALPHA[Number(n % BigInt(ALPHA.length))];
    n /= BigInt(ALPHA.length);
  }
  return `${prefix}-${s}`;
}

export interface ReferralState {
  referrerId: string;
  refereeId: string | null;
  status: "pending" | "joined" | "qualified" | "rewarded" | "rejected";
}

export type ReferralError = "self" | "not_new" | "already_referred" | "cap" | "unknown_code";

/** Can `referee` join with the referrer's code? */
export function canRefer(input: {
  referrerId: string | null;
  refereeId: string;
  refereeVisits: number;
  refereeAlreadyReferred: boolean;
  /** referrals by this referrer in the last 30 days */
  referrerRecent: number;
  monthlyCap: number;
}): ReferralError | null {
  if (!input.referrerId) return "unknown_code";
  if (input.referrerId === input.refereeId) return "self";
  if (input.refereeAlreadyReferred) return "already_referred";
  if (input.refereeVisits > 0) return "not_new";
  if (input.monthlyCap > 0 && input.referrerRecent >= input.monthlyCap) return "cap";
  return null;
}

/** On the referee's paid check: joined → qualified (reward the referrer) once. */
export function onRefereePaid(r: ReferralState): { next: ReferralState; rewardReferrer: boolean } {
  if (r.status !== "joined") return { next: r, rewardReferrer: false };
  return { next: { ...r, status: "rewarded" }, rewardReferrer: true };
}

/** WhatsApp share text with the code and the link to the loyalty page. */
export function referralShareText(lang: "ar" | "en", restaurant: string, code: string, link: string, gift: string) {
  return lang === "ar"
    ? `جرّب ${restaurant}! استخدم كودي ${code} وخد ${gift} على أول طلب 🎁\n${link}`
    : `Try ${restaurant}! Use my code ${code} and get ${gift} on your first order 🎁\n${link}`;
}

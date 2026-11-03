/**
 * Wave 2 — CRM, loyalty, promotions, gift cards, campaigns, own promos and Sufra sponsored placements.
 * Rows for supabase/migrations/0009_crm.sql. Rules live in src/lib/promo (pure); data operations in
 * src/modules/marketing/ops.ts and src/modules/customers/crm.ts.
 */
import type { Localized, TenantRow, BaseRow, OrderMode } from "./types";
import type { Units } from "@/lib/money";
import type { LoyaltyRules } from "@/lib/promo/loyalty";
import type { PromotionRule, PromoChannel } from "@/lib/promo/types";
import type { LeadSource, SegmentDef } from "@/lib/promo/segments";
import type { BookingStatus, PricingModel, SlotType } from "@/lib/promo/sponsored";
import type { GiftCardStatus, GiftCardTxnKind } from "@/lib/promo/giftcards";

export type { LeadSource, PromoChannel };

/** Consent flags (Egypt PDPL 151/2020): what the guest agreed to be contacted on, and when. */
export interface Consent {
  whatsapp: boolean;
  sms: boolean;
  email: boolean;
  push: boolean;
  /** ISO time consent was captured / changed */
  at: string | null;
  /** where: "qr", "checkout", "pos", "import" … */
  via: string | null;
}

/** One loyalty program per restaurant (id = restaurant id). */
export interface LoyaltyProgram extends TenantRow, LoyaltyRules {
  name: Localized;
  /** referral: what the friend gets (a coupon promotion issued as a unique code) */
  referralPromotionId: string | null;
  referralMonthlyCap: number;
  /** shown on the guest loyalty page */
  terms: Localized;
}

export type LoyaltyEntryKind = "earn" | "redeem" | "expire" | "adjust" | "bonus";

/** Every points movement — and every paid visit of a known customer (kind "earn", points may be 0). */
export interface LoyaltyEntry extends TenantRow {
  customerId: string;
  branchId: string | null;
  kind: LoyaltyEntryKind;
  points: number;
  /** earn: what the visit spent (pre-tax eligible) / the bill total */
  spend: Units;
  checkId: string | null;
  channel: PromoChannel | null;
  rewardId: string | null;
  /** stamp card progress on this visit (cardId → stamps added) */
  stamps: Record<string, number>;
  expiresAt: string | null;
  note: string;
  actorId: string | null;
  at: string;
  /** earn: what the visit ordered (itemId → units) — item affinity, favourites */
  items?: Record<string, number>;
}

export interface Promotion extends TenantRow, PromotionRule {
  createdBy: string | null;
  /** campaign that issued it (attribution) */
  campaignId: string | null;
}

/** Unique single-use codes (campaigns, referrals, birthday). */
export interface CouponCode extends TenantRow {
  promotionId: string;
  code: string;
  customerId: string | null;
  campaignId: string | null;
  usedAt: string | null;
  checkId: string | null;
  expiresAt: string | null;
}

export type RedemptionStatus = "applied" | "redeemed" | "voided";

/** A promotion used on a check/order. "applied" while the check is open, "redeemed" once paid. */
export interface PromoRedemption extends TenantRow {
  /** null for loyalty rewards / points (see rewardId) */
  promotionId: string | null;
  /** loyalty reward id, or "points" for points used as money off */
  rewardId: string | null;
  code: string | null;
  customerId: string | null;
  checkId: string | null;
  orderId: string | null;
  channel: PromoChannel;
  status: RedemptionStatus;
  discount: Units;
  deliveryDiscount: Units;
  /** per line, so removing the promo restores the manual discounts exactly */
  lineDiscounts: Record<string, Units>;
  /** check total when paid (campaign revenue attribution) */
  revenue: Units;
  campaignId: string | null;
  /** loyalty reward redeemed through this row (points spent) */
  points: number;
  at: string;
}

export interface GiftCard extends TenantRow {
  code: string;
  initial: Units;
  balance: Units;
  status: GiftCardStatus;
  expiresAt: string | null;
  purchaser: { name: string; phone: string } | null;
  recipient: { name: string; phone: string; message: string } | null;
  soldVia: "pos" | "online";
  soldBy: string | null;
  paymentRef: string | null;
  customerId: string | null;
}

export interface GiftCardTxn extends TenantRow {
  giftCardId: string;
  kind: GiftCardTxnKind;
  amount: Units;
  balanceAfter: Units;
  checkId: string | null;
  paymentId: string | null;
  actorId: string | null;
  note: string;
}

export interface Segment extends TenantRow, SegmentDef {
  name: Localized;
  color: string;
  /** cached count (refreshed by the builder) */
  count: number;
}

export type CampaignChannel = "whatsapp" | "sms" | "push";
export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "cancelled";

export interface CampaignVariant {
  id: string;
  label: string;
  /** {name} {restaurant} {code} {points} {link} {tier} */
  text: Localized;
  /** share of the audience, % */
  share: number;
}

export interface CampaignStats {
  targeted: number;
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
  redeemed: number;
  revenue: Units;
  cost: Units;
}

export interface Campaign extends TenantRow {
  name: string;
  segmentId: string | null;
  /** built-in audience when no saved segment: "all", "rfm:at_risk", … */
  audience: string;
  channel: CampaignChannel;
  status: CampaignStatus;
  variants: CampaignVariant[];
  /** offer attached — every recipient gets a unique code of this promotion */
  promotionId: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  /** per message, Units (WhatsApp marketing conversation ≈ EGP 0.85; SMS ≈ 0.35) */
  costPerMessage: Units;
  stats: CampaignStats;
  /** journey that created it (automations) */
  journeyId: string | null;
  createdBy: string | null;
}

export type MessageStatus = "queued" | "sent" | "delivered" | "read" | "failed";

export interface CampaignMessage extends TenantRow {
  campaignId: string;
  variantId: string;
  customerId: string;
  to: string;
  text: string;
  code: string | null;
  status: MessageStatus;
  /** wa.me click-to-chat link (until the WhatsApp Cloud API notifier is connected) */
  link: string | null;
  sentAt: string | null;
  readAt: string | null;
  redeemedAt: string | null;
  revenue: Units;
}

export type JourneyTrigger = "welcome" | "birthday" | "winback" | "post_visit" | "referral" | "second_visit";

export interface Journey extends TenantRow {
  trigger: JourneyTrigger;
  name: Localized;
  enabled: boolean;
  channel: CampaignChannel;
  /** welcome/post_visit: hours after; birthday: days before; winback: days since last visit */
  delay: number;
  text: Localized;
  promotionId: string | null;
  stats: { sent: number; redeemed: number; revenue: Units };
  lastRunAt: string | null;
}

export interface Referral extends TenantRow {
  referrerId: string;
  refereeId: string | null;
  code: string;
  status: "pending" | "joined" | "qualified" | "rewarded" | "rejected";
  /** coupon code issued to the friend */
  refereeCode: string | null;
  rewardedAt: string | null;
}

export type BannerPlacement = "menu_top" | "online_top" | "checkout" | "table";

/** The restaurant's own promos on its QR menu / ordering pages. */
export interface PromoBanner extends TenantRow {
  title: Localized;
  body: Localized;
  /** emoji or short badge ("٢٠٪", "🎁") */
  badge: string;
  imageUrl: string | null;
  color: string;
  placements: BannerPlacement[];
  promotionId: string | null;
  /** tap → add this item */
  itemId: string | null;
  window: { startsAt: string | null; endsAt: string | null; days?: number[]; from?: string | null; to?: string | null } | null;
  modes: OrderMode[];
  active: boolean;
  sort: number;
  stats: { impressions: number; clicks: number };
}

/** Promo block printed at the bottom of receipts (Settings.invoice.promo). */
export interface ReceiptPromoBlock {
  enabled: boolean;
  title: Localized;
  body: Localized;
  /** coupon code printed under the text (next-visit offer) */
  code: string | null;
  /** what the QR opens: the loyalty page, the feedback page or a custom URL */
  qr: "loyalty" | "feedback" | "menu" | "none" | "url";
  url: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

/** Guest feedback (0005_guest.sql guest_feedback + 0009 reply columns). */
export interface GuestFeedback extends TenantRow {
  branchId: string | null;
  checkId: string | null;
  orderId: string | null;
  tableId: string | null;
  customerId?: string | null;
  waiterId?: string | null;
  stars: number;
  tags: string[];
  comment: string;
  reply?: string | null;
  repliedAt?: string | null;
  repliedBy?: string | null;
}

/* ───────── Sufra platform (super-admin) ───────── */

/** Restaurant marketplace profile (city / cuisines) — read by the directory and the sponsored feed. */
export interface MarketProfile extends TenantRow {
  city: string;
  area: string;
  cuisines: string[];
  priceLevel: 1 | 2 | 3 | 4;
  rating: number;
  listed: boolean;
}

/** A sellable ad slot (global, not a tenant row). */
export interface AdSlot extends BaseRow {
  type: SlotType;
  name: Localized;
  description: Localized;
  city: string | null;
  cuisine: string | null;
  capacity: number;
  pricing: { model: PricingModel; rate: Units };
  active: boolean;
  sort: number;
}

/** A sponsored placement bought by a restaurant (restaurantId = the advertiser). */
export interface AdBooking extends TenantRow {
  slotId: string;
  startsOn: string;
  endsOn: string;
  status: BookingStatus;
  targeting: { city: string | null; cuisine: string | null };
  pricing: { model: PricingModel; rate: Units };
  budget: Units;
  /** total to pay (per-day: days × rate; CPM/CPC: the budget, billed on delivery) */
  price: Units;
  creative: { headline: Localized; imageUrl: string | null; cta: Localized };
  payment: { method: "online" | "invoice"; reference: string | null; paidAt: string | null; invoiceNo: string | null };
  stats: { impressions: number; clicks: number; orders: number; revenue: Units };
  /** per-day delivery (YYYY-MM-DD → counts), for the performance chart */
  daily: Record<string, { impressions: number; clicks: number; orders: number }>;
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewNote: string;
}

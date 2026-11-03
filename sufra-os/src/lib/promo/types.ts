/**
 * Promotion / loyalty / ads shapes shared by the pure engines in src/lib/promo and the data rows in
 * src/data/crmTypes.ts. No I/O here: everything is plain data so the rules run the same in the POS, the guest
 * checkout, tests and (ported) Postgres functions.
 *
 * Money is Units (0.00001 EGP). Rates are basis points (15% = 1500), like the rest of Sufra.
 */
import type { Localized, OrderMode } from "@/data/types";
import type { Units } from "@/lib/money";

/** Where a promotion can be used. */
export type PromoChannel = "pos" | "qr" | "online";

export type PromoType =
  /** % off the bill, or off the target items (value = bp) */
  | "percent"
  /** fixed amount off the bill / the target items (value = Units) */
  | "amount"
  /** buy N get M (value = bp off the reward units; 10000 = free) */
  | "bogo"
  /** a set of items for a fixed price (value = Units for one combo) */
  | "combo"
  /** waives the delivery fee */
  | "free_delivery"
  /** N units of a target item free (value = number of free units) */
  | "free_item";

export interface PromoWindow {
  /** ISO, inclusive */
  startsAt?: string | null;
  /** ISO, exclusive */
  endsAt?: string | null;
  /** 0 = Sunday … 6 = Saturday; empty/undefined = every day */
  days?: number[];
  /** "HH:MM" wall time in the restaurant's timezone; `to` may be before `from` (past midnight) */
  from?: string | null;
  to?: string | null;
}

export interface PromotionRule {
  name: Localized;
  description?: Localized;
  /** coupon = needs a code; auto = applies by itself when its conditions hold */
  kind: "coupon" | "auto";
  type: PromoType;
  /** shared (multi-use) code; unique per-customer codes live in couponCodes */
  code: string | null;
  value: number;
  /** cap on the discount one use can give */
  maxDiscount?: Units | null;
  /** minimum (pre-tax, after manual discounts) spend */
  minSpend?: Units | null;
  /** null = the whole bill */
  target?: { itemIds: string[]; categoryIds: string[] } | null;
  bogo?: { buyQty: number; getQty: number; getItemIds?: string[] } | null;
  combo?: { itemIds: string[] } | null;
  window?: PromoWindow | null;
  /** empty = every channel */
  channels: PromoChannel[];
  /** empty/undefined = every order type */
  modes?: OrderMode[];
  firstOrderOnly?: boolean;
  limits?: { total?: number | null; perCustomer?: number | null } | null;
  /** may combine with other stackable promotions */
  stackable: boolean;
  /** lower runs first */
  priority: number;
  active: boolean;
  /** only for members of these segments / tiers (resolved by the caller into ctx) */
  segmentIds?: string[];
  tierIds?: string[];
  /** cached count of redemptions */
  uses: number;
}

export interface PromoLine {
  id: string;
  itemId: string;
  categoryId: string | null;
  qty: number;
  /** unit price including modifiers */
  unitPrice: Units;
  /** discount already on the line (manual) */
  discount: Units;
}

export interface PromoCart {
  lines: PromoLine[];
  channel: PromoChannel;
  mode: OrderMode;
  deliveryFee: Units;
  at: Date;
  /** IANA zone for day/hour windows (default Africa/Cairo) */
  timezone?: string;
}

export interface PromoCustomer {
  id: string;
  /** paid orders before this one */
  orders: number;
  /** redemptions so far by promotion id */
  usesByPromo: Record<string, number>;
  segmentIds: string[];
  tierId: string | null;
}

/** A unique code row as the engine needs it. */
export interface UniqueCode {
  code: string;
  promotionId: string;
  customerId: string | null;
  usedAt: string | null;
}

export interface PromoContext {
  customer: PromoCustomer | null;
  /** codes the guest/cashier typed (normalised by the engine) */
  codes: string[];
  /** unique codes matching what was typed (looked up by the caller) */
  uniqueCodes?: UniqueCode[];
}

export type RejectReason =
  | "inactive"
  | "not_started"
  | "expired"
  | "wrong_day"
  | "wrong_time"
  | "channel"
  | "mode"
  | "min_spend"
  | "no_items"
  | "first_order"
  | "needs_customer"
  | "limit_total"
  | "limit_customer"
  | "segment"
  | "not_stackable"
  | "unknown_code"
  | "code_used"
  | "code_owner"
  | "no_delivery";

export interface AppliedPromo {
  promotionId: string;
  name: Localized;
  code: string | null;
  /** discount on the lines (sum of lineDiscounts) */
  discount: Units;
  lineDiscounts: Record<string, Units>;
  /** delivery fee waived (not in `discount`) */
  deliveryDiscount: Units;
}

export interface PromoResult {
  applied: AppliedPromo[];
  rejected: { promotionId: string | null; code: string | null; reason: RejectReason }[];
  /** total promo discount per line (to add to the line's own discount) */
  lineDiscounts: Record<string, Units>;
  discount: Units;
  deliveryDiscount: Units;
  /** pre-tax base the promotions saw (after manual line discounts) */
  base: Units;
  /** auto offers that are close: "add X more" */
  hints: { promotionId: string; name: Localized; missing: Units }[];
}

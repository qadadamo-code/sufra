/**
 * Public (no-auth) marketing API used by the guest pages: menu banners & offers, coupon checks at checkout,
 * applying promos to a placed order, the loyalty card, buying gift cards, and the Sufra sponsored feed.
 *
 *   local  (LocalAdapter): reads/writes the in-browser rows directly (same as GuestService)
 *   cloud  (SupabaseAdapter): SECURITY DEFINER RPCs from supabase/migrations/0009_crm.sql — anon never touches tables
 *          guest_promos(slug, placement) · guest_check_coupon(slug, code, phone) · guest_apply_promos(slug, order, codes, phone)
 *          guest_loyalty_card(slug, phone, order_no) · public_sponsored(city, cuisine) · public_sponsored_track(id, event)
 */
import type { GuestMenu, Repo } from "@/data/repo";
import type { BannerPlacement, Customer, GiftCard, LoyaltyEntry, LoyaltyProgram, OrderMode, PromoBanner, Promotion } from "@/data/types";
import { makeDb } from "@/data/hooks";
import { recomputeCheck } from "@/data/ops";
import { lineUnitPrice } from "@/data/pricing";
import type { Units } from "@/lib/money";
import { nowIso } from "@/lib/time";
import { normalizePhone } from "@/modules/guest/api/service";
import { canRefer, computeBalance, evaluatePromotions, expiryFor, nextTier, normalizeCode, publicFeed, referralCode, tierFor, windowCheck, type PromoResult, type PublicSponsored, type Tier } from "@/lib/promo";
import type { CartLine } from "@/modules/guest/cart";
import { rulesOf, sellGiftCard } from "../ops";

type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> };

export interface PublicOffer {
  id: string;
  name: PromoBanner["title"];
  kind: Promotion["kind"];
  type: Promotion["type"];
  code: string | null;
}

export interface LoyaltyCard {
  customer: { id: string; name: string; phone: string; referralCode: string | null };
  program: Pick<LoyaltyProgram, "name" | "terms" | "pointValue" | "earnPoints" | "earnSpend" | "minRedeem" | "rewards" | "stampCards" | "tiers">;
  points: number;
  lifetime: number;
  tier: Tier | null;
  next: { tier: Tier; missing: number } | null;
  expiringSoon: { points: number; at: string } | null;
  stamps: Record<string, number>;
  history: { at: string; kind: LoyaltyEntry["kind"]; points: number; spend: Units }[];
  codes: { code: string; name: Promotion["name"]; usedAt: string | null }[];
  visits: number;
}

export class PromoError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export class PromoPublic {
  constructor(private repo: Repo) {}
  private get local() {
    return this.repo.kind === "local";
  }
  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const client = (this.repo as unknown as { client?: Rpc }).client;
    if (!client) throw new PromoError("no_backend");
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new PromoError(error.message);
    return data as T;
  }
  private async restaurant(slug: string) {
    const [r] = await this.repo.list("restaurants", { where: { slug, active: true } });
    if (!r) throw new PromoError("not_found");
    return r;
  }

  /** Banners for a placement + the public list of active promotions (cloud: guest_promos). */
  async promos(slug: string, placement: BannerPlacement, mode: OrderMode, at = new Date()): Promise<{ banners: PromoBanner[]; offers: PublicOffer[]; promotions: Promotion[] }> {
    if (!this.local) return this.rpc("guest_promos", { p_slug: slug, p_placement: placement, p_mode: mode });
    const r = await this.restaurant(slug);
    const banners = (await this.repo.list("promoBanners", { where: { restaurantId: r.id, active: true }, orderBy: [{ field: "sort" }] })).filter(
      (b) => b.placements.includes(placement) && (!b.modes.length || b.modes.includes(mode)) && !windowCheck({ window: b.window }, at),
    );
    const promotions = (await this.repo.list("promotions", { where: { restaurantId: r.id, active: true } })).filter((p) => !windowCheck(p, at));
    return { banners, offers: promotions.filter((p) => p.kind === "auto" || p.code).map((p) => ({ id: p.id, name: p.name, kind: p.kind, type: p.type, code: p.kind === "coupon" ? p.code : null })), promotions };
  }

  /** Count a banner impression/click (best effort). */
  async track(bannerId: string, event: "impression" | "click") {
    if (!this.local) return void this.rpc("guest_banner_track", { p_banner_id: bannerId, p_event: event }).catch(() => undefined);
    const b = await this.repo.get("promoBanners", bannerId);
    if (b) await this.repo.update("promoBanners", b.id, { stats: { ...b.stats, [event === "click" ? "clicks" : "impressions"]: (event === "click" ? b.stats.clicks : b.stats.impressions) + 1 } });
  }

  private async customerCtx(restaurantId: string, phone: string | null) {
    const p = phone ? normalizePhone(phone) : null;
    if (!p) return { customer: null as Customer | null, ctx: null };
    const [c] = await this.repo.list("customers", { where: { restaurantId, phone: p } });
    if (!c) return { customer: null, ctx: { id: `new:${p}`, orders: 0, usesByPromo: {}, segmentIds: [], tierId: null } };
    const reds = await this.repo.list("promoRedemptions", { where: { customerId: c.id, status: "redeemed" } });
    const usesByPromo: Record<string, number> = {};
    for (const r of reds) if (r.promotionId) usesByPromo[r.promotionId] = (usesByPromo[r.promotionId] ?? 0) + 1;
    return { customer: c, ctx: { id: c.id, orders: c.visits, usesByPromo, segmentIds: [], tierId: c.tierId ?? null } };
  }

  /**
   * Evaluates the cart with the typed codes + automatic offers. Cloud: guest_check_coupon validates the code and returns
   * the matching promotion rows; the same pure engine prices it here, and the staff app re-applies it authoritatively.
   */
  async checkCart(slug: string, menu: GuestMenu, cart: CartLine[], input: { mode: OrderMode; channel: "qr" | "online"; deliveryFee: Units; codes: string[]; phone?: string | null }, at = new Date()): Promise<PromoResult> {
    const lines = cart.map((l, i) => {
      const it = menu.items.find((x) => x.id === l.itemId);
      const mods = l.modifierIds.reduce((a, id) => a + (menu.modifiers.find((m) => m.id === id)?.price ?? 0), 0);
      return { id: `cart-${i}`, itemId: l.itemId, categoryId: it?.categoryId ?? null, qty: l.qty, unitPrice: (it?.price ?? 0) + mods, discount: 0 };
    });
    let promotions: Promotion[];
    let uniqueCodes: { code: string; promotionId: string; customerId: string | null; usedAt: string | null }[] = [];
    let ctx: Awaited<ReturnType<PromoPublic["customerCtx"]>>["ctx"] = null;
    if (!this.local) {
      const res = await this.rpc<{ promotions: Promotion[]; uniqueCodes: typeof uniqueCodes; customer: typeof ctx }>("guest_check_coupon", { p_slug: slug, p_codes: input.codes.map(normalizeCode), p_phone: input.phone ?? null });
      promotions = res.promotions;
      uniqueCodes = res.uniqueCodes;
      ctx = res.customer;
    } else {
      const r = await this.restaurant(slug);
      promotions = await this.repo.list("promotions", { where: { restaurantId: r.id } });
      const codes = input.codes.map(normalizeCode).filter(Boolean);
      uniqueCodes = codes.length ? (await this.repo.list("couponCodes", { where: { restaurantId: r.id, code: codes } })).map((c) => ({ code: c.code, promotionId: c.promotionId, customerId: c.customerId, usedAt: c.usedAt })) : [];
      ctx = (await this.customerCtx(r.id, input.phone ?? null)).ctx;
    }
    return evaluatePromotions({ lines, channel: input.channel, mode: input.mode, deliveryFee: input.deliveryFee, at }, promotions, { customer: ctx, codes: input.codes, uniqueCodes });
  }

  /** After placeOrder: apply the codes + automatic offers to the order's check (line discounts before tax, fee waiver). */
  async applyToOrder(slug: string, orderId: string, codes: string[], phone: string | null): Promise<PromoResult | null> {
    if (!this.local) {
      await this.rpc("guest_apply_promos", { p_slug: slug, p_order_id: orderId, p_codes: codes.map(normalizeCode), p_phone: phone });
      return null;
    }
    const order = await this.repo.get("orders", orderId);
    if (!order || !order.checkId) return null;
    const r = await this.restaurant(slug);
    if (order.restaurantId !== r.id) return null;
    const items = await this.repo.list("orderItems", { where: { orderId } });
    const menu = await this.repo.list("menuItems", { where: { restaurantId: r.id } });
    const promotions = await this.repo.list("promotions", { where: { restaurantId: r.id } });
    const norm = codes.map(normalizeCode).filter(Boolean);
    const ucs = norm.length ? await this.repo.list("couponCodes", { where: { restaurantId: r.id, code: norm } }) : [];
    const { ctx, customer } = await this.customerCtx(r.id, phone);
    const channel = order.source === "qr" ? "qr" : "online";
    const res = evaluatePromotions(
      {
        lines: items.filter((i) => i.status !== "void").map((i) => ({ id: i.id, itemId: i.itemId, categoryId: menu.find((m) => m.id === i.itemId)?.categoryId ?? null, qty: i.qty, unitPrice: lineUnitPrice(i), discount: i.discount })),
        channel, mode: order.mode, deliveryFee: order.deliveryFee, at: new Date(),
      },
      promotions,
      { customer: ctx, codes: norm, uniqueCodes: ucs.map((c) => ({ code: c.code, promotionId: c.promotionId, customerId: c.customerId, usedAt: c.usedAt })) },
    );
    if (!res.applied.length) return res;
    for (const i of items) if (res.lineDiscounts[i.id]) await this.repo.update("orderItems", i.id, { discount: i.discount + res.lineDiscounts[i.id] });
    if (res.deliveryDiscount) await this.repo.update("orders", order.id, { deliveryFee: Math.max(0, order.deliveryFee - res.deliveryDiscount) });
    for (const a of res.applied) {
      const uc = ucs.find((u) => u.promotionId === a.promotionId);
      const p = promotions.find((x) => x.id === a.promotionId);
      await this.repo.insert("promoRedemptions", {
        restaurantId: r.id, promotionId: a.promotionId, rewardId: null, code: uc?.code ?? a.code, customerId: customer?.id ?? order.customerId, checkId: order.checkId, orderId: order.id, channel, status: "applied",
        discount: a.discount, deliveryDiscount: a.deliveryDiscount, lineDiscounts: a.lineDiscounts, revenue: 0, campaignId: uc?.campaignId ?? p?.campaignId ?? null, points: 0, at: nowIso(),
      });
    }
    await recomputeCheck(makeDb(this.repo, r.id, order.branchId, null), order.checkId);
    return res;
  }

  /**
   * Loyalty card sign-in (demo, OTP-less): phone + the number of any past order. A guest with no orders on record
   * can use the last 4 digits of their phone (demo only). Production: a one-time code over WhatsApp (see DESIGN.md).
   */
  async loyaltyCard(slug: string, phone: string, proof: string): Promise<LoyaltyCard> {
    const p = normalizePhone(phone);
    if (!p) throw new PromoError("bad_phone");
    if (!this.local) return this.rpc("guest_loyalty_card", { p_slug: slug, p_phone: p, p_order_no: proof });
    const r = await this.restaurant(slug);
    const [c] = await this.repo.list("customers", { where: { restaurantId: r.id, phone: p } });
    if (!c) throw new PromoError("not_member");
    const orders = await this.repo.list("orders", { where: { restaurantId: r.id, customerId: c.id } });
    const proofN = proof.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\D/g, "");
    const ok = orders.length ? orders.some((o) => String(o.number) === proofN) : proofN === p.slice(-4);
    if (!ok) throw new PromoError("bad_proof");
    return this.cardFor(r.id, c);
  }

  /** Card for a customer already identified on this device (token from loyaltyCard). */
  async cardById(slug: string, customerId: string, phone: string): Promise<LoyaltyCard | null> {
    if (!this.local) return null;
    const r = await this.restaurant(slug);
    const c = await this.repo.get("customers", customerId);
    if (!c || c.restaurantId !== r.id || c.phone !== phone) return null;
    return this.cardFor(r.id, c);
  }

  private async cardFor(restaurantId: string, c: Customer): Promise<LoyaltyCard> {
    const [program] = await this.repo.list("loyaltyPrograms", { where: { restaurantId } });
    const rules = rulesOf(program ?? null);
    const ledger = await this.repo.list("loyaltyLedger", { where: { customerId: c.id } });
    const b = computeBalance(ledger.map((e) => ({ id: e.id, kind: e.kind, points: e.points, at: e.at, expiresAt: e.expiresAt })));
    const codes = await this.repo.list("couponCodes", { where: { customerId: c.id } });
    const promos = await this.repo.list("promotions", { where: { restaurantId } });
    return {
      customer: { id: c.id, name: c.name, phone: c.phone, referralCode: c.referralCode ?? null },
      program: {
        name: program?.name ?? { ar: "نادي الولاء", en: "Loyalty club" }, terms: program?.terms ?? { ar: "", en: "" }, pointValue: rules.pointValue, earnPoints: rules.earnPoints, earnSpend: rules.earnSpend,
        minRedeem: rules.minRedeem, rewards: rules.rewards.filter((x) => x.active), stampCards: rules.stampCards.filter((x) => x.active), tiers: rules.tiers,
      },
      points: b.balance, lifetime: b.lifetime, tier: tierFor(b.lifetime, rules.tiers), next: nextTier(b.lifetime, rules.tiers), expiringSoon: b.expiringSoon, stamps: c.stamps ?? {},
      history: ledger.sort((x, y) => y.at.localeCompare(x.at)).slice(0, 12).map((e) => ({ at: e.at, kind: e.kind, points: e.points, spend: e.spend })),
      codes: codes.map((x) => ({ code: x.code, name: promos.find((p) => p.id === x.promotionId)?.name ?? { ar: "", en: "" }, usedAt: x.usedAt })), visits: c.visits,
    };
  }

  /** Join the club from the loyalty page: consent, welcome bonus, optional friend's referral code. */
  async join(slug: string, x: { name: string; phone: string; whatsapp: boolean; referralCode?: string | null }): Promise<{ customerId: string; phone: string; welcome: number; refereeCode: string | null }> {
    const phone = normalizePhone(x.phone);
    if (!phone) throw new PromoError("bad_phone");
    if (!this.local) {
      await this.rpc("guest_join_loyalty", { p_slug: slug, p_name: x.name.trim(), p_phone: phone, p_check_id: null });
      return { customerId: "", phone, welcome: 0, refereeCode: null };
    }
    const r = await this.restaurant(slug);
    const [program] = await this.repo.list("loyaltyPrograms", { where: { restaurantId: r.id } });
    const rules = rulesOf(program ?? null);
    let [c] = await this.repo.list("customers", { where: { restaurantId: r.id, phone } });
    const consent = { whatsapp: x.whatsapp, sms: false, email: false, push: false, at: nowIso(), via: "qr" };
    let welcome = 0;
    if (!c) {
      c = await this.repo.insert("customers", {
        restaurantId: r.id, phone, name: x.name.trim() || phone, email: null, visits: 0, lastVisitAt: null, totalSpent: 0, loyaltyPoints: 0, tags: ["loyalty"], notes: "", birthday: null, addresses: [],
        source: "qr", consent, stamps: {}, lifetimePoints: 0, tierId: rules.tiers[0]?.id ?? null, referralCode: null,
      });
      await this.repo.update("customers", c.id, { referralCode: referralCode(c.id) });
      if (rules.enabled && rules.welcomeBonus > 0) {
        welcome = rules.welcomeBonus;
        await this.repo.insert("loyaltyLedger", { restaurantId: r.id, customerId: c.id, branchId: null, kind: "bonus", points: welcome, spend: 0, checkId: null, channel: "qr", rewardId: null, stamps: {}, expiresAt: expiryFor(nowIso(), rules), note: "welcome", actorId: null, at: nowIso() });
        await this.repo.update("customers", c.id, { loyaltyPoints: welcome, lifetimePoints: welcome });
      }
    } else await this.repo.update("customers", c.id, { consent: { ...(c.consent ?? consent), whatsapp: x.whatsapp, at: nowIso(), via: "qr" }, tags: [...new Set([...c.tags, "loyalty"])] });
    // friend's referral code → the friend (this guest) gets the welcome coupon, the referrer is rewarded on the first paid visit
    let refereeCode: string | null = null;
    const code = x.referralCode?.trim().toUpperCase();
    if (code) {
      const [referrer] = await this.repo.list("customers", { where: { restaurantId: r.id, referralCode: code } });
      const already = (await this.repo.list("referrals", { where: { restaurantId: r.id, refereeId: c.id } })).length > 0;
      const recent = referrer ? (await this.repo.list("referrals", { where: { referrerId: referrer.id }, gte: { createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString() } })).length : 0;
      const err = canRefer({ referrerId: referrer?.id ?? null, refereeId: c.id, refereeVisits: c.visits, refereeAlreadyReferred: already, referrerRecent: recent, monthlyCap: program?.referralMonthlyCap ?? 10 });
      if (err) throw new PromoError(`referral_${err}`);
      if (program?.referralPromotionId) {
        refereeCode = referralCode(`friend:${c.id}`, "RF");
        await this.repo.insert("couponCodes", { restaurantId: r.id, promotionId: program.referralPromotionId, code: refereeCode, customerId: c.id, campaignId: null, usedAt: null, checkId: null, expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() });
      }
      await this.repo.insert("referrals", { restaurantId: r.id, referrerId: referrer!.id, refereeId: c.id, code, status: "joined", refereeCode, rewardedAt: null });
      await this.repo.update("customers", c.id, { referredBy: referrer!.id, source: c.visits ? c.source : "referral" });
    }
    return { customerId: c.id, phone, welcome, refereeCode };
  }

  /** Online e-gift card: issued once the (demo) payment intent succeeded — idempotent by the intent id. */
  async issueGiftCard(slug: string, x: { amount: Units; purchaser: { name: string; phone: string }; recipient: { name: string; phone: string; message: string } | null; intentId: string; code?: string }): Promise<GiftCard> {
    if (!this.local) return this.rpc("guest_gift_card_status", { p_slug: slug, p_intent_id: x.intentId });
    const r = await this.restaurant(slug);
    const db = makeDb(this.repo, r.id, null, null);
    return sellGiftCard(db, { amount: x.amount, purchaser: x.purchaser, recipient: x.recipient, via: "online", method: "online", reference: x.intentId, code: x.code });
  }

  /** Sponsored placements for the Sufra marketplace (sufra-web reads the same through public_sponsored). */
  async sponsored(city: string | null, cuisine: string | null, today = new Date().toISOString().slice(0, 10)): Promise<PublicSponsored[]> {
    if (!this.local) return this.rpc("public_sponsored", { p_city: city, p_cuisine: cuisine });
    const bookings = await this.repo.list("adBookings");
    const slots = await this.repo.list("adSlots");
    const restaurants = await this.repo.list("restaurants");
    return publicFeed(bookings, slots, restaurants, { city, cuisine, today });
  }
}

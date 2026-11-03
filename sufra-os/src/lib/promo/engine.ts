/**
 * Promotions engine (pure). Takes a cart/check and the restaurant's promotions, returns per-line discounts.
 *
 *   const r = evaluatePromotions(cart, promos, { customer, codes: ["RAMADAN15"] });
 *   // r.lineDiscounts[lineId] → add to OrderItem.discount;  r.deliveryDiscount → waive the fee
 *
 * Rules
 *  - Every discount is a *line* discount before tax: bill-level promotions are allocated over the eligible lines
 *    (largest remainder, whole piastres), so @finance/tax prices VAT/service on the discounted net exactly like a
 *    manual discount, and receipts/ETA show it per line.
 *  - A line never goes below zero; manual discounts already on a line are respected (the promo sees the net).
 *  - Stacking: all eligible *stackable* promotions apply one after another (priority order, each on what is left),
 *    a *non-stackable* promotion applies alone. The engine picks whichever option saves the guest the most
 *    (ties → lower priority number) and reports the others as `not_stackable`.
 *  - Coupons need their shared code typed, or a unique (single-use, maybe customer-bound) code.
 */
import type { Localized } from "@/data/types";
import { roundMinor, UNITS_PER_MINOR, type Units } from "@/lib/money";
import { latinDigits } from "@/lib/arabic";
import type { AppliedPromo, PromoCart, PromoContext, PromoLine, PromoResult, PromotionRule, RejectReason } from "./types";

export type Promo = PromotionRule & { id: string };

/** Upper-case, Latin digits, no spaces/dashes: " ramadan-15 " → "RAMADAN15". */
export const normalizeCode = (c: string) => latinDigits(c).toUpperCase().replace(/[\s\-_.]/g, "");

/** Split `total` over `weights` in whole piastres (largest remainder); the parts always add up to `total`. */
export function allocateUnits(total: Units, weights: Units[]): Units[] {
  const t = Math.round(total / UNITS_PER_MINOR);
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (t <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (Math.max(0, w) * t) / sum);
  const out = raw.map(Math.floor);
  let left = t - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i]++;
    left--;
  }
  return out.map((p) => p * UNITS_PER_MINOR);
}

/** Day of week (0 = Sunday) and minutes after midnight in a timezone. */
export function wallClock(at: Date, timezone = "Africa/Cairo"): { day: number; minutes: number; date: string } {
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" });
    const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
    return { day, minutes: Number(p.hour) * 60 + Number(p.minute), date: `${p.year}-${p.month}-${p.day}` };
  } catch {
    return { day: at.getDay(), minutes: at.getHours() * 60 + at.getMinutes(), date: at.toISOString().slice(0, 10) };
  }
}

const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Is `at` inside the promotion's date/day/hour window? Returns the reason when not. */
export function windowCheck(p: Pick<PromotionRule, "window">, at: Date, timezone?: string): RejectReason | null {
  const w = p.window;
  if (!w) return null;
  if (w.startsAt && at.getTime() < Date.parse(w.startsAt)) return "not_started";
  if (w.endsAt && at.getTime() >= Date.parse(w.endsAt)) return "expired";
  const wc = wallClock(at, timezone);
  if (w.from && w.to) {
    const a = hm(w.from);
    const b = hm(w.to);
    const inside = a <= b ? wc.minutes >= a && wc.minutes < b : wc.minutes >= a || wc.minutes < b;
    if (!inside) return "wrong_time";
    // a window past midnight belongs to the day it started
    const day = a > b && wc.minutes < b ? (wc.day + 6) % 7 : wc.day;
    if (w.days?.length && !w.days.includes(day)) return "wrong_day";
    return null;
  }
  if (w.days?.length && !w.days.includes(wc.day)) return "wrong_day";
  return null;
}

const lineBase = (l: PromoLine, extra: Record<string, Units>) => Math.max(0, l.unitPrice * l.qty - l.discount - (extra[l.id] ?? 0));

function targets(p: Promo, l: PromoLine) {
  if (!p.target || (!p.target.itemIds.length && !p.target.categoryIds.length)) return true;
  return p.target.itemIds.includes(l.itemId) || (!!l.categoryId && p.target.categoryIds.includes(l.categoryId));
}

/** Units of each eligible line, priced at their current net unit price. */
function unitsOf(lines: PromoLine[], used: Record<string, Units>) {
  const out: { lineId: string; price: Units }[] = [];
  for (const l of lines) {
    if (l.qty <= 0) continue;
    const net = lineBase(l, used) / l.qty;
    for (let i = 0; i < l.qty; i++) out.push({ lineId: l.id, price: net });
  }
  return out;
}

/** Discount one promotion gives on the cart as it stands (`used` = discounts already taken by earlier promos). */
function compute(p: Promo, cart: PromoCart, used: Record<string, Units>): { lines: Record<string, Units>; delivery: Units } | RejectReason {
  const eligible = cart.lines.filter((l) => l.qty > 0 && targets(p, l) && lineBase(l, used) > 0);
  const out: Record<string, Units> = {};
  const add = (id: string, v: Units) => v > 0 && (out[id] = (out[id] ?? 0) + v);

  switch (p.type) {
    case "free_delivery": {
      if (cart.mode !== "delivery" || cart.deliveryFee <= 0) return "no_delivery";
      return { lines: {}, delivery: cart.deliveryFee };
    }
    case "percent": {
      if (!eligible.length) return "no_items";
      const bases = eligible.map((l) => lineBase(l, used));
      const total = roundMinor((bases.reduce((a, b) => a + b, 0) * p.value) / 10_000);
      allocateUnits(total, bases).forEach((v, i) => add(eligible[i].id, v));
      break;
    }
    case "amount": {
      if (!eligible.length) return "no_items";
      const bases = eligible.map((l) => lineBase(l, used));
      const total = Math.min(roundMinor(p.value), bases.reduce((a, b) => a + b, 0));
      allocateUnits(total, bases).forEach((v, i) => add(eligible[i].id, v));
      break;
    }
    case "bogo": {
      const buy = Math.max(1, p.bogo?.buyQty ?? 1);
      const get = Math.max(1, p.bogo?.getQty ?? 1);
      const rate = p.value || 10_000;
      const getIds = p.bogo?.getItemIds?.length ? p.bogo.getItemIds : null;
      if (!getIds) {
        // same pool: sort by price, every group of buy+get gives the cheapest `get` units
        const units = unitsOf(eligible, used).sort((a, b) => b.price - a.price);
        const groups = Math.floor(units.length / (buy + get));
        if (!groups) return "no_items";
        // the cheapest groups*get units are the rewards
        const rewards = units.slice(units.length - groups * get);
        for (const u of rewards) add(u.lineId, Math.round((u.price * rate) / 10_000));
      } else {
        const buyUnits = unitsOf(eligible, used).length;
        const sets = Math.floor(buyUnits / buy);
        const pool = unitsOf(cart.lines.filter((l) => getIds.includes(l.itemId)), used).sort((a, b) => a.price - b.price);
        const rewards = pool.slice(0, sets * get);
        if (!rewards.length) return "no_items";
        for (const u of rewards) add(u.lineId, Math.round((u.price * rate) / 10_000));
      }
      // whole piastres per line
      for (const k of Object.keys(out)) out[k] = roundMinor(out[k]);
      break;
    }
    case "free_item": {
      const n = Math.max(1, Math.round(p.value || 1));
      const units = unitsOf(eligible, used).sort((a, b) => a.price - b.price).slice(0, n);
      if (!units.length) return "no_items";
      for (const u of units) add(u.lineId, u.price);
      for (const k of Object.keys(out)) out[k] = roundMinor(out[k]);
      break;
    }
    case "combo": {
      const ids = p.combo?.itemIds ?? [];
      if (!ids.length) return "no_items";
      const pools = ids.map((id) => unitsOf(cart.lines.filter((l) => l.itemId === id), used).sort((a, b) => b.price - a.price));
      const k = Math.min(...pools.map((x) => x.length));
      if (!k) return "no_items";
      for (let i = 0; i < k; i++) {
        const set = pools.map((pool) => pool[i]);
        const full = set.reduce((a, u) => a + u.price, 0);
        const save = Math.max(0, roundMinor(full - p.value));
        allocateUnits(save, set.map((u) => u.price)).forEach((v, j) => add(set[j].lineId, v));
      }
      break;
    }
  }

  // never more than what is left on a line
  for (const l of cart.lines) if (out[l.id]) out[l.id] = Math.min(out[l.id], lineBase(l, used));
  let total = Object.values(out).reduce((a, b) => a + b, 0);
  if (p.maxDiscount != null && p.maxDiscount > 0 && total > p.maxDiscount) {
    const ids = Object.keys(out);
    const capped = allocateUnits(roundMinor(p.maxDiscount), ids.map((id) => out[id]));
    ids.forEach((id, i) => (out[id] = capped[i]));
    total = p.maxDiscount;
  }
  if (total <= 0) return "no_items";
  return { lines: out, delivery: 0 };
}

/** Conditions that do not depend on other promotions. */
export function eligibility(p: Promo, cart: PromoCart, ctx: PromoContext, base: Units): RejectReason | null {
  if (!p.active) return "inactive";
  const w = windowCheck(p, cart.at, cart.timezone);
  if (w) return w;
  if (p.channels.length && !p.channels.includes(cart.channel)) return "channel";
  if (p.modes?.length && !p.modes.includes(cart.mode)) return "mode";
  if (p.limits?.total != null && p.uses >= p.limits.total) return "limit_total";
  const needsCustomer = !!(p.firstOrderOnly || p.limits?.perCustomer != null || p.segmentIds?.length || p.tierIds?.length);
  if (needsCustomer && !ctx.customer) return "needs_customer";
  if (p.firstOrderOnly && ctx.customer && ctx.customer.orders > 0) return "first_order";
  if (p.limits?.perCustomer != null && ctx.customer && (ctx.customer.usesByPromo[p.id] ?? 0) >= p.limits.perCustomer) return "limit_customer";
  if (p.segmentIds?.length && ctx.customer && !p.segmentIds.some((s) => ctx.customer!.segmentIds.includes(s))) return "segment";
  if (p.tierIds?.length && ctx.customer && !(ctx.customer.tierId && p.tierIds.includes(ctx.customer.tierId))) return "segment";
  if (p.minSpend && base < p.minSpend) return "min_spend";
  return null;
}

/** Which coupons the typed codes unlock (and why the others don't). */
function resolveCodes(promos: Promo[], ctx: PromoContext) {
  const typed = [...new Set(ctx.codes.map(normalizeCode).filter(Boolean))];
  const unlocked = new Map<string, string>(); // promotionId → code
  const rejected: PromoResult["rejected"] = [];
  for (const code of typed) {
    const shared = promos.find((p) => p.kind === "coupon" && p.code && normalizeCode(p.code) === code);
    if (shared) {
      unlocked.set(shared.id, code);
      continue;
    }
    const uc = ctx.uniqueCodes?.find((u) => normalizeCode(u.code) === code);
    if (!uc || !promos.some((p) => p.id === uc.promotionId)) {
      rejected.push({ promotionId: null, code, reason: "unknown_code" });
      continue;
    }
    if (uc.usedAt) rejected.push({ promotionId: uc.promotionId, code, reason: "code_used" });
    else if (uc.customerId && uc.customerId !== ctx.customer?.id) rejected.push({ promotionId: uc.promotionId, code, reason: ctx.customer ? "code_owner" : "needs_customer" });
    else unlocked.set(uc.promotionId, code);
  }
  return { unlocked, rejected };
}

export function evaluatePromotions(cart: PromoCart, promos: Promo[], ctx: PromoContext): PromoResult {
  const base = cart.lines.reduce((a, l) => a + Math.max(0, l.unitPrice * l.qty - l.discount), 0);
  const { unlocked, rejected } = resolveCodes(promos, ctx);
  const hints: PromoResult["hints"] = [];

  const candidates: Promo[] = [];
  for (const p of [...promos].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))) {
    if (p.kind === "coupon" && !unlocked.has(p.id)) continue;
    const why = eligibility(p, cart, ctx, base);
    if (why) {
      if (p.kind === "coupon") rejected.push({ promotionId: p.id, code: unlocked.get(p.id) ?? null, reason: why });
      else if (why === "min_spend" && p.minSpend && !windowCheck(p, cart.at, cart.timezone)) hints.push({ promotionId: p.id, name: p.name, missing: p.minSpend - base });
      continue;
    }
    candidates.push(p);
  }

  const run = (list: Promo[]) => {
    const used: Record<string, Units> = {};
    const applied: AppliedPromo[] = [];
    const fails: { p: Promo; reason: RejectReason }[] = [];
    let delivery = 0;
    for (const p of list) {
      const r = compute(p, { ...cart, deliveryFee: cart.deliveryFee - delivery }, used);
      if (typeof r === "string") {
        fails.push({ p, reason: r });
        continue;
      }
      for (const [k, v] of Object.entries(r.lines)) used[k] = (used[k] ?? 0) + v;
      delivery += r.delivery;
      applied.push({ promotionId: p.id, name: p.name, code: unlocked.get(p.id) ?? null, discount: Object.values(r.lines).reduce((a, b) => a + b, 0), lineDiscounts: r.lines, deliveryDiscount: r.delivery });
    }
    const total = applied.reduce((a, x) => a + x.discount + x.deliveryDiscount, 0);
    return { used, applied, fails, delivery, total };
  };

  const options = [run(candidates.filter((p) => p.stackable)), ...candidates.filter((p) => !p.stackable).map((p) => run([p]))];
  // best saving; ties → the option whose first promotion has the lower priority
  let best = options[0];
  for (const o of options.slice(1)) {
    const pa = best.applied[0] ? (promos.find((p) => p.id === best.applied[0].promotionId)?.priority ?? 0) : Infinity;
    const pb = o.applied[0] ? (promos.find((p) => p.id === o.applied[0].promotionId)?.priority ?? 0) : Infinity;
    if (o.total > best.total || (o.total === best.total && o.total > 0 && pb < pa)) best = o;
  }
  const appliedIds = new Set(best.applied.map((a) => a.promotionId));
  for (const f of best.fails) if (f.p.kind === "coupon") rejected.push({ promotionId: f.p.id, code: unlocked.get(f.p.id) ?? null, reason: f.reason });
  for (const p of candidates) {
    if (appliedIds.has(p.id) || best.fails.some((f) => f.p.id === p.id)) continue;
    // it could apply on its own, but lost to a better (or non-combinable) option
    const alone = run([p]);
    if (alone.applied.length) rejected.push({ promotionId: p.id, code: unlocked.get(p.id) ?? null, reason: "not_stackable" });
    else if (p.kind === "coupon") rejected.push({ promotionId: p.id, code: unlocked.get(p.id) ?? null, reason: alone.fails[0]?.reason ?? "no_items" });
  }

  return {
    applied: best.applied,
    rejected,
    lineDiscounts: best.used,
    discount: best.applied.reduce((a, x) => a + x.discount, 0),
    deliveryDiscount: best.delivery,
    base,
    hints: hints.filter((h) => h.missing > 0),
  };
}

export const REJECT_LABEL: Record<RejectReason, Localized> = {
  inactive: { ar: "العرض متوقف", en: "This offer is paused" },
  not_started: { ar: "العرض لسه مابدأش", en: "This offer hasn't started yet" },
  expired: { ar: "العرض انتهى", en: "This offer has expired" },
  wrong_day: { ar: "العرض مش متاح النهارده", en: "Not valid today" },
  wrong_time: { ar: "العرض مش متاح الساعة دي", en: "Not valid at this hour" },
  channel: { ar: "مش متاح هنا", en: "Not valid on this channel" },
  mode: { ar: "مش متاح لنوع الطلب ده", en: "Not valid for this order type" },
  min_spend: { ar: "الطلب أقل من الحد الأدنى", en: "Below the minimum spend" },
  no_items: { ar: "مفيش أصناف في الطلب ينطبق عليها", en: "No items in the order qualify" },
  first_order: { ar: "لأول طلب بس", en: "First order only" },
  needs_customer: { ar: "محتاج رقم موبايل العميل", en: "Needs the customer's phone number" },
  limit_total: { ar: "الكوبون خلص", en: "This code has been fully used" },
  limit_customer: { ar: "استخدمته قبل كده", en: "Already used by this customer" },
  segment: { ar: "العرض لعملاء معيّنين", en: "Only for selected customers" },
  not_stackable: { ar: "مايتجمعش مع عرض تاني", en: "Can't be combined with another offer" },
  unknown_code: { ar: "الكود ده مش موجود", en: "Unknown code" },
  code_used: { ar: "الكود اتستخدم قبل كده", en: "This code was already used" },
  code_owner: { ar: "الكود ده لعميل تاني", en: "This code belongs to another customer" },
  no_delivery: { ar: "للتوصيل بس", en: "Delivery orders only" },
};


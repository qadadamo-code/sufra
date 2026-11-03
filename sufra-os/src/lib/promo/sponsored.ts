/**
 * Sponsored placements sold by Sufra (pure): slot catalogue, booking conflicts (capacity per day), quotes,
 * spend from delivery stats, and the public feed the marketplace reads (`public_sponsored(city, cuisine)`).
 */
import type { Localized } from "@/data/types";
import { roundMinor, type Units } from "@/lib/money";

export type SlotType = "marketplace_top" | "cuisine_top" | "city_top" | "home_banner";
export type PricingModel = "day" | "cpm" | "cpc";

export interface SlotRule {
  type: SlotType;
  name: Localized;
  /** for city_top / cuisine_top: the city/cuisine it covers (null = chosen per booking) */
  city: string | null;
  cuisine: string | null;
  /** concurrent paid placements per day */
  capacity: number;
  pricing: { model: PricingModel; rate: Units };
  active: boolean;
}

export type BookingStatus = "requested" | "pending_payment" | "approved" | "live" | "paused" | "rejected" | "cancelled" | "ended";

export interface BookingRule {
  id: string;
  slotId: string;
  restaurantId: string;
  /** YYYY-MM-DD inclusive */
  startsOn: string;
  endsOn: string;
  status: BookingStatus;
  targeting: { city: string | null; cuisine: string | null };
  pricing: { model: PricingModel; rate: Units };
  budget: Units;
  stats: { impressions: number; clicks: number; orders: number; revenue: Units };
}

/** Statuses that hold a slot (a request or a rejection does not). */
export const HOLDS: BookingStatus[] = ["pending_payment", "approved", "live", "paused"];

const day = (s: string) => Date.parse(`${s}T00:00:00Z`);
export const daysBetween = (a: string, b: string) => Math.round((day(b) - day(a)) / 86_400_000) + 1;
export function eachDay(a: string, b: string): string[] {
  const out: string[] = [];
  for (let t = day(a); t <= day(b); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export class BookingError extends Error {
  constructor(public code: "bad_dates" | "past" | "full" | "inactive" | "budget") {
    super(code);
  }
}

/** Days in [start, end] where the slot is already at capacity (for the same targeting). */
export function conflicts(slot: SlotRule & { id: string }, bookings: BookingRule[], start: string, end: string, targeting: BookingRule["targeting"], ignoreId?: string): string[] {
  const relevant = bookings.filter(
    (b) =>
      b.slotId === slot.id &&
      b.id !== ignoreId &&
      HOLDS.includes(b.status) &&
      (slot.type !== "city_top" || (b.targeting.city ?? slot.city) === (targeting.city ?? slot.city)) &&
      (slot.type !== "cuisine_top" || (b.targeting.cuisine ?? slot.cuisine) === (targeting.cuisine ?? slot.cuisine)),
  );
  return eachDay(start, end).filter((d) => relevant.filter((b) => b.startsOn <= d && d <= b.endsOn).length >= slot.capacity);
}

/** Price of a booking: per-day = days × rate; CPM/CPC = the budget (capped spend). */
export function quote(slot: SlotRule, start: string, end: string, budget: Units): Units {
  if (slot.pricing.model === "day") return slot.pricing.rate * daysBetween(start, end);
  return roundMinor(budget);
}

export function validateBooking(slot: SlotRule & { id: string }, bookings: BookingRule[], input: { startsOn: string; endsOn: string; budget: Units; targeting: BookingRule["targeting"] }, today: string): void {
  if (!slot.active) throw new BookingError("inactive");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endsOn) || input.endsOn < input.startsOn) throw new BookingError("bad_dates");
  if (input.startsOn < today) throw new BookingError("past");
  if (slot.pricing.model !== "day" && input.budget < slot.pricing.rate) throw new BookingError("budget");
  if (conflicts(slot, bookings, input.startsOn, input.endsOn, input.targeting).length) throw new BookingError("full");
}

/** What a booking has cost so far. */
export function spend(b: Pick<BookingRule, "pricing" | "stats" | "startsOn" | "endsOn" | "budget">, today: string): Units {
  const s = b.stats;
  let v = 0;
  if (b.pricing.model === "cpm") v = roundMinor((s.impressions * b.pricing.rate) / 1000);
  else if (b.pricing.model === "cpc") v = s.clicks * b.pricing.rate;
  else {
    const end = today < b.endsOn ? today : b.endsOn;
    v = end < b.startsOn ? 0 : b.pricing.rate * daysBetween(b.startsOn, end);
  }
  return b.pricing.model === "day" ? v : Math.min(v, b.budget);
}

/** Does the placement show today? (approved/live, in its dates, budget not spent). */
export function isServing(b: BookingRule, today: string): boolean {
  if (b.status !== "live" && b.status !== "approved") return false;
  if (today < b.startsOn || today > b.endsOn) return false;
  if (b.pricing.model !== "day" && spend(b, today) >= b.budget) return false;
  return true;
}

export const ctr = (s: { impressions: number; clicks: number }) => (s.impressions ? s.clicks / s.impressions : 0);

const SLOT_ORDER: SlotType[] = ["home_banner", "marketplace_top", "city_top", "cuisine_top"];

export interface PublicSponsored {
  bookingId: string;
  slot: SlotType;
  restaurantId: string;
  slug: string;
  name: Localized;
  brandColor: string;
  headline: Localized;
  imageUrl: string | null;
  city: string | null;
  cuisine: string | null;
  label: Localized;
}

/**
 * The public feed: placements serving today that match the city/cuisine asked for (null = any), ordered by slot
 * (home banner → marketplace top → city → cuisine) and rotated fairly by day so equal bookings take turns.
 */
export function publicFeed<B extends BookingRule & { creative: { headline: Localized; imageUrl: string | null } }>(
  bookings: B[],
  slots: (SlotRule & { id: string })[],
  restaurants: { id: string; slug: string; name: Localized; brandColor: string; active: boolean }[],
  q: { city?: string | null; cuisine?: string | null; today: string },
): PublicSponsored[] {
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase() || null;
  const city = norm(q.city);
  const cuisine = norm(q.cuisine);
  const seed = Number(q.today.replace(/-/g, "")) % 997;
  return bookings
    .filter((b) => isServing(b, q.today))
    .map((b) => ({ b, slot: slots.find((s) => s.id === b.slotId), r: restaurants.find((x) => x.id === b.restaurantId) }))
    .filter((x) => x.slot && x.slot.active && x.r && x.r.active)
    .filter(({ b, slot }) => {
      const bc = norm(b.targeting.city ?? slot!.city);
      const bq = norm(b.targeting.cuisine ?? slot!.cuisine);
      if (slot!.type === "city_top") return !!city && bc === city;
      if (slot!.type === "cuisine_top") return !!cuisine && bq === cuisine;
      return (!city || !bc || bc === city) && (!cuisine || !bq || bq === cuisine);
    })
    .sort((x, y) => SLOT_ORDER.indexOf(x.slot!.type) - SLOT_ORDER.indexOf(y.slot!.type) || rot(x.b.id, seed) - rot(y.b.id, seed))
    .map(({ b, slot, r }) => ({
      bookingId: b.id,
      slot: slot!.type,
      restaurantId: r!.id,
      slug: r!.slug,
      name: r!.name,
      brandColor: r!.brandColor,
      headline: b.creative.headline,
      imageUrl: b.creative.imageUrl,
      city: b.targeting.city ?? slot!.city,
      cuisine: b.targeting.cuisine ?? slot!.cuisine,
      label: { ar: "مُموَّل", en: "Sponsored" },
    }));
}

function rot(id: string, seed: number) {
  let h = seed;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100_003;
  return h;
}

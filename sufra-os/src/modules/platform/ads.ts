/**
 * Sponsored placements — data operations shared by the restaurant's "Buy an ad" flow and the Sufra platform console.
 *
 *   restaurant:  availability → quote → request (pay online via the payments API, or invoice) → Sufra approves → live
 *   platform:    approve / reject / pause / end · record delivery (impressions, clicks, orders) · public feed
 *
 * Availability looks across every restaurant's bookings, which a restaurant cannot read (RLS): in the cloud it is the
 * SECURITY DEFINER function ad_slot_availability(); locally the in-browser rows are read unscoped.
 */
import type { Repo } from "@/data/repo";
import type { Db } from "@/data/hooks";
import type { AdBooking, AdSlot } from "@/data/types";
import type { Units } from "@/lib/money";
import { nowIso } from "@/lib/time";
import { conflicts, quote, validateBooking, type BookingStatus } from "@/lib/promo";
import { demoProvider } from "@/modules/guest/pay";
import { createPaymentIntent } from "@/modules/payments/api";

type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> };
const rpcOf = (repo: Repo) => (repo as unknown as { client?: Rpc }).client ?? null;

export const today = () => new Date().toISOString().slice(0, 10);

export async function slotAvailability(repo: Repo, slot: AdSlot, start: string, end: string, targeting: AdBooking["targeting"]): Promise<string[]> {
  if (repo.kind !== "local") {
    const c = rpcOf(repo);
    if (!c) return [];
    const { data, error } = await c.rpc("ad_slot_availability", { p_slot_id: slot.id, p_start: start, p_end: end, p_city: targeting.city, p_cuisine: targeting.cuisine });
    if (error) throw new Error(error.message);
    return (data as string[]) ?? [];
  }
  const all = await repo.list("adBookings", { where: { slotId: slot.id } });
  return conflicts(slot, all, start, end, targeting);
}

export interface BookingInput {
  slot: AdSlot;
  startsOn: string;
  endsOn: string;
  targeting: AdBooking["targeting"];
  budget: Units;
  creative: AdBooking["creative"];
  payment: "online" | "invoice";
}

/** Restaurant side: validates, prices, (optionally) pays, and files the request for Sufra's review. */
export async function requestBooking(db: Db, x: BookingInput, opts: { slug: string; lang: "ar" | "en" }): Promise<AdBooking> {
  const others = db.repo.kind === "local" ? await db.repo.list("adBookings", { where: { slotId: x.slot.id } }) : [];
  validateBooking(x.slot, others, { startsOn: x.startsOn, endsOn: x.endsOn, budget: x.budget, targeting: x.targeting }, today());
  if (db.repo.kind !== "local") {
    const taken = await slotAvailability(db.repo, x.slot, x.startsOn, x.endsOn, x.targeting);
    if (taken.length) throw new Error("full");
  }
  const price = quote(x.slot, x.startsOn, x.endsOn, x.budget);
  let payment: AdBooking["payment"] = { method: x.payment, reference: null, paidAt: null, invoiceNo: null };
  if (x.payment === "online") {
    // through the payments intent API (DemoProvider locally — the restaurant pays Sufra; cloud: hosted checkout, the
    // verified webhook marks the booking paid)
    const pi = await createPaymentIntent(db.repo, {
      restaurantId: db.restaurantId, restaurantSlug: opts.slug, kind: "link", amount: price, currency: "EGP", note: `Sufra ad · ${x.slot.type} · ${x.startsOn}→${x.endsOn}`,
      purposeRef: null, createdBy: db.actorId, lang: opts.lang, returnUrl: `${typeof window !== "undefined" ? window.location.origin : ""}/app/marketing/ads?pi={pi}`,
    });
    if (db.repo.kind === "local") {
      const done = await demoProvider.complete(pi.id, "succeeded");
      payment = { method: "online", reference: done?.reference ?? pi.id, paidAt: nowIso(), invoiceNo: null };
    } else payment = { method: "online", reference: pi.id, paidAt: null, invoiceNo: null };
  } else payment.invoiceNo = `SUF-AD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 8999)}`;
  const b = await db.insert("adBookings", {
    slotId: x.slot.id, startsOn: x.startsOn, endsOn: x.endsOn, status: "requested", targeting: x.targeting, pricing: x.slot.pricing, budget: x.budget, price, creative: x.creative, payment,
    stats: { impressions: 0, clicks: 0, orders: 0, revenue: 0 }, daily: {}, requestedBy: db.actorId, reviewedBy: null, reviewNote: "",
  });
  await db.audit("ads.request", "adBookings", b.id, { slot: x.slot.type, price, payment: x.payment });
  return b;
}

/** Platform side: move a booking along. Approving a request whose dates have started makes it live. */
export async function reviewBooking(repo: Repo, b: AdBooking, next: BookingStatus, reviewerId: string | null, note = ""): Promise<AdBooking> {
  if (next === "approved" || next === "live") {
    const slot = await repo.get("adSlots", b.slotId);
    if (slot) {
      const all = await repo.list("adBookings", { where: { slotId: b.slotId } });
      const taken = conflicts(slot, all, b.startsOn, b.endsOn, b.targeting, b.id);
      if (taken.length) throw new Error("full");
    }
  }
  const status: BookingStatus = next === "approved" && b.startsOn <= today() ? "live" : next;
  return repo.update("adBookings", b.id, { status, reviewedBy: reviewerId, reviewNote: note, ...(next === "approved" && b.payment.method === "invoice" && !b.payment.invoiceNo ? { payment: { ...b.payment, invoiceNo: `SUF-AD-${Date.now().toString(36).toUpperCase()}` } } : {}) });
}

/** Record delivery (the public feed calls public_sponsored_track in the cloud). */
export async function trackAd(repo: Repo, bookingId: string, event: "impression" | "click" | "order", revenue: Units = 0) {
  const b = await repo.get("adBookings", bookingId);
  if (!b) return;
  const d = today();
  const day = b.daily[d] ?? { impressions: 0, clicks: 0, orders: 0 };
  const key = event === "impression" ? "impressions" : event === "click" ? "clicks" : "orders";
  await repo.update("adBookings", b.id, {
    stats: { ...b.stats, [key]: b.stats[key] + 1, revenue: b.stats.revenue + revenue },
    daily: { ...b.daily, [d]: { ...day, [key]: day[key] + 1 } },
  });
}

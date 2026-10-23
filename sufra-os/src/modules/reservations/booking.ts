/**
 * Public booking ("reservations from home") — no login.
 *
 *  - Local mode: the browser *is* the server (LocalAdapter), so availability is computed here with the
 *    ported floor engine (bookingSlots → suggestTables) over the restaurant's real tables and bookings.
 *  - Supabase: anon visitors cannot read tables or reservations (RLS); they call the SECURITY DEFINER
 *    RPCs guest_booking_info / guest_booking_slots / guest_book from supabase/migrations/0003_floor.sql.
 *
 * Either way the visitor never sees other guests' bookings or table ids — only which times are open.
 * Bookings arrive as `pending` + source "online" and staff confirm them on /reservations.
 */
import type { Repo } from "@/data/repo";
import type { Localized, ReservationTag } from "@/data/types";
import { bookingSlots, parseHours, type SlotReason } from "@/modules/floor/core/availability";
import { defaultDuration } from "@/modules/floor/core/reservations";
import { coreChecks, coreReservation, layoutOf, toMin } from "@/modules/floor/model";

export const ONLINE_MAX_PARTY = 8;
/** pacing: covers that may arrive in one 15-minute slot from all channels */
export const MAX_COVERS_PER_SLOT = 30;
export const BOOKING_DAYS = 30;

export interface BookingInfo {
  restaurant: { id: string; slug: string; name: Localized; brandColor: string; phone: string | null };
  branch: { id: string; name: Localized; address: Localized; hours: { open: string; close: string } };
  maxParty: number;
  days: number;
}

export interface PublicSlot {
  startsAt: string;
  ok: boolean;
  reason?: SlotReason;
}

export interface BookInput {
  startsAt: string;
  party: number;
  name: string;
  phone: string;
  note?: string;
  tags?: ReservationTag[];
}

export interface GuestBookingApi {
  info(slug: string): Promise<BookingInfo | null>;
  slots(slug: string, date: string, party: number): Promise<PublicSlot[]>;
  book(slug: string, input: BookInput): Promise<{ id: string }>;
}

export const normalizePhone = (p: string) => p.replace(/[\s\-()]/g, "").replace(/^\+?20(?=1)/, "0").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
export const validPhone = (p: string) => /^(01[0125]\d{8}|\+?\d{8,15})$/.test(normalizePhone(p));

/** local midnight of a YYYY-MM-DD date, in epoch minutes */
export function dayStartMin(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(new Date(y, m - 1, d, 0, 0, 0, 0).getTime() / 60000);
}
export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

export function guestBooking(repo: Repo): GuestBookingApi {
  if (repo.kind === "supabase") {
    const client = (repo as unknown as { client: RpcClient }).client;
    const call = async <T,>(fn: string, args: Record<string, unknown>) => {
      const { data, error } = await client.rpc(fn, args);
      if (error) throw new Error(error.message);
      return data as T;
    };
    return {
      info: (slug) => call<BookingInfo | null>("guest_booking_info", { p_slug: slug }),
      slots: (slug, date, party) => call<PublicSlot[]>("guest_booking_slots", { p_slug: slug, p_date: date, p_party: party }),
      book: (slug, i) => call<{ id: string }>("guest_book", { p_slug: slug, p_starts_at: i.startsAt, p_party: i.party, p_name: i.name, p_phone: normalizePhone(i.phone), p_note: i.note ?? "", p_tags: i.tags ?? [] }),
    };
  }
  return localBooking(repo);
}

function localBooking(repo: Repo): GuestBookingApi {
  const ctx = async (slug: string) => {
    await repo.ready();
    const [r] = await repo.list("restaurants", { where: { slug, active: true } });
    if (!r) return null;
    const [branch] = await repo.list("branches", { where: { restaurantId: r.id, isDefault: true } });
    if (!branch) return null;
    return { r, branch };
  };

  const compute = async (slug: string, date: string, party: number) => {
    const c = await ctx(slug);
    if (!c) throw new Error("not_found");
    const rid = c.r.id;
    const [zones, tables, decor, reservations, checks] = await Promise.all([
      repo.list("zones", { where: { restaurantId: rid, branchId: c.branch.id } }),
      repo.list("tables", { where: { restaurantId: rid, branchId: c.branch.id, active: true } }),
      repo.list("floorDecor", { where: { restaurantId: rid } }),
      repo.list("reservations", { where: { restaurantId: rid, branchId: c.branch.id, status: ["pending", "confirmed", "seated"] } }),
      repo.list("checks", { where: { restaurantId: rid, branchId: c.branch.id, status: ["open", "bill_requested"] } }),
    ]);
    const layout = layoutOf(zones, tables.filter((t) => t.status !== "blocked"), decor);
    const dayStart = dayStartMin(date);
    const slots = bookingSlots(
      { dayStart, party, hours: parseHours(c.branch.openingHours), now: Date.now() / 60000, leadMinutes: 60, maxCoversPerSlot: MAX_COVERS_PER_SLOT, maxParty: ONLINE_MAX_PARTY },
      layout,
      reservations.map(coreReservation),
      coreChecks(checks, [], []),
    );
    return { c, slots };
  };

  return {
    info: async (slug) => {
      const c = await ctx(slug);
      if (!c) return null;
      return {
        restaurant: { id: c.r.id, slug: c.r.slug, name: c.r.name, brandColor: c.r.brandColor, phone: c.r.phone },
        branch: { id: c.branch.id, name: c.branch.name, address: c.branch.address, hours: c.branch.openingHours ?? { open: "12:00", close: "00:00" } },
        maxParty: ONLINE_MAX_PARTY,
        days: BOOKING_DAYS,
      };
    },
    slots: async (slug, date, party) => {
      const { slots } = await compute(slug, date, party);
      return slots.map((s) => ({ startsAt: new Date(s.start * 60000).toISOString(), ok: s.ok, ...(s.reason ? { reason: s.reason } : {}) }));
    },
    book: async (slug, i) => {
      const name = i.name.trim().slice(0, 80);
      const phone = normalizePhone(i.phone);
      if (!name) throw new Error("name_required");
      if (!validPhone(phone)) throw new Error("bad_phone");
      if (!Number.isInteger(i.party) || i.party < 1 || i.party > ONLINE_MAX_PARTY) throw new Error("bad_party");
      const start = new Date(i.startsAt);
      const date = isoDate(start);
      const { c, slots } = await compute(slug, date, i.party);
      const slot = slots.find((s) => s.start === toMin(i.startsAt));
      if (!slot || !slot.ok) throw new Error("taken");
      const rid = c.r.id;
      // at most 3 pending online requests per phone per day (spam guard)
      const mine = await repo.list("reservations", { where: { restaurantId: rid, phone, status: "pending", source: "online" } });
      if (mine.filter((r) => isoDate(new Date(r.startsAt)) === date).length >= 3) throw new Error("too_many");
      const [customer] = await repo.list("customers", { where: { restaurantId: rid, phone } });
      const row = await repo.insert("reservations", {
        restaurantId: rid, branchId: c.branch.id, customerId: customer?.id ?? null, name, phone, party: i.party, startsAt: start.toISOString(), durationMin: defaultDuration(i.party),
        tableIds: slot.tableIds, status: "pending", note: (i.note ?? "").slice(0, 300), tags: (i.tags ?? []).filter((t) => ["birthday", "vip", "kids", "smoking", "quiet"].includes(t)), source: "online",
        deposit: 0, depositPaid: false,
      });
      return { id: row.id };
    },
  };
}

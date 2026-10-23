import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "@/data/local/LocalAdapter";
import { DEMO_SLUG } from "@/data/seed";
import { guestBooking, isoDate, normalizePhone, validPhone } from "./booking";

let n = 0;
const open: LocalAdapter[] = [];
afterEach(() => {
  while (open.length) open.pop()!.close();
});
async function setup() {
  const a = new LocalAdapter({ name: `booking-${++n}`, sessionKey: `booking-${n}.session` });
  open.push(a);
  await a.ready();
  return a;
}
const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return isoDate(d);
};

describe("public booking (local mode)", () => {
  it("describes the restaurant without leaking bookings", async () => {
    const api = guestBooking(await setup());
    const info = await api.info(DEMO_SLUG);
    expect(info?.branch.hours).toEqual({ open: "12:00", close: "01:00" });
    expect(JSON.stringify(info)).not.toContain("01005551201");
    expect(await api.info("nope")).toBeNull();
  });

  it("offers 15-minute slots from opening until an hour before closing", async () => {
    const api = guestBooking(await setup());
    const slots = await api.slots(DEMO_SLUG, tomorrow(), 2);
    expect(slots.length).toBe((25 * 60 - 60 - 12 * 60) / 15 + 1); // 12:00 … 00:00
    expect(slots.filter((s) => s.ok).length).toBeGreaterThan(30);
    expect(new Date(slots[0].startsAt).getHours()).toBe(12);
    const big = await api.slots(DEMO_SLUG, tomorrow(), 14);
    expect(big.every((s) => s.reason === "too_big")).toBe(true);
  });

  it("books a pending online reservation with a suggested table, and refuses a slot that is no longer free", async () => {
    const repo = await setup();
    const api = guestBooking(repo);
    const slots = await api.slots(DEMO_SLUG, tomorrow(), 6);
    const pick = slots.find((s) => s.ok)!;
    const { id } = await api.book(DEMO_SLUG, { startsAt: pick.startsAt, party: 6, name: "سلمى", phone: "+20 100 555 1234", note: "عيد ميلاد" });
    const row = await repo.get("reservations", id);
    expect(row?.status).toBe("pending");
    expect(row?.source).toBe("online");
    expect(row?.phone).toBe("01005551234");
    expect(row?.tableIds.length).toBeGreaterThan(0);
    // keep booking the same time until every table that fits 6 is gone → refused
    let err = "";
    for (let i = 0; i < 25 && !err; i++) await api.book(DEMO_SLUG, { startsAt: pick.startsAt, party: 6, name: "x", phone: `0100555${1000 + i}`, note: "" }).catch((e: Error) => (err = e.message));
    expect(err).toBe("taken");
  });

  it("validates input", async () => {
    const api = guestBooking(await setup());
    const slot = (await api.slots(DEMO_SLUG, tomorrow(), 2)).find((s) => s.ok)!;
    await expect(api.book(DEMO_SLUG, { startsAt: slot.startsAt, party: 2, name: "", phone: "01005551234" })).rejects.toThrow("name_required");
    await expect(api.book(DEMO_SLUG, { startsAt: slot.startsAt, party: 2, name: "a", phone: "123" })).rejects.toThrow("bad_phone");
    expect(normalizePhone("٠١٠٠٥٥٥١٢٣٤")).toBe("01005551234");
    expect(validPhone("01005551234")).toBe(true);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "@/data/local/LocalAdapter";
import { makeDb } from "@/data/hooks";
import { DEMO_BRANCH_ID, DEMO_RESTAURANT_ID, DEMO_SLUG, staffId } from "@/data/seed";
import type { DeliveryZoneRow, DispatchStage, Order } from "@/data/types";
import { major } from "@/lib/money";
import { GuestService } from "@/modules/guest/api/service";
import { openShift } from "@/modules/pos/sale";
import { batchGroups, lateness, suggestDrivers, type DriverState } from "./assign";
import { etaMinutes, haversineKm, inGeometry, pointInPolygon, travelMinutes, withinHours, zoneFee, zoneFor } from "./geo";
import { registerStageSender, stageVars, type StageMessage } from "./notify";
import { deliveryReport } from "./report";
import { autoAccepts, DEFAULT_DELIVERY, newDispatch } from "./settings";
import { settleShift, settlementDiff, shiftCash } from "./settle";
import { acceptOrder, arrive, assignDriver, canTransition, checkTransition, deliver, failDelivery, markReady, pickUp, proofOk, rejectOrder, StageError, TRANSITIONS, unassignDriver } from "./stages";
import { intakeDispatch } from "./intake";
import { shouldSend, startShift } from "./driverOps";
import { DEMO_DOORS, DEMO_ZONE_DEFS } from "./seed";

const P = (lat: number, lng: number) => ({ lat, lng });
const KITCHEN = P(30.0626, 31.2179);

/* ───────── geometry, zones, fees, ETA ───────── */

describe("geo", () => {
  it("haversine: Zamalek → Dokki is ~3 km, and symmetric", () => {
    const d = haversineKm(KITCHEN, DEMO_DOORS.mesaha);
    expect(d).toBeGreaterThan(2.5);
    expect(d).toBeLessThan(3.2);
    expect(haversineKm(DEMO_DOORS.mesaha, KITCHEN)).toBeCloseTo(d, 9);
    expect(haversineKm(KITCHEN, KITCHEN)).toBe(0);
  });

  it("ETA = ride (road factor, speed) + hand-over + kitchen time left + stops before", () => {
    const ride = travelMinutes(KITCHEN, DEMO_DOORS.mesaha, 22);
    // 2.8 km × 1.35 ≈ 3.8 km @ 22 km/h ≈ 10.3 → 11 min + 3 hand-over
    expect(ride).toBeGreaterThanOrEqual(13);
    expect(ride).toBeLessThanOrEqual(15);
    expect(travelMinutes(KITCHEN, DEMO_DOORS.mesaha, 44)).toBeLessThan(ride);
    expect(etaMinutes({ from: KITCHEN, to: DEMO_DOORS.mesaha, speedKmh: 22, prepLeftMin: 10 })).toBe(ride + 10);
    expect(etaMinutes({ from: KITCHEN, to: DEMO_DOORS.mesaha, speedKmh: 22, stopsBefore: 2 })).toBe(ride + 10);
  });

  it("point in polygon (convex + concave) and in a radius ring", () => {
    const sq = [P(0, 0), P(0, 10), P(10, 10), P(10, 0)];
    expect(pointInPolygon(P(5, 5), sq)).toBe(true);
    expect(pointInPolygon(P(11, 5), sq)).toBe(false);
    // a "C" shape: the notch is outside
    const c = [P(0, 0), P(0, 10), P(10, 10), P(10, 7), P(3, 7), P(3, 3), P(10, 3), P(10, 0)];
    expect(pointInPolygon(P(1, 5), c)).toBe(true);
    expect(pointInPolygon(P(6, 5), c)).toBe(false);
    expect(pointInPolygon(P(6, 1), c)).toBe(true);
    expect(pointInPolygon(P(1, 1), [P(0, 0), P(1, 1)])).toBe(false);
    const ring = { kind: "ring" as const, center: KITCHEN, radiusKm: 1 };
    expect(inGeometry(P(30.0626, 31.2240), ring)).toBe(true); // ~0.6 km east
    expect(inGeometry(P(30.0626, 31.2320), ring)).toBe(false); // ~1.4 km
    expect(inGeometry(KITCHEN, null)).toBe(false);
  });

  it("the seeded doors fall in their zones; inner zones win; closed hours skip a zone", () => {
    const zones = DEMO_ZONE_DEFS.map((z, i) => ({ ...z, id: String(i) })) as unknown as DeliveryZoneRow[];
    expect(zoneFor(DEMO_DOORS.abuElFeda, zones)?.slug).toBe("zamalek");
    expect(zoneFor(DEMO_DOORS.mesaha, zones)?.slug).toBe("dokki");
    expect(zoneFor(DEMO_DOORS.shehab, zones)?.slug).toBe("mohandessin");
    expect(zoneFor(KITCHEN, zones)?.slug).toBe("zamalek");
    expect(zoneFor(P(30.2, 31.5), zones)).toBeNull();
    const wide = { ...zones[0], slug: "wide", sort: 99, geometry: { kind: "ring" as const, center: KITCHEN, radiusKm: 20 } };
    expect(zoneFor(DEMO_DOORS.mesaha, [wide, ...zones])?.slug).toBe("dokki");
    const lunchOnly = { ...zones[5], hours: { open: "12:00", close: "16:00" } };
    expect(zoneFor(DEMO_DOORS.mesaha, [lunchOnly, wide], 13 * 60)?.slug).toBe("dokki");
    expect(zoneFor(DEMO_DOORS.mesaha, [lunchOnly, wide], 20 * 60)?.slug).toBe("wide");
    expect(withinHours({ open: "12:00", close: "01:00" }, 30)).toBe(true); // past midnight
    expect(withinHours({ open: "12:00", close: "01:00" }, 3 * 60)).toBe(false);
  });

  it("fee is free at/above the threshold", () => {
    const z = { fee: major(25), freeOver: major(600) };
    expect(zoneFee(z, major(599.99))).toBe(major(25));
    expect(zoneFee(z, major(600))).toBe(0);
    expect(zoneFee({ fee: major(25), freeOver: null }, major(5000))).toBe(major(25));
  });
});

/* ───────── assignment, batching, lateness ───────── */

describe("dispatch suggestions", () => {
  const params = { origin: KITCHEN, speedKmh: 22, batchRadiusKm: 1.2, maxBatch: 3 };
  const now = Date.parse("2026-11-03T19:00:00Z");
  const fresh = new Date(now - 60_000).toISOString();
  const d = (id: string, loc: { lat: number; lng: number } | null, load: DriverState["load"] = [], onShift = true): DriverState => ({ id, name: id, onShift, location: loc, locationAt: loc ? fresh : null, load });

  it("prefers the idle rider closest to the kitchen; off-shift riders never show", () => {
    const s = suggestDrivers({ id: "o1", to: DEMO_DOORS.shehab, prepLeftMin: 0 }, [d("far", DEMO_DOORS.mesaha), d("near", P(30.0628, 31.2183)), d("off", KITCHEN, [], false)], params, now);
    expect(s.map((x) => x.driverId)).toEqual(["near", "far"]);
    expect(s[0].reason).toBe("idle");
    expect(s[0].atKitchenMin).toBe(0);
    expect(s[1].atKitchenMin).toBeGreaterThan(5);
    expect(s[0].etaMin).toBe(travelMinutes(KITCHEN, DEMO_DOORS.shehab, 22));
  });

  it("batches with a rider already holding an order to a nearby door", () => {
    const holding = d("holding", KITCHEN, [{ orderId: "o0", state: "assigned", to: DEMO_DOORS.lebanon }]);
    const idle = d("idle", P(30.0628, 31.2183));
    const s = suggestDrivers({ id: "o1", to: DEMO_DOORS.shehab, prepLeftMin: 0 }, [idle, holding], params, now);
    expect(s[0].driverId).toBe("holding");
    expect(s[0].reason).toBe("batch");
    expect(s[0].batchWith).toEqual(["o0"]);
    // the same rider holding an order to Dokki is not a batch for Mohandessin
    const other = d("other", KITCHEN, [{ orderId: "o9", state: "assigned", to: DEMO_DOORS.mesaha }]);
    const s2 = suggestDrivers({ id: "o1", to: DEMO_DOORS.shehab, prepLeftMin: 0 }, [other, idle], params, now);
    expect(s2[0].driverId).toBe("idle");
    expect(s2.find((x) => x.driverId === "other")?.reason).toBe("full");
  });

  it("a rider on the road must finish the drop and ride back; kitchen time left delays everyone", () => {
    const out = d("out", DEMO_DOORS.july26, [{ orderId: "o5", state: "out", to: DEMO_DOORS.mesaha }]);
    const s = suggestDrivers({ id: "o1", to: DEMO_DOORS.abuElFeda, prepLeftMin: 0 }, [out], params, now);
    expect(s[0].reason).toBe("returning");
    expect(s[0].atKitchenMin).toBeGreaterThan(travelMinutes(DEMO_DOORS.july26, DEMO_DOORS.mesaha, 22));
    const slow = suggestDrivers({ id: "o1", to: DEMO_DOORS.abuElFeda, prepLeftMin: 25 }, [d("idle", KITCHEN)], params, now);
    expect(slow[0].etaMin).toBe(25 + travelMinutes(KITCHEN, DEMO_DOORS.abuElFeda, 22));
  });

  it("groups unassigned nearby orders ready around the same time, never more than max", () => {
    const t = now;
    const g = batchGroups(
      [
        { id: "a", to: DEMO_DOORS.shehab, readyBy: t },
        { id: "b", to: DEMO_DOORS.lebanon, readyBy: t + 3 * 60_000 },
        { id: "c", to: DEMO_DOORS.gameatDowal, readyBy: t + 4 * 60_000 },
        { id: "d", to: DEMO_DOORS.mesaha, readyBy: t },
        { id: "e", to: DEMO_DOORS.shehab, readyBy: t + 40 * 60_000 },
      ],
      1.2,
      2,
    );
    expect(g).toEqual([["a", "b"]]);
    expect(batchGroups([{ id: "x", to: null, readyBy: t }], 1.2, 3)).toEqual([]);
  });

  it("lateness: ok → at risk (5 min before the limit) → late", () => {
    const promised = new Date(now).toISOString();
    expect(lateness(null, now + 1e9, now, 10)).toBe("ok");
    expect(lateness(promised, now + 2 * 60_000, now, 10)).toBe("ok");
    expect(lateness(promised, now + 7 * 60_000, now, 10)).toBe("risk");
    expect(lateness(promised, now + 11 * 60_000, now, 10)).toBe("late");
    expect(lateness(promised, null, now + 11 * 60_000, 10)).toBe("late");
  });
});

/* ───────── cash ───────── */

describe("rider cash", () => {
  const o = (stage: "delivered" | "picked_up", collected: { method: "cash" | "card" | "prepaid"; amount: number } | null) =>
    ({ number: 1, mode: "delivery", source: "phone", status: "ready", deliveryStatus: null, driverId: "r", openedAt: "2026-11-03T18:00:00Z", dispatch: newDispatch("phone", "2026-11-03T18:00:00Z", { stage, collected }) }) as unknown as Order;

  it("expected = cash collected on delivered orders only", () => {
    const c = shiftCash([o("delivered", { method: "cash", amount: major(320.5) }), o("delivered", { method: "cash", amount: major(99.5) }), o("delivered", { method: "card", amount: major(200) }), o("delivered", { method: "prepaid", amount: 0 }), o("picked_up", { method: "cash", amount: major(1000) })]);
    expect(c).toEqual({ orders: 4, cash: major(420), card: major(200), prepaid: 1, expected: major(420) });
  });

  it("short / over / exact, to the piastre", () => {
    expect(settlementDiff(major(420), major(420))).toEqual({ difference: 0, state: "exact" });
    expect(settlementDiff(major(420), major(400))).toEqual({ difference: -major(20), state: "short" });
    expect(settlementDiff(major(420), major("420.5"))).toEqual({ difference: major("0.5"), state: "over" });
    expect(settlementDiff(major(420), major(420) + 400).state).toBe("exact"); // sub-piastre noise rounds away
  });
});

/* ───────── stage machine ───────── */

describe("stage machine", () => {
  const base = { mode: "delivery" as const, driverId: null, status: "sent" as const, deliveryStatus: "pending" as const, source: "online" as const, openedAt: "2026-11-03T18:00:00Z" };
  const at = (stage: DispatchStage, extra: Partial<Order> = {}) => ({ ...base, ...extra, dispatch: newDispatch("online_delivery", base.openedAt, { stage }) }) as unknown as Order;

  it("allows the happy path and blocks illegal jumps", () => {
    expect(canTransition(at("received"), "accepted")).toBe(true);
    expect(canTransition(at("received"), "picked_up")).toBe(false);
    expect(canTransition(at("received"), "delivered")).toBe(false);
    expect(canTransition(at("accepted"), "assigned")).toBe(true);
    expect(canTransition(at("assigned"), "picked_up")).toBe(true);
    expect(canTransition(at("picked_up"), "arrived")).toBe(true);
    expect(canTransition(at("arrived"), "delivered")).toBe(true);
    expect(canTransition(at("delivered"), "accepted")).toBe(false);
    expect(canTransition(at("rejected"), "accepted")).toBe(false);
    expect(canTransition(at("picked_up"), "accepted")).toBe(false);
    expect(canTransition(at("failed"), "assigned")).toBe(true);
    for (const t of ["delivered", "rejected", "cancelled"] as const) expect(TRANSITIONS[t]).toEqual([]);
  });

  it("own-rider deliveries can't skip the rider; counter hand-overs (takeaway / aggregator rider) can", () => {
    expect(checkTransition(at("accepted"), "delivered")?.code).toBe("own_rider");
    expect(canTransition(at("accepted", { mode: "takeaway" }), "delivered")).toBe(true);
    expect(canTransition(at("accepted", { mode: "takeaway" }), "assigned")).toBe(false);
    const agg = { ...at("accepted"), dispatch: { ...at("accepted").dispatch!, aggregator: { id: "talabat" as const, ref: "x", commissionBps: 2000, theirRider: true } } };
    expect(canTransition(agg, "delivered")).toBe(true);
  });

  it("proof rules", () => {
    expect(proofOk("none", undefined, "1234")).toBeNull();
    expect(proofOk("otp", { kind: "otp", otp: "1234" }, "1234")).toBeNull();
    expect(proofOk("otp", { kind: "otp", otp: "9999" }, "1234")?.code).toBe("bad_otp");
    expect(proofOk("otp", { kind: "photo", photo: "data:x" }, "1234")?.code).toBe("needs_proof");
    expect(proofOk("photo", { kind: "photo", photo: "data:x" }, "1234")).toBeNull();
    expect(proofOk("either", { kind: "photo", photo: "data:x" }, "1234")).toBeNull();
    expect(proofOk("either", { kind: "none" }, "1234")?.code).toBe("needs_proof");
  });
});

/* ───────── intake & notifications (pure) ───────── */

describe("intake", () => {
  const settings = (p: Partial<typeof DEFAULT_DELIVERY> = {}, requireWaiterConfirm = true) => ({ delivery: { ...DEFAULT_DELIVERY, ...p }, qrOrdering: { enabled: true, requireWaiterConfirm, allowServiceCalls: true } }) as never;

  it("online delivery waits for a decision with a deadline; auto-accept skips the inbox with a promise", () => {
    const now = Date.parse("2026-11-03T19:00:00Z");
    const zone = { id: "dokki", name: { ar: "الدقي", en: "Dokki" }, fee: major(40), minOrder: 0, etaMin: 35, etaMax: 50, geometry: DEMO_ZONE_DEFS[5].geometry };
    const manual = intakeDispatch({ settings: settings(), order: { id: "o1", source: "online", mode: "delivery" }, zone, now });
    expect(manual.autoFire).toBe(false);
    expect(manual.dispatch.stage).toBe("received");
    expect(manual.dispatch.expiresAt).toBe(new Date(now + 8 * 60_000).toISOString());
    expect(manual.dispatch.otp).toMatch(/^\d{4}$/);
    expect(manual.door && zoneFor(manual.door, [{ ...DEMO_ZONE_DEFS[5], id: "z" } as DeliveryZoneRow])?.slug).toBe("dokki");
    const auto = intakeDispatch({ settings: settings({ autoAccept: { ...DEFAULT_DELIVERY.autoAccept, online_delivery: true } }), order: { id: "o1", source: "online", mode: "delivery" }, zone, gps: DEMO_DOORS.mesaha, now });
    expect(auto.autoFire).toBe(true);
    expect(auto.dispatch.stage).toBe("accepted");
    expect(auto.door).toEqual(DEMO_DOORS.mesaha);
    expect(Date.parse(auto.dispatch.promisedAt!)).toBe(now + (20 + travelMinutes(DEFAULT_DELIVERY.origin, DEMO_DOORS.mesaha, 22)) * 60_000);
    expect(intakeDispatch({ settings: settings({ autoRejectMin: 0 }), order: { id: "o1", source: "online", mode: "takeaway" }, now }).dispatch.expiresAt).toBeNull();
  });

  it("QR keeps the waiter-confirm rule; phone/aggregator default to auto", () => {
    expect(autoAccepts("qr", settings({}, true))).toBe(false);
    expect(autoAccepts("qr", settings({}, false))).toBe(true);
    expect(autoAccepts("phone", settings())).toBe(true);
    expect(autoAccepts("online_takeaway", settings())).toBe(false);
  });

  it("stage messages carry rider name/phone, tracking link, reason", () => {
    const order = { id: "oid", number: 42, openedAt: "2026-11-03T18:00:00Z", mode: "delivery", dispatch: newDispatch("phone", "2026-11-03T18:00:00Z", { promisedAt: "2026-11-03T18:45:00Z" }) } as unknown as Order;
    const x = { order, customer: { name: "دينا الشافعي", phone: "01005551201" }, restaurant: { name: { ar: "سفرة", en: "Sufra" }, phone: "0227350000", slug: "sufra-zamalek" }, driver: { name: "إسلام جمال", phone: "01005550111" }, lang: "en" as const, origin: "https://x.test/app/" };
    const out = stageVars("out_for_delivery", x);
    expect(out).toMatchObject({ name: "دينا", number: 42, driver_name: "إسلام", driver_phone: "01005550111", link: "https://x.test/app/r/sufra-zamalek/o/oid" });
    expect(String(out.eta)).toMatch(/\d/);
    expect(stageVars("cancelled", { ...x, reason: "Closed", paid: 0 })).toMatchObject({ reason: "Closed", phone: "0227350000" });
    expect(stageVars("arriving", x)).toEqual({ number: 42, driver_name: "إسلام", driver_phone: "01005550111" });
  });
});

/* ───────── end to end on the local backend ───────── */

let n = 0;
const open: LocalAdapter[] = [];
afterEach(() => {
  while (open.length) open.pop()!.close();
});
async function setup() {
  const repo = new LocalAdapter({ name: `delivery${++n}`, sessionKey: `delivery${n}.s` });
  open.push(repo);
  await repo.ready();
  const cashier = makeDb(repo, DEMO_RESTAURANT_ID, DEMO_BRANCH_ID, staffId("cashier1"));
  const rider = makeDb(repo, DEMO_RESTAURANT_ID, DEMO_BRANCH_ID, staffId("delivery3"));
  const sent: StageMessage[] = [];
  const off = registerStageSender(async (m) => void sent.push(m));
  return { repo, cashier, rider, sent, off, svc: new GuestService(repo) };
}

describe("delivery flow (local backend)", () => {
  it("guest order → inbox → accept → ready → assign → picked up → arrived → delivered (OTP) → settlement", async () => {
    const { repo, cashier, rider, sent, off, svc } = await setup();
    try {
      const menu = (await svc.menu(DEMO_SLUG))!;
      const hummus = menu.items.find((i) => i.name.en === "Hummus")!;
      const venue = (await svc.venue(DEMO_SLUG))!;
      expect(venue.zones.find((z) => z.id === "zamalek")?.geometry?.kind).toBe("polygon"); // from deliveryZones, not the hard-coded list
      const { orderId } = await svc.placeOrder(DEMO_SLUG, { mode: "delivery", lines: [{ itemId: hummus.id, qty: 2, modifierIds: [] }], customer: { name: "Test Guest", phone: "01005559999" }, delivery: { zoneId: "zamalek", address: "12 Brazil St", notes: "", lat: 30.0612, lng: 31.2201 }, payment: "cash" });
      let o = (await repo.get("orders", orderId))!;
      expect(o.dispatch?.stage).toBe("received");
      expect(o.delivery?.lat).toBe(30.0612);

      // illegal: the rider can't pick up an order nobody accepted
      await expect(pickUp(cashier, orderId, null)).rejects.toBeInstanceOf(StageError);

      o = await acceptOrder(cashier, orderId, 15);
      expect(o.dispatch?.stage).toBe("accepted");
      expect(o.status).toBe("sent");
      expect(o.dispatch?.promisedAt).toBeTruthy();
      expect((await repo.list("orderItems", { where: { orderId } })).every((i) => i.status === "sent")).toBe(true);
      expect(sent.map((m) => m.stage)).toEqual(["accepted"]);
      expect(sent[0].dedupeKey).toBe(`${orderId}:accepted`);
      expect(sent[0].to).toBe("01005559999");

      // kitchen finishes
      for (const i of await repo.list("orderItems", { where: { orderId } })) await repo.update("orderItems", i.id, { status: "ready" });
      o = (await markReady(cashier, orderId))!;
      expect(o.dispatch?.readyAt).toBeTruthy();
      expect(await markReady(cashier, orderId)).toBeNull(); // idempotent

      const shift = await startShift(rider, staffId("delivery3"));
      await assignDriver(cashier, orderId, staffId("delivery2"));
      o = await assignDriver(cashier, orderId, staffId("delivery3")); // reassign
      expect(o.driverId).toBe(staffId("delivery3"));
      expect(o.deliveryStatus).toBe("assigned");
      o = await unassignDriver(cashier, orderId);
      expect(o.driverId).toBeNull();
      await assignDriver(cashier, orderId, staffId("delivery3"));

      o = await pickUp(rider, orderId, shift.id);
      expect(o.deliveryStatus).toBe("picked_up");
      expect((await svc.track(DEMO_SLUG, orderId))?.stage).toBe("out_for_delivery");
      const view = (await svc.driverView(DEMO_SLUG, orderId))!;
      expect(view.otp).toBe(o.dispatch?.otp);
      expect(view.driver?.name).toBe("عمر");
      await arrive(rider, orderId);

      const check = (await repo.get("checks", o.checkId!))!;
      await expect(deliver(rider, orderId, { proof: { kind: "otp", otp: "0000" }, collected: { method: "cash", amount: check.total } })).rejects.toThrow(/bad_otp/);
      o = await deliver(rider, orderId, { proof: { kind: "otp", otp: o.dispatch!.otp! }, collected: { method: "cash", amount: check.total } });
      expect(o.deliveryStatus).toBe("delivered");
      expect((await svc.track(DEMO_SLUG, orderId))?.stage).toBe("delivered");
      expect(sent.map((m) => m.stage)).toEqual(["accepted", "out_for_delivery", "arriving", "delivered"]);
      expect(sent[1].vars).toMatchObject({ driver_name: "عمر", driver_phone: "01005550114" });

      // settle: rider hands in 10 EGP less → checks closed on POS1, short posted
      const pos = await openShift(cashier, "POS1", major(500));
      const fresh = (await repo.get("driverShifts", shift.id))!;
      const r = await settleShift(cashier, fresh, check.total - major(10), { shift: pos, device: "POS1" });
      expect(r.errors).toEqual([]);
      expect(r.closed).toBe(1);
      expect(r).toMatchObject({ difference: -major(10), state: "short" });
      expect((await repo.get("checks", check.id))?.status).toBe("paid");
      const moves = await repo.list("cashMovements", { where: { shiftId: pos.id } });
      expect(moves).toEqual([expect.objectContaining({ kind: "out", amount: major(10) })]);
      const ledger = await repo.list("ledgerEntries", { where: { sourceId: moves[0].id } });
      expect(ledger[0].lines.find((l) => l.account === "6901")?.debit).toBe(major(10));
      expect((await repo.get("driverShifts", shift.id))?.status).toBe("settled");
      await expect(settleShift(cashier, (await repo.get("driverShifts", shift.id))!, 0, { shift: pos, device: "POS1" })).rejects.toThrow(/already settled/);
    } finally {
      off();
    }
  });

  it("reject voids the order and tells the customer why; failed deliveries can be re-dispatched", async () => {
    const { repo, cashier, sent, off } = await setup();
    try {
      const [pending] = (await repo.list("orders")).filter((o) => o.dispatch?.stage === "received" && o.mode === "delivery");
      const o = await rejectOrder(cashier, pending.id, "صنف خلص");
      expect(o.status).toBe("void");
      expect(o.dispatch?.stage).toBe("rejected");
      expect((await repo.list("orderItems", { where: { orderId: o.id } })).every((i) => i.status === "void")).toBe(true);
      expect((await repo.get("checks", o.checkId!))?.status).toBe("void");
      expect(sent.at(-1)).toMatchObject({ stage: "cancelled", template: "order_cancelled" });
      expect(sent.at(-1)!.vars.reason).toBe("صنف خلص");
      await expect(acceptOrder(cashier, o.id, 10)).rejects.toBeInstanceOf(StageError);

      const [out] = (await repo.list("orders")).filter((x) => x.dispatch?.stage === "picked_up");
      const failed = await failDelivery(cashier, out.id, "العميل مش بيرد");
      expect(failed.deliveryStatus).toBe("failed");
      expect((await assignDriver(cashier, out.id, staffId("delivery2"))).dispatch?.stage).toBe("assigned");
    } finally {
      off();
    }
  });
});

describe("reports", () => {
  it("counts channels, lateness, riders and aggregator commission from the seed", async () => {
    const repo = new LocalAdapter({ name: `delivery-r${++n}`, memory: true });
    open.push(repo);
    await repo.ready();
    const orders = (await repo.list("orders")).filter((o) => o.mode !== "dine_in");
    const checks = new Map((await repo.list("checks")).map((c) => [c.id, c]));
    const r = deliveryReport(orders, checks, { graceMin: 10, ratings: new Map([[orders.find((o) => o.number && o.dispatch?.stage === "delivered" && o.driverId === staffId("delivery"))!.id, 5]]) });
    expect(r.byChannel.find((c) => c.channel === "aggregator")?.count).toBe(1);
    const tb = r.aggregators.find((a) => a.id === "talabat")!;
    expect(tb.commission).toBe(Math.round((tb.gross * 2200) / 10_000));
    expect(tb.net).toBe(tb.gross - tb.commission);
    expect(r.onTimeBase).toBe(3);
    expect(r.late).toBe(1); // the lunch order by عمر arrived 22 min after the promise
    const islam = r.riders.find((x) => x.driverId === staffId("delivery"))!;
    expect(islam.deliveries).toBe(1);
    expect(islam.cash).toBeGreaterThan(0);
    expect(islam.rating).toBe(5);
    expect(r.avgPrepMin).toBeGreaterThan(0);
  });
});

describe("rider GPS throttle", () => {
  const f = (lat: number, lng: number, at: number, accuracy = 10) => ({ lat, lng, at, accuracy, heading: null, speed: null });
  it("sends the first fix, then only after moving ≥30 m and ≥15 s, or a 60 s heartbeat; ignores poor fixes", () => {
    const a = f(30.06, 31.22, 0);
    expect(shouldSend(null, a)).toBe(true);
    expect(shouldSend(a, f(30.0601, 31.22, 20_000))).toBe(false); // 11 m
    expect(shouldSend(a, f(30.0605, 31.22, 10_000))).toBe(false); // 55 m but too soon
    expect(shouldSend(a, f(30.0605, 31.22, 20_000))).toBe(true);
    expect(shouldSend(a, f(30.0605, 31.22, 20_000, 400))).toBe(false);
    expect(shouldSend(a, f(30.06, 31.22, 61_000))).toBe(true);
  });
});

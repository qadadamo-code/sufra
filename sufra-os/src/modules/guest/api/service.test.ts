import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "@/data/local/LocalAdapter";
import { DEMO_SLUG } from "@/data/seed";
import type { ChangeEvent } from "@/data/repo";
import { major } from "@/lib/money";
import { GuestService, normalizePhone } from "./service";
import { demoProvider } from "../pay/demo";
import { stageOf } from "../stages";

let n = 0;
const open: LocalAdapter[] = [];
const make = (name: string) => {
  const a = new LocalAdapter({ name, sessionKey: `${name}.s` });
  open.push(a);
  return a;
};
afterEach(() => {
  while (open.length) open.pop()!.close();
});
const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));

async function setup() {
  const repo = make(`guest${++n}`);
  await repo.ready();
  const svc = new GuestService(repo);
  const menu = (await svc.menu(DEMO_SLUG, "ZM07"))!;
  const item = (en: string) => menu.items.find((i) => i.name.en === en)!;
  return { repo, svc, menu, item };
}

describe("GuestService (local backend)", () => {
  it("QR order waits for the waiter when the restaurant requires it, and shows on the table bill", async () => {
    const { repo, svc, item } = await setup();
    const tea = item("Tea");
    const { orderId } = await svc.placeOrder(DEMO_SLUG, { tableCode: "ZM07", mode: "dine_in", lines: [{ itemId: tea.id, qty: 2, modifierIds: [] }] });
    const o = (await repo.get("orders", orderId))!;
    expect(o.source).toBe("qr");
    const items = await repo.list("orderItems", { where: { orderId } });
    expect(items.every((i) => i.status === "new")).toBe(true);
    const bill = (await svc.tableBill(DEMO_SLUG, "ZM07"))!;
    expect(bill.lines.some((l) => l.orderId === orderId && l.qty === 2)).toBe(true);
    expect(bill.totals.total).toBeGreaterThan(major(90));
    expect(bill.orders.at(-1)?.stage).toBe("received");
    expect((await svc.track(DEMO_SLUG, orderId))?.stage).toBe("received");
  });

  it("goes straight to the kitchen when waiter confirmation is off", async () => {
    const { repo, svc, item } = await setup();
    const [s] = await repo.list("settings");
    await repo.update("settings", s.id, { qrOrdering: { ...s.qrOrdering, requireWaiterConfirm: false } });
    const { orderId } = await svc.placeOrder(DEMO_SLUG, { tableCode: "ZM07", mode: "dine_in", lines: [{ itemId: item("Hummus").id, qty: 1, modifierIds: [] }] });
    const items = await repo.list("orderItems", { where: { orderId } });
    expect(items.every((i) => i.status === "sent" && i.firedAt)).toBe(true);
    expect((await svc.track(DEMO_SLUG, orderId))?.stage).toBe("preparing");
  });

  it("online delivery order: zone fee in the check, customer saved, kitchen gets it, another tab sees it live", async () => {
    const { repo, svc, item } = await setup();
    const staff = make(`guest${n}`); // same IndexedDB + BroadcastChannel name = a staff tab on the same browser
    await staff.ready();
    const seen: ChangeEvent[] = [];
    staff.subscribe(["orders"], null, (e) => seen.push(e));
    const { orderId, number } = await svc.placeOrder(DEMO_SLUG, {
      mode: "delivery",
      lines: [{ itemId: item("Hummus").id, qty: 2, modifierIds: [] }],
      customer: { name: "Test Guest", phone: "٠١٠٠٥٥٥٩٩٩٩" },
      delivery: { zoneId: "zamalek", address: "12 Brazil St", notes: "3rd floor" },
      payment: "cash",
    });
    expect(number).toBeGreaterThan(0);
    const o = (await repo.get("orders", orderId))!;
    expect(o.source).toBe("online");
    expect(o.deliveryFee).toBe(major(25));
    expect(o.delivery?.address).toBe("12 Brazil St");
    expect(o.deliveryStatus).toBe("pending");
    const check = (await repo.get("checks", o.checkId!))!;
    expect(check.total).toBe(major("245.10")); // (190 + 25) × 1.14
    const [cust] = await repo.list("customers", { where: { phone: "01005559999" } });
    expect(cust.name).toBe("Test Guest");
    expect(o.customerId).toBe(cust.id);
    const t = (await svc.track(DEMO_SLUG, orderId))!;
    expect(t.stage).toBe("accepted");
    expect(t.totals.deliveryFee).toBe(major(25));
    await wait();
    expect(seen.some((e) => e.id === orderId && e.origin === "peer")).toBe(true);
    expect(await staff.get("orders", orderId)).toBeTruthy();
  });

  it("rejects bad input", async () => {
    const { svc, item } = await setup();
    await expect(svc.placeOrder(DEMO_SLUG, { mode: "takeaway", lines: [{ itemId: item("Tea").id, qty: 1, modifierIds: [] }], customer: { name: "x", phone: "123" } })).rejects.toThrow("bad_customer");
    await expect(svc.placeOrder(DEMO_SLUG, { mode: "delivery", lines: [{ itemId: item("Tea").id, qty: 1, modifierIds: [] }], customer: { name: "x", phone: "01001234567" }, delivery: { zoneId: "nowhere", address: "a", notes: "" } })).rejects.toThrow("bad_address");
    await expect(svc.placeOrder(DEMO_SLUG, { tableCode: "ZM07", mode: "dine_in", lines: [] })).rejects.toThrow("empty_order");
  });

  it("records a demo payment once, bumps the check and pings the waiter", async () => {
    const { repo, svc, item } = await setup();
    await svc.placeOrder(DEMO_SLUG, { tableCode: "ZM07", mode: "dine_in", lines: [{ itemId: item("Om Ali").id, qty: 2, modifierIds: [] }] });
    const bill = (await svc.tableBill(DEMO_SLUG, "ZM07"))!;
    const half = Math.round(bill.totals.total / 2000) * 1000;
    const pi = await demoProvider.createIntent({ restaurantSlug: DEMO_SLUG, purpose: "check", checkId: bill.checkId, orderId: null, tableCode: "ZM07", amount: half, tip: major(20), currency: "EGP", splitLabel: "1 of 2", customer: null, returnUrl: "/", lang: "ar" });
    const done = (await demoProvider.complete(pi.id, "succeeded"))!;
    await svc.recordPayment(DEMO_SLUG, done);
    await svc.recordPayment(DEMO_SLUG, done);
    const pays = await repo.list("payments", { where: { checkId: bill.checkId } });
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ method: "online", amount: half, tip: major(20), splitLabel: "1 of 2", reference: pi.id });
    expect((await repo.get("checks", bill.checkId))!.paid).toBe(bill.totals.paid + half);
    const t = (await repo.list("tables", { where: { code: "ZM07" } }))[0];
    const calls = await repo.list("serviceCalls", { where: { tableId: t.id, type: "bill" } });
    expect(calls.some((c) => c.text.includes("أونلاين"))).toBe(true);
    await expect(svc.recordPayment(DEMO_SLUG, { ...done, status: "failed" })).rejects.toThrow("not_paid");
  });

  it("call status is readable by the guest; feedback and loyalty are stored", async () => {
    const { repo, svc } = await setup();
    const { id } = await svc.callWaiter(DEMO_SLUG, "ZM07", "water");
    expect((await svc.callStates(DEMO_SLUG, "ZM07", [id]))[0].status).toBe("open");
    await repo.update("serviceCalls", id, { status: "ack", ackAt: new Date().toISOString() });
    expect((await svc.callStates(DEMO_SLUG, "ZM07", [id]))[0].status).toBe("ack");
    await svc.feedback(DEMO_SLUG, { tableCode: "ZM07", stars: 2, comment: "cold food", tags: ["food"] });
    const fb = await repo.list("auditLog", { where: { action: "guest.feedback" } });
    expect(fb.at(-1)?.data).toMatchObject({ stars: 2, comment: "cold food" });
    const r = await svc.joinLoyalty(DEMO_SLUG, { name: "Mona", phone: "+20 122 555 0000" });
    expect(r.points).toBe(0);
    expect((await repo.list("customers", { where: { phone: "01225550000" } }))[0].name).toBe("Mona");
    await expect(svc.joinLoyalty(DEMO_SLUG, { name: "x", phone: "999" })).rejects.toThrow("bad_phone");
  });
});

describe("helpers", () => {
  it("normalises Egyptian mobiles", () => {
    expect(normalizePhone("01005551201")).toBe("01005551201");
    expect(normalizePhone("+20 100 555 1201")).toBe("01005551201");
    expect(normalizePhone("٠١١٢٣٤٥٦٧٨٩")).toBe("01123456789");
    expect(normalizePhone("0100555120")).toBeNull();
    expect(normalizePhone("01305551201")).toBeNull();
  });

  it("derives the guest-facing stage from item statuses", () => {
    const o = (mode: "dine_in" | "takeaway" | "delivery", qr = false, deliveryStatus: "picked_up" | "delivered" | null = null) => ({ mode, qr, status: "open" as const, deliveryStatus });
    expect(stageOf(o("dine_in", true), [{ status: "new" }])).toBe("received");
    expect(stageOf(o("dine_in", true), [{ status: "sent" }, { status: "new" }])).toBe("preparing");
    expect(stageOf(o("dine_in", true), [{ status: "ready" }, { status: "served" }])).toBe("ready");
    expect(stageOf(o("dine_in", true), [{ status: "served" }, { status: "void" }])).toBe("served");
    expect(stageOf(o("delivery"), [{ status: "sent" }])).toBe("accepted");
    expect(stageOf(o("delivery"), [{ status: "preparing" }, { status: "sent" }])).toBe("preparing");
    expect(stageOf(o("delivery", false, "picked_up"), [{ status: "ready" }])).toBe("out_for_delivery");
    expect(stageOf(o("delivery", false, "delivered"), [{ status: "ready" }])).toBe("delivered");
    expect(stageOf(o("takeaway"), [{ status: "served" }])).toBe("picked_up");
    expect(stageOf({ ...o("takeaway"), status: "void" }, [{ status: "sent" }])).toBe("cancelled");
  });
});

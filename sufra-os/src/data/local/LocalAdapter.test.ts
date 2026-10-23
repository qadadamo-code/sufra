import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "./LocalAdapter";
import { DEMO_PASSWORD, DEMO_RESTAURANT_ID, DEMO_SLUG, staffId } from "../seed";
import type { ChangeEvent } from "../repo";

let n = 0;
const open: LocalAdapter[] = [];
const make = (name: string, opts: Partial<ConstructorParameters<typeof LocalAdapter>[0]> = {}) => {
  const a = new LocalAdapter({ name, sessionKey: `${name}.session`, ...opts });
  open.push(a);
  return a;
};
afterEach(() => {
  while (open.length) open.pop()!.close();
});
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe("LocalAdapter", () => {
  it("seeds the demo restaurant on first run", async () => {
    const a = make(`t${++n}`);
    await a.ready();
    const [r] = await a.list("restaurants", { where: { slug: DEMO_SLUG } });
    expect(r.id).toBe(DEMO_RESTAURANT_ID);
    expect(await a.list("tables", { where: { restaurantId: r.id } })).toHaveLength(18);
    expect((await a.list("menuItems")).length).toBeGreaterThanOrEqual(45);
  });

  it("CRUD with queries", async () => {
    const a = make(`t${++n}`, { seed: false });
    await a.ready();
    const row = await a.insert("serviceCalls", { restaurantId: "r1", branchId: "b1", tableId: "t1", type: "water", text: "", status: "open", source: "qr", ackBy: null, ackAt: null, doneAt: null });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.createdAt).toBeTruthy();
    await a.insert("serviceCalls", { restaurantId: "r1", branchId: "b1", tableId: "t2", type: "bill", text: "", status: "open", source: "qr", ackBy: null, ackAt: null, doneAt: null });
    await a.insert("serviceCalls", { restaurantId: "r2", branchId: "b9", tableId: "t9", type: "tea", text: "", status: "open", source: "qr", ackBy: null, ackAt: null, doneAt: null });
    expect(await a.list("serviceCalls", { where: { restaurantId: "r1" } })).toHaveLength(2);
    expect(await a.list("serviceCalls", { where: { type: ["bill", "tea"] }, orderBy: [{ field: "type" }] }).then((x) => x.map((c) => c.type))).toEqual(["bill", "tea"]);
    const up = await a.update("serviceCalls", row.id, { status: "ack" });
    expect(up.status).toBe("ack");
    expect((await a.get("serviceCalls", row.id))?.status).toBe("ack");
    await a.remove("serviceCalls", row.id);
    expect(await a.get("serviceCalls", row.id)).toBeNull();
    await expect(a.update("serviceCalls", "missing", { status: "done" })).rejects.toThrow();
  });

  it("returns copies (callers cannot mutate the store)", async () => {
    const a = make(`t${++n}`);
    await a.ready();
    const [t] = await a.list("tables", { limit: 1 });
    t.label = "hacked";
    expect((await a.get("tables", t.id))?.label).not.toBe("hacked");
  });

  it("persists to IndexedDB across instances", async () => {
    const name = `t${++n}`;
    const a = make(name, { seed: false });
    await a.ready();
    const row = await a.insert("customers", { restaurantId: "r1", phone: "01005559999", name: "X", email: null, visits: 0, lastVisitAt: null, totalSpent: 0, loyaltyPoints: 0, tags: [], notes: "", birthday: null, addresses: [] });
    a.close();
    const b = make(name, { seed: false });
    await b.ready();
    expect((await b.get("customers", row.id))?.phone).toBe("01005559999");
  });

  it("broadcasts changes to other tabs (BroadcastChannel)", async () => {
    const name = `t${++n}`;
    const cashier = make(name);
    const kitchen = make(name);
    await Promise.all([cashier.ready(), kitchen.ready()]);
    const seen: ChangeEvent[] = [];
    kitchen.subscribe(["orderItems"], DEMO_RESTAURANT_ID, (e) => seen.push(e));
    const [item] = await cashier.list("orderItems", { where: { status: "preparing" }, limit: 1 });
    await cashier.update("orderItems", item.id, { status: "ready" });
    await wait(60);
    expect(seen.some((e) => e.id === item.id && e.origin === "peer" && e.type === "update")).toBe(true);
    expect((await kitchen.get("orderItems", item.id))?.status).toBe("ready");
    // peers notice each other
    expect(kitchen.sync().peers).toBeGreaterThanOrEqual(1);
  });

  it("subscribe filters by collection and restaurant", async () => {
    const a = make(`t${++n}`, { seed: false });
    await a.ready();
    const got: string[] = [];
    a.subscribe(["serviceCalls"], "r1", (e) => got.push(e.id));
    const x = await a.insert("serviceCalls", { restaurantId: "r1", branchId: "b", tableId: "t", type: "water", text: "", status: "open", source: "qr", ackBy: null, ackAt: null, doneAt: null });
    await a.insert("serviceCalls", { restaurantId: "r2", branchId: "b", tableId: "t", type: "water", text: "", status: "open", source: "qr", ackBy: null, ackAt: null, doneAt: null });
    await a.insert("customers", { restaurantId: "r1", phone: "1", name: "Y", email: null, visits: 0, lastVisitAt: null, totalSpent: 0, loyaltyPoints: 0, tags: [], notes: "", birthday: null, addresses: [] });
    expect(got).toEqual([x.id]);
  });

  it("email sign-in and PIN verification", async () => {
    const a = make(`t${++n}`);
    await a.ready();
    await expect(a.auth.signInWithPassword("owner@sufra.demo", "nope")).rejects.toThrow();
    const u = await a.auth.signInWithPassword("OWNER@sufra.demo", DEMO_PASSWORD);
    expect(u.email).toBe("owner@sufra.demo");
    const ms = await a.auth.myMemberships();
    expect(ms[0].membership.role).toBe("owner");
    expect(await a.auth.verifyPin(DEMO_RESTAURANT_ID, staffId("cashier1"), "4000")).toMatchObject({ role: "cashier" });
    expect(await a.auth.verifyPin(DEMO_RESTAURANT_ID, staffId("cashier1"), "1234")).toBeNull();
    expect(await a.auth.verifyPin("other", staffId("cashier1"), "4000")).toBeNull();
    await a.auth.setPin(DEMO_RESTAURANT_ID, staffId("cashier1"), "2468");
    expect(await a.auth.verifyPin(DEMO_RESTAURANT_ID, staffId("cashier1"), "2468")).not.toBeNull();
    const roster = await a.auth.pinRoster(DEMO_RESTAURANT_ID);
    expect(roster.length).toBe(12);
    expect(JSON.stringify(roster)).not.toMatch(/sha256/);
    await a.auth.signOut();
    expect(await a.auth.current()).toBeNull();
  });

  it("guest API: menu, server-priced order, de-duplicated waiter call", async () => {
    const a = make(`t${++n}`);
    await a.ready();
    expect(await a.guest.menu(DEMO_SLUG, "NOPE")).toBeNull();
    const menu = (await a.guest.menu(DEMO_SLUG, "ZM13"))!;
    expect(menu.table?.label).toBe("13");
    const kofta = menu.items.find((i) => i.name.en === "Grilled kofta")!;
    const half = menu.modifiers.find((m) => m.name.en === "½ kg")!;
    const { orderId, number } = await a.guest.placeOrder(DEMO_SLUG, { tableCode: "ZM13", mode: "dine_in", lines: [{ itemId: kofta.id, qty: 2, modifierIds: [half.id] }] });
    expect(number).toBeGreaterThan(0);
    const [order] = await a.list("orders", { where: { id: orderId } });
    expect(order.source).toBe("qr");
    const [line] = await a.list("orderItems", { where: { orderId } });
    expect(line.unitPrice).toBe(kofta.price);
    expect(line.modifiers[0].price).toBe(half.price);
    const [check] = await a.list("checks", { where: { id: order.checkId! } });
    // 2 × (345 + 330) = 1350; +12% service = 162; +14% VAT on 1512 = 211.68 → 1723.68
    expect(check.total).toBe(172_368_000);
    const sold = menu.items.find((i) => !i.available)!;
    await expect(a.guest.placeOrder(DEMO_SLUG, { tableCode: "ZM13", mode: "dine_in", lines: [{ itemId: sold.id, qty: 1, modifierIds: [] }] })).rejects.toThrow("item_unavailable");
    const c1 = await a.guest.callWaiter(DEMO_SLUG, "ZM13", "water");
    const c2 = await a.guest.callWaiter(DEMO_SLUG, "ZM13", "water");
    expect(c2.id).toBe(c1.id);
    expect((await a.guest.orderStatus(DEMO_SLUG, orderId))?.items[0].status).toBe("new");
  });

  it("reset restores the seed", async () => {
    const a = make(`t${++n}`);
    await a.ready();
    const [t] = await a.list("tables", { limit: 1 });
    await a.remove("tables", t.id);
    await a.reset();
    expect(await a.list("tables")).toHaveLength(18);
  });
});

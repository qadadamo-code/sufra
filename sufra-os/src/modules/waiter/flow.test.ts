/** End-to-end on the in-browser adapter: waiter sends a round → KDS ticket → bump / recall / serve → waiter + calls. */
import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "@/data/local/LocalAdapter";
import { makeDb } from "@/data/hooks";
import { DEMO_BRANCH_ID, DEMO_RESTAURANT_ID, DEMO_SLUG, staffId } from "@/data/seed";
import { buildTickets } from "@/modules/kitchen/kds";
import { applyAction, setAvailability } from "@/modules/kitchen/ops";
import { ackCall, callStats, createServiceCall, doneCall, pingWaiter } from "@/lib/service-calls";
import { requestBill, sendRound, type CartLine } from "./orderOps";

let n = 0;
const open: LocalAdapter[] = [];
afterEach(() => {
  while (open.length) open.pop()!.close();
});
async function setup() {
  const repo = new LocalAdapter({ name: `flow${++n}`, sessionKey: `flow${n}.s` });
  open.push(repo);
  await repo.ready();
  return { repo, waiter: makeDb(repo, DEMO_RESTAURANT_ID, DEMO_BRANCH_ID, staffId("waiter1")), chef: makeDb(repo, DEMO_RESTAURANT_ID, DEMO_BRANCH_ID, staffId("chef")) };
}

describe("waiter → kitchen flow", () => {
  it("sends a round, bumps, recalls and serves", async () => {
    const { waiter, chef } = await setup();
    const table = (await waiter.list("tables", { where: { code: "ZM01" } }))[0];
    const menu = await waiter.list("menuItems");
    const cats = await waiter.list("menuCategories");
    const hummus = menu.find((m) => m.name.en === "Hummus")!;
    const omAli = menu.find((m) => m.name.en === "Om Ali")!;
    const lines: CartLine[] = [
      { key: "a", item: hummus, qty: 2, modifiers: [], notes: "حساسية سمسم", seat: 1, course: 1 },
      { key: "b", item: omAli, qty: 1, modifiers: [], notes: "", seat: null, course: 2 },
    ];
    const order = await sendRound(waiter, { table, lines, guests: 2, categories: cats, holdLater: true });
    expect(order.waiterId).toBe(staffId("waiter1"));

    let items = await chef.list("orderItems", { where: { orderId: order.id } });
    expect(items.map((i) => i.status).sort()).toEqual(["new", "sent"]);
    expect(items.find((i) => i.itemId === hummus.id)!.stationId).toBeTruthy();
    expect((await chef.get("tables", table.id))!.status).toBe("ordered");
    const check = (await chef.list("checks", { contains: { tableIds: table.id }, where: { status: "open" } }))[0];
    expect(check.total).toBeGreaterThan(0);

    const orders = await chef.list("orders", { where: { status: ["open", "sent", "ready", "served"] } });
    let all = await chef.list("orderItems");
    let t = buildTickets(orders, all).find((x) => x.order.id === order.id)!;
    expect(t.items).toHaveLength(1);
    expect(t.held).toHaveLength(1);

    await applyAction(chef, t.items, "bump");
    expect((await chef.get("orders", order.id))!.status).toBe("ready");
    all = await chef.list("orderItems");
    expect(buildTickets(await chef.list("orders", { where: { id: order.id } }), all)).toHaveLength(0); // left the line

    await applyAction(chef, t.items.map((i) => ({ ...i, status: "ready" as const })), "recall");
    expect((await chef.get("orders", order.id))!.status).toBe("sent");
    items = await chef.list("orderItems", { where: { orderId: order.id, status: "preparing" } });
    expect(items).toHaveLength(1);
    expect(items[0].readyAt).toBeNull();

    await applyAction(chef, items, "bump");
    const ready = await waiter.list("orderItems", { where: { orderId: order.id, status: "ready" } });
    await applyAction(waiter, ready, "serve");
    expect((await chef.get("orders", order.id))!.status).toBe("served");
  });

  it("86 hides the item from the guest menu; calls ack/done feed the KPI", async () => {
    const { repo, waiter, chef } = await setup();
    const hummus = (await chef.list("menuItems")).find((m) => m.name.en === "Hummus")!;
    await setAvailability(chef, hummus.id, false);
    const menu = await repo.guest.menu(DEMO_SLUG, "ZM02");
    expect(menu!.items.find((i) => i.id === hummus.id)?.available ?? false).toBe(false);

    const table = (await waiter.list("tables", { where: { code: "ZM02" } }))[0];
    const c = await createServiceCall(waiter, { branchId: DEMO_BRANCH_ID, tableId: table.id, type: "water", source: "qr" });
    const dup = await createServiceCall(waiter, { branchId: DEMO_BRANCH_ID, tableId: table.id, type: "water", source: "qr" });
    expect(dup.id).toBe(c.id);
    await ackCall(waiter, c);
    await doneCall(waiter, (await waiter.get("serviceCalls", c.id))!);
    const done = (await waiter.get("serviceCalls", c.id))!;
    expect(done.status).toBe("done");
    expect(done.ackBy).toBe(staffId("waiter1"));
    const s = callStats(await waiter.list("serviceCalls"));
    expect(s.byWaiter.some((w) => w.waiterId === staffId("waiter1"))).toBe(true);

    const order = (await chef.list("orders", { where: { status: "sent" } })).find((o) => o.tableIds.length)!;
    const ping = await pingWaiter(chef, order);
    expect(ping?.type).toBe("pickup");
    expect((await pingWaiter(chef, order))?.id).toBe(ping?.id); // one open ping per order
  });

  it("request bill resolves the guest's bill call", async () => {
    const { waiter } = await setup();
    const table = (await waiter.list("tables", { where: { code: "ZM07" } }))[0];
    const check = (await waiter.list("checks", { contains: { tableIds: table.id } }))[0];
    await requestBill(waiter, table, check);
    expect((await waiter.list("serviceCalls", { where: { tableId: table.id, type: "bill", status: "open" } }))).toHaveLength(0);
    expect((await waiter.get("tables", table.id))!.status).toBe("bill");
  });
});

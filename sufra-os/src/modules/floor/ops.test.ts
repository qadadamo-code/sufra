import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "@/data/local/LocalAdapter";
import { makeDb } from "@/data/hooks";
import { DEMO_BRANCH_ID, DEMO_RESTAURANT_ID, staffId } from "@/data/seed";
import { seedId } from "@/lib/id";
import { markClean, markPaid, mergeTables, reconcileContacts, requestBill, seatTables, splitByTable, transferTable } from "./ops";
import { deriveFloor } from "./model";

let n = 0;
const open: LocalAdapter[] = [];
afterEach(() => {
  while (open.length) open.pop()!.close();
});
async function setup() {
  const a = new LocalAdapter({ name: `floor-ops-${++n}`, sessionKey: `floor-ops-${n}.session` });
  open.push(a);
  await a.ready();
  return makeDb(a, DEMO_RESTAURANT_ID, DEMO_BRANCH_ID, staffId("manager"));
}
const tid = (k: number) => seedId(`sufra-zamalek:table:${k}`);

describe("floor ops on the seeded restaurant", () => {
  it("splits the 11+12 bill back by origin table, then merges it again", async () => {
    const db = await setup();
    const [merged] = (await db.list("checks", { where: { status: "open" } })).filter((c) => c.tableIds.includes(tid(11)));
    expect(merged.tableIds).toEqual([tid(11), tid(12)]);
    const total = merged.total;
    const spawned = await splitByTable(db, merged);
    expect(spawned).toHaveLength(1);
    const after = await db.list("checks", { where: { status: "open" } });
    const c11 = after.find((c) => c.tableIds[0] === tid(11))!;
    const c12 = after.find((c) => c.tableIds[0] === tid(12))!;
    expect(c11.tableIds).toEqual([tid(11)]);
    expect(c11.total + c12.total).toBe(total);
    // items followed their table
    const o12 = await db.list("orders", { where: { checkId: c12.id } });
    const items12 = await db.list("orderItems", { where: { orderId: o12.map((o) => o.id) } });
    expect(items12.every((i) => i.originTableId === tid(12))).toBe(true);

    const target = await mergeTables(db, [tid(11), tid(12)]);
    expect(target).toBe(c11.id); // opened first
    const again = await db.list("checks", { where: { status: "open" } });
    expect(again.filter((c) => c.tableIds.includes(tid(12)))).toHaveLength(1);
    expect((await db.get("checks", c11.id))!.total).toBe(total);
    expect((await db.get("checks", c12.id))!.status).toBe("void");
  });

  it("seats a free table, asks for the bill, settles and clears it", async () => {
    const db = await setup();
    const check = await seatTables(db, { tableIds: [tid(1)], guests: 3, waiterId: staffId("waiter1") });
    expect((await db.get("tables", tid(1)))!.status).toBe("seated");
    const [order] = await db.list("orders", { where: { checkId: check.id } });
    expect(order.waiterId).toBe(staffId("waiter1"));
    await expect(seatTables(db, { tableIds: [tid(1)], guests: 2 })).rejects.toThrow("table_busy");
    await requestBill(db, check);
    expect((await db.get("tables", tid(1)))!.status).toBe("bill");
    await markPaid(db, (await db.get("checks", check.id))!);
    expect((await db.get("checks", check.id))!.status).toBe("paid");
    expect((await db.get("tables", tid(1)))!.status).toBe("dirty");
    await markClean(db, [tid(1)]);
    expect((await db.get("tables", tid(1)))!.status).toBe("free");
  });

  it("transfers a party to a free table, moving item origins", async () => {
    const db = await setup();
    const [c3] = (await db.list("checks", { where: { status: "open" } })).filter((c) => c.tableIds.includes(tid(3)));
    await transferTable(db, c3, tid(3), tid(4));
    const moved = (await db.get("checks", c3.id))!;
    expect(moved.tableIds).toEqual([tid(4)]);
    expect((await db.get("tables", tid(3)))!.status).toBe("dirty");
    const orders = await db.list("orders", { where: { checkId: c3.id } });
    const items = await db.list("orderItems", { where: { orderId: orders.map((o) => o.id) } });
    expect(items.every((i) => i.originTableId === tid(4))).toBe(true);
  });

  it("pushing a table against an occupied one merges their bills", async () => {
    const db = await setup();
    const before = await db.list("tables");
    // table 3 (occupied) and 4 (seat someone) are 200cm apart; push 4 against 3
    await seatTables(db, { tableIds: [tid(4)], guests: 2 });
    const after = before.map((t) => (t.id === tid(4) ? { ...t, x: 680 } : t));
    await db.update("tables", tid(4), { x: 680 });
    const r = await reconcileContacts(db, before, after, []);
    expect(r.merged).toHaveLength(1);
    const open3 = (await db.list("checks", { where: { status: "open" } })).filter((c) => c.tableIds.includes(tid(3)));
    expect(open3).toHaveLength(1);
    expect(open3[0].tableIds.sort()).toEqual([tid(3), tid(4)].sort());
  });

  it("derives colours for every table state from the seed", async () => {
    const db = await setup();
    const v = deriveFloor({
      zones: await db.list("zones"), tables: await db.list("tables"), decor: await db.list("floorDecor"), links: [], checks: await db.list("checks"), orders: await db.list("orders"),
      reservations: await db.list("reservations"), calls: await db.list("serviceCalls"), members: await db.list("memberships"), now: Date.now(),
    });
    const st = (k: number) => v.tables.get(tid(k))!.state;
    expect(st(1)).toBe("free");
    expect(["occupied", "long"]).toContain(st(3));
    expect(st(7)).toBe("bill");
    expect(st(10)).toBe("dirty");
    expect(st(18)).toBe("blocked");
    expect(v.tables.get(tid(11))!.group?.tableIds).toHaveLength(2);
    expect(v.tables.get(tid(5))!.waiter?.id).toBe(staffId("waiter2"));
  });
});

/**
 * End-to-end POS money flow on the in-browser backend: shift → ticket → send → split tender → close (receipt + ETA chain
 * + ledger) → return → cash out → Z report.
 */
import { afterAll, describe, expect, it } from "vitest";
import { LocalAdapter } from "@/data/local/LocalAdapter";
import { makeDb } from "@/data/hooks";
import { DEMO_BRANCH_ID, DEMO_RESTAURANT_ID, staffId } from "@/data/seed";
import { major } from "@/lib/money";
import { verifyEtaUuid } from "@/lib/receipt/eta";
import { addLine, loadTicket, mergeChecks, openTicket, sendToKitchen, splitIntoChecks } from "./ops";
import { activeOrderFor } from "@/data/ops";
import { buildZ, cashMove, closeCheck, closeShift, openShift, refundSale, returnable, takePayment } from "./sale";
import { splitEvenly } from "./math";

const repo = new LocalAdapter({ name: "pos-sale-test", memory: true, sessionKey: "pos-sale-test.session" });
afterAll(() => repo.close());
const db = makeDb(repo, DEMO_RESTAURANT_ID, DEMO_BRANCH_ID, staffId("cashier1"));
const DEVICE = "TEST1";

async function ticket(keys: [string, number][], mode: "dine_in" | "takeaway" = "takeaway") {
  const cats = await db.list("menuCategories");
  const items = await db.list("menuItems");
  const { check, order } = await openTicket(db, { mode, pickup: false, tableIds: [], guests: 2, customerId: null, deliveryFee: 0, delivery: null, pickupAt: null });
  for (const [sku, qty] of keys) {
    const it = items.find((i) => i.sku === sku)!;
    const t = (await loadTicket(db, check.id))!;
    await addLine(db, { orderId: order.id, checkId: check.id, items: t.items, tableId: null }, { item: it, modifiers: [], qty, notes: "", seat: null, course: 1 }, cats);
  }
  return (await loadTicket(db, check.id))!;
}

describe("POS sale flow", () => {
  it("runs a shift end to end and the Z report adds up", async () => {
    await repo.ready();
    const shift = await openShift(db, DEVICE, major(500));
    expect(shift.status).toBe("open");

    // sale 1: split evenly between two cards + a cash share
    const t1 = await ticket([["KOFTA", 2], ["TEA", 3]]);
    expect(await sendToKitchen(db, t1)).toBe(2);
    expect((await loadTicket(db, t1.check.id))!.items.every((i) => i.status === "sent" && i.firedAt)).toBe(true);
    const c1 = (await db.get("checks", t1.check.id))!;
    const shares = splitEvenly(c1.total, 3);
    await takePayment(db, c1, { method: "card", amount: shares[0], tip: major(20), tendered: null });
    await takePayment(db, c1, { method: "wallet", amount: shares[1], tip: 0, tendered: null });
    await takePayment(db, c1, { method: "cash", amount: shares[2], tip: 0, tendered: major(500) });
    const r1 = await closeCheck(db, c1.id, { shift, device: DEVICE });
    expect(r1.ledgerError).toBeNull();
    expect(r1.receipt.receiptNo).toBe("TEST1-000001");
    expect(r1.receipt.bill.payable).toBe(c1.total);
    expect((await db.get("checks", c1.id))!.status).toBe("paid");

    // sale 2: split by item into two checks, both cash
    const t2 = await ticket([["KOFTA", 1], ["HUMMUS", 1], ["SODA", 2]]);
    const [other] = await splitIntoChecks(db, t2, [[{ itemId: t2.items[2].id, qty: 1 }]]);
    const a = (await db.get("checks", t2.check.id))!;
    const b = (await db.get("checks", other.id))!;
    const whole = (await ticket([["KOFTA", 1], ["HUMMUS", 1], ["SODA", 2]])).check;
    expect(a.total + b.total).toBe((await db.get("checks", whole.id))!.total);
    for (const c of [a, b]) {
      await takePayment(db, c, { method: "cash", amount: c.total, tip: 0, tendered: c.total });
      await closeCheck(db, c.id, { shift, device: DEVICE });
    }

    // the device chain: continuous numbers, each previousUUID = the one before, uuids verify
    const rs = await db.list("receipts", { where: { device: DEVICE }, orderBy: [{ field: "seq" }] });
    expect(rs.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(rs[1].etaPreviousUuid).toBe(rs[0].etaUuid);
    expect(rs[2].etaPreviousUuid).toBe(rs[1].etaUuid);
    for (const r of rs) expect((await verifyEtaUuid(r.etaJson!)).matches).toBe(true);

    // return one kofta from sale 1, refunded in cash (manager approved upstream)
    const kofta = rs[0].bill.lines.find((l) => l.qty === 2)!;
    const ret = await refundSale(db, rs[0], [{ lineId: kofta.id, qty: 1 }], "cash", { shift, device: DEVICE, approvedBy: staffId("manager"), reason: "test" });
    expect(ret.receipt.kind).toBe("RC");
    expect(ret.receipt.seq).toBe(4);
    expect(JSON.parse(ret.receipt.etaJson!).header.referenceUUID).toBe(rs[0].etaUuid);
    expect(returnable(rs[0], [ret.receipt]).get(kofta.id)).toBe(1);

    // paid out for ice
    await cashMove(db, shift, "out", major(50), "ثلج", null);

    // every journal entry balances
    const je = await db.list("ledgerEntries");
    expect(je.length).toBeGreaterThanOrEqual(5);
    for (const e of je) expect(e.lines.reduce((s, l) => s + l.debit - l.credit, 0)).toBe(0);

    // X (mid-shift) then Z
    const receipts = await db.list("receipts", { where: { shiftId: shift.id } });
    const moves = await db.list("cashMovements", { where: { shiftId: shift.id } });
    const x = buildZ(shift, receipts, moves, null);
    expect(x.sales.count).toBe(3);
    expect(x.returns.count).toBe(1);
    const cashSales = shares[2] + a.total + b.total;
    const expected = major(500) + cashSales - ret.receipt.bill.payable - major(50);
    expect(Number(x.cash.expected)).toBe(expected);
    expect(Number(x.tips)).toBe(major(20));

    const closed = await closeShift(db, shift, expected - major(5));
    expect(closed.zNumber).toBe(1);
    expect(closed.z.cash.difference).toBe(-major(5));
    expect(closed.z.sales.total).toBe(c1.total + a.total + b.total);
    expect(closed.z.firstNumber).toBe(1);
    expect(closed.z.lastNumber).toBe(4);
    expect(closed.shift.status).toBe("closed");
    const z = closed.z;
    expect(z.byMethod.card + z.byMethod.wallet + z.byMethod.cash).toBe(z.sales.total - z.returns.total);
  });
});

describe("one order per check across floor, waiter and POS", () => {
  it("reuses the seated (empty) order, and merging moves orders + payments", async () => {
    await repo.ready();
    const { check, order } = await openTicket(db, { mode: "dine_in", pickup: false, tableIds: [], guests: 2, customerId: null, deliveryFee: 0, delivery: null, pickupAt: null });
    expect((await activeOrderFor(db, check, { source: "pos" })).id).toBe(order.id);
    expect((await activeOrderFor(db, check, { source: "waiter" })).id).toBe(order.id);
    await db.update("orders", order.id, { status: "closed" });
    const fresh = await activeOrderFor(db, check, { source: "pos" });
    expect(fresh.id).not.toBe(order.id);

    const a = await ticket([["KOFTA", 1]]);
    const b = await ticket([["TEA", 2]]);
    await takePayment(db, b.check, { method: "card", amount: major(10), tip: 0, tendered: null });
    await mergeChecks(db, (await db.get("checks", a.check.id))!, (await db.get("checks", b.check.id))!);
    const gone = (await db.get("checks", b.check.id))!;
    expect(gone.status).toBe("void");
    expect(gone.tableIds).toEqual([]);
    const into = (await db.get("checks", a.check.id))!;
    expect(into.paid).toBe(major(10));
    expect((await db.list("orders", { where: { checkId: a.check.id } })).length).toBe(2);
    expect((await db.list("payments", { where: { checkId: a.check.id } })).length).toBe(1);
  });
});

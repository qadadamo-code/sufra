/**
 * Inventory, recipes & purchasing — pure rules + the end-to-end flow on the in-browser backend:
 * POS send → stock deduction → count → PO → receive → invoice → pay, with every ledger entry balanced.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mergeChart, validateJournal } from "@/modules/accounting/core";
import { LocalAdapter } from "@/data/local/LocalAdapter";
import { makeDb } from "@/data/hooks";
import { buildSeed, DEMO_BRANCH_ID, DEMO_RESTAURANT_ID, staffId } from "@/data/seed";
import type { LedgerEntry, Recipe, StockItem } from "@/data/types";
import { major } from "@/lib/money";
import { seedId } from "@/lib/id";
import { avgCost, consume, countTo, margin, portionCost, prepUnitCost, receive, type CostContext } from "./costing";
import { explodeContext, explodeLine } from "./explode";
import { convert, formatQty, toBase, unitsFor } from "./units";
import { canMove, createPo, invoicePo, paySupplier, poLine, receivePo, receiptVariance, sendPo, suggestPacks, supplierBalances } from "./purchasing";
import { applyMoves, approveCount, levelId, produce, recordWaste, saveCountLine, startCount, submitCount } from "./stock";
import { batchesOnHand, usageReport } from "./reports";
import { addLine, loadTicket, openTicket, sendToKitchen, voidLine } from "@/modules/pos/ops";
import { closeCheck, openShift, takePayment } from "@/modules/pos/sale";
import { commissionUnits } from "./purchasing";

const item = (o: Partial<StockItem> & Pick<StockItem, "id" | "baseUnit">): StockItem => ({
  restaurantId: "r", createdAt: "", updatedAt: "", name: { ar: o.id, en: o.id }, sku: o.id, category: "dry", kind: "raw", packs: [], countUnit: o.baseUnit,
  account: "food", levels: { min: 0, par: 0, max: 0 }, branchLevels: {}, supplierIds: [], preferredSupplierId: null, lastCost: 0, defaultLocationIds: [], trackBatches: false,
  shelfLifeDays: null, vatBp: 0, yieldBp: 10_000, allergens: [], active: true, note: "", ...o,
});
const recipe = (o: Partial<Recipe> & Pick<Recipe, "ownerType" | "ownerId" | "lines">): Recipe => ({ id: `${o.ownerType}:${o.ownerId}`, restaurantId: "r", createdAt: "", updatedAt: "", yieldQty: 1, method: "", updatedBy: null, ...o });

describe("units", () => {
  const cola = item({ id: "cola", baseUnit: "pc", packs: [{ id: "carton", name: { ar: "كرتونة", en: "carton" }, factor: 24 }] });
  const flour = item({ id: "flour", baseUnit: "g", packs: [{ id: "sack", name: { ar: "شيكارة", en: "sack" }, factor: 50_000 }] });
  it("converts kg/g, L/ml and item packs", () => {
    expect(convert(2.5, "kg", "g", flour)).toBe(2500);
    expect(convert(750, "g", "kg", flour)).toBe(0.75);
    expect(convert(2, "sack", "kg", flour)).toBe(100);
    expect(toBase(3, "carton", cola)).toBe(72);
    expect(convert(30, "pc", "carton", cola)).toBe(1.25);
    expect(convert(1.5, "L", "ml", item({ id: "milk", baseUnit: "ml" }))).toBe(1500);
    expect(convert(2, "dozen", "pc", cola)).toBe(24);
  });
  it("refuses impossible conversions", () => {
    expect(() => convert(1, "kg", "pc", cola)).toThrow();
    expect(() => convert(1, "L", "g", flour)).toThrow();
    expect(unitsFor(cola).map((u) => u.id)).toEqual(["pc", "dozen", "carton"]);
  });
  it("formats with the nicest unit", () => {
    expect(formatQty(2500, flour, "en")).toBe("2.5 kg");
    expect(formatQty(750, flour, "en")).toBe("750 g");
    expect(formatQty(48, cola, "en", "carton")).toBe("2 carton");
  });
});

describe("weighted average cost (EAS 2)", () => {
  it("blends receipts by value and issues at the average", () => {
    let p = receive({ qty: 0, value: 0 }, 10_000, major(4800)); // 10 kg lamb at 480/kg
    expect(avgCost(p)).toBe(major(0.48));
    p = receive(p, 10_000, major(5100)); // +10 kg at 510/kg
    expect(p).toEqual({ qty: 20_000, value: major(9900) });
    expect(avgCost(p)).toBe(major(0.495));
    const r = consume(p, 5000, 0);
    expect(r.value).toBe(major(2475));
    expect(r.position).toEqual({ qty: 15_000, value: major(7425) });
    // taking everything left takes the whole value (no rounding residue)
    const all = consume(r.position, 15_000, 0);
    expect(all.position).toEqual({ qty: 0, value: 0 });
  });
  it("keeps exact value with fractional grams", () => {
    const p = receive({ qty: 0, value: 0 }, 1000, major(1400)); // saffron-like: 1.4 EGP/g
    const r = consume(p, 0.5, 0);
    expect(r.value).toBe(major(0.7));
  });
  it("lets sales run negative at the average (last cost when empty) and settles on the next receipt", () => {
    const r = consume({ qty: 100, value: major(50) }, 150, major(0.6));
    expect(r.value).toBe(major(50) + major(25));
    expect(r.position.qty).toBe(-50);
    const p = receive(r.position, 1000, major(600));
    expect(p.qty).toBe(950);
    expect(p.value).toBe(major(600) - major(25));
    expect(consume({ qty: 0, value: 0 }, 10, major(0.6)).value).toBe(major(6));
  });
  it("count adjustments are valued at the average", () => {
    const p = { qty: 2000, value: major(1000) };
    expect(countTo(p, 1500, 0)).toMatchObject({ qty: -500, value: -major(250), position: { qty: 1500, value: major(750) } });
    expect(countTo(p, 2200, 0)).toMatchObject({ qty: 200, value: major(100) });
  });
});

describe("recipe cost", () => {
  const items = new Map<string, StockItem>([
    ["tahini", item({ id: "tahini", baseUnit: "g" })],
    ["lemon", item({ id: "lemon", baseUnit: "g" })],
    ["chicken", item({ id: "chicken", baseUnit: "g", yieldBp: 8000 })],
    ["cheese", item({ id: "cheese", baseUnit: "g" })],
    ["sauce", item({ id: "sauce", baseUnit: "g", kind: "prep" })],
  ]);
  const cost: Record<string, number> = { tahini: major(0.135), lemon: major(0.045), chicken: major(0.2), cheese: major(0.38), sauce: major(99) };
  const sauce = recipe({ ownerType: "prep", ownerId: "sauce", lines: [{ itemId: "tahini", qty: 500 }, { itemId: "lemon", qty: 100 }], yieldQty: 1000 });
  const ctx: CostContext = { items, prepRecipes: new Map([["sauce", sauce]]), unitCost: (id) => cost[id] };
  it("prices a sub-recipe from its own recipe ÷ yield", () => {
    // (500 × 0.135 + 100 × 0.045) / 1000 g = 0.072 EGP/g
    expect(prepUnitCost("sauce", ctx)).toBe(major(0.072));
  });
  it("adds modifiers and grosses up trim yield", () => {
    const dish = recipe({ ownerType: "menu_item", ownerId: "tawook", lines: [{ itemId: "chicken", qty: 240 }, { itemId: "sauce", qty: 50 }] });
    const extraCheese = recipe({ ownerType: "modifier", ownerId: "cheese", lines: [{ itemId: "cheese", qty: 30 }] });
    // chicken 240 g at 80% yield = 300 g × 0.20 = 60; sauce 50 × 0.072 = 3.6 → 63.6; + cheese 30 × 0.38 = 11.4 → 75
    expect(portionCost(dish, [], ctx)).toBe(major(63.6));
    expect(portionCost(dish, [extraCheese], ctx)).toBe(major(75));
    const m = margin(major(75), major(300));
    expect(m.foodCostBp).toBe(2500);
    expect(m.contribution).toBe(major(225));
  });
  it("explodes an order line with modifiers, item-scoped modifiers and combos", () => {
    const menu = [
      { id: "juice", comboOf: undefined },
      { id: "meal", comboOf: [{ itemId: "juice", qty: 2 }] },
    ] as never[];
    const recipes = [
      recipe({ ownerType: "menu_item", ownerId: "juice", lines: [{ itemId: "lemon", qty: 120 }] }),
      recipe({ ownerType: "modifier", ownerId: "large", lines: [{ itemId: "lemon", qty: 10 }] }),
      recipe({ ownerType: "modifier", ownerId: "large", scopeItemId: "juice", lines: [{ itemId: "lemon", qty: 60 }], id: "scoped" }),
      recipe({ ownerType: "modifier", ownerId: "no-lemon", lines: [{ itemId: "lemon", qty: -500 }] }),
    ];
    const ctx2 = explodeContext(menu, [...items.values()], recipes);
    const mod = (id: string) => ({ groupId: "g", modifierId: id, name: { ar: id, en: id }, price: 0 });
    expect(explodeLine({ itemId: "juice", qty: 2, modifiers: [mod("large")] }, ctx2).get("lemon")).toBe(360);
    expect(explodeLine({ itemId: "meal", qty: 1, modifiers: [] }, ctx2).get("lemon")).toBe(240);
    expect(explodeLine({ itemId: "juice", qty: 1, modifiers: [mod("no-lemon")] }, ctx2).has("lemon")).toBe(false);
  });
});

describe("suggested orders", () => {
  const base = { onHand: 0, onOrder: 0, min: 2000, par: 6000, max: 12_000, dailyUsage: 2000, leadDays: 1, coverDays: 3, packFactor: 1000 };
  it("orders up to cover lead time + cover days, in whole packs", () => {
    expect(suggestPacks({ ...base, onHand: 1500 })).toBe(7); // up to 8 000, need 6 500 → 7 kg
    expect(suggestPacks({ ...base, onHand: 1500, packFactor: 25_000 })).toBe(1); // one sack
  });
  it("counts what is already on order and respects the reorder point and max", () => {
    expect(suggestPacks({ ...base, onHand: 1500, onOrder: 5000 })).toBe(0);
    expect(suggestPacks({ ...base, onHand: 2500 })).toBe(0); // above reorder point
    expect(suggestPacks({ ...base, onHand: 0, dailyUsage: 5000, max: 9000 })).toBe(9);
  });
});

describe("purchase order state machine", () => {
  it("allows only forward moves", () => {
    expect(canMove("draft", "sent")).toBe(true);
    expect(canMove("sent", "partial")).toBe(true);
    expect(canMove("partial", "received")).toBe(true);
    expect(canMove("received", "invoiced")).toBe(true);
    expect(canMove("invoiced", "paid")).toBe(true);
    expect(canMove("draft", "received")).toBe(false);
    expect(canMove("received", "sent")).toBe(false);
    expect(canMove("paid", "cancelled")).toBe(false);
    expect(canMove("partial", "cancelled")).toBe(false);
  });
  it("marketplace commission follows the supplier plan", () => {
    expect(commissionUnits("starter", major(10_000))).toBe(major(600)); // 6 %
    expect(commissionUnits("growth", major(100_000))).toBe(major(1500)); // 3.5 % capped at 1 500
    expect(commissionUnits("starter", major(100))).toBe(major(15)); // min 15
  });
});

describe("batches", () => {
  it("on-hand stock is the newest receipts (oldest used first)", () => {
    const b = (id: string, receivedAt: string, qty: number) => ({ id, receivedAt, qty }) as never;
    const left = batchesOnHand([b("old", "2026-10-01", 5000), b("mid", "2026-10-03", 5000), b("new", "2026-10-05", 4000)], 6000);
    expect(left.map((x) => [x.id, x.left])).toEqual([["new", 4000], ["mid", 2000]]);
  });
});

describe("demo seed", () => {
  const { data } = buildSeed(new Date("2026-10-23T20:00:00+03:00"));
  it("has ~80+ ingredients, recipes for every menu item and positions that equal their moves", () => {
    expect(data.stockItems.filter((i) => i.kind === "raw").length).toBeGreaterThanOrEqual(80);
    for (const m of data.menuItems.filter((x) => x.restaurantId === DEMO_RESTAURANT_ID)) {
      const own = data.recipes.some((r) => r.ownerType === "menu_item" && r.ownerId === m.id);
      expect(own || !!m.comboOf?.length, m.name.en).toBe(true);
    }
    for (const l of data.stockLevels) {
      const mv = data.stockMoves.filter((x) => x.itemId === l.itemId && x.locationId === l.locationId);
      expect(Math.round(mv.reduce((a, x) => a + x.qty, 0) * 1000) / 1000, l.itemId).toBe(l.qty);
      expect(mv.reduce((a, x) => a + x.value, 0), l.itemId).toBe(l.value);
      expect(l.id).toBe(levelId(DEMO_RESTAURANT_ID, l.locationId, l.itemId));
    }
    expect(data.purchaseOrders.map((p) => p.status)).toEqual(expect.arrayContaining(["paid", "invoiced", "received", "sent", "draft"]));
    expect(data.stockCounts[0].lines.some((l) => l.counted !== l.expected)).toBe(true);
    const usage = usageReport(data.stockMoves, "2000-01-01", "2100-01-01");
    expect(usage.some((u) => u.variance !== 0)).toBe(true);
  });
});

/* ───────── end to end on the local backend ───────── */

const repo = new LocalAdapter({ name: "inventory-test", memory: true, sessionKey: "inventory-test.session" });
afterAll(() => repo.close());
const db = makeDb(repo, DEMO_RESTAURANT_ID, DEMO_BRANCH_ID, staffId("manager"));
const sid = (k: string) => seedId(`sufra-zamalek:${k}`);

async function onHand(stockKey: string) {
  const it = (await db.get("stockItems", sid(`stock:${stockKey}`)))!;
  const lv = await db.get("stockLevels", levelId(DEMO_RESTAURANT_ID, it.defaultLocationIds[0], it.id));
  return { qty: lv?.qty ?? 0, value: lv?.value ?? 0, item: it };
}
const chart = mergeChart();
const balanced = (rows: LedgerEntry[]) => {
  expect(rows.length).toBeGreaterThan(0);
  for (const e of rows) {
    validateJournal({ date: e.date, lines: e.lines }, chart);
    expect(e.lines.reduce((a, l) => a + l.debit, 0)).toBe(e.lines.reduce((a, l) => a + l.credit, 0));
  }
};
async function ledgerSince(n: number) {
  const all = await db.list("ledgerEntries");
  return all.slice(n);
}

describe("inventory flow (local backend)", () => {
  it("selling a kofta in the POS takes its recipe out of stock at send, with a balanced cost-of-sales entry", async () => {
    await repo.ready();
    const before = await onHand("p-kofta");
    const breadBefore = await onHand("baladi-bread");
    const nLedger = (await db.list("ledgerEntries")).length;
    const cats = await db.list("menuCategories");
    const kofta = (await db.list("menuItems", { where: { sku: "KOFTA" } }))[0];
    const mods = await db.list("modifiers");
    const cheese = mods.find((m) => m.id === sid("mod:extras:cheese"))!;
    const { check, order } = await openTicket(db, { mode: "takeaway", pickup: false, tableIds: [], guests: 1, customerId: null, deliveryFee: 0, delivery: null, pickupAt: null });
    const t0 = (await loadTicket(db, check.id))!;
    await addLine(db, { orderId: order.id, checkId: check.id, items: t0.items, tableId: null }, { item: kofta, modifiers: [cheese], qty: 2, notes: "", seat: null, course: 1 }, cats);
    const roumiBefore = await onHand("roumi");
    const t1 = (await loadTicket(db, check.id))!;
    await sendToKitchen(db, t1);
    const after = await onHand("p-kofta");
    expect(after.qty).toBeCloseTo(before.qty - 2 * 280, 3);
    expect((await onHand("baladi-bread")).qty).toBe(breadBefore.qty - 2);
    expect((await onHand("roumi")).qty).toBeCloseTo(roumiBefore.qty - 60, 3); // extra cheese 30 g × 2
    const moves = await db.list("stockMoves", { where: { refType: "order_item", refId: t1.items[0].id } });
    expect(moves.length).toBeGreaterThan(3);
    const cogs = (await ledgerSince(nLedger)).filter((e) => e.sourceType === "cogs");
    expect(cogs).toHaveLength(1);
    balanced(cogs);
    expect(cogs[0].lines.reduce((a, l) => a + l.debit, 0)).toBe(-moves.reduce((a, m) => a + m.value, 0));

    // paying does not deduct again (idempotent per line)
    const shift = await openShift(db, "INV1", major(500));
    const fresh = (await db.get("checks", check.id))!;
    await takePayment(db, fresh, { method: "cash", amount: fresh.total, tip: 0, tendered: fresh.total });
    await closeCheck(db, check.id, { shift, device: "INV1" });
    expect((await onHand("p-kofta")).qty).toBeCloseTo(after.qty, 3);
  });

  it("a drink rung up and paid without sending is deducted at payment; a void after send becomes waste", async () => {
    const cats = await db.list("menuCategories");
    const water = (await db.list("menuItems", { where: { sku: "WATER" } }))[0];
    const tea = (await db.list("menuItems", { where: { sku: "TEA" } }))[0];
    const before = await onHand("water");
    const { check, order } = await openTicket(db, { mode: "takeaway", pickup: false, tableIds: [], guests: 1, customerId: null, deliveryFee: 0, delivery: null, pickupAt: null });
    await addLine(db, { orderId: order.id, checkId: check.id, items: [], tableId: null }, { item: water, modifiers: [], qty: 3, notes: "", seat: null, course: 1 }, cats);
    const [shift] = await db.list("shifts", { where: { device: "INV1", status: "open" } });
    const c = (await db.get("checks", check.id))!;
    await takePayment(db, c, { method: "card", amount: c.total, tip: 0, tendered: null });
    await closeCheck(db, check.id, { shift, device: "INV1" });
    expect((await onHand("water")).qty).toBe(before.qty - 3);

    // void after send: stock stays out, cost moves to waste
    const t = await openTicket(db, { mode: "takeaway", pickup: false, tableIds: [], guests: 1, customerId: null, deliveryFee: 0, delivery: null, pickupAt: null });
    await addLine(db, { orderId: t.order.id, checkId: t.check.id, items: [], tableId: null }, { item: tea, modifiers: [], qty: 1, notes: "", seat: null, course: 1 }, cats);
    await sendToKitchen(db, (await loadTicket(db, t.check.id))!);
    const teaAfterSend = await onHand("tea");
    const line = (await loadTicket(db, t.check.id))!.items[0];
    const n = (await db.list("ledgerEntries")).length;
    await voidLine(db, t.check.id, line, "guest changed mind", staffId("manager"));
    expect((await onHand("tea")).qty).toBeCloseTo(teaAfterSend.qty, 3);
    const w = await db.list("stockMoves", { where: { refType: "order_item_void", refId: line.id, kind: "waste" } });
    expect(w[0].reason).toBe("void_after_send");
    const je = (await ledgerSince(n)).filter((e) => e.sourceType === "void-waste");
    expect(je).toHaveLength(1);
    balanced(je);
  });

  it("waste and production post and move stock at cost", async () => {
    const n = (await db.list("ledgerEntries")).length;
    const lemon = await onHand("lemon");
    await recordWaste(db, { itemId: lemon.item.id, locationId: lemon.item.defaultLocationIds[0], branchId: DEMO_BRANCH_ID, qty: 500, reason: "spoiled" });
    expect((await onHand("lemon")).qty).toBeCloseTo(lemon.qty - 500, 3);
    const sauce = await onHand("p-tahini");
    const tahini = await onHand("tahini");
    const r = await produce(db, { prepItemId: sauce.item.id, batches: 2, locationId: sauce.item.defaultLocationIds[0], branchId: DEMO_BRANCH_ID });
    expect(r.qty).toBe(2400);
    expect((await onHand("tahini")).qty).toBeCloseTo(tahini.qty - 1000, 3);
    const s2 = await onHand("p-tahini");
    expect(s2.qty).toBeCloseTo(sauce.qty + 2400, 3);
    expect(s2.value - sauce.value).toBe(r.value);
    const je = await ledgerSince(n);
    expect(je.map((e) => e.sourceType)).toEqual(["waste"]); // production moves value inside inventory: no entry
    balanced(je);
  });

  it("a blind count → variance → approval posts the adjustment", async () => {
    const fridge = sid("location:fridge");
    const count = await startCount(db, { branchId: DEMO_BRANCH_ID, locationId: fridge, kind: "partial", blind: true, itemIds: [sid("stock:lamb"), sid("stock:eggs")] });
    expect(count.lines.length).toBe(2);
    const lamb = count.lines.find((l) => l.itemId === sid("stock:lamb"))!;
    const eggs = count.lines.find((l) => l.itemId === sid("stock:eggs"))!;
    await saveCountLine(db, count.id, lamb.itemId, fridge, lamb.expected - 400);
    await saveCountLine(db, count.id, eggs.itemId, fridge, eggs.expected + 2);
    const sub = await submitCount(db, count.id);
    expect(sub.varianceValue).toBe(Math.round(-400 * lamb.unitCost) + Math.round(2 * eggs.unitCost));
    const n = (await db.list("ledgerEntries")).length;
    const ap = await approveCount(db, count.id, staffId("manager"));
    expect(ap.status).toBe("approved");
    expect((await onHand("lamb")).qty).toBeCloseTo(lamb.expected - 400, 3);
    expect((await onHand("eggs")).qty).toBeCloseTo(eggs.expected + 2, 3);
    const je = (await ledgerSince(n)).filter((e) => e.sourceType === "stock-count");
    expect(je).toHaveLength(1);
    balanced(je);
    const v = je[0].lines.find((l) => l.account === "5401")!;
    expect(v.debit - v.credit).toBe(-ap.varianceValue);
  });

  it("purchase order: send → partial → received (price variance, WAC) → invoice with input VAT → pay", async () => {
    const lamb = await onHand("lamb");
    const sup = sid("supplier:butcher");
    const offers = await db.list("supplierItems", { where: { supplierId: sup, itemId: lamb.item.id } });
    const po = await createPo(db, { supplierId: sup, branchId: DEMO_BRANCH_ID, locationId: lamb.item.defaultLocationIds[0], lines: [poLine(lamb.item, offers[0], 10)] });
    expect(po.status).toBe("draft");
    expect(po.channel).toBe("marketplace");
    await sendPo(db, po.id, "marketplace");
    const line = po.lines[0];
    const p1 = await receivePo(db, po.id, [{ lineId: line.id, qty: 4, price: line.price }]);
    expect(p1.status).toBe("partial");
    const higher = line.price + major(30);
    expect(receiptVariance(p1, [{ lineId: line.id, qty: 6, price: higher }])[0]).toMatchObject({ qtyDiff: 0, priceDiff: major(30), priceEffect: major(180) });
    const p2 = await receivePo(db, po.id, [{ lineId: line.id, qty: 6, price: higher }]);
    expect(p2.status).toBe("received");
    const after = await onHand("lamb");
    expect(after.qty).toBeCloseTo(lamb.qty + 10_000, 3);
    expect(after.value - lamb.value).toBe(4 * line.price + 6 * higher);
    expect((await db.get("stockItems", lamb.item.id))!.lastCost).toBe(Math.round(higher / 1000));
    expect(p2.marketplace!.base).toBe(4 * line.price + 6 * higher);
    expect(p2.marketplace!.commission).toBeGreaterThan(0);
    const offer = (await db.list("supplierItems", { where: { supplierId: sup, itemId: lamb.item.id } }))[0];
    expect(offer.price).toBe(higher);

    const n = (await db.list("ledgerEntries")).length;
    const inv = await invoicePo(db, po.id, { number: "AM-9001" });
    expect(inv.net).toBe(4 * line.price + 6 * higher); // lamb VAT-exempt, free delivery
    expect(inv.vat).toBe(0);
    await paySupplier(db, { invoiceId: inv.id, amount: major(1000), method: "bank" });
    expect(supplierBalances(await db.list("supplierInvoices")).get(sup)!.owed).toBeGreaterThanOrEqual(inv.total - major(1000));
    await paySupplier(db, { invoiceId: inv.id, amount: inv.total - major(1000), method: "cash" });
    expect((await db.get("purchaseOrders", po.id))!.status).toBe("paid");
    const je = await ledgerSince(n);
    expect(je.map((e) => e.sourceType)).toEqual(["purchase-invoice", "supplier.payment", "supplier.payment"]);
    balanced(je);
    expect(je[0].lines.find((l) => l.account === "2101")!.credit).toBe(inv.total);
    await expect(paySupplier(db, { invoiceId: inv.id, amount: major(1), method: "cash" })).rejects.toThrow();
  });

  it("an invoice with taxable lines books input VAT (postPurchase)", async () => {
    const oil = await onHand("oil");
    const sup = sid("supplier:grocer");
    const [offer] = await db.list("supplierItems", { where: { supplierId: sup, itemId: oil.item.id } });
    const po = await createPo(db, { supplierId: sup, branchId: DEMO_BRANCH_ID, locationId: oil.item.defaultLocationIds[0], lines: [poLine(oil.item, offer, 2)] });
    await sendPo(db, po.id, "whatsapp");
    await receivePo(db, po.id, [{ lineId: po.lines[0].id, qty: 2, price: offer.price }]);
    const n = (await db.list("ledgerEntries")).length;
    const inv = await invoicePo(db, po.id, { number: "EW-1" });
    expect(inv.vat).toBe(Math.round((2 * offer.price * 1400) / 10_000));
    const [je] = await ledgerSince(n);
    balanced([je]);
    expect(je.lines.find((l) => l.account === "1401")!.debit).toBe(inv.vat);
    expect(je.lines.find((l) => l.account === "1301")!.debit).toBe(2 * offer.price);
  });

  it("transfers move value between locations without changing the total", async () => {
    const before = await db.list("stockLevels", { where: { itemId: sid("stock:tahini") } });
    const total0 = before.reduce((a, l) => a + l.value, 0);
    const from = sid("location:store");
    const to = sid("location:kitchen");
    await applyMoves(db, []);
    const { moveNow } = await import("./stock");
    await moveNow(db, { fromBranchId: DEMO_BRANCH_ID, toBranchId: DEMO_BRANCH_ID, fromLocationId: from, toLocationId: to, note: "", lines: [{ itemId: sid("stock:tahini"), qty: 1000 }] });
    const afterRows = await db.list("stockLevels", { where: { itemId: sid("stock:tahini") } });
    expect(afterRows.reduce((a, l) => a + l.value, 0)).toBe(total0);
    expect(afterRows.find((l) => l.locationId === to)!.qty).toBe(1000);
  });
});

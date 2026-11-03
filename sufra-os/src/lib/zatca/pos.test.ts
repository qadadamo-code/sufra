/**
 * KSA POS path end to end on the in-browser backend: the Riyadh demo tenant closes a check → simplified tax invoice
 * (demo-signed, chained, QR on the receipt model), a B2B check → standard invoice for clearance, a return → credit note
 * referencing the sale, and the Egyptian tenant still gets ETA e-receipts (country switch).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalAdapter } from "@/data/local/LocalAdapter";
import { makeDb } from "@/data/hooks";
import { DEMO_BRANCH_ID, DEMO_RESTAURANT_ID, staffId } from "@/data/seed";
import { seedId } from "@/lib/id";
import { major } from "@/lib/money";
import { buildReceiptModel } from "@/lib/receipt";
import { addLine, loadTicket, openTicket } from "@/modules/pos/ops";
import { closeCheck, openShift, refundSale, takePayment } from "@/modules/pos/sale";
import { KSA_BRANCH_ID, KSA_RESTAURANT_ID } from "./demoSeed";
import { FIRST_PIH } from "./ubl";
import { decodeQr } from "./tlv";
import { verifyInvoiceXml } from "./sign";
import { receiptZatca } from "./receipt";
import { brokenLink } from "./chain";

beforeAll(() => {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0,
  };
});

const repo = new LocalAdapter({ name: "zatca-pos-test", memory: true, sessionKey: "zatca-pos-test.session" });
afterAll(() => repo.close());
const db = makeDb(repo, KSA_RESTAURANT_ID, KSA_BRANCH_ID, seedId("sufra-riyadh:staff:owner"));
const DEVICE = "RUH1";

async function sale(keys: [string, number][]) {
  const cats = await db.list("menuCategories");
  const items = await db.list("menuItems");
  const { check, order } = await openTicket(db, { mode: "takeaway", pickup: false, tableIds: [], guests: 1, customerId: null, deliveryFee: 0, delivery: null, pickupAt: null });
  for (const [sku, qty] of keys) {
    const it = items.find((i) => i.sku === sku)!;
    const t = (await loadTicket(db, check.id))!;
    await addLine(db, { orderId: order.id, checkId: check.id, items: t.items, tableId: null }, { item: it, modifiers: [], qty, notes: "", seat: null, course: 1 }, cats);
  }
  return (await db.get("checks", check.id))!;
}

describe("KSA POS → ZATCA", () => {
  it("prices the Riyadh menu VAT-inclusive in SAR", async () => {
    await repo.ready();
    const c = await sale([["KABSA", 1], ["TEA", 2]]);
    expect(c.total).toBe(major(90)); // 70 + 2 × 10, VAT inside
    expect(c.service).toBe(0);
    expect(c.vat).toBeGreaterThan(0);
  });

  it("closing a check issues a demo-signed simplified invoice, chained, QR on the receipt", async () => {
    const shift = await openShift(db, DEVICE, major(200));
    const c = await sale([["KABSA", 1], ["TEA", 2]]);
    await takePayment(db, c, { method: "cash", amount: c.total, tip: 0, tendered: major(100) });
    const r = await closeCheck(db, c.id, { shift, device: DEVICE });
    expect(r.etaError).toBeNull();
    expect(r.receipt.etaStatus).toBe("not_required");
    expect(r.receipt.etaUuid).toBeNull();
    const z = r.zatca!;
    expect(z.kind).toBe("simplified");
    expect(z.docType).toBe("invoice");
    expect(z.status).toBe("demo");
    expect(z.icv).toBe(1);
    expect(z.pih).toBe(FIRST_PIH);
    expect(z.total).toBe(major(90));
    expect(verifyInvoiceXml(z.xml).ok).toBe(true);
    const q = decodeQr(z.qr);
    expect(q.total).toBe("90.00");
    expect(q.vatNumber).toBe("399999999900003");
    expect(q.tags.map((t) => t.tag)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // the receipt shows the ZATCA QR (not an ETA one), the KSA title and SAR
    const settings = (await db.list("settings"))[0];
    const m = buildReceiptModel({
      kind: "SC", bill: r.receipt.bill, tax: settings.tax, invoice: settings.invoice, restaurant: { name: { ar: "x", en: "x" }, phone: null }, branch: null, receiptNo: r.receipt.receiptNo,
      orderNumber: null, issuedAt: r.receipt.issuedAt, cashier: null, waiter: null, tableLabels: [], guests: null, mode: "takeaway", customer: null, payments: r.receipt.payments,
      tendered: null, change: null, eta: null, zatca: receiptZatca(z, settings), currency: "SAR",
    });
    expect(m.zatca?.qr).toBe(z.qr);
    expect(m.eta).toBeNull();
    expect(m.title.ar).toBe("فاتورة ضريبية مبسطة");
    expect(m.legal[0]).toMatchObject({ value: "399999999900003" });
    expect(m.currency).toBe("SAR");

    // second sale continues the chain
    const c2 = await sale([["HUMMUS", 1]]);
    await takePayment(db, c2, { method: "card", amount: c2.total, tip: 0, tendered: null });
    const r2 = await closeCheck(db, c2.id, { shift, device: DEVICE });
    expect(r2.zatca!.icv).toBe(2);
    expect(r2.zatca!.pih).toBe(z.hash);

    // a return is a simplified credit note referencing the sale, same chain
    const back = await refundSale(db, r.receipt, [{ lineId: r.receipt.bill.lines[1].id, qty: 1 }], "cash", { shift, device: DEVICE, approvedBy: null, reason: "طلب خاطئ" });
    const cn = back.zatca!;
    expect(cn.docType).toBe("credit");
    expect(cn.kind).toBe("simplified");
    expect(cn.icv).toBe(3);
    expect(cn.refInvoiceNo).toBe(r.receipt.receiptNo);
    expect(cn.xml).toContain(`<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${r.receipt.receiptNo}</cbc:ID>`);
    expect(cn.xml).toContain("<cbc:InstructionNote>طلب خاطئ</cbc:InstructionNote>");
    expect(verifyInvoiceXml(cn.xml).ok).toBe(true);

    const all = await db.list("zatcaInvoices", { where: { device: DEVICE } });
    expect(brokenLink(all)).toBeNull();
    expect((await db.list("zatcaEgsUnits")).length).toBe(1);
  });

  it("a check with a buyer VAT number becomes a standard invoice for clearance (unsigned, no QR yet)", async () => {
    const [shift] = await db.list("shifts", { where: { device: DEVICE, status: "open" } });
    const c = await sale([["MIXED", 2]]);
    await db.update("checks", c.id, { taxBuyer: { name: "شركة الأمل للتموين", vatNumber: "311111111100003", address: { street: "التحلية", building: "1234", district: "السليمانية", city: "الرياض", postalCode: "12345", country: "SA" } } });
    await takePayment(db, c, { method: "card", amount: c.total, tip: 0, tendered: null });
    const r = await closeCheck(db, c.id, { shift, device: DEVICE });
    expect(r.zatca!.kind).toBe("standard");
    expect(r.zatca!.xml).toContain('name="0100000"');
    expect(r.zatca!.xml).toContain("<cbc:CompanyID>311111111100003</cbc:CompanyID>");
    expect(r.zatca!.icv).toBe(4);
  });

  it("Egypt still issues ETA e-receipts (country switch)", async () => {
    const eg = makeDb(repo, DEMO_RESTAURANT_ID, DEMO_BRANCH_ID, staffId("cashier1"));
    const shift = await openShift(eg, "EG1", major(100));
    const cats = await eg.list("menuCategories");
    const items = await eg.list("menuItems");
    const { check, order } = await openTicket(eg, { mode: "takeaway", pickup: false, tableIds: [], guests: 1, customerId: null, deliveryFee: 0, delivery: null, pickupAt: null });
    const t = (await loadTicket(eg, check.id))!;
    await addLine(eg, { orderId: order.id, checkId: check.id, items: t.items, tableId: null }, { item: items.find((i) => i.sku === "TEA")!, modifiers: [], qty: 1, notes: "", seat: null, course: 1 }, cats);
    const c = (await eg.get("checks", check.id))!;
    await takePayment(eg, c, { method: "cash", amount: c.total, tip: 0, tendered: c.total });
    const r = await closeCheck(eg, c.id, { shift, device: "EG1" });
    expect(r.receipt.etaUuid).toMatch(/^[0-9a-f]{64}$/);
    expect(r.zatca ?? null).toBeNull();
  });
});

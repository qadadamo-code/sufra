import { describe, expect, it } from "vitest";
import { buildSeed } from "@/data/seed";
import { priceItems } from "@/data/pricing";
import { freezeBill, toFinanceBill } from "./bill";
import { buildReceiptModel, type ReceiptSource } from "./model";
import { qrMatrix } from "./qr";
import { resolveDesign } from "./design";

const { data } = buildSeed(new Date("2026-10-23T20:00:00+03:00"));
const settings = data.settings[0];
const check = data.checks.find((c) => c.discount)!; // table 7: 10% discount
const order = data.orders.find((o) => o.checkId === check.id)!;
const items = data.orderItems.filter((i) => i.orderId === order.id);
const { bill } = priceItems(items, { mode: order.mode, tax: settings.tax, discount: check.discount });
const frozen = freezeBill(bill!, items);

const src = (over: Partial<ReceiptSource> = {}): ReceiptSource => ({
  kind: "SC", bill: frozen, tax: { ...settings.tax, taxId: "123-456-789" }, invoice: settings.invoice, restaurant: data.restaurants[0], branch: data.branches[0],
  receiptNo: "POS1-000007", orderNumber: order.number, issuedAt: "2026-10-23T18:30:00Z", cashier: "سارة حسني", waiter: "أحمد سمير", tableLabels: ["7"], guests: 4,
  mode: "dine_in", customer: null, payments: [{ method: "cash", amount: frozen.payable, tip: 0 }], tendered: Math.ceil(frozen.payable / 10_000_000) * 10_000_000,
  change: Math.ceil(frozen.payable / 10_000_000) * 10_000_000 - frozen.payable, eta: { uuid: "a".repeat(64), qr: "https://preprod.invoicing.eta.gov.eg/receipts/search/x" }, ...over,
});

describe("receipt model", () => {
  it("freezes and thaws a bill exactly", () => {
    const back = toFinanceBill(frozen);
    expect(back).toEqual(bill);
    expect(frozen.lines[0].name).toEqual(items[0].name);
  });

  it("shows every line, and the totals rows add up to what the guest pays", () => {
    const m = buildReceiptModel(src());
    expect(m.lines).toHaveLength(items.length);
    const total = m.totals.find((t) => t.key === "total")!.amount;
    expect(total).toBe(check.total);
    const parts = m.totals.filter((t) => t.key !== "total" && t.key !== "includes").reduce((a, t) => a + t.amount, 0);
    expect(parts).toBe(total);
    expect(m.totals.map((t) => t.key)).toEqual(["subtotal", "discount", "service", "vat", "total"]);
    expect(m.totals.find((t) => t.key === "service")!.label.en).toBe("Service 12%");
    expect(m.totals.find((t) => t.key === "vat")!.label.en).toBe("VAT 14%");
  });

  it("carries the legal and ETA blocks, and honours the designer toggles", () => {
    const m = buildReceiptModel(src());
    expect(m.legal.map((r) => r.value)).toEqual(["123-456-789", "5610"]);
    expect(m.eta?.uuid).toHaveLength(64);
    expect(m.title.en).toBe("Electronic tax receipt");
    expect(m.meta.find((r) => r.label.en === "Table")?.value).toBe("7");
    const design = resolveDesign(settings.invoice);
    const off = buildReceiptModel(src({ invoice: { ...settings.invoice, showQr: false, design: { ...design, fields: { ...design.fields, table: false, taxId: false, modifiers: false } } } }));
    expect(off.eta).toBeNull();
    expect(off.meta.find((r) => r.label.en === "Table")).toBeUndefined();
    expect(off.legal.map((r) => r.value)).toEqual(["5610"]);
    expect(off.lines.every((l) => l.modifiers.length === 0)).toBe(true);
  });

  it("pre-bills and returns are titled as such; inclusive prices show 'includes' lines", () => {
    expect(buildReceiptModel(src({ kind: "prebill", eta: null })).title.en).toMatch(/Pre-bill/);
    expect(buildReceiptModel(src({ kind: "RC", refundOf: "POS1-000003" })).meta[1].value).toBe("POS1-000003");
    const inc = buildReceiptModel(src({ tax: { ...settings.tax, priceMode: "inclusive" } }));
    expect(inc.totals.filter((t) => t.key === "includes")).toHaveLength(2);
  });

  it("encodes the ETA QR", () => {
    const q = qrMatrix("https://invoicing.eta.gov.eg/receipts/search/" + "f".repeat(64) + "/share/2026-10-23T18:30Z#Total:1234.560,IssuerRIN:123456789");
    expect(q.size).toBeGreaterThanOrEqual(41);
    expect(q.path.length).toBeGreaterThan(100);
  });
});

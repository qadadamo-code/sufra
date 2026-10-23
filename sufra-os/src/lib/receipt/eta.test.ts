import { describe, expect, it } from "vitest";
import { issueReceipt, verifyReceiptUuid } from "@finance/eta-receipt";
import { DEFAULT_PROFILE, priceBill } from "@finance/tax";
import { egp } from "@finance/money";
import { buildSeed } from "@/data/seed";
import { etaConfig, etaReadiness, issueEtaReceipt, verifyEtaUuid, webSha256Hex } from "./eta";
import { sha256 } from "@/lib/sha256";

const { data } = buildSeed(new Date("2026-10-23T20:00:00+03:00"));
const settings = { ...data.settings[0], tax: { ...data.settings[0].tax, taxId: "123456789" }, eta: { enabled: true, environment: "preprod" as const, posSerial: "SUFRA-POS-0001", tradeName: "Sufra Zamalek", branchAddress: { governate: "Cairo", regionCity: "Zamalek", street: "Brazil St", buildingNumber: "10", postalCode: "" }, splitTender: "dominant" as const, itemCodePrefix: "", credentialsConfigured: false } };
const lines = [
  { description: "كفتة / Kofta", internalCode: "ITEM-0001" },
  { description: "شاي / Tea", internalCode: "ITEM-0002" },
];
const bill = priceBill({ mode: "dine-in", lines: [{ id: "a", qty: 2, unitPrice: egp("345"), category: "grill" }, { id: "b", qty: 2, unitPrice: egp("40"), category: "bar" }] }, DEFAULT_PROFILE);
const cfg = etaConfig({ settings, restaurant: data.restaurants[0], branch: data.branches[0], internalCodes: lines.map((l) => l.internalCode) });
const at = new Date("2026-10-23T17:45:00Z");
const now = new Date("2026-10-23T18:00:00Z");

describe("ETA e-receipt in the browser", () => {
  it("WebCrypto SHA-256 matches the reference implementation", async () => {
    for (const s of ["", "abc", "سُفرة", '"HEADER""A""1"'.repeat(50)]) expect(await webSha256Hex(s)).toBe(sha256(s));
  });

  it("uuid and JSON equal sufra-finance's node issueReceipt for the same receipt", async () => {
    const input = { kind: "SC" as const, bill, profile: DEFAULT_PROFILE, lines, payments: [{ method: "card" as const, amount: bill.payable + egp("20"), tip: egp("20") }], receiptNumber: "POS1-000001", issuedAt: at, previousUUID: "" };
    const node = issueReceipt(cfg, input, now);
    const web = await issueEtaReceipt(cfg, input, now);
    expect(web.uuid).toBe(node.uuid);
    expect(web.json).toBe(node.json);
    expect(web.qr).toBe(node.qr);
    expect(verifyReceiptUuid(web.json).matches).toBe(true);
    expect((await verifyEtaUuid(node.json)).matches).toBe(true);
    // chained receipt and a return
    const second = await issueEtaReceipt(cfg, { ...input, receiptNumber: "POS1-000002", previousUUID: web.uuid }, now);
    expect(second.uuid).toBe(issueReceipt(cfg, { ...input, receiptNumber: "POS1-000002", previousUUID: node.uuid }, now).uuid);
    const ret = await issueEtaReceipt(cfg, { ...input, kind: "RC", receiptNumber: "POS1-000003", previousUUID: second.uuid, referenceUUID: web.uuid }, now);
    expect(ret.uuid).toBe(issueReceipt(cfg, { ...input, kind: "RC", receiptNumber: "POS1-000003", previousUUID: second.uuid, referenceUUID: node.uuid }, now).uuid);
    expect(JSON.parse(ret.json).header.referenceUUID).toBe(web.uuid);
  });

  it("builds the seller from settings and the QR from the portal", async () => {
    expect(cfg.seller.rin).toBe("123456789");
    expect(cfg.seller.deviceSerialNumber).toBe("SUFRA-POS-0001");
    expect(cfg.itemCodes.DELIVERY.itemCode).toBe("EG-123456789-DELIVERY");
    const r = await issueEtaReceipt(cfg, { kind: "SC", bill, profile: DEFAULT_PROFILE, lines, payments: [{ method: "cash", amount: bill.payable }], receiptNumber: "X-1", issuedAt: at, previousUUID: "" }, now);
    expect(r.qr.startsWith("https://preprod.invoicing.eta.gov.eg/receipts/search/" + r.uuid)).toBe(true);
    expect(r.qr).toContain("IssuerRIN:123456789");
  });

  it("readiness lists what ETA needs before going live", () => {
    expect(etaReadiness(data.settings[0]).missing).toEqual(["rin", "serial", "tradeName", "address"]);
    expect(etaReadiness(settings).ok).toBe(true);
  });
});

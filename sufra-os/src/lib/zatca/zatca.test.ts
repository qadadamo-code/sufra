import { describe, expect, it } from "vitest";
import { createHash, createPublicKey, createVerify, X509Certificate } from "node:crypto";
import { fromBase64, fromUtf8, toBase64, utf8 } from "./bytes";
import { decodeTlv, decodeQr, encodeTlv } from "./tlv";
import { buildCsr, demoSelfSignedCertificate, generateKeyPair, keyPairFromPem, keyPairFromSecret, parseCertificate, sec1Pem, sha256HexB64, spkiDer, verifyDer } from "./crypto";
import { FIRST_PIH, buildInvoiceTree, computeTotals, hashInput, invoiceHash, taxOf } from "./ubl";
import { signInvoice, verifyInvoiceXml } from "./sign";
import { canonical, el, parseXml, byName, find, textOf } from "./xml";
import { parseDer } from "./asn1";
import { checkInvoice, isVatNumber, missingInXml } from "./validate";
import { nextChain } from "./chain";
import type { ZatcaInvoiceInput } from "./types";

const SECRET = new Uint8Array(32).map((_, i) => i + 1);
const key = keyPairFromSecret(SECRET);
const cert = demoSelfSignedCertificate(key, { commonName: "Sufra-POS1", vatNumber: "399999999900003", serial: 4711n, now: new Date("2026-11-01T00:00:00Z") });

const seller: ZatcaInvoiceInput["seller"] = {
  name: "مطعم سُفرة – الرياض",
  vatNumber: "399999999900003",
  id: { scheme: "CRN", value: "1010101010" },
  address: { street: "طريق الملك فهد", building: "2322", additionalNo: "8228", district: "العليا", city: "الرياض", postalCode: "12241", country: "SA" },
};

const sale = (over: Partial<ZatcaInvoiceInput> = {}): ZatcaInvoiceInput => ({
  kind: "simplified",
  docType: "invoice",
  invoiceNo: "RUH1-000001",
  uuid: "3cf5ee18-ee25-44ea-a444-2c37ba7f28be",
  icv: 1,
  pih: FIRST_PIH,
  issueDate: "2026-11-03",
  issueTime: "21:15:04",
  currency: "SAR",
  seller,
  lines: [
    { id: "a", name: "كبسة لحم", qty: 1, net: 6087, vat: 913, vatRate: 1500, category: "S" }, // 70.00 incl.
    { id: "b", name: "شاي & نعناع <كبير>", qty: 2, net: 1739, vat: 261, vatRate: 1500, category: "S" }, // 2 × 10.00 incl.
  ],
  payable: 9000,
  paymentMeans: "10",
  ...over,
});

describe("QR TLV", () => {
  it("encodes tag, 1-byte length and UTF-8 value; decodes back", () => {
    const b = encodeTlv([[1, "سفرة"], [2, "399999999900003"], [8, new Uint8Array([1, 2, 3])]]);
    expect(b[0]).toBe(1);
    expect(b[1]).toBe(utf8("سفرة").length); // 8 bytes, not 4 characters
    const recs = decodeTlv(b);
    expect(recs.map((r) => r.tag)).toEqual([1, 2, 8]);
    expect(fromUtf8(recs[0].value)).toBe("سفرة");
    expect([...recs[2].value]).toEqual([1, 2, 3]);
  });
  it("matches the well-known phase-1 sample bytes", () => {
    // "Bobs Records", 310122393500003, 2022-04-25T15:30:00Z, 1000.00, 150.00 — the widely published ZATCA phase-1 example
    const qr = toBase64(encodeTlv([[1, "Bobs Records"], [2, "310122393500003"], [3, "2022-04-25T15:30:00Z"], [4, "1000.00"], [5, "150.00"]]));
    expect(qr).toBe("AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==");
  });
  it("rejects values over 255 bytes and truncated input", () => {
    expect(() => encodeTlv([[1, "x".repeat(256)]])).toThrow();
    expect(() => decodeTlv(new Uint8Array([1, 5, 65]))).toThrow();
  });
});

describe("PIH chain & ICV", () => {
  it("first PIH is the value printed in BR-KSA-26 (Base64 of hex SHA-256 of '0')", () => {
    expect(FIRST_PIH).toBe("NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==");
  });
  it("chains: each invoice's PIH is the previous invoice hash, ICV +1", () => {
    let prev = null as { icv: number; hash: string } | null;
    const hashes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = nextChain(prev);
      expect(c.icv).toBe(i + 1);
      expect(c.pih).toBe(i === 0 ? FIRST_PIH : hashes[i - 1]);
      const s = signInvoice(sale({ icv: c.icv, pih: c.pih, uuid: `3cf5ee18-ee25-44ea-a444-2c37ba7f28b${i}` }), { secretKey: key.secretKey, certificate: cert });
      hashes.push(s.hash);
      prev = { icv: c.icv, hash: s.hash };
    }
    expect(new Set(hashes).size).toBe(3);
  });
});

describe("invoice hash", () => {
  it("is SHA-256 over C14N without UBLExtensions / Signature / QR, stable across runs and signing", () => {
    const x = sale();
    const h1 = invoiceHash(buildInvoiceTree(x));
    const s1 = signInvoice(x, { secretKey: key.secretKey, certificate: cert });
    const s2 = signInvoice(x, { secretKey: key.secretKey, certificate: cert });
    expect(s1.hash).toBe(h1);
    expect(s2.hash).toBe(h1);
    expect(invoiceHash(parseXml(s1.xml))).toBe(h1); // recomputed from the signed document
    const node = createHash("sha256").update(hashInput(buildInvoiceTree(x)), "utf8").digest("base64");
    expect(node).toBe(h1);
    expect(hashInput(buildInvoiceTree(x))).not.toMatch(/UBLExtensions|cac:Signature|>QR</);
  });
  it("changes when any business field changes", () => {
    expect(invoiceHash(buildInvoiceTree(sale({ icv: 2 })))).not.toBe(invoiceHash(buildInvoiceTree(sale())));
  });
  it("canonical form: sorted attributes, escaped text, explicit end tags", () => {
    const c = canonical(el("a", { xmlns: "urn:x", z: "1", b: 'q"<' }, el("c"), "a&b>"));
    expect(c).toBe('<a xmlns="urn:x" b="q&quot;&lt;" z="1"><c></c>a&amp;b&gt;</a>');
    expect(canonical(parseXml('<?xml version="1.0"?>\n<a z="1" b="2"><c/></a>'))).toBe('<a b="2" z="1"><c></c></a>');
  });
});

describe("signature & certificates", () => {
  it("signs the invoice hash with secp256k1; node:crypto verifies it with our SPKI", () => {
    const s = signInvoice(sale(), { secretKey: key.secretKey, certificate: cert });
    const pub = createPublicKey({ key: Buffer.from(spkiDer(key.publicKey)), format: "der", type: "spki" });
    const ok = createVerify("sha256").update(Buffer.from(fromBase64(s.hash))).verify(pub, Buffer.from(fromBase64(s.signature)));
    expect(ok).toBe(true);
    expect(verifyDer(fromBase64(s.signature), fromBase64(s.hash), key.publicKey)).toBe(true);
  });
  it("verifyInvoiceXml re-derives every digest from the XML", () => {
    const s = signInvoice(sale(), { secretKey: key.secretKey, certificate: cert });
    const r = verifyInvoiceXml(s.xml);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    const tampered = s.xml.replace("<cbc:Name>كبسة لحم</cbc:Name>", "<cbc:Name>كبسة</cbc:Name>");
    expect(verifyInvoiceXml(tampered).ok).toBe(false);
  });
  it("demo certificate is valid X.509 (node parses + verifies it) and parses back", () => {
    const x = new X509Certificate(Buffer.from(fromBase64(cert)));
    expect(x.verify(x.publicKey)).toBe(true);
    const c = parseCertificate(cert);
    expect(c.serial).toBe(4711n);
    expect(c.issuerName).toBe("CN=SUFRA-DEMO-CA, O=Sufra OS DEMO (not ZATCA), C=SA");
    expect(toBase64(c.publicKey)).toBe(toBase64(key.publicKey));
    // binarySecurityToken (Base64 of the Base64 DER) is accepted too
    expect(parseCertificate(toBase64(utf8(cert))).serial).toBe(4711n);
  });
  it("CSR is valid PKCS#10 with the ZATCA subject, template and SAN", () => {
    const csr = buildCsr(key, { env: "sandbox", commonName: "Sufra-POS1", egsSerial: "1-Sufra|2-OS1|3-ed22f1d8-e6a2-1118-9b58-d9a8f11e445f", vatNumber: "399999999900003", orgUnit: "الرياض", orgName: "مطعم سُفرة", invoiceTypes: "1100", location: "RRRD2929", industry: "Restaurants" });
    expect(csr.pem).toMatch(/^-----BEGIN CERTIFICATE REQUEST-----/);
    expect(fromUtf8(fromBase64(csr.base64Pem))).toBe(csr.pem);
    // self-signature over CertificationRequestInfo verifies with node
    const der = csr.der;
    const d = parseDer(der);
    const pub = createPublicKey({ key: Buffer.from(spkiDer(key.publicKey)), format: "der", type: "spki" });
    expect(createVerify("sha256").update(Buffer.from(d.children[0].raw)).verify(pub, Buffer.from(d.children[2].body.slice(1)))).toBe(true);
    const text = Buffer.from(der).toString("latin1");
    expect(text).toContain("TSTZATCA-Code-Signing");
    expect(text).toContain("1-Sufra|2-OS1|3-ed22f1d8");
    expect(text).toContain("399999999900003");
    expect(text).toContain("1100");
  });
  it("private key round-trips through SEC1 PEM", () => {
    const k = generateKeyPair();
    expect(toBase64(keyPairFromPem(sec1Pem(k)).publicKey)).toBe(toBase64(k.publicKey));
    const nodeKey = createPublicKey({ key: sec1Pem(k), format: "pem" });
    expect(nodeKey.asymmetricKeyDetails?.namedCurve).toBe("secp256k1");
  });
});

describe("QR contents", () => {
  it("tags 1–9 for a simplified invoice; 9 is the certificate signature", () => {
    const s = signInvoice(sale(), { secretKey: key.secretKey, certificate: cert });
    const d = decodeQr(s.qr);
    expect(d.tags.map((t) => t.tag)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(d.sellerName).toBe(seller.name);
    expect(d.vatNumber).toBe("399999999900003");
    expect(d.timestamp).toBe("2026-11-03T21:15:04");
    expect(d.total).toBe("90.00");
    expect(d.vatTotal).toBe("11.74");
    expect(d.invoiceHash).toBe(s.hash);
    expect(d.signature).toBe(s.signature);
    expect(d.publicKey).toBe(toBase64(spkiDer(key.publicKey)));
    expect(d.stampSignature).toBe(toBase64(parseCertificate(cert).signature));
    expect(s.qr.length).toBeLessThanOrEqual(700);
    // the QR is also embedded in the XML
    expect(textOf(find(parseXml(s.xml), (e) => e.name === "cbc:EmbeddedDocumentBinaryObject" && e.children[0] === s.qr))).toBe(s.qr);
  });
  it("standard invoices go to clearance unsigned and without QR", () => {
    const s = signInvoice(sale({ kind: "standard", buyer: { name: "شركة الأمل", vatNumber: "311111111100003", address: { street: "التحلية", building: "1234", district: "السليمانية", city: "الرياض", postalCode: "12345", country: "SA" } } }), null);
    expect(s.qr).toBe("");
    expect(s.xml).not.toContain("UBLExtensions");
    expect(s.xml).toContain('name="0100000"');
    expect(s.xml).toContain("<cbc:ActualDeliveryDate>2026-11-03</cbc:ActualDeliveryDate>");
  });
});

describe("totals (KSA VAT 15%)", () => {
  it("document VAT is computed on the taxable total, rounding to the paid amount in BT-114", () => {
    const t = computeTotals(sale());
    expect(t.lineExtension).toBe(7826);
    expect(t.vat).toBe(taxOf(7826, 1500)); // 1173.9 → 1174
    expect(t.vat).toBe(1174);
    expect(t.taxInclusive).toBe(9000);
    expect(t.rounding).toBe(0);
    const one = computeTotals({ lines: [{ id: "x", name: "x", qty: 1, net: 869, vat: 131, vatRate: 1500, category: "S" }], payable: 1000 });
    expect(one.vat).toBe(130); // 8.69 × 15% = 1.3035 → 1.30 (not the line's 1.31)
    expect(one.rounding).toBe(1); // 9.99 + 0.01 = 10.00 paid
  });
  it("half-up rounding", () => {
    expect(taxOf(870, 1500)).toBe(131); // 1.305 → 1.31
    expect(taxOf(100, 1500)).toBe(15);
  });
});

describe("credit notes", () => {
  it("381 with billing reference and reason (BR-KSA-56 / 17)", () => {
    const x = sale({ docType: "credit", invoiceNo: "RUH1-000002", icv: 2, billingReference: { invoiceNo: "RUH1-000001", issueDate: "2026-11-03" }, reason: "مرتجع — الصنف اتلغى" });
    const s = signInvoice(x, { secretKey: key.secretKey, certificate: cert });
    const root = parseXml(s.xml);
    expect(textOf(find(root, byName("cbc:InvoiceTypeCode")))).toBe("381");
    expect(textOf(find(find(root, byName("cac:BillingReference"))!, byName("cbc:ID")))).toBe("RUH1-000001");
    expect(textOf(find(root, byName("cbc:InstructionNote")))).toBe("مرتجع — الصنف اتلغى");
    expect(checkInvoice(x)).toEqual([]);
    expect(checkInvoice({ ...x, billingReference: null, reason: "" }).map((i) => i.rule)).toEqual(["BR-KSA-56", "BR-KSA-17"]);
  });
});

describe("XML well-formedness & required fields", () => {
  it("parses back, has every required element and the KSA seller address", () => {
    const s = signInvoice(sale(), { secretKey: key.secretKey, certificate: cert });
    expect(s.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"')).toBe(true);
    expect(missingInXml(s.xml)).toEqual([]);
    expect(s.xml).toContain("<cbc:ProfileID>reporting:1.0</cbc:ProfileID>");
    expect(s.xml).toContain('<cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode>');
    expect(s.xml).toContain("شاي &amp; نعناع &lt;كبير&gt;");
    // 17.39 / 2 is not whole halalas → price for the whole quantity with BaseQuantity
    expect(s.xml).toContain('<cac:Price><cbc:PriceAmount currencyID="SAR">17.39</cbc:PriceAmount><cbc:BaseQuantity unitCode="PCE">2.000000</cbc:BaseQuantity></cac:Price>');
    expect(s.xml).toContain('<cac:Price><cbc:PriceAmount currencyID="SAR">60.87</cbc:PriceAmount></cac:Price>');
    expect(s.xml).toContain("<cbc:PlotIdentification>8228</cbc:PlotIdentification>");
  });
  it("pre-flight catches bad seller data", () => {
    expect(isVatNumber("399999999900003")).toBe(true);
    expect(isVatNumber("199999999900003")).toBe(false);
    const bad = sale({ seller: { ...seller, name: "Sufra", vatNumber: "123", address: { ...seller.address, building: "12", postalCode: "1224" } } });
    expect(checkInvoice(bad).map((i) => i.rule).sort()).toEqual(["BR-KSA-37", "BR-KSA-39", "BR-KSA-66", "VAT-IR-53"].sort());
  });
  it("certificate digest uses the SDK form (Base64 of hex SHA-256 of the Base64 text)", () => {
    const s = signInvoice(sale(), { secretKey: key.secretKey, certificate: cert });
    const root = parseXml(s.xml);
    expect(textOf(find(find(root, byName("xades:CertDigest"))!, byName("ds:DigestValue")))).toBe(sha256HexB64(utf8(cert)));
  });
});

describe("server stamping of an offline (unsigned) document", () => {
  it("stampXml yields exactly what signing at issue would, hash unchanged", async () => {
    const { stampXml } = await import("./sign");
    const x = sale();
    const unsigned = signInvoice(x, null);
    const direct = signInvoice(x, { secretKey: key.secretKey, certificate: cert });
    const stamped = stampXml(unsigned.xml, { secretKey: key.secretKey, certificate: cert });
    expect(stamped.hash).toBe(unsigned.hash);
    expect(verifyInvoiceXml(stamped.xml).checks.filter((c) => !c.ok)).toEqual([]);
    // ECDSA (RFC 6979) is deterministic → byte-identical to signing at issue time
    expect(stamped.xml).toBe(direct.xml);
    expect(() => stampXml(stamped.xml, { secretKey: key.secretKey, certificate: cert })).toThrow(/already stamped/);
  });
});

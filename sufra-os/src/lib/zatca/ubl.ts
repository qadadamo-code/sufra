/**
 * UBL 2.1 invoice tree for ZATCA (E-Invoice XML Implementation Standard v1.2), invoice hash and the PIH chain.
 *
 * Element order follows the UBL 2.1 Invoice XSD sequence; every BR-KSA rule we rely on is cited next to its element.
 * Credit and debit notes use the `Invoice` root with type codes 381/383 (§11.2.1: "The UBL Message type is 'Invoice'
 * for all document types", which is what the ZATCA SDK samples do).
 */
import { utf8 } from "./bytes";
import { sha256, sha256B64, sha256HexB64 } from "./crypto";
import { TYPE_CODE, subtypeName, type VatBreakdown, type ZatcaInvoiceInput, type ZatcaLine, type ZatcaTotals } from "./types";
import { canonical, el, type XElement } from "./xml";

export const NS = {
  invoice: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
  sig: "urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2",
  sac: "urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2",
  sbc: "urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2",
  ds: "http://www.w3.org/2000/09/xmldsig#",
  xades: "http://uri.etsi.org/01903/v1.3.2#",
} as const;

/**
 * PIH of the very first invoice of an EGS unit (BR-KSA-26): Base64 of the HEX SHA-256 of "0" — i.e. the literal string
 * "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==" printed in the standard.
 */
export const FIRST_PIH = sha256HexB64(utf8("0"));

/* ───────── amounts ───────── */

/** halalas → "12.34" */
export function sar(h: number): string {
  if (!Number.isSafeInteger(h)) throw new Error(`amount must be whole halalas: ${h}`);
  const neg = h < 0;
  const a = Math.abs(h);
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}
/** basis points → "15.00" */
export const pct = (bp: number) => sar(bp);
/** half-up (§10 Rounding) for non-negative products, in halalas */
export const taxOf = (taxable: number, bp: number) => Math.sign(taxable) * Math.floor((Math.abs(taxable) * bp + 5000) / 10000);
const qtyStr = (q: number) => {
  const t = Math.round(q * 1000);
  if (Math.abs(t / 1000 - q) > 1e-9 || t <= 0) throw new Error(`quantity ${q}: positive, ≤ 3 decimals`);
  return (t / 1000).toFixed(6);
};

/**
 * Document totals per §9.6: one VAT breakdown per (category, rate); the category VAT is computed on the document level
 * (taxable × rate, rounded half-up) — NOT the sum of rounded line VATs (§10). Any difference to what the guest paid
 * (inclusive menus) goes to PayableRoundingAmount (BT-114, BR-CO-16).
 */
export function computeTotals(x: Pick<ZatcaInvoiceInput, "lines" | "payable">): ZatcaTotals {
  const groups = new Map<string, VatBreakdown>();
  for (const l of x.lines) {
    const key = `${l.category}:${l.vatRate}`;
    const g = groups.get(key) ?? { category: l.category, rate: l.category === "S" ? l.vatRate : 0, taxable: 0, tax: 0, exemptionCode: l.exemptionCode, exemptionReason: l.exemptionReason };
    g.taxable += l.net;
    groups.set(key, g);
  }
  const breakdown = [...groups.values()].map((g) => ({ ...g, tax: g.category === "S" ? taxOf(g.taxable, g.rate) : 0 }));
  const lineExtension = x.lines.reduce((a, l) => a + l.net, 0);
  const vat = breakdown.reduce((a, g) => a + g.tax, 0);
  const taxInclusive = lineExtension + vat;
  const payable = x.payable ?? taxInclusive;
  return { lineExtension, taxExclusive: lineExtension, vat, taxInclusive, allowance: 0, rounding: payable - taxInclusive, payable, breakdown };
}

/* ───────── tree ───────── */

const amt = (name: string, h: number, cur: string) => el(name, { currencyID: cur }, sar(h));

function taxCategory(tag: "cac:TaxCategory" | "cac:ClassifiedTaxCategory", c: { category: string; rate: number; exemptionCode?: string; exemptionReason?: string }, withReason: boolean) {
  return el(
    tag,
    null,
    el("cbc:ID", tag === "cac:TaxCategory" ? { schemeAgencyID: "6", schemeID: "UN/ECE 5305" } : null, c.category),
    el("cbc:Percent", null, pct(c.category === "S" ? c.rate : 0)),
    withReason && c.category !== "S" && c.exemptionCode ? el("cbc:TaxExemptionReasonCode", null, c.exemptionCode) : null,
    withReason && c.category !== "S" && c.exemptionReason ? el("cbc:TaxExemptionReason", null, c.exemptionReason) : null,
    el("cac:TaxScheme", null, el("cbc:ID", tag === "cac:TaxCategory" ? { schemeAgencyID: "6", schemeID: "UN/ECE 5153" } : null, "VAT")),
  );
}

function address(a: Partial<ZatcaInvoiceInput["seller"]["address"]>) {
  return el(
    "cac:PostalAddress",
    null,
    a.street ? el("cbc:StreetName", null, a.street) : null,
    a.building ? el("cbc:BuildingNumber", null, a.building) : null,
    a.additionalNo ? el("cbc:PlotIdentification", null, a.additionalNo) : null,
    a.district ? el("cbc:CitySubdivisionName", null, a.district) : null,
    a.city ? el("cbc:CityName", null, a.city) : null,
    a.postalCode ? el("cbc:PostalZone", null, a.postalCode) : null,
    el("cac:Country", null, el("cbc:IdentificationCode", null, a.country || "SA")),
  );
}

function line(l: ZatcaLine, i: number, cur: string) {
  const q = Math.round(l.qty * 1000);
  // item net price (BT-146): exact when net ÷ qty is whole halalas; otherwise price for the whole quantity via BaseQuantity
  const exact = (l.net * 1000) % q === 0;
  return el(
    "cac:InvoiceLine",
    null,
    el("cbc:ID", null, String(i + 1)),
    el("cbc:InvoicedQuantity", { unitCode: "PCE" }, qtyStr(l.qty)),
    amt("cbc:LineExtensionAmount", l.net, cur),
    el("cac:TaxTotal", null, amt("cbc:TaxAmount", l.vat, cur), amt("cbc:RoundingAmount", l.net + l.vat, cur)), // KSA-11, KSA-12 (BR-KSA-51)
    el("cac:Item", null, el("cbc:Name", null, l.name), taxCategory("cac:ClassifiedTaxCategory", { category: l.category, rate: l.vatRate }, false)),
    el("cac:Price", null, amt("cbc:PriceAmount", exact ? (l.net * 1000) / q : l.net, cur), exact ? null : el("cbc:BaseQuantity", { unitCode: "PCE" }, qtyStr(l.qty))),
  );
}

export interface TreeParts {
  /** ext:UBLExtensions (signature) — first child when present */
  extensions?: XElement | null;
  /** QR Base64 → cac:AdditionalDocumentReference[ID=QR] */
  qr?: string | null;
}

/** The invoice as a tree. Without `parts` it is the form the invoice hash is computed over (minus cac:Signature). */
export function buildInvoiceTree(x: ZatcaInvoiceInput, parts: TreeParts = {}): XElement {
  const cur = x.currency;
  const t = computeTotals(x);
  const simplified = x.kind === "simplified";
  const note = x.docType !== "invoice";
  const b = x.buyer;
  const buyerParty = el(
    "cac:Party",
    null,
    b?.otherId && !b.vatNumber ? el("cac:PartyIdentification", null, el("cbc:ID", { schemeID: b.otherId.scheme }, b.otherId.value)) : null, // BR-KSA-14
    b?.address && (b.address.street || b.address.city) ? address(b.address) : null,
    b?.vatNumber ? el("cac:PartyTaxScheme", null, el("cbc:CompanyID", null, b.vatNumber), el("cac:TaxScheme", null, el("cbc:ID", null, "VAT"))) : null,
    b?.name ? el("cac:PartyLegalEntity", null, el("cbc:RegistrationName", null, b.name)) : null,
  );
  return el(
    "Invoice",
    { xmlns: NS.invoice, "xmlns:cac": NS.cac, "xmlns:cbc": NS.cbc, "xmlns:ext": NS.ext },
    parts.extensions ?? null,
    el("cbc:ProfileID", null, "reporting:1.0"), // BR-KSA-EN16931-01
    el("cbc:ID", null, x.invoiceNo),
    el("cbc:UUID", null, x.uuid), // BR-KSA-03
    el("cbc:IssueDate", null, x.issueDate),
    el("cbc:IssueTime", null, x.issueTime), // BR-KSA-70
    el("cbc:InvoiceTypeCode", { name: subtypeName(x.kind) }, TYPE_CODE[x.docType]), // BR-KSA-05/06
    x.note ? el("cbc:Note", { languageID: "ar" }, x.note) : null,
    el("cbc:DocumentCurrencyCode", null, cur),
    el("cbc:TaxCurrencyCode", null, "SAR"), // BR-KSA-68, BR-KSA-EN16931-02
    note && x.billingReference
      ? el("cac:BillingReference", null, el("cac:InvoiceDocumentReference", null, el("cbc:ID", null, x.billingReference.invoiceNo), x.billingReference.issueDate ? el("cbc:IssueDate", null, x.billingReference.issueDate) : null)) // BR-KSA-56
      : null,
    el("cac:AdditionalDocumentReference", null, el("cbc:ID", null, "ICV"), el("cbc:UUID", null, String(x.icv))), // KSA-16, BR-KSA-33/34
    el("cac:AdditionalDocumentReference", null, el("cbc:ID", null, "PIH"), el("cac:Attachment", null, el("cbc:EmbeddedDocumentBinaryObject", { mimeCode: "text/plain" }, x.pih))), // KSA-13, BR-KSA-61
    parts.qr ? el("cac:AdditionalDocumentReference", null, el("cbc:ID", null, "QR"), el("cac:Attachment", null, el("cbc:EmbeddedDocumentBinaryObject", { mimeCode: "text/plain" }, parts.qr))) : null, // KSA-14
    parts.extensions ? el("cac:Signature", null, el("cbc:ID", null, "urn:oasis:names:specification:ubl:signature:Invoice"), el("cbc:SignatureMethod", null, "urn:oasis:names:specification:ubl:dsig:enveloped:xades")) : null, // BR-KSA-28..30, 60
    el(
      "cac:AccountingSupplierParty",
      null,
      el(
        "cac:Party",
        null,
        el("cac:PartyIdentification", null, el("cbc:ID", { schemeID: x.seller.id.scheme }, x.seller.id.value)), // BR-KSA-08
        address(x.seller.address), // BR-KSA-09/37/66
        el("cac:PartyTaxScheme", null, el("cbc:CompanyID", null, x.seller.vatNumber), el("cac:TaxScheme", null, el("cbc:ID", null, "VAT"))), // BR-KSA-39/40
        el("cac:PartyLegalEntity", null, el("cbc:RegistrationName", null, x.seller.name)),
      ),
    ),
    el("cac:AccountingCustomerParty", null, buyerParty),
    !simplified || x.supplyDate ? el("cac:Delivery", null, el("cbc:ActualDeliveryDate", null, x.supplyDate ?? x.issueDate)) : null, // BR-KSA-15
    el("cac:PaymentMeans", null, el("cbc:PaymentMeansCode", null, x.paymentMeans), note && x.reason ? el("cbc:InstructionNote", null, x.reason) : null), // BR-KSA-16/17
    // BR-KSA-EN16931-08/09: one TaxTotal with subtotals + one in the accounting currency (BT-111) without
    el("cac:TaxTotal", null, amt("cbc:TaxAmount", t.vat, "SAR")),
    el(
      "cac:TaxTotal",
      null,
      amt("cbc:TaxAmount", t.vat, cur),
      t.breakdown.map((g) => el("cac:TaxSubtotal", null, amt("cbc:TaxableAmount", g.taxable, cur), amt("cbc:TaxAmount", g.tax, cur), taxCategory("cac:TaxCategory", g, true))),
    ),
    el(
      "cac:LegalMonetaryTotal",
      null,
      amt("cbc:LineExtensionAmount", t.lineExtension, cur),
      amt("cbc:TaxExclusiveAmount", t.taxExclusive, cur),
      amt("cbc:TaxInclusiveAmount", t.taxInclusive, cur),
      amt("cbc:AllowanceTotalAmount", t.allowance, cur),
      amt("cbc:PrepaidAmount", 0, cur),
      t.rounding ? amt("cbc:PayableRoundingAmount", t.rounding, cur) : null,
      amt("cbc:PayableAmount", t.payable, cur),
    ),
    x.lines.map((l, i) => line(l, i, cur)),
  );
}

/* ───────── hashing ───────── */

const dropForHash = (e: XElement) =>
  e.name === "ext:UBLExtensions" ||
  e.name === "cac:Signature" ||
  (e.name === "cac:AdditionalDocumentReference" && e.children.some((c) => typeof c !== "string" && c.name === "cbc:ID" && c.children[0] === "QR"));

/** Remove UBLExtensions, cac:Signature and the QR reference (the ds:Transforms XPaths), keep everything else. */
export function stripForHash(root: XElement): XElement {
  return { ...root, children: root.children.filter((c) => typeof c === "string" || !dropForHash(c)) };
}

/** Canonical bytes the hash is computed over (BR-KSA-26 steps 1–4). */
export const hashInput = (root: XElement) => canonical(stripForHash(root));
/** Invoice hash, Base64 of the binary SHA-256 (BR-KSA-26 steps 5–6) — goes into DigestValue, QR tag 6, the next PIH and the API body. */
export const invoiceHashBytes = (root: XElement) => sha256(utf8(hashInput(root)));
export const invoiceHash = (root: XElement) => sha256B64(utf8(hashInput(root)));

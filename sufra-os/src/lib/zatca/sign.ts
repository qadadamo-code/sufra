/**
 * Cryptographic stamp (XAdES B-B enveloped in ext:UBLExtensions) + Phase-2 QR — Security Features Implementation
 * Standards v1.2 §2.3.3 / §4, as the ZATCA SDK (`fatoora -sign -qr`) produces them:
 *
 *   invoice hash   = SHA-256(C14N11(invoice − UBLExtensions − cac:Signature − QR))           → ds:Reference[@Id=invoiceSignedData]
 *   signature      = ECDSA-secp256k1-SHA256(invoice-hash bytes), DER, Base64                   → ds:SignatureValue, QR tag 7
 *   cert digest    = Base64(HEX(SHA-256(Base64 certificate text)))                             → xades:CertDigest       (SDK quirk)
 *   props digest   = Base64(HEX(SHA-256(SignedProperties serialised detached)))                → ds:Reference[#xadesSignedProperties] (SDK quirk)
 *
 * The two "Base64 of HEX" digests and signing the hash instead of SignedInfo are SDK behaviour, not textbook XMLDSig —
 * see DESIGN.md (marked UNCONFIRMED until our XML passes `fatoora -validate` / the compliance API).
 */
import { fromBase64, toBase64, utf8 } from "./bytes";
import { parseCertificate, sha256HexB64, signDer, spkiDer, verifyDer, type CertInfo } from "./crypto";
import { decodeQr, encodeQr, QR_MAX_CHARS, type TlvValue } from "./tlv";
import { NS, buildInvoiceTree, computeTotals, invoiceHash, invoiceHashBytes, sar } from "./ubl";
import type { ZatcaInvoiceInput } from "./types";
import { attr, byName, detached, el, find, parseXml, pathTo, scopeAt, serializeDocument, textOf, type XElement } from "./xml";

const ALG = {
  c14n11: "http://www.w3.org/2006/12/xml-c14n11",
  ecdsaSha256: "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256",
  sha256: "http://www.w3.org/2001/04/xmlenc#sha256",
  xpath: "http://www.w3.org/TR/1999/REC-xpath-19991116",
  signedProps: "http://www.w3.org/2000/09/xmldsig#SignatureProperties",
} as const;

const XPATHS = ["not(//ancestor-or-self::ext:UBLExtensions)", "not(//ancestor-or-self::cac:Signature)", "not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])"];

/** "2026-11-03T21:15:04" — SigningTime / QR tag 3 style (no zone; the invoice's own AST wall time). */
export const qrTimestamp = (x: Pick<ZatcaInvoiceInput, "issueDate" | "issueTime">) => `${x.issueDate}T${x.issueTime}`;

function signedProperties(signingTime: string, cert: CertInfo, certB64: string) {
  return el(
    "xades:SignedProperties",
    { Id: "xadesSignedProperties" },
    el(
      "xades:SignedSignatureProperties",
      null,
      el("xades:SigningTime", null, signingTime),
      el(
        "xades:SigningCertificate",
        null,
        el(
          "xades:Cert",
          null,
          el("xades:CertDigest", null, el("ds:DigestMethod", { Algorithm: ALG.sha256 }), el("ds:DigestValue", null, sha256HexB64(utf8(certB64)))),
          el("xades:IssuerSerial", null, el("ds:X509IssuerName", null, cert.issuerName), el("ds:X509SerialNumber", null, cert.serial.toString(10))),
        ),
      ),
    ),
  );
}

function extensions(x: { invoiceHash: string; propsDigest: string; signature: string; certB64: string; props: XElement }) {
  return el(
    "ext:UBLExtensions",
    null,
    el(
      "ext:UBLExtension",
      null,
      el("ext:ExtensionURI", null, "urn:oasis:names:specification:ubl:dsig:enveloped:xades"),
      el(
        "ext:ExtensionContent",
        null,
        el(
          "sig:UBLDocumentSignatures",
          { "xmlns:sig": NS.sig, "xmlns:sac": NS.sac, "xmlns:sbc": NS.sbc },
          el(
            "sac:SignatureInformation",
            null,
            el("cbc:ID", null, "urn:oasis:names:specification:ubl:signature:1"),
            el("sbc:ReferencedSignatureID", null, "urn:oasis:names:specification:ubl:signature:Invoice"),
            el(
              "ds:Signature",
              { "xmlns:ds": NS.ds, Id: "signature" },
              el(
                "ds:SignedInfo",
                null,
                el("ds:CanonicalizationMethod", { Algorithm: ALG.c14n11 }),
                el("ds:SignatureMethod", { Algorithm: ALG.ecdsaSha256 }),
                el(
                  "ds:Reference",
                  { Id: "invoiceSignedData", URI: "" },
                  el("ds:Transforms", null, ...XPATHS.map((p) => el("ds:Transform", { Algorithm: ALG.xpath }, el("ds:XPath", null, p))), el("ds:Transform", { Algorithm: ALG.c14n11 })),
                  el("ds:DigestMethod", { Algorithm: ALG.sha256 }),
                  el("ds:DigestValue", null, x.invoiceHash),
                ),
                el("ds:Reference", { Type: ALG.signedProps, URI: "#xadesSignedProperties" }, el("ds:DigestMethod", { Algorithm: ALG.sha256 }), el("ds:DigestValue", null, x.propsDigest)),
              ),
              el("ds:SignatureValue", null, x.signature),
              el("ds:KeyInfo", null, el("ds:X509Data", null, el("ds:X509Certificate", null, x.certB64))),
              el("ds:Object", null, el("xades:QualifyingProperties", { "xmlns:xades": NS.xades, Target: "signature" }, x.props)),
            ),
          ),
        ),
      ),
    ),
  );
}

/** SignedProperties digest from a (complete) invoice tree — same function for signing and verifying. */
export function signedPropertiesDigest(root: XElement): string | null {
  const path = pathTo(root, byName("xades:SignedProperties"));
  if (!path) return null;
  const sp = path[path.length - 1];
  return sha256HexB64(utf8(detached(sp, scopeAt(path.slice(0, -1)))));
}

export interface QrInput {
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  /** halalas */
  total: number;
  vat: number;
  hash: string;
  signature?: string;
  publicKey?: Uint8Array;
  stampSignature?: Uint8Array | null;
}

/** Phase-2 QR (tags 1–9; 9 only for simplified). Without signature/publicKey it is the Phase-1 QR (tags 1–5) + hash. */
export function buildQr(q: QrInput): string {
  const recs: [number, TlvValue][] = [[1, q.sellerName], [2, q.vatNumber], [3, q.timestamp], [4, sar(q.total)], [5, sar(q.vat)]];
  if (q.hash) recs.push([6, q.hash]);
  if (q.signature) recs.push([7, q.signature]);
  if (q.publicKey) recs.push([8, q.publicKey]);
  if (q.stampSignature) recs.push([9, q.stampSignature]);
  const b64 = encodeQr(recs);
  if (b64.length > QR_MAX_CHARS) throw new Error(`QR is ${b64.length} characters (ZATCA maximum ${QR_MAX_CHARS})`);
  return b64;
}

/** Phase-1 QR (tags 1–5) — fallback for KSA receipts before an EGS is onboarded (catalogue §11). */
export const phase1Qr = (q: Omit<QrInput, "hash" | "signature" | "publicKey" | "stampSignature">) =>
  encodeQr([[1, q.sellerName], [2, q.vatNumber], [3, q.timestamp], [4, sar(q.total)], [5, sar(q.vat)]]);

export interface SignedInvoice {
  xml: string;
  /** invoice hash (Base64 SHA-256) — the next PIH */
  hash: string;
  signature: string;
  qr: string;
  /** Base64 of the XML — the API body's `invoice` */
  xmlBase64: string;
  totals: ReturnType<typeof computeTotals>;
}

/**
 * Sign + QR a simplified invoice (or note) — or, with `sign: false`, an unsigned standard invoice for clearance
 * (ZATCA stamps standard documents itself and returns them with the QR).
 */
export function signInvoice(x: ZatcaInvoiceInput, key: { secretKey: Uint8Array; certificate: string } | null, opts: { signingTime?: string } = {}): SignedInvoice {
  const base = buildInvoiceTree(x);
  const hashBytes = invoiceHashBytes(base);
  const hash = toBase64(hashBytes);
  const totals = computeTotals(x);
  if (!key) {
    const xml = serializeDocument(base);
    return { xml, hash, signature: "", qr: "", xmlBase64: toBase64(utf8(xml)), totals };
  }
  const cert = parseCertificate(key.certificate);
  const signature = toBase64(signDer(hashBytes, key.secretKey));
  const props = signedProperties(opts.signingTime ?? qrTimestamp(x), cert, cert.base64);
  const qr = buildQr({
    sellerName: x.seller.name,
    vatNumber: x.seller.vatNumber,
    timestamp: qrTimestamp(x),
    total: totals.taxInclusive,
    vat: totals.vat,
    hash,
    signature,
    publicKey: spkiDer(cert.publicKey),
    stampSignature: x.kind === "simplified" ? cert.signature : null,
  });
  // the props digest is computed in place (namespace context of the finished document)
  const draft = buildInvoiceTree(x, { extensions: extensions({ invoiceHash: hash, propsDigest: "", signature, certB64: cert.base64, props }), qr });
  const propsDigest = signedPropertiesDigest(draft)!;
  const root = buildInvoiceTree(x, { extensions: extensions({ invoiceHash: hash, propsDigest, signature, certB64: cert.base64, props }), qr });
  const xml = serializeDocument(root);
  return { xml, hash, signature, qr, xmlBase64: toBase64(utf8(xml)), totals };
}

/* ───────── server-side stamping of an already issued (unsigned) document ───────── */

const child = (e: XElement, name: string) => e.children.find((c): c is XElement => typeof c !== "string" && c.name === name) ?? null;
const halalasOf = (s: string) => {
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) throw new Error(`not an amount: ${s}`);
  const v = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -v : v;
};

/**
 * Stamp an unsigned simplified document that the POS built and chained offline (keys live on the server). The hashed
 * content is untouched, so the hash — and every later PIH — stays valid; UBLExtensions, the QR reference and
 * cac:Signature are inserted where the XSD wants them.
 */
export function stampXml(xml: string, key: { secretKey: Uint8Array; certificate: string }, opts: { signingTime?: string } = {}): SignedInvoice {
  const parsed = parseXml(xml);
  if (find(parsed, byName("ext:UBLExtensions"))) throw new Error("document is already stamped");
  const base = { ...parsed, children: parsed.children.filter((c) => typeof c !== "string") };
  const hashBytes = invoiceHashBytes(base);
  const hash = toBase64(hashBytes);
  const cert = parseCertificate(key.certificate);
  const signature = toBase64(signDer(hashBytes, key.secretKey));
  const issueDate = textOf(child(base, "cbc:IssueDate"));
  const issueTime = textOf(child(base, "cbc:IssueTime"));
  const kind = attr(child(base, "cbc:InvoiceTypeCode"), "name")?.startsWith("02") ? "simplified" : "standard";
  const supplier = find(base, byName("cac:AccountingSupplierParty"))!;
  const lmt = child(base, "cac:LegalMonetaryTotal")!;
  const taxTotal = base.children.find((c): c is XElement => typeof c !== "string" && c.name === "cac:TaxTotal")!;
  const total = halalasOf(textOf(child(lmt, "cbc:TaxInclusiveAmount")));
  const vat = halalasOf(textOf(child(taxTotal, "cbc:TaxAmount")));
  const qr = buildQr({
    sellerName: textOf(find(supplier, byName("cbc:RegistrationName"))),
    vatNumber: textOf(find(supplier, byName("cbc:CompanyID"))),
    timestamp: `${issueDate}T${issueTime}`,
    total, vat, hash, signature,
    publicKey: spkiDer(cert.publicKey),
    stampSignature: kind === "simplified" ? cert.signature : null,
  });
  const props = signedProperties(opts.signingTime ?? `${issueDate}T${issueTime}`, cert, cert.base64);
  const assemble = (propsDigest: string): XElement => {
    const ext = extensions({ invoiceHash: hash, propsDigest, signature, certB64: cert.base64, props });
    const kids: XElement[] = [];
    for (const c of base.children as XElement[]) {
      kids.push(c);
      if (c.name === "cac:AdditionalDocumentReference" && textOf(child(c, "cbc:ID")) === "PIH") {
        kids.push(el("cac:AdditionalDocumentReference", null, el("cbc:ID", null, "QR"), el("cac:Attachment", null, el("cbc:EmbeddedDocumentBinaryObject", { mimeCode: "text/plain" }, qr))));
        kids.push(el("cac:Signature", null, el("cbc:ID", null, "urn:oasis:names:specification:ubl:signature:Invoice"), el("cbc:SignatureMethod", null, "urn:oasis:names:specification:ubl:dsig:enveloped:xades")));
      }
    }
    return { ...base, children: [ext, ...kids] };
  };
  const root = assemble(signedPropertiesDigest(assemble(""))!);
  const out = serializeDocument(root);
  return { xml: out, hash, signature, qr, xmlBase64: toBase64(utf8(out)), totals: { lineExtension: 0, taxExclusive: 0, vat, taxInclusive: total, allowance: 0, rounding: 0, payable: total, breakdown: [] } };
}

/** QR stored in a (cleared/stamped) XML, if any. */
export function qrOfXml(xml: string): string | null {
  const root = parseXml(xml);
  const ref = find(root, (e) => e.name === "cac:AdditionalDocumentReference" && textOf(find(e, byName("cbc:ID"))) === "QR");
  return ref ? textOf(find(ref, byName("cbc:EmbeddedDocumentBinaryObject"))) || null : null;
}

/* ───────── verification (queue "verify", tests) ───────── */

export interface VerifyReport {
  ok: boolean;
  hash: string;
  checks: { id: string; ok: boolean; detail?: string }[];
}

/** Re-derives hash, signature, props digest and QR from a stored/returned XML. Does not check the CA chain. */
export function verifyInvoiceXml(xml: string): VerifyReport {
  const root = parseXml(xml);
  const hash = invoiceHash(root);
  const checks: VerifyReport["checks"] = [];
  const ref = find(root, (e) => e.name === "ds:Reference" && attr(e, "Id") === "invoiceSignedData");
  const digest = textOf(ref ? find(ref, byName("ds:DigestValue")) : null);
  const qrRef = find(root, (e) => e.name === "cac:AdditionalDocumentReference" && textOf(find(e, byName("cbc:ID"))) === "QR");
  const qr = textOf(qrRef ? find(qrRef, byName("cbc:EmbeddedDocumentBinaryObject")) : null);
  if (!ref) {
    checks.push({ id: "signed", ok: false, detail: "no cryptographic stamp (unsigned — standard invoices are stamped by ZATCA at clearance)" });
    return { ok: false, hash, checks };
  }
  checks.push({ id: "digest", ok: digest === hash, detail: digest === hash ? undefined : `DigestValue ${digest} ≠ ${hash}` });
  const certB64 = textOf(find(root, byName("ds:X509Certificate")));
  const sig = textOf(find(root, byName("ds:SignatureValue")));
  let cert: CertInfo | null = null;
  try {
    cert = parseCertificate(certB64);
  } catch (e) {
    checks.push({ id: "certificate", ok: false, detail: String((e as Error).message) });
  }
  if (cert) checks.push({ id: "signature", ok: verifyDer(fromBase64(sig), fromBase64(hash), cert.publicKey) });
  const spRef = find(root, (e) => e.name === "ds:Reference" && attr(e, "URI") === "#xadesSignedProperties");
  const spDigest = textOf(spRef ? find(spRef, byName("ds:DigestValue")) : null);
  checks.push({ id: "signedProperties", ok: spDigest === signedPropertiesDigest(root) });
  const certDigest = textOf(find(find(root, byName("xades:CertDigest")) ?? root, byName("ds:DigestValue")));
  checks.push({ id: "certDigest", ok: certDigest === sha256HexB64(utf8(certB64)) });
  if (qr) {
    const d = decodeQr(qr);
    checks.push({ id: "qrHash", ok: d.invoiceHash === hash });
    checks.push({ id: "qrSignature", ok: d.signature === sig });
    checks.push({ id: "qrPublicKey", ok: !!cert && d.publicKey === toBase64(spkiDer(cert.publicKey)) });
  } else checks.push({ id: "qr", ok: false, detail: "no QR" });
  return { ok: checks.every((c) => c.ok), hash, checks };
}

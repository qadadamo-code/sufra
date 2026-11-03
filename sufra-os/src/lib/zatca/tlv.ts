/**
 * ZATCA QR code: Base64 of Tag-Length-Value records (Security Features Implementation Standards v1.2 §4, Table 3).
 *   tag: 1 byte · length: 1 byte (unsigned) · value: UTF-8 bytes (tags 1–5; text) or raw bytes.
 * Tags: 1 seller name · 2 VAT number · 3 timestamp · 4 total with VAT · 5 VAT total · 6 invoice hash · 7 ECDSA signature ·
 * 8 ECDSA public key · 9 ZATCA CA signature over the stamp certificate (simplified invoices and their notes only).
 * The standard caps the Base64 text at 700 characters.
 */
import { concat, fromBase64, fromUtf8, toBase64, utf8 } from "./bytes";

export type TlvValue = string | Uint8Array;
export interface TlvRecord {
  tag: number;
  value: Uint8Array;
}

export function encodeTlv(records: [tag: number, value: TlvValue][]): Uint8Array {
  return concat(
    ...records.map(([tag, v]) => {
      const bytes = typeof v === "string" ? utf8(v) : v;
      if (tag < 1 || tag > 255) throw new Error(`TLV tag ${tag} out of range`);
      if (bytes.length > 255) throw new Error(`TLV tag ${tag}: value is ${bytes.length} bytes (max 255 with a 1-byte length)`);
      return concat(new Uint8Array([tag, bytes.length]), bytes);
    }),
  );
}

export function decodeTlv(buf: Uint8Array): TlvRecord[] {
  const out: TlvRecord[] = [];
  let i = 0;
  while (i < buf.length) {
    if (i + 2 > buf.length) throw new Error("truncated TLV header");
    const tag = buf[i], len = buf[i + 1];
    if (i + 2 + len > buf.length) throw new Error(`truncated TLV value for tag ${tag}`);
    out.push({ tag, value: buf.slice(i + 2, i + 2 + len) });
    i += 2 + len;
  }
  return out;
}

export const QR_MAX_CHARS = 700;

export const encodeQr = (records: [number, TlvValue][]) => toBase64(encodeTlv(records));

/** Human-readable decode of a ZATCA QR (queue "decode QR" view and tests). Binary tags (8, 9) are shown as Base64. */
export interface DecodedQr {
  sellerName?: string;
  vatNumber?: string;
  timestamp?: string;
  total?: string;
  vatTotal?: string;
  invoiceHash?: string;
  signature?: string;
  publicKey?: string;
  stampSignature?: string;
  tags: { tag: number; length: number; text: string }[];
}

const TEXT_TAGS = new Set([1, 2, 3, 4, 5, 6, 7]);
export function decodeQr(b64: string): DecodedQr {
  const recs = decodeTlv(fromBase64(b64));
  const text = (r: TlvRecord) => (TEXT_TAGS.has(r.tag) ? safeUtf8(r.value) : toBase64(r.value));
  const d: DecodedQr = { tags: recs.map((r) => ({ tag: r.tag, length: r.value.length, text: text(r) })) };
  const keys: Record<number, keyof Omit<DecodedQr, "tags">> = { 1: "sellerName", 2: "vatNumber", 3: "timestamp", 4: "total", 5: "vatTotal", 6: "invoiceHash", 7: "signature", 8: "publicKey", 9: "stampSignature" };
  for (const r of recs) if (keys[r.tag]) d[keys[r.tag]] = text(r);
  return d;
}

function safeUtf8(b: Uint8Array) {
  try {
    return fromUtf8(b);
  } catch {
    return toBase64(b);
  }
}

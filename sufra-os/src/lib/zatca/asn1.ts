/**
 * Minimal DER (X.690) writer + reader: enough for EC keys (SEC1 / SubjectPublicKeyInfo), PKCS#10 CSRs and reading the
 * X.509 certificates (CSIDs) ZATCA issues. No BER, no indefinite lengths.
 */
import { concat, fromHex, toHex, utf8 } from "./bytes";

/* ───────── writer ───────── */

function len(n: number): Uint8Array {
  if (n < 0x80) return new Uint8Array([n]);
  const b: number[] = [];
  while (n > 0) {
    b.unshift(n & 255);
    n >>>= 8;
  }
  return new Uint8Array([0x80 | b.length, ...b]);
}
export const tlv = (tag: number, body: Uint8Array) => concat(new Uint8Array([tag]), len(body.length), body);

export const seq = (...items: Uint8Array[]) => tlv(0x30, concat(...items));
export const set = (...items: Uint8Array[]) => {
  // DER: SET OF sorted by encoding
  const sorted = [...items].sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
  });
  return tlv(0x31, concat(...sorted));
};
export const ctx = (n: number, body: Uint8Array, constructed = true) => tlv((constructed ? 0xa0 : 0x80) | n, body);
export const octets = (b: Uint8Array) => tlv(0x04, b);
export const bitString = (b: Uint8Array) => tlv(0x03, concat(new Uint8Array([0]), b));
export const nul = () => new Uint8Array([0x05, 0x00]);
export const utf8Str = (s: string) => tlv(0x0c, utf8(s));
export const printable = (s: string) => {
  if (/[^A-Za-z0-9 '()+,\-./:=?]/.test(s)) throw new Error(`not a PrintableString: ${s}`);
  return tlv(0x13, utf8(s));
};
export const utcTime = (d: Date) => tlv(0x17, utf8(d.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z"));
export const generalizedTime = (d: Date) => tlv(0x18, utf8(d.toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z"));

export function int(v: number | bigint | Uint8Array): Uint8Array {
  let b: Uint8Array;
  if (v instanceof Uint8Array) b = v;
  else {
    let h = BigInt(v).toString(16);
    if (h.length % 2) h = "0" + h;
    b = fromHex(h);
  }
  let i = 0;
  while (i < b.length - 1 && b[i] === 0 && !(b[i + 1] & 0x80)) i++;
  b = b.slice(i);
  if (b[0] & 0x80) b = concat(new Uint8Array([0]), b);
  return tlv(0x02, b);
}

export function oid(dotted: string): Uint8Array {
  const p = dotted.split(".").map(Number);
  const out: number[] = [p[0] * 40 + p[1]];
  for (const n of p.slice(2)) {
    const b: number[] = [n & 0x7f];
    let x = Math.floor(n / 128);
    while (x > 0) {
      b.unshift((x & 0x7f) | 0x80);
      x = Math.floor(x / 128);
    }
    out.push(...b);
  }
  return tlv(0x06, new Uint8Array(out));
}

/* ───────── reader ───────── */

export interface Der {
  tag: number;
  /** full encoding (header + body) */
  raw: Uint8Array;
  body: Uint8Array;
  children: Der[];
}

export function readDer(buf: Uint8Array, offset = 0): { node: Der; end: number } {
  const tag = buf[offset];
  if (tag === undefined) throw new Error("DER: unexpected end");
  let l = buf[offset + 1];
  let h = 2;
  if (l & 0x80) {
    const n = l & 0x7f;
    if (n === 0 || n > 4) throw new Error("DER: unsupported length");
    l = 0;
    for (let k = 0; k < n; k++) l = (l << 8) | buf[offset + 2 + k];
    h += n;
  }
  const end = offset + h + l;
  if (end > buf.length) throw new Error("DER: length past end");
  const body = buf.slice(offset + h, end);
  const node: Der = { tag, raw: buf.slice(offset, end), body, children: [] };
  if (tag & 0x20) {
    let o = 0;
    while (o < body.length) {
      const r = readDer(body, o);
      node.children.push(r.node);
      o = r.end;
    }
  }
  return { node, end };
}
export const parseDer = (buf: Uint8Array) => readDer(buf).node;

export function oidString(d: Der): string {
  const b = d.body;
  const out = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0;
  for (let i = 1; i < b.length; i++) {
    v = v * 128 + (b[i] & 0x7f);
    if (!(b[i] & 0x80)) {
      out.push(v);
      v = 0;
    }
  }
  return out.join(".");
}
export const intValue = (d: Der): bigint => BigInt("0x" + (toHex(d.body) || "0"));
/** BIT STRING content without the unused-bits byte */
export const bits = (d: Der) => d.body.slice(1);

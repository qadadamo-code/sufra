/**
 * Byte helpers shared by the browser and the server functions (no Node Buffer, no DOM: plain Uint8Array + atob/btoa-free
 * base64 so it runs the same in Vite, Vitest/Node and Vercel functions). Keep this file free of `@/` imports: /api imports it.
 */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INV = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
export const fromUtf8 = (b: Uint8Array): string => new TextDecoder("utf-8", { fatal: true }).decode(b);

export function toBase64(b: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i < b.length) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : "=") + "=";
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[\s]/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) throw new Error("invalid base64");
  const body = clean.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < body.length; i += 4) {
    const a = B64_INV[body.charCodeAt(i)], b = B64_INV[body.charCodeAt(i + 1)];
    const c = i + 2 < body.length ? B64_INV[body.charCodeAt(i + 2)] : 0;
    const d = i + 3 < body.length ? B64_INV[body.charCodeAt(i + 3)] : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = n >> 16;
    if (i + 2 < body.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < body.length) out[o++] = n & 255;
  }
  return out;
}

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export function fromHex(h: string): Uint8Array {
  if (h.length % 2 || /[^0-9a-f]/i.test(h)) throw new Error("invalid hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** PEM armour (64-char lines). */
export const toPem = (label: string, der: Uint8Array) => `-----BEGIN ${label}-----\n${toBase64(der).replace(/(.{64})/g, "$1\n").replace(/\n$/, "")}\n-----END ${label}-----\n`;
export function fromPem(pem: string): { label: string; der: Uint8Array } {
  const m = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(pem);
  if (!m) return { label: "", der: fromBase64(pem) }; // bare base64 (ZATCA hands certificates out without armour)
  return { label: m[1], der: fromBase64(m[2]) };
}

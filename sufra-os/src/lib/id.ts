/**
 * IDs are UUIDs everywhere (Postgres `uuid` columns), so a row created offline in the browser
 * can be pushed to Supabase unchanged.
 */
export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return formatV4(b);
}

/**
 * Deterministic UUID (v4 layout) from a name, so seed rows have the same id in the browser seed and in
 * supabase/seed.sql. Not cryptographic; only for fixtures.
 */
export function seedId(name: string): string {
  const b = new Uint8Array(16);
  // four independent 32-bit FNV-1a lanes
  for (let lane = 0; lane < 4; lane++) {
    let h = 0x811c9dc5 ^ (lane * 0x9e3779b1);
    const s = `${lane}:${name}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h >>>= 0;
    b[lane * 4] = h >>> 24;
    b[lane * 4 + 1] = (h >>> 16) & 255;
    b[lane * 4 + 2] = (h >>> 8) & 255;
    b[lane * 4 + 3] = h & 255;
  }
  return formatV4(b);
}

function formatV4(b: Uint8Array) {
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Short human code (table QR codes, order numbers on tickets). */
export function shortCode(len = 6): string {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

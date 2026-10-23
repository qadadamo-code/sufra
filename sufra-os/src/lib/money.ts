/**
 * Money in Sufra OS.
 *
 * Every amount is an integer count of **units of 0.00001 of the currency** (EGP: 1 EGP = 100 000 units,
 * 1 piastre = 1 000 units) — the exact unit `sufra-finance` uses for its `bigint` Amount, and the unit of
 * every `bigint` money column in Postgres (`*_u` / `price`, `total`, …).
 *
 * In the UI and data layer we carry it as a JS `number` (`Units`): safe to 2^53 units ≈ 90 billion EGP,
 * JSON-friendly, and PostgREST returns bigint columns as numbers. Convert with `toAmount()` before handing
 * values to `@finance/*` (which uses bigint) and `fromAmount()` on the way back. Never use floats of EGP.
 */
import { divRound, type Amount } from "@finance/money";

export type Units = number;
export type Currency = "EGP" | "SAR";

export const UNITS_PER_MAJOR = 100_000;
export const UNITS_PER_MINOR = 1_000;

/** 185.5 EGP → units. Accepts strings ("185.50") to avoid float surprises. */
export function major(v: number | string): Units {
  const s = typeof v === "number" ? v.toFixed(5) : v.trim();
  const m = /^(-)?(\d+)(?:\.(\d{1,5}))?$/.exec(s);
  if (!m) throw new Error(`not an amount: ${v}`);
  const u = Number(m[2]) * UNITS_PER_MAJOR + Number((m[3] ?? "").padEnd(5, "0"));
  return m[1] ? -u : u;
}
/** piastres (or halalas) → units */
export const minor = (p: number): Units => Math.round(p) * UNITS_PER_MINOR;

export const toAmount = (u: Units): Amount => BigInt(Math.round(u));
export const fromAmount = (a: Amount): Units => {
  const n = Number(a);
  if (!Number.isSafeInteger(n)) throw new Error("amount out of range");
  return n;
};

/** Round units to whole minor units (piastres), half away from zero — what a guest sees and pays. */
export const roundMinor = (u: Units): Units => fromAmount(divRound(toAmount(u), 1000n) * 1000n);

const CUR: Record<Currency, { ar: string; en: string }> = {
  EGP: { ar: "ج.م", en: "EGP" },
  SAR: { ar: "ر.س", en: "SAR" },
};

export interface MoneyFormat {
  lang: "ar" | "en";
  currency?: Currency;
  /** drop ".00" on whole amounts (menus, tiles). Default false (bills always show piastres). */
  compact?: boolean;
  /** omit the currency label */
  bare?: boolean;
  /** show "+" for positive amounts */
  signed?: boolean;
}

/** Parts so components can style digits (mono) and currency (text) separately. */
export function moneyParts(u: Units, f: MoneyFormat): { sign: string; digits: string; currency: string } {
  const r = roundMinor(u);
  const neg = r < 0;
  const abs = Math.abs(r);
  const whole = Math.floor(abs / UNITS_PER_MAJOR);
  const frac = Math.round((abs % UNITS_PER_MAJOR) / UNITS_PER_MINOR);
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const digits = f.compact && frac === 0 ? grouped : `${grouped}.${String(frac).padStart(2, "0")}`;
  const sign = neg ? "-" : f.signed && r > 0 ? "+" : "";
  return { sign, digits, currency: f.bare ? "" : CUR[f.currency ?? "EGP"][f.lang] };
}

/**
 * Plain string. Arabic puts the currency after the number ("1,250.00 ج.م"), English before ("EGP 1,250.00").
 * Digits stay Latin in both (receipts, ETA and most Egyptian POS do the same).
 */
export function formatMoney(u: Units, f: MoneyFormat): string {
  const p = moneyParts(u, f);
  const n = `${p.sign}${p.digits}`;
  if (!p.currency) return n;
  return f.lang === "ar" ? `${n} ${p.currency}` : `${p.currency} ${n}`;
}

/** Sum without float drift (units are integers, but be explicit). */
export const sumUnits = (xs: Iterable<Units>): Units => {
  let t = 0;
  for (const x of xs) t += x;
  return t;
};

/** units × percentage given in basis points, rounded to whole units. */
export const pctOf = (u: Units, bp: number): Units => fromAmount(divRound(toAmount(u) * BigInt(bp), 10_000n));

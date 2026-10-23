/**
 * Splitting a table's bill from a guest phone. Every split is an exact partition of the payable total
 * in whole piastres (largest-remainder), so the shares of everyone at the table always add back up
 * to the bill — no "missing 0.01".
 */
import { roundMinor, UNITS_PER_MINOR, type Units } from "@/lib/money";

/** Split `total` into parts proportional to `weights`, in whole minor units; sums exactly to `total`. */
export function allocate(total: Units, weights: number[]): Units[] {
  if (!weights.length) return [];
  const sumW = weights.reduce((a, w) => a + Math.max(0, w), 0);
  const minor = Math.floor(total / UNITS_PER_MINOR);
  const dust = total - minor * UNITS_PER_MINOR; // sub-piastre remainder (should be 0 for a payable total)
  if (sumW <= 0) {
    const even = allocate(total, weights.map(() => 1));
    return even;
  }
  const raw = weights.map((w) => (minor * Math.max(0, w)) / sumW);
  const base = raw.map(Math.floor);
  let left = minor - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) base[order[k].i] += 1;
  const out = base.map((p) => p * UNITS_PER_MINOR);
  out[0] += dust;
  return out;
}

/** n equal shares (the first ones carry the extra piastres). */
export const evenShares = (total: Units, n: number): Units[] => allocate(total, Array.from({ length: Math.max(1, Math.floor(n)) }, () => 1));

export interface BillLine {
  id: string;
  qty: number;
  /** line value before service/VAT (unit incl. modifiers × qty − line discount) */
  gross: Units;
}

/**
 * "I pay for what I had": the selected quantity of each line, with service, VAT and bill discounts spread
 * proportionally. `picked` maps line id → quantity picked (0…qty).
 */
export function itemsShare(lines: BillLine[], picked: Record<string, number>, total: Units): Units {
  let mine = 0;
  let rest = 0;
  for (const l of lines) {
    const q = Math.min(l.qty, Math.max(0, picked[l.id] ?? 0));
    const part = l.qty > 0 ? (l.gross * q) / l.qty : 0;
    mine += part;
    rest += l.gross - part;
  }
  if (mine <= 0) return 0;
  if (rest <= 0) return total;
  return allocate(total, [mine, rest])[0];
}

/** Tip from a percentage in basis points (1000 = 10%), rounded to piastres. */
export const tipFor = (amount: Units, bp: number): Units => (bp > 0 ? roundMinor((amount * bp) / 10_000) : 0);

export type SplitMode = "full" | "even" | "items" | "custom";

export interface SplitInput {
  mode: SplitMode;
  /** payable total of the check */
  total: Units;
  /** already paid on the check */
  paid: Units;
  /** even: people at the table and how many shares I cover */
  people?: number;
  shares?: number;
  lines?: BillLine[];
  picked?: Record<string, number>;
  custom?: Units;
}

/** What this phone pays now (before tip), never more than what is still due. */
export function myShare(s: SplitInput): Units {
  const due = Math.max(0, s.total - s.paid);
  let v: Units;
  switch (s.mode) {
    case "full":
      v = due;
      break;
    case "even": {
      const n = Math.max(1, s.people ?? 1);
      const k = Math.min(n, Math.max(1, s.shares ?? 1));
      v = evenShares(s.total, n).slice(0, k).reduce((a, b) => a + b, 0);
      break;
    }
    case "items":
      v = itemsShare(s.lines ?? [], s.picked ?? {}, s.total);
      break;
    case "custom":
      v = roundMinor(Math.max(0, s.custom ?? 0));
      break;
  }
  return Math.min(due, v);
}

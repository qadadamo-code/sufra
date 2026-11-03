/**
 * Per-EGS-unit chain: Invoice Counter Value (KSA-16, starts at 1, never resets, never skips) and Previous Invoice Hash
 * (KSA-13; the first document of a unit carries FIRST_PIH). Every document type — simplified/standard, invoice/credit/
 * debit — advances the same chain. Rejected documents stay in the chain (ZATCA's guidance: fix and issue a new document;
 * the counter/hash chain is not rewound), so the chain is derived from the last *issued* row, whatever its status.
 */
import { FIRST_PIH } from "./ubl";

export interface ChainState {
  icv: number;
  hash: string;
}

export function nextChain(prev: ChainState | null): { icv: number; pih: string } {
  if (!prev) return { icv: 1, pih: FIRST_PIH };
  if (!Number.isSafeInteger(prev.icv) || prev.icv < 1) throw new Error(`broken chain: icv ${prev.icv}`);
  if (!prev.hash) throw new Error("broken chain: previous invoice has no hash");
  return { icv: prev.icv + 1, pih: prev.hash };
}

/** Checks a run of documents of one EGS unit (ordered by ICV) links up. Returns the first broken ICV or null. */
export function brokenLink(rows: { icv: number; pih: string; hash: string }[]): number | null {
  const sorted = [...rows].sort((a, b) => a.icv - b.icv);
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (i === 0) {
      if (r.icv === 1 && r.pih !== FIRST_PIH) return r.icv;
      continue;
    }
    const p = sorted[i - 1];
    if (r.icv !== p.icv + 1 || r.pih !== p.hash) return r.icv;
  }
  return null;
}

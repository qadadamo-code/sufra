/** In-memory evaluation of a portable Query — used by the local adapter, the offline cache and optimistic patches. */
import type { Primitive, Query } from "./repo";

type AnyRow = Record<string, unknown>;

export function matchesQuery<T>(row: T, q: Query<T> | undefined): boolean {
  if (!q) return true;
  const r = row as unknown as AnyRow;
  if (q.where) {
    for (const [k, v] of Object.entries(q.where) as [string, Primitive | Primitive[] | undefined][]) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        if (!v.includes(r[k] as Primitive)) return false;
      } else if ((r[k] ?? null) !== v) return false;
    }
  }
  if (q.contains) {
    for (const [k, v] of Object.entries(q.contains)) {
      if (v === undefined) continue;
      const arr = r[k];
      if (!Array.isArray(arr) || !arr.includes(v)) return false;
    }
  }
  if (q.gte) for (const [k, v] of Object.entries(q.gte)) if (v !== undefined && !((r[k] as string | number) >= (v as string | number))) return false;
  if (q.lte) for (const [k, v] of Object.entries(q.lte)) if (v !== undefined && !((r[k] as string | number) <= (v as string | number))) return false;
  return true;
}

export function sortRows<T>(rows: T[], q: Query<T> | undefined): T[] {
  const order = q?.orderBy;
  if (!order?.length) return rows;
  return [...rows].sort((a, b) => {
    for (const o of order) {
      const av = (a as AnyRow)[o.field] as string | number | null;
      const bv = (b as AnyRow)[o.field] as string | number | null;
      if (av === bv) continue;
      const c = av === null ? -1 : bv === null ? 1 : av < bv ? -1 : 1;
      return o.dir === "desc" ? -c : c;
    }
    return 0;
  });
}

export function runQuery<T>(rows: Iterable<T>, q: Query<T> | undefined): T[] {
  const out: T[] = [];
  for (const r of rows) if (matchesQuery(r, q)) out.push(r);
  const sorted = sortRows(out, q);
  return q?.limit ? sorted.slice(0, q.limit) : sorted;
}

/** Apply one change to a cached result set (optimistic updates in useLive). */
export function applyChange<T extends { id: string }>(rows: T[], type: "insert" | "update" | "delete", id: string, row: T | undefined, q: Query<T> | undefined): T[] {
  const idx = rows.findIndex((r) => r.id === id);
  if (type === "delete" || !row || !matchesQuery(row, q)) {
    return idx === -1 ? rows : rows.filter((r) => r.id !== id);
  }
  const next = idx === -1 ? [...rows, row] : rows.map((r, i) => (i === idx ? row : r));
  const sorted = sortRows(next, q);
  return q?.limit ? sorted.slice(0, q.limit) : sorted;
}

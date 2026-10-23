import { computeGroups, type TableGroup } from "./layout";
import type { Check, CheckLine, ManualLink, MenuItem, Table } from "./types";

export type IdGen = () => string;

export const isActive = (c: Check) => c.status === "open" || c.status === "bill_requested";

export function checkForTable(checks: Check[], tableId: string) {
  return checks.find((c) => isActive(c) && c.tableIds.includes(tableId)) ?? null;
}

export function checkTotal(c: Check) {
  return c.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
}

export function openCheck(checks: Check[], tableIds: string[], guests: number, now: number, newId: IdGen, reservationId: string | null = null): Check[] {
  if (tableIds.some((t) => checkForTable(checks, t))) throw new Error("table already has an open bill");
  return [...checks, { id: newId(), tableIds, lines: [], guests, openedAt: now, status: "open", reservationId }];
}

export function addItem(checks: Check[], checkId: string, item: MenuItem, tableId: string, newId: IdGen): Check[] {
  return checks.map((c) => {
    if (c.id !== checkId) return c;
    const same = c.lines.find((l) => l.itemId === item.id && l.originTableId === tableId && l.unitPrice === item.price);
    const lines: CheckLine[] = same
      ? c.lines.map((l) => (l === same ? { ...l, qty: l.qty + 1 } : l))
      : [...c.lines, { id: newId(), itemId: item.id, qty: 1, unitPrice: item.price, originTableId: tableId }];
    return { ...c, lines, status: c.status === "bill_requested" ? "open" : c.status };
  });
}

export function setStatus(checks: Check[], checkId: string, status: Check["status"]): Check[] {
  return checks.map((c) => (c.id === checkId ? { ...c, status } : c));
}

export interface MergeOutcome {
  checks: Check[];
  targetId: string | null;
  absorbed: string[];
}

/**
 * Folds every open bill on `tableIds` into the one opened first, and makes
 * that bill cover all of `tableIds`. Lines keep the table they were ordered
 * from, so the merge can be undone table by table.
 */
export function mergeChecks(checks: Check[], tableIds: string[]): MergeOutcome {
  const involved = checks.filter((c) => isActive(c) && c.tableIds.some((t) => tableIds.includes(t))).sort((a, b) => a.openedAt - b.openedAt);
  if (involved.length === 0) return { checks, targetId: null, absorbed: [] };
  const [target, ...rest] = involved;
  const cover = [...target.tableIds];
  for (const c of rest) for (const t of c.tableIds) if (!cover.includes(t)) cover.push(t);
  for (const t of tableIds) if (!cover.includes(t)) cover.push(t);
  const merged: Check = {
    ...target,
    tableIds: cover,
    lines: [...target.lines, ...rest.flatMap((c) => c.lines)],
    guests: involved.reduce((s, c) => s + c.guests, 0),
    status: involved.some((c) => c.status === "open") ? "open" : target.status,
  };
  const restIds = new Set(rest.map((c) => c.id));
  return {
    checks: checks.filter((c) => !restIds.has(c.id)).map((c) => (c.id === target.id ? merged : c)),
    targetId: target.id,
    absorbed: rest.map((c) => c.id),
  };
}

/**
 * Undoes a merge: every table gets back the lines that were ordered from it.
 * The primary table keeps the original bill id. Tables with nothing ordered
 * are released rather than given an empty bill.
 */
export function splitCheck(checks: Check[], checkId: string, newId: IdGen): Check[] {
  const c = checks.find((x) => x.id === checkId);
  if (!c || c.tableIds.length < 2 || !isActive(c)) return checks;
  const [primary, ...others] = c.tableIds;
  const byTable = new Map<string, CheckLine[]>();
  for (const l of c.lines) {
    const t = others.includes(l.originTableId) ? l.originTableId : primary;
    byTable.set(t, [...(byTable.get(t) ?? []), l]);
  }
  const occupied = others.filter((t) => byTable.has(t));
  const share = Math.max(1, Math.floor(c.guests / (occupied.length + 1)));
  const spawned: Check[] = occupied.map((t) => ({
    id: newId(),
    tableIds: [t],
    lines: byTable.get(t)!,
    guests: share,
    openedAt: c.openedAt,
    status: "open",
    reservationId: null,
  }));
  const kept: Check = {
    ...c,
    tableIds: [primary],
    lines: byTable.get(primary) ?? [],
    guests: Math.max(1, c.guests - share * spawned.length),
  };
  return [...checks.map((x) => (x.id === c.id ? kept : x)), ...spawned];
}

/** Moves a bill from one table to another; joins the bill already there, if any. */
export function transferTable(checks: Check[], checkId: string, from: string, to: string): Check[] {
  const c = checks.find((x) => x.id === checkId);
  if (!c || !c.tableIds.includes(from) || from === to) return checks;
  const moved: Check = {
    ...c,
    tableIds: c.tableIds.includes(to) ? c.tableIds.filter((t) => t !== from) : c.tableIds.map((t) => (t === from ? to : t)),
    lines: c.lines.map((l) => (l.originTableId === from ? { ...l, originTableId: to } : l)),
  };
  const next = checks.map((x) => (x.id === checkId ? moved : x));
  const there = checkForTable(
    next.filter((x) => x.id !== checkId),
    to,
  );
  return there ? mergeChecks(next, [to]).checks : next;
}

export interface ReconcileOutcome {
  checks: Check[];
  merges: Array<{ targetId: string; absorbed: string[]; tableIds: string[] }>;
  /** Bills that still cover tables which are no longer together. */
  separated: string[];
  groups: TableGroup[];
}

/**
 * Called after the floor changes. A newly formed contact between two tables
 * merges their bills; contacts that already existed are left alone so a
 * deliberate split is not undone behind the cashier's back.
 */
export function reconcile(tables: Table[], links: ManualLink[], checks: Check[], prevEdges: Set<string>, nextEdges: Set<string>): ReconcileOutcome {
  const groups = computeGroups(tables, links, nextEdges);
  const fresh = [...nextEdges].filter((e) => !prevEdges.has(e));
  const merges: ReconcileOutcome["merges"] = [];
  let out = checks;
  for (const g of groups) {
    if (!fresh.some((e) => e.split("|").every((x) => g.tableIds.includes(x)))) continue;
    const r = mergeChecks(out, g.tableIds);
    if (r.targetId) {
      out = r.checks;
      merges.push({ targetId: r.targetId, absorbed: r.absorbed, tableIds: g.tableIds });
    }
  }
  const separated = out
    .filter((c) => isActive(c) && c.tableIds.length > 1)
    .filter((c) => {
      const g = groups.find((x) => x.tableIds.includes(c.tableIds[0]));
      return !g || !c.tableIds.every((t) => g.tableIds.includes(t));
    })
    .map((c) => c.id);
  return { checks: out, merges, separated, groups };
}

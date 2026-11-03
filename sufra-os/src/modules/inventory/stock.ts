/**
 * Stock operations on top of the Repo: every change goes through `applyMoves`, which updates the (item, location)
 * position at weighted-average cost and appends a `stockMoves` row. Waste, transfers, production and counts are thin
 * layers over it; each posts its ledger entry through ./posting.
 */
import type { Db } from "@/data/hooks";
import type { CountLine, MoveKind, Recipe, StockAccount, StockCount, StockItem, StockLevel, StockMove, StockTransfer, WasteReason } from "@/data/types";
import { seedId, uuid } from "@/lib/id";
import { nowIso } from "@/lib/time";
import type { Units } from "@/lib/money";
import { avgCost, consume, countTo, grossQty, receive, type Position } from "./costing";
import { addTo, postCountVariance, postWasteCost, type ByAccount } from "./posting";
import { q3 } from "./units";

export const levelId = (restaurantId: string, locationId: string, itemId: string) => seedId(`stock-level:${restaurantId}:${locationId}:${itemId}`);

export interface MoveInput {
  itemId: string;
  locationId: string;
  branchId: string;
  kind: MoveKind;
  /** signed: + into stock, − out of stock (ignored for count_adjust → use `counted`) */
  qty: number;
  /** goods in: total net value of what came in (receive / transfer_in / production_in). Missing = average / last cost. */
  value?: Units;
  /** count_adjust: the counted quantity to set */
  counted?: number;
  refType?: string | null;
  refId?: string | null;
  groupId?: string | null;
  reason?: WasteReason | null;
  note?: string;
  photo?: string | null;
  batchId?: string | null;
  at?: string;
}

/** Applies moves in order, keeping one cached position per (item, location). Returns the written move rows. */
export async function applyMoves(db: Db, moves: MoveInput[], cache?: { items?: Map<string, StockItem> }): Promise<StockMove[]> {
  const items = cache?.items ?? new Map((await db.list("stockItems")).map((i) => [i.id, i]));
  const levels = new Map<string, StockLevel | Omit<StockLevel, "createdAt" | "updatedAt">>();
  const touched = new Set<string>();
  const out: StockMove[] = [];
  const at0 = nowIso();
  for (const m of moves) {
    const lid = levelId(db.restaurantId, m.locationId, m.itemId);
    let lv = levels.get(lid);
    if (!lv) {
      const got = await db.get("stockLevels", lid);
      lv = got ?? { id: lid, restaurantId: db.restaurantId, branchId: m.branchId, locationId: m.locationId, itemId: m.itemId, qty: 0, value: 0, lastCountAt: null, lastMoveAt: null };
      levels.set(lid, lv);
    }
    const item = items.get(m.itemId);
    const fallback = item?.lastCost ?? 0;
    const pos: Position = { qty: lv.qty, value: lv.value };
    let next: Position;
    let qty: number;
    let value: Units;
    if (m.kind === "count_adjust") {
      const r = countTo(pos, m.counted ?? pos.qty, fallback);
      next = r.position;
      qty = r.qty;
      value = r.value;
      if (qty === 0) {
        levels.set(lid, { ...lv, lastCountAt: m.at ?? at0 });
        touched.add(lid);
        continue;
      }
    } else if (m.qty > 0) {
      const inValue = m.value ?? Math.round(m.qty * (avgCost(pos) ?? fallback));
      next = receive(pos, m.qty, Math.max(0, inValue));
      qty = q3(m.qty);
      value = Math.max(0, inValue);
    } else if (m.qty < 0) {
      const r = consume(pos, -m.qty, fallback);
      next = r.position;
      qty = q3(m.qty);
      value = -r.value;
    } else continue;
    const at = m.at ?? at0;
    levels.set(lid, { ...lv, qty: next.qty, value: next.value, lastMoveAt: at, ...(m.kind === "count_adjust" ? { lastCountAt: at } : {}) });
    touched.add(lid);
    const row = await db.insert("stockMoves", {
      branchId: m.branchId, locationId: m.locationId, itemId: m.itemId, kind: m.kind, qty, value, unitCost: qty ? Math.round(Math.abs(value / qty)) : 0,
      refType: m.refType ?? null, refId: m.refId ?? null, groupId: m.groupId ?? null, reason: m.reason ?? null, note: m.note ?? "", photo: m.photo ?? null, batchId: m.batchId ?? null,
      at, by: db.actorId,
    });
    out.push(row);
  }
  for (const lid of touched) {
    const lv = levels.get(lid)!;
    const exists = "createdAt" in lv;
    if (exists) await db.update("stockLevels", lid, { qty: lv.qty, value: lv.value, lastMoveAt: lv.lastMoveAt, lastCountAt: lv.lastCountAt });
    else await db.insert("stockLevels", { ...(lv as Omit<StockLevel, "createdAt" | "updatedAt" | "restaurantId">), id: lid });
  }
  return out;
}

/** Value that left stock, split by the item's account (for the cost-of-sales / waste entry). */
export function valueByAccount(moves: Pick<StockMove, "itemId" | "value">[], items: Map<string, StockItem>, sign: 1 | -1 = -1): ByAccount {
  const m: ByAccount = {};
  for (const x of moves) addTo(m, (items.get(x.itemId)?.account ?? "food") as StockAccount, sign * x.value);
  return m;
}

/* ───────── waste / staff meals ───────── */

export async function recordWaste(db: Db, w: { itemId: string; locationId: string; branchId: string; qty: number; reason: WasteReason; note?: string; photo?: string | null }) {
  if (!(w.qty > 0)) throw new Error("quantity must be positive");
  const items = new Map((await db.list("stockItems")).map((i) => [i.id, i]));
  const groupId = uuid();
  const staff = w.reason === "staff_meal";
  const moves = await applyMoves(db, [{ ...w, qty: -w.qty, kind: staff ? "staff_meal" : "waste", groupId, refType: "waste", refId: groupId }], { items });
  await postWasteCost(db, { id: groupId, branchId: w.branchId, cost: valueByAccount(moves, items), staffMeal: staff, reason: w.reason });
  await db.audit("stock.waste", "stockMoves", moves[0]?.id ?? null, { item: w.itemId, qty: w.qty, reason: w.reason });
  return moves[0] ?? null;
}

/* ───────── transfers (between locations or branches) ───────── */

export async function requestTransfer(db: Db, t: Pick<StockTransfer, "fromBranchId" | "fromLocationId" | "toBranchId" | "toLocationId" | "note"> & { lines: { itemId: string; qty: number }[] }) {
  if (t.fromLocationId === t.toLocationId) throw new Error("pick two different locations");
  const lines = t.lines.filter((l) => l.qty > 0).map((l) => ({ itemId: l.itemId, qty: q3(l.qty), unitCost: 0 }));
  if (!lines.length) throw new Error("nothing to transfer");
  return db.insert("stockTransfers", { ...t, lines, status: "requested", requestedBy: db.actorId, sentAt: null, receivedAt: null });
}

/** Dispatch: stock leaves the source at its average cost (the value travels with it). */
export async function sendTransfer(db: Db, transferId: string) {
  const t = await db.get("stockTransfers", transferId);
  if (!t || t.status !== "requested") throw new Error("transfer is not waiting to be sent");
  const moves = await applyMoves(db, t.lines.map((l) => ({ itemId: l.itemId, locationId: t.fromLocationId, branchId: t.fromBranchId, kind: "transfer_out" as const, qty: -l.qty, refType: "transfer", refId: t.id, groupId: t.id })));
  const lines = t.lines.map((l) => {
    const mv = moves.find((m) => m.itemId === l.itemId);
    return { ...l, unitCost: mv ? mv.unitCost : 0 };
  });
  return db.update("stockTransfers", t.id, { status: "sent", sentAt: nowIso(), lines });
}

export async function receiveTransfer(db: Db, transferId: string) {
  const t = await db.get("stockTransfers", transferId);
  if (!t || t.status !== "sent") throw new Error("transfer is not on its way");
  await applyMoves(db, t.lines.map((l) => ({ itemId: l.itemId, locationId: t.toLocationId, branchId: t.toBranchId, kind: "transfer_in" as const, qty: l.qty, value: Math.round(l.qty * l.unitCost), refType: "transfer", refId: t.id, groupId: t.id })));
  return db.update("stockTransfers", t.id, { status: "received", receivedAt: nowIso() });
}

/** Same-branch move (kitchen ↔ store): request + send + receive in one go. */
export async function moveNow(db: Db, t: Parameters<typeof requestTransfer>[1]) {
  const r = await requestTransfer(db, t);
  await sendTransfer(db, r.id);
  return receiveTransfer(db, r.id);
}

/* ───────── production of prep items (sub-recipes) ───────── */

/**
 * Makes `batches` × the prep recipe at a location: ingredients out at average cost, the prep item in at exactly that
 * value (so a batch of tahini sauce costs what went into it). Returns the produced quantity.
 */
export async function produce(db: Db, p: { prepItemId: string; batches: number; locationId: string; branchId: string; note?: string }) {
  if (!(p.batches > 0)) throw new Error("batches must be positive");
  const [recipe] = await db.list("recipes", { where: { ownerType: "prep", ownerId: p.prepItemId } });
  if (!recipe || !recipe.lines.length) throw new Error("this prep item has no recipe");
  const items = new Map((await db.list("stockItems")).map((i) => [i.id, i]));
  const groupId = uuid();
  const outs = await applyMoves(
    db,
    recipe.lines.map((l) => ({ itemId: l.itemId, locationId: p.locationId, branchId: p.branchId, kind: "production_out" as const, qty: -q3(grossQty(l, items.get(l.itemId)) * p.batches), refType: "production", refId: groupId, groupId })),
    { items },
  );
  const value = -outs.reduce((a, m) => a + m.value, 0);
  const qty = q3(recipe.yieldQty * p.batches);
  const [made] = await applyMoves(db, [{ itemId: p.prepItemId, locationId: p.locationId, branchId: p.branchId, kind: "production_in", qty, value, refType: "production", refId: groupId, groupId, note: p.note }], { items });
  await db.audit("stock.produce", "stockMoves", made?.id ?? null, { item: p.prepItemId, batches: p.batches, qty, value });
  return { qty, value, groupId };
}

/* ───────── stock counts ───────── */

/** Freezes what the system expects for each (item, location) in scope. Blind counts hide `expected` from the counter. */
export async function startCount(db: Db, c: { branchId: string; locationId: string | null; kind: "full" | "partial"; blind: boolean; itemIds?: string[]; note?: string }): Promise<StockCount> {
  const items = (await db.list("stockItems", { where: { active: true } })).filter((i) => c.kind === "full" || !c.itemIds || c.itemIds.includes(i.id));
  const locations = (await db.list("storageLocations", { where: { branchId: c.branchId, active: true } })).filter((l) => !c.locationId || l.id === c.locationId);
  const levels = await db.list("stockLevels", { where: { branchId: c.branchId } });
  const lines: CountLine[] = [];
  for (const loc of locations)
    for (const it of items) {
      const lv = levels.find((x) => x.locationId === loc.id && x.itemId === it.id);
      // a location only lists what it holds (or is the item's home); a full count of the store lists everything stored there
      if (!lv && !it.defaultLocationIds.includes(loc.id)) continue;
      lines.push({ itemId: it.id, locationId: loc.id, expected: lv?.qty ?? 0, counted: null, unitCost: (lv && avgCost(lv)) ?? it.lastCost });
    }
  return db.insert("stockCounts", {
    branchId: c.branchId, locationId: c.locationId, kind: c.kind, blind: c.blind, status: "open", lines, startedBy: db.actorId, startedAt: nowIso(),
    submittedAt: null, approvedBy: null, approvedAt: null, varianceValue: 0, note: c.note ?? "",
  });
}

export const lineVariance = (l: CountLine) => (l.counted == null ? 0 : q3(l.counted - l.expected));
export const lineVarianceValue = (l: CountLine) => Math.round(lineVariance(l) * l.unitCost);
export const countVarianceValue = (lines: CountLine[]) => lines.reduce((a, l) => a + lineVarianceValue(l), 0);

export async function saveCountLine(db: Db, countId: string, itemId: string, locationId: string, counted: number | null) {
  const c = await db.get("stockCounts", countId);
  if (!c || c.status !== "open") throw new Error("count is closed");
  const lines = c.lines.map((l) => (l.itemId === itemId && l.locationId === locationId ? { ...l, counted: counted == null ? null : q3(Math.max(0, counted)) } : l));
  return db.update("stockCounts", countId, { lines, varianceValue: countVarianceValue(lines) });
}

export async function submitCount(db: Db, countId: string) {
  const c = await db.get("stockCounts", countId);
  if (!c || c.status !== "open") throw new Error("count is not open");
  // uncounted lines on a partial count are left alone; on a full count an empty line means "none left"
  const lines = c.kind === "full" ? c.lines.map((l) => ({ ...l, counted: l.counted ?? 0 })) : c.lines;
  return db.update("stockCounts", countId, { status: "submitted", submittedAt: nowIso(), lines, varianceValue: countVarianceValue(lines) });
}

/**
 * Approve → adjustment moves + one variance journal. Sales/receipts that happened WHILE counting are kept: the position
 * is set to counted + (movement since the count started), not overwritten with the counted figure.
 */
export async function approveCount(db: Db, countId: string, approvedBy: string | null) {
  const c = await db.get("stockCounts", countId);
  if (!c || c.status !== "submitted") throw new Error("count is not submitted");
  const items = new Map((await db.list("stockItems")).map((i) => [i.id, i]));
  const levels = await db.list("stockLevels", { where: { branchId: c.branchId } });
  const inputs: MoveInput[] = [];
  for (const l of c.lines) {
    if (l.counted == null) continue;
    const lv = levels.find((x) => x.locationId === l.locationId && x.itemId === l.itemId);
    const now = lv?.qty ?? 0;
    const target = q3(l.counted + (now - l.expected));
    if (target === now) continue;
    inputs.push({ itemId: l.itemId, locationId: l.locationId, branchId: c.branchId, kind: "count_adjust", qty: 0, counted: target, refType: "count", refId: c.id, groupId: c.id });
  }
  const moves = await applyMoves(db, inputs, { items });
  const byAcc = valueByAccount(moves, items, 1);
  await postCountVariance(db, { id: c.id, branchId: c.branchId, value: byAcc });
  const varianceValue = moves.reduce((a, m) => a + m.value, 0);
  const row = await db.update("stockCounts", c.id, { status: "approved", approvedBy: approvedBy ?? db.actorId, approvedAt: nowIso(), varianceValue });
  await db.audit("stock.count.approve", "stockCounts", c.id, { lines: moves.length, variance: varianceValue }, approvedBy);
  return row;
}

/* ───────── helpers for screens ───────── */

export function onHandBy(levels: Pick<StockLevel, "itemId" | "qty" | "value" | "branchId" | "locationId">[], f: { branchId?: string | null; locationId?: string | null } = {}) {
  const m = new Map<string, Position>();
  for (const l of levels) {
    if (f.branchId && l.branchId !== f.branchId) continue;
    if (f.locationId && l.locationId !== f.locationId) continue;
    const p = m.get(l.itemId) ?? { qty: 0, value: 0 };
    m.set(l.itemId, { qty: q3(p.qty + l.qty), value: p.value + l.value });
  }
  return m;
}

export const recipeOf = (recipes: Recipe[], ownerType: Recipe["ownerType"], ownerId: string) => recipes.find((r) => r.ownerType === ownerType && r.ownerId === ownerId) ?? null;

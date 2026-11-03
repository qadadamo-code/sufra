/**
 * Costing — pure functions, no I/O.
 *
 *  - Stock is valued at MOVING WEIGHTED-AVERAGE cost (EAS 2 / IAS 2). The arithmetic is sufra-finance `applyMove`
 *    (bigint, no drift) run on integer milli-base-units, so 0.5 g of saffron is still exact.
 *  - Recipe cost = Σ ingredient qty × cost per base unit, grossed up for trim yield and cooking loss. Prep items
 *    (sub-recipes: sauces, doughs) cost their own recipe ÷ yield, recursively. Modifiers add their own recipe.
 *  - Food cost % and margin are on the NET price (VAT and service excluded — inclusive menus have VAT removed).
 */
import { applyMove, type StockItem as FinStock } from "@finance/inventory";
import { divRound } from "@finance/money";
import type { Recipe, RecipeLine, StockItem } from "@/data/types";
import { fromAmount, toAmount, type Units } from "@/lib/money";
import { fromMilli, q3, toMilli } from "./units";

/* ───────── weighted average on one stock position ───────── */

export interface Position {
  qty: number;
  value: Units;
}

const fin = (p: Position): FinStock => ({ id: "x", name: "x", unit: "g", qty: toMilli(p.qty), value: toAmount(p.value) });
const back = (s: FinStock): Position => ({ qty: q3(fromMilli(s.qty)), value: fromAmount(s.value) });

/** Average cost per ONE base unit (null when nothing is on hand). */
export function avgCost(p: Position): Units | null {
  if (p.qty <= 0) return null;
  // value ÷ milli-units × 1000 → per base unit, rounded once (same divRound as finance averageCost)
  return fromAmount(divRound(toAmount(p.value) * 1000n, BigInt(toMilli(p.qty))));
}

/** Goods in at `cost` (net purchase value, excl. recoverable VAT). The new average blends in by value. */
export function receive(p: Position, qty: number, cost: Units): Position {
  if (qty <= 0 || cost < 0) throw new Error("invalid receipt");
  if (p.qty < 0) {
    // stock was negative (sold before the delivery was booked): the receipt first covers the hole
    return { qty: q3(p.qty + qty), value: p.value + cost };
  }
  return back(applyMove(fin(p), { kind: "receive", itemId: "x", qty: toMilli(qty), cost: toAmount(cost) }).item);
}

/**
 * Goods out at the current average. Taking everything takes the whole value (no rounding residue).
 * Selling more than is on hand is allowed (the kitchen never waits for paperwork): the extra goes out at `fallbackCost`
 * (last purchase cost) and the position goes negative until the next receipt or count.
 */
export function consume(p: Position, qty: number, fallbackCost: Units): { position: Position; value: Units } {
  if (qty <= 0) throw new Error("invalid quantity");
  if (p.qty > 0 && qty <= p.qty) {
    const r = applyMove(fin(p), { kind: "consume", itemId: "x", qty: toMilli(qty), reason: "sale" });
    return { position: back(r.item), value: fromAmount(r.value) };
  }
  const fromStock = Math.max(0, p.qty);
  const extra = q3(qty - fromStock);
  const unit = p.qty > 0 ? (avgCost(p) ?? fallbackCost) : p.qty < 0 && p.value < 0 ? Math.round(p.value / p.qty) : fallbackCost;
  const extraValue = Math.round(extra * unit);
  const stockValue = fromStock > 0 ? p.value : 0;
  const value = stockValue + extraValue;
  return { position: { qty: q3(p.qty - qty), value: p.value - value }, value };
}

/** Stock count: the difference is valued at the current average (or `fallbackCost` when nothing was on hand). */
export function countTo(p: Position, counted: number, fallbackCost: Units): { position: Position; qty: number; value: Units } {
  const diff = q3(counted - p.qty);
  if (diff === 0) return { position: p, qty: 0, value: 0 };
  if (diff < 0) {
    const r = consume(p, -diff, fallbackCost);
    return { position: r.position, qty: diff, value: -r.value };
  }
  if (p.qty > 0) {
    const r = applyMove(fin(p), { kind: "count", itemId: "x", counted: toMilli(counted) });
    return { position: back(r.item), qty: diff, value: fromAmount(r.value) };
  }
  // was empty / negative: the found stock is valued at the last cost
  const unit = fallbackCost;
  const target = Math.round(Math.max(0, counted) * unit);
  return { position: { qty: q3(counted), value: target }, qty: diff, value: target - p.value };
}

/* ───────── recipes ───────── */

export interface CostContext {
  items: Map<string, StockItem>;
  /** prep item id → its recipe */
  prepRecipes: Map<string, Recipe>;
  /** current average cost per base unit by item (falls back to lastCost) */
  unitCost: (itemId: string) => Units;
}

/** Quantity that actually leaves stock for a recipe line (trim yield + cooking loss grossed up). */
export function grossQty(line: RecipeLine, item: Pick<StockItem, "yieldBp"> | undefined): number {
  const loss = 1 + (line.lossBp ?? 0) / 10_000;
  const yieldF = item && item.yieldBp > 0 && item.yieldBp < 10_000 ? item.yieldBp / 10_000 : 1;
  return q3((line.qty * loss) / yieldF);
}

/** Cost per base unit of a prep item from its own recipe (recursive), else its stock cost. */
export function prepUnitCost(itemId: string, ctx: CostContext, seen: Set<string> = new Set()): Units {
  const r = ctx.prepRecipes.get(itemId);
  if (!r || !r.lines.length || r.yieldQty <= 0 || seen.has(itemId)) return ctx.unitCost(itemId);
  seen.add(itemId);
  const batch = linesCost(r.lines, ctx, seen);
  seen.delete(itemId);
  return Math.round(batch / r.yieldQty);
}

export function lineCost(line: RecipeLine, ctx: CostContext, seen: Set<string> = new Set()): Units {
  const item = ctx.items.get(line.itemId);
  const unit = item?.kind === "prep" ? prepUnitCost(line.itemId, ctx, seen) : ctx.unitCost(line.itemId);
  return Math.round(grossQty(line, item) * unit);
}

export function linesCost(lines: RecipeLine[], ctx: CostContext, seen: Set<string> = new Set()): Units {
  return lines.reduce((a, l) => a + lineCost(l, ctx, seen), 0);
}

/** One portion: the item's recipe (÷ yield) plus each chosen modifier's recipe. */
export function portionCost(recipe: Pick<Recipe, "lines" | "yieldQty"> | null | undefined, modifierRecipes: (Pick<Recipe, "lines" | "yieldQty"> | null | undefined)[], ctx: CostContext): Units {
  const base = recipe ? Math.round(linesCost(recipe.lines, ctx) / Math.max(1, recipe.yieldQty || 1)) : 0;
  const mods = modifierRecipes.reduce((a, r) => a + (r ? Math.round(linesCost(r.lines, ctx) / Math.max(1, r.yieldQty || 1)) : 0), 0);
  return base + mods;
}

/** Net selling price: removes VAT when menu prices include it. */
export function netPrice(price: Units, opts: { inclusive: boolean; vatBp: number }): Units {
  return opts.inclusive ? Math.round((price * 10_000) / (10_000 + opts.vatBp)) : price;
}

export interface Margin {
  cost: Units;
  net: Units;
  /** cost ÷ net price, bp */
  foodCostBp: number;
  /** (net − cost) ÷ net, bp */
  marginBp: number;
  /** contribution per portion */
  contribution: Units;
}
export function margin(cost: Units, net: Units): Margin {
  const foodCostBp = net > 0 ? Math.round((cost * 10_000) / net) : 0;
  return { cost, net, foodCostBp, marginBp: net > 0 ? 10_000 - foodCostBp : 0, contribution: net - cost };
}

/** Food-cost band used for colouring: ≤ 30% great, ≤ 38% ok, above → too expensive. */
export const costTone = (bp: number): "ok" | "warn" | "danger" => (bp <= 3000 ? "ok" : bp <= 3800 ? "warn" : "danger");

/** Price that hits a target food cost % (rounded up to the next 5 EGP). */
export function priceForTarget(cost: Units, targetBp: number, opts: { inclusive: boolean; vatBp: number }): Units {
  if (targetBp <= 0) return 0;
  const net = Math.ceil((cost * 10_000) / targetBp);
  const gross = opts.inclusive ? Math.ceil((net * (10_000 + opts.vatBp)) / 10_000) : net;
  const step = 5 * 100_000;
  return Math.ceil(gross / step) * step;
}

/**
 * Recipe explosion — which stock items (base units) one order line consumes. Pure; shared by the live deduction
 * (./deduct.ts), the demo seed and the reports.
 *
 *   menu item recipe × qty ÷ yield
 *   + each chosen modifier's recipe (an item-scoped one wins: "large" mango juice ≠ "large" lemon-mint)
 *   + combos: each component's recipe × component qty
 * Trim yield and cooking loss are grossed up (costing.grossQty). Prep items stay prep items (they are stocked).
 */
import type { MenuItem, OrderItem, Recipe, StockItem } from "@/data/types";
import { grossQty } from "./costing";
import { q3 } from "./units";

export interface ExplodeContext {
  menuItems: Map<string, MenuItem>;
  stockItems: Map<string, StockItem>;
  /** recipeKey(ownerType, ownerId, scopeItemId?) → recipe */
  recipes: Map<string, Recipe>;
}

export const recipeKey = (t: Recipe["ownerType"], id: string, scope?: string | null) => (scope ? `${t}:${id}@${scope}` : `${t}:${id}`);

export function explodeContext(menuItems: MenuItem[], stockItems: StockItem[], recipes: Recipe[]): ExplodeContext {
  return {
    menuItems: new Map(menuItems.map((m) => [m.id, m])),
    stockItems: new Map(stockItems.map((s) => [s.id, s])),
    recipes: new Map(recipes.map((r) => [recipeKey(r.ownerType, r.ownerId, r.scopeItemId), r])),
  };
}

/** The modifier recipe that applies on this menu item. */
export const modifierRecipe = (ctx: Pick<ExplodeContext, "recipes">, modifierId: string, itemId: string) => ctx.recipes.get(recipeKey("modifier", modifierId, itemId)) ?? ctx.recipes.get(recipeKey("modifier", modifierId));

function addRecipe(out: Map<string, number>, r: Recipe | undefined, portions: number, ctx: ExplodeContext) {
  if (!r) return;
  const per = portions / Math.max(1, r.yieldQty || 1);
  for (const l of r.lines) out.set(l.itemId, q3((out.get(l.itemId) ?? 0) + grossQty(l, ctx.stockItems.get(l.itemId)) * per));
}

/** Stock items one order line consumes. Totals ≤ 0 (a "no X" on an item without X) are dropped. */
export function explodeLine(line: Pick<OrderItem, "itemId" | "qty" | "modifiers">, ctx: ExplodeContext): Map<string, number> {
  const out = new Map<string, number>();
  const item = ctx.menuItems.get(line.itemId);
  const own = ctx.recipes.get(recipeKey("menu_item", line.itemId));
  if (own) addRecipe(out, own, line.qty, ctx);
  else if (item?.comboOf?.length) for (const c of item.comboOf) addRecipe(out, ctx.recipes.get(recipeKey("menu_item", c.itemId)), line.qty * c.qty, ctx);
  for (const m of line.modifiers) addRecipe(out, modifierRecipe(ctx, m.modifierId, line.itemId), line.qty, ctx);
  for (const [k, v] of out) if (v <= 0) out.delete(k);
  return out;
}

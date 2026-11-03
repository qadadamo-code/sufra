/** Cost of a menu item portion (own recipe, or combo components) — what the menu manager and engineering show. */
import type { MenuItem, Recipe } from "@/data/types";
import type { Units } from "@/lib/money";
import { linesCost, type CostContext } from "./costing";

export function menuItemCost(item: Pick<MenuItem, "id" | "comboOf">, recipes: Recipe[], ctx: CostContext, modifierIds: string[] = []): Units | null {
  const find = (t: Recipe["ownerType"], id: string, scope: string | null = null) => recipes.find((r) => r.ownerType === t && r.ownerId === id && (r.scopeItemId ?? null) === scope);
  const own = find("menu_item", item.id);
  let cost: number | null = null;
  if (own) cost = Math.round(linesCost(own.lines, ctx) / Math.max(1, own.yieldQty || 1));
  else if (item.comboOf?.length) {
    cost = 0;
    for (const c of item.comboOf) {
      const r = find("menu_item", c.itemId);
      if (r) cost += Math.round((linesCost(r.lines, ctx) / Math.max(1, r.yieldQty || 1)) * c.qty);
    }
  }
  for (const m of modifierIds) {
    const r = find("modifier", m, item.id) ?? find("modifier", m);
    if (r) cost = (cost ?? 0) + linesCost(r.lines, ctx);
  }
  return cost;
}

/** Default modifiers are what a plain order gets (side: rice, sugar: medium …) — included in the "typical" cost. */
export const defaultModifierIds = (item: Pick<MenuItem, "modifierGroupIds">, modifiers: { id: string; groupId: string; isDefault: boolean }[]) =>
  modifiers.filter((m) => m.isDefault && item.modifierGroupIds.includes(m.groupId)).map((m) => m.id);

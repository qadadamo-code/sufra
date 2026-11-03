/**
 * Menu engineering (Kasavana & Smith): each item is placed on popularity × contribution margin.
 *   popularity high  ⇔ share of items sold ≥ 70% × (1 / number of items)
 *   margin high      ⇔ item margin ≥ the menu's weighted average margin
 * Stars (keep), plowhorses (re-price / re-cost), puzzles (promote / reposition), dogs (replace).
 * Cost per portion: inventory recipe cost when present (menuItems.cost), else the configured default food-cost %.
 */
import type { Localized } from "@/data/types";
import type { Units } from "@/lib/money";

export type MenuClass = "star" | "plowhorse" | "puzzle" | "dog";

export interface MeInput {
  id: string;
  name: Localized | string;
  qty: number;
  /** net revenue of those portions (after line discounts, before VAT/service) */
  revenue: Units;
  /** cost per portion; null → default % */
  unitCost: Units | null;
  categoryId?: string;
}
export interface MeRow extends MeInput {
  price: Units;
  cost: Units;
  costSource: "recipe" | "default";
  margin: Units;
  contribution: Units;
  mix: number;
  foodCostBp: number;
  popular: boolean;
  profitable: boolean;
  klass: MenuClass;
}

export function menuEngineering(items: MeInput[], defaultFoodCostBp: number) {
  const sold = items.filter((i) => i.qty > 0);
  const totalQty = sold.reduce((a, i) => a + i.qty, 0);
  const rows = sold.map((i) => {
    const price = Math.round(i.revenue / i.qty);
    const recipe = i.unitCost != null && i.unitCost > 0;
    const cost = recipe ? i.unitCost! : Math.round((price * defaultFoodCostBp) / 10_000);
    const margin = price - cost;
    return { ...i, price, cost, costSource: recipe ? ("recipe" as const) : ("default" as const), margin, contribution: margin * i.qty, mix: totalQty ? i.qty / totalQty : 0, foodCostBp: price ? Math.round((cost * 10_000) / price) : 0 };
  });
  const n = rows.length || 1;
  const popThreshold = (1 / n) * 0.7;
  const totalContribution = rows.reduce((a, r) => a + r.contribution, 0);
  const avgMargin = totalQty ? Math.round(totalContribution / totalQty) : 0;
  const out: MeRow[] = rows.map((r) => {
    const popular = r.mix >= popThreshold;
    const profitable = r.margin >= avgMargin;
    const klass: MenuClass = popular && profitable ? "star" : popular ? "plowhorse" : profitable ? "puzzle" : "dog";
    return { ...r, popular, profitable, klass };
  });
  return {
    rows: out.sort((a, b) => b.contribution - a.contribution),
    popThreshold,
    avgMargin,
    totalQty,
    totalContribution,
    revenue: rows.reduce((a, r) => a + r.revenue, 0),
    cost: rows.reduce((a, r) => a + r.cost * r.qty, 0),
    defaultCosted: out.filter((r) => r.costSource === "default").length,
  };
}

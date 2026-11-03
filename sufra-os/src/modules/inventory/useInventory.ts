/** Live inventory data for the screens, scoped to the current branch, plus the cost context recipes are priced with. */
import { useMemo } from "react";
import { useSession } from "@/auth/session";
import { useLive } from "@/data/hooks";
import type { Recipe, StockItem } from "@/data/types";
import type { Units } from "@/lib/money";
import { avgCost, type CostContext } from "./costing";
import { explodeContext } from "./explode";
import { inventorySettings } from "./settings";
import { onHandBy } from "./stock";

export function useInventory() {
  const { branchId, branches } = useSession();
  const items = useLive("stockItems", { orderBy: [{ field: "category" }] }).data;
  const levels = useLive("stockLevels").data;
  const locations = useLive("storageLocations", { orderBy: [{ field: "sort" }] }).data;
  const suppliers = useLive("suppliers").data;
  const offers = useLive("supplierItems").data;
  const recipes = useLive("recipes").data;
  const batches = useLive("stockBatches").data;
  const [settingsRow] = useLive("settings").data;
  const branch = branchId ?? branches.find((b) => b.isDefault)?.id ?? branches[0]?.id ?? null;
  return useMemo(() => {
    const itemById = new Map(items.map((i) => [i.id, i]));
    const branchLevels = levels.filter((l) => !branch || l.branchId === branch);
    const onHand = onHandBy(branchLevels);
    const allOnHand = onHandBy(levels);
    const unitCost = (id: string): Units => {
      const p = allOnHand.get(id);
      return (p && avgCost(p)) ?? itemById.get(id)?.lastCost ?? 0;
    };
    const prepRecipes = new Map(recipes.filter((r) => r.ownerType === "prep").map((r) => [r.ownerId, r]));
    const costCtx: CostContext = { items: itemById, prepRecipes, unitCost };
    const branchLocations = locations.filter((l) => !branch || l.branchId === branch);
    return {
      branchId: branch,
      items,
      itemById,
      levels: branchLevels,
      allLevels: levels,
      onHand,
      locations: branchLocations,
      allLocations: locations,
      locationById: new Map(locations.map((l) => [l.id, l])),
      suppliers,
      supplierById: new Map(suppliers.map((s) => [s.id, s])),
      offers,
      recipes,
      batches,
      settings: inventorySettings(settingsRow),
      settingsRow,
      costCtx,
      unitCost,
      levelsFor: (it: StockItem) => (branch && it.branchLevels[branch]) || it.levels,
      recipeFor: (t: Recipe["ownerType"], id: string, scope?: string | null) => recipes.find((r) => r.ownerType === t && r.ownerId === id && (r.scopeItemId ?? null) === (scope ?? null)) ?? null,
      explodeCtx: (menuItems: Parameters<typeof explodeContext>[0]) => explodeContext(menuItems, items, recipes),
    };
  }, [items, levels, locations, suppliers, offers, recipes, batches, settingsRow, branch]);
}
export type Inv = ReturnType<typeof useInventory>;

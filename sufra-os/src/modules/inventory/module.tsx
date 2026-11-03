import { lazy } from "react";
import { Warehouse } from "lucide-react";
import { useSession } from "@/auth/session";
import { useLive } from "@/data/hooks";
import { defineModule } from "../types";
import { onHandMap } from "./reports";

/** Nav badge: stock items at or below their reorder point in this branch. */
function useLowStock(): number | null {
  const { branchId } = useSession();
  const items = useLive("stockItems", { where: { active: true } }).data;
  const levels = useLive("stockLevels").data;
  const on = onHandMap(levels, branchId);
  const n = items.filter((i) => i.kind === "raw" && ((branchId && i.branchLevels[branchId]) || i.levels).min > 0 && (on.get(i.id) ?? 0) <= ((branchId && i.branchLevels[branchId]) || i.levels).min).length;
  return n || null;
}

/**
 * Inventory, recipes & purchasing (Wave 3). Stock at weighted average (EAS 2), recipe deduction at send
 * (src/modules/inventory/deduct.ts), counts, waste, transfers, production, POs → GRN → supplier invoice (input VAT) →
 * payment, and the Sufra supplier marketplace. Schema: supabase/migrations/0012_inventory.sql.
 */
export default defineModule({
  id: "inventory",
  status: "ready",
  icon: Warehouse,
  title: { ar: "المخزن والمشتريات", en: "Inventory" },
  description: { ar: "خامات ووصفات وجرد وهالك وطلبات شراء وموردين", en: "Stock, recipes, counts, waste, purchase orders and suppliers" },
  permission: "inventory.view",
  shortcut: "g n",
  nav: { path: "/inventory", group: "manage", order: 12, useBadge: useLowStock },
  keywords: ["stock", "inventory", "recipe", "BOM", "waste", "count", "purchase order", "supplier", "marketplace", "مخزن", "خامات", "وصفة", "جرد", "هالك", "مورد", "طلب شراء"],
  routes: [
    { path: "/inventory/*", element: lazy(() => import("./InventoryPage")) },
  ],
  data: ["stockItems", "stockLevels", "stockMoves", "recipes", "suppliers", "purchaseOrders", "stockCounts"],
});

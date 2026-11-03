import { lazy } from "react";
import { BookOpen } from "lucide-react";
import { defineModule } from "../types";

/**
 * Menu manager (Wave 3): categories & items (photo, AR/EN, price per channel/branch, VAT flag, station, prep time,
 * allergens, calories, selling hours, 86), modifier groups with recipes, combos, drag-reorder, bulk price change with
 * preview, live food cost from inventory recipes and menu engineering. Every write goes to menuItems/… which the POS,
 * waiter app, QR and online menus read live; shared selling rules live in ./rules.ts.
 */
export default defineModule({
  id: "menu",
  status: "ready",
  icon: BookOpen,
  title: { ar: "المنيو", en: "Menu" },
  description: { ar: "الأصناف والأسعار والإضافات والوصفات وهندسة المنيو", en: "Items, prices, modifiers, recipes and menu engineering" },
  permission: "menu.edit",
  shortcut: "g m",
  nav: { path: "/menu", group: "manage", order: 10 },
  keywords: ["menu", "items", "price", "modifier", "combo", "86", "allergens", "menu engineering", "منيو", "صنف", "سعر", "إضافات", "كومبو", "خلص"],
  routes: [{ path: "/menu/*", element: lazy(() => import("./MenuPage")) }],
  data: ["menuCategories", "menuItems", "modifierGroups", "modifiers", "recipes"],
});

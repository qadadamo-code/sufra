import { lazy } from "react";
import { BarChart3 } from "lucide-react";
import { defineModule } from "../types";

/**
 * Reports (Wave 3): sales by item / category / hour / day / channel / order type / staff / table / payment, discounts,
 * voids, refunds, covers, average check, table turns; menu engineering; P&L (branch, period, compare), balance sheet,
 * trial balance, cash flow, service-charge & tips liability, prime cost. CSV + print/PDF.
 * Financial tabs need "reports.financial"; sales/menu/staff need "reports.view".
 */
export default defineModule({
  id: "reports",
  status: "ready",
  icon: BarChart3,
  title: { ar: "التقارير", en: "Reports" },
  description: { ar: "المبيعات والمنيو والأرباح والميزانية", en: "Sales, menu, P&L and balance sheet" },
  permission: "reports.view",
  shortcut: "g t",
  nav: { path: "/reports", group: "manage", order: 30 },
  routes: [{ path: "/reports/*", element: lazy(() => import("./ReportsPage")) }],
  keywords: ["ارباح", "أرباح وخسائر", "ميزانية", "ميزان مراجعة", "هندسة المنيو", "p&l", "profit", "balance sheet", "trial balance", "menu engineering", "prime cost", "sales report"],
  data: ["checks", "orderItems", "payments", "ledgerEntries"],
});

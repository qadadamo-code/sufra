import { BarChart3 } from "lucide-react";
import { defineModule } from "../types";

export default defineModule({
  id: "reports",
  status: "soon",
  icon: BarChart3,
  title: { ar: "التقارير", en: "Reports" },
  description: { ar: "المبيعات والأصناف والموظفين والضرايب", en: "Sales, items, staff and tax" },
  permission: "reports.view",
  shortcut: "g t",
  nav: { path: "/reports", group: "manage", order: 30 },
  routes: [{ path: "/reports/*" }],
  features: [
    { ar: "تقرير Z لآخر اليوم من دفتر sufra-finance", en: "End-of-day Z report from the sufra-finance ledger" },
    { ar: "الأصناف الأكتر ربح والأقل طلب", en: "Most profitable and slowest items" },
    { ar: "أداء الجرسونات: شيكات، متوسط، تيبس", en: "Waiter performance: checks, average, tips" },
  ],
  data: ["checks", "payments", "orderItems"],
});

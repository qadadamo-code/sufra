import { lazy } from "react";
import { LayoutDashboard } from "lucide-react";
import { defineModule } from "../types";

export default defineModule({
  id: "overview",
  status: "ready",
  icon: LayoutDashboard,
  title: { ar: "نظرة عامة", en: "Overview" },
  description: { ar: "مبيعات النهارده، الصالة، المطبخ والنداءات — مباشر", en: "Today's sales, floor, kitchen and calls — live" },
  permission: "dashboard.view",
  homeFor: ["owner", "admin"],
  shortcut: "g h",
  nav: { path: "/overview", group: "service", order: 1, mobile: true },
  routes: [{ path: "/overview", element: lazy(() => import("./OverviewPage")) }],
  keywords: ["dashboard", "لوحة", "home"],
});

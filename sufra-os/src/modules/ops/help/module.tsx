import { lazy } from "react";
import { CircleHelp } from "lucide-react";
import { defineModule } from "../../types";

/** Sufra technical support for restaurant staff: help center, "اطلب دعم" with diagnostics, my tickets, system status. */
export default defineModule({
  id: "help",
  status: "ready",
  icon: CircleHelp,
  title: { ar: "المساعدة والدعم الفني", en: "Help & support" },
  description: { ar: "مقالات المساعدة واطلب دعم من فريق سُفرة وحالة النظام", en: "Help articles, request Sufra support and system status" },
  permission: "help.view",
  nav: { path: "/help", group: "admin", order: 90 },
  keywords: ["help", "support", "status", "مساعدة", "دعم", "مشكلة", "حالة"],
  routes: [{ path: "/help/*", element: lazy(() => import("../support/HelpPage")) }],
  data: ["supportTickets"],
});

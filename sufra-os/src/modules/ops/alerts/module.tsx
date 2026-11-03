import { lazy } from "react";
import { Siren } from "lucide-react";
import { defineModule } from "../../types";
import { useAlertsBadge } from "./useAlerts";

/** Alerts center: escalated calls, late deliveries, low stock, cash over/short, camera exceptions, failed payments, tickets past SLA. */
export default defineModule({
  id: "alerts",
  status: "ready",
  icon: Siren,
  title: { ar: "مركز التنبيهات", en: "Alerts center" },
  description: { ar: "كل اللي محتاج مدير في مكان واحد، وقواعد مين يتبلّغ", en: "Everything that needs a manager, and who gets notified" },
  permission: "alerts.view",
  shortcut: "g n",
  nav: { path: "/alerts", group: "manage", order: 5, useBadge: useAlertsBadge },
  keywords: ["alerts", "alarm", "notifications", "تنبيهات", "إنذار"],
  routes: [{ path: "/alerts", element: lazy(() => import("./AlertsPage")) }],
  data: ["serviceCalls", "orders", "auditLog", "paymentIntents", "supportTickets"],
});

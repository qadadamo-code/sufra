import { lazy } from "react";
import { CreditCard } from "lucide-react";
import { useLive } from "@/data/hooks";
import { defineModule } from "../types";

/** live badge: pay links / table payments still waiting */
function useWaitingBadge() {
  const { data } = useLive("paymentIntents", { where: { status: "requires_action" } });
  const now = Date.now();
  const n = data.filter((p) => Date.parse(p.expiresAt) > now).length;
  return n || null;
}

/**
 * Online payments (Wave 2): gateway transactions, pay-by-link, settlements, reconciliation, refunds,
 * Settings → Payments, and the public pay-link page. Server side: /api/pay-* (repo root), schema 0008_payments.sql.
 */
export default defineModule({
  id: "payments",
  status: "ready",
  icon: CreditCard,
  title: { ar: "المدفوعات", en: "Payments" },
  description: { ar: "الدفع الأونلاين ولينكات الدفع والتسويات", en: "Online payments, pay links and settlements" },
  permission: "reports.financial",
  shortcut: "g y",
  nav: { path: "/payments", group: "manage", order: 45, useBadge: useWaitingBadge },
  routes: [
    { path: "/payments", element: lazy(() => import("./PaymentsPage")) },
    { path: "/settings/payments", permission: "settings.view", title: { ar: "الدفع", en: "Payments" }, element: lazy(() => import("./PaymentsSettings")) },
    { path: "/r/:restaurantSlug/link/:intentId", layout: "guest", element: lazy(() => import("./PayLinkPage")) },
  ],
  keywords: ["paymob", "kashier", "moyasar", "pay link", "لينك دفع", "باي موب", "refund", "استرداد", "settlement", "تسوية"],
  data: ["paymentIntents", "paymentRefunds", "paymentPayouts", "payments"],
});

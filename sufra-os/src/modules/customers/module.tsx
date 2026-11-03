import { lazy } from "react";
import { Users } from "lucide-react";
import { defineModule } from "../types";

/**
 * CRM: customer list (search, filters, RFM), profiles (history, loyalty, coupons, feedback, notes), lead capture with
 * consent, duplicate merge, CSV import/export and the rule-based segment builder. Data: customers + loyalty_ledger
 * (visits/points), promo_redemptions, coupon_codes, guest_feedback (0009_crm.sql).
 */
export default defineModule({
  id: "customers",
  status: "ready",
  icon: Users,
  title: { ar: "الزباين", en: "Customers" },
  description: { ar: "ملفات الزباين والزيارات والنقاط والشرائح", en: "Guest profiles, visits, points and segments" },
  permission: "customers.view",
  shortcut: "g c",
  nav: { path: "/customers", group: "manage", order: 20 },
  keywords: ["crm", "customers", "loyalty", "segments", "leads", "زباين", "عملاء", "شرائح", "نقاط"],
  routes: [{ path: "/customers/*", element: lazy(() => import("./CustomersPage")) }],
  data: ["customers", "loyaltyLedger", "segments"],
});

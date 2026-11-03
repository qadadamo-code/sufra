import { lazy } from "react";
import { LifeBuoy } from "lucide-react";
import { defineModule } from "../../types";
import { useTicketsBadge } from "./badge";

/**
 * Restaurant hotline & help desk: guest complaints (from the public "contact the restaurant" sheet, phone, WhatsApp) as
 * tickets with the guest's history, priority, SLA, assignment, notes, resolution and follow-up. Settings → Operations.
 */
export default defineModule({
  id: "support",
  status: "ready",
  icon: LifeBuoy,
  title: { ar: "الشكاوى والخط الساخن", en: "Guest hotline" },
  description: { ar: "شكاوى الضيوف كتذاكر بأولوية ووقت رد ومسؤول", en: "Guest complaints as tickets with priority, SLA and owner" },
  permission: "tickets.handle",
  shortcut: "g u",
  nav: { path: "/support", group: "manage", order: 74, useBadge: useTicketsBadge },
  keywords: ["support", "complaint", "ticket", "hotline", "شكوى", "شكاوى", "تذكرة", "خط ساخن"],
  routes: [
    { path: "/support/*", element: lazy(() => import("./TicketsPage")) },
    { path: "/settings/ops", element: lazy(() => import("./OpsSettingsPage")), permission: "settings.edit", title: { ar: "التشغيل والدعم", en: "Operations & support" } },
  ],
  data: ["supportTickets", "customers", "orders", "payments", "guestFeedback"],
});

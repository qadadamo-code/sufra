import { lazy } from "react";
import { Headset } from "lucide-react";
import { defineModule } from "../../types";

/** Sufra support desk (platform_admin): every restaurant's "اطلب دعم" tickets with their diagnostics. */
export default defineModule({
  id: "desk",
  status: "ready",
  icon: Headset,
  title: { ar: "مكتب دعم سُفرة", en: "Sufra support desk" },
  description: { ar: "تذاكر الدعم الفني من كل المطاعم", en: "Technical support tickets from every restaurant" },
  permission: "platform.admin",
  nav: { path: "/sufra-desk", group: "admin", order: 2, mobile: true },
  keywords: ["desk", "support", "tickets", "دعم", "تذاكر"],
  routes: [{ path: "/sufra-desk/*", element: lazy(() => import("../support/DeskPage")) }],
  data: ["supportTickets", "restaurants"],
});

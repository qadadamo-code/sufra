import { lazy } from "react";
import { ClipboardList } from "lucide-react";
import { defineModule } from "../types";
import { useActiveOrders } from "../badges";

export default defineModule({
  id: "orders",
  status: "ready",
  icon: ClipboardList,
  title: { ar: "الطلبات", en: "Orders" },
  description: { ar: "كل الطلبات: صالة، تيك أواي، دليفري، QR وأونلاين — إعادة طباعة ومرتجعات", en: "Every order: dine-in, takeaway, delivery, QR and online — reprints and refunds" },
  permission: "orders.create",
  shortcut: "g o",
  nav: { path: "/orders", group: "service", order: 40, useBadge: useActiveOrders },
  routes: [{ path: "/orders/*", element: lazy(() => import("./OrdersPage")) }],
  keywords: ["orders", "طلبات", "refund", "مرتجع", "reprint", "طباعة"],
  data: ["orders", "orderItems", "receipts"],
});

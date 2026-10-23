import { ClipboardList } from "lucide-react";
import { defineModule } from "../types";
import { useActiveOrders } from "../badges";

export default defineModule({
  id: "orders",
  status: "soon",
  icon: ClipboardList,
  title: { ar: "الطلبات", en: "Orders" },
  description: { ar: "كل الطلبات: صالة، تيك أواي، دليفري، QR وأونلاين", en: "Every order: dine-in, takeaway, delivery, QR and online" },
  permission: "orders.create",
  shortcut: "g o",
  nav: { path: "/orders", group: "service", order: 40, useBadge: useActiveOrders },
  routes: [{ path: "/orders/*" }],
  features: [
    { ar: "فلترة بالمصدر والحالة والوقت", en: "Filter by source, status and time" },
    { ar: "تفاصيل كل صنف: مين طلبه، اتبعت امتى، اتقدّم امتى", en: "Per-item trail: who ordered, when fired, when served" },
    { ar: "إعادة طباعة وتحويل طلب لترابيزة تانية", en: "Reprint and move an order to another table" },
  ],
  data: ["orders", "orderItems"],
});

import { lazy } from "react";
import { QrCode } from "lucide-react";
import { defineModule } from "../types";

/**
 * Guest experience. Public pages (no auth) talk to the backend only through repo.guest.* / GuestService
 * (SECURITY DEFINER RPCs in Supabase — 0001_init.sql + 0005_guest.sql).
 *
 *   /r/:slug/t/:code   QR table page: menu, order, call the waiter, bill, split, pay, receipt, feedback
 *   /r/:slug           online ordering: delivery / takeaway / pickup at a time
 *   /r/:slug/o/:id     live order tracking
 *   /r/:slug/pay/:pi   DemoProvider hosted checkout (stands in for Paymob/Kashier)
 *   /settings/qr       staff: printable QR table tents + WhatsApp message previews
 */
export default defineModule({
  id: "guest",
  status: "ready",
  icon: QrCode,
  title: { ar: "QR والطلب أونلاين", en: "QR & online ordering" },
  description: { ar: "منيو الـ QR ونداء الجرسون والدفع من الترابيزة والطلب أونلاين", en: "QR menu, call-a-waiter, pay at table and online ordering" },
  permission: "floor.edit",
  shortcut: "g q",
  nav: { path: "/settings/qr", group: "admin", order: 8 },
  keywords: ["qr", "menu", "online", "delivery", "whatsapp", "tent", "منيو", "كود", "اونلاين", "واتساب"],
  routes: [
    { path: "/r/:restaurantSlug/t/:tableCode", element: lazy(() => import("./TablePage")), layout: "guest" },
    { path: "/r/:restaurantSlug/o/:orderId", element: lazy(() => import("./TrackPage")), layout: "guest" },
    { path: "/r/:restaurantSlug/pay/:intentId", element: lazy(() => import("./CheckoutPage")), layout: "guest" },
    { path: "/r/:restaurantSlug", element: lazy(() => import("./OnlinePage")), layout: "guest" },
    { path: "/settings/qr", element: lazy(() => import("./QrSettingsPage")), permission: "floor.edit", title: { ar: "أكواد QR", en: "QR codes" } },
  ],
  features: [
    { ar: "الزبون يطلب من موبايله والجرسون يأكد", en: "Guests order from their phone; the waiter confirms" },
    { ar: "دفع أونلاين وتقسيم الحساب من الموبايل", en: "Pay online and split the bill from the phone" },
  ],
});

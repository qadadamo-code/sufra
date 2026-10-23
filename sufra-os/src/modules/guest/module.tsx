import { lazy } from "react";
import { QrCode } from "lucide-react";
import { defineModule } from "../types";

const GuestMenuPage = lazy(() => import("./GuestMenuPage"));

/** Public pages (no auth). Data comes only through repo.guest.* (SECURITY DEFINER RPCs in Supabase). */
export default defineModule({
  id: "guest",
  status: "soon",
  icon: QrCode,
  title: { ar: "منيو الترابيزة", en: "Table menu" },
  description: { ar: "منيو الـ QR ونداء الجرسون والطلب أونلاين", en: "QR menu, call-a-waiter and online ordering" },
  routes: [
    { path: "/r/:restaurantSlug/t/:tableCode", element: GuestMenuPage, layout: "guest" },
    { path: "/r/:restaurantSlug", element: GuestMenuPage, layout: "guest" },
  ],
  features: [
    { ar: "الزبون يطلب من موبايله والجرسون يأكد", en: "Guests order from their phone; the waiter confirms" },
    { ar: "دفع أونلاين وتقسيم الحساب من الموبايل", en: "Pay online and split the bill from the phone" },
  ],
});

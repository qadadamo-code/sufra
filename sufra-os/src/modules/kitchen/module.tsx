import { lazy } from "react";
import { ChefHat } from "lucide-react";
import { defineModule } from "../types";
import { useKitchenQueue } from "../badges";

export default defineModule({
  id: "kitchen",
  status: "ready",
  icon: ChefHat,
  title: { ar: "المطبخ", en: "Kitchen" },
  description: { ar: "شاشة المطبخ: التذاكر حسب المحطة والوقت", en: "Kitchen display: tickets by station and time" },
  permission: "kitchen.view",
  homeFor: ["chef", "kitchen"],
  shortcut: "g k",
  nav: { path: "/kitchen", group: "service", order: 30, mobile: true, useBadge: useKitchenQueue },
  routes: [
    { path: "/kitchen/*", element: lazy(() => import("./KitchenPage")) },
    { path: "/kds", element: lazy(() => import("./KdsKiosk")), layout: "bare", title: { ar: "شاشة المطبخ", en: "Kitchen display" } },
  ],
  keywords: ["kds", "شيف", "chef", "expo", "86", "bump"],
  features: [
    { ar: "تذاكر لكل محطة (شوّاية، سخن، بارد، حلويات، بار) بعدّاد وقت", en: "Tickets per station (grill, hot, cold, desserts, bar) with timers" },
    { ar: "لمسة واحدة: بيتعمل ← جاهز، والجرسون يعرف على طول", en: "One tap: preparing → ready, and the waiter knows instantly" },
    { ar: "الكورسات: الحلو مايطلعش قبل الأكل", en: "Courses: dessert doesn't fire before mains" },
    { ar: "الشيف يقدر يقفل صنف خلص (٨٦) من الشاشة", en: "Chef can 86 a sold-out item from the screen" },
  ],
  data: ["orderItems", "kitchenStations"],
});

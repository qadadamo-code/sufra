import { Bike } from "lucide-react";
import { defineModule } from "../types";
import { usePendingDeliveries } from "../badges";

export default defineModule({
  id: "delivery",
  status: "soon",
  icon: Bike,
  title: { ar: "الدليفري", en: "Delivery" },
  description: { ar: "توزيع الطلبات على الطيارين ومتابعتها", en: "Dispatch orders to riders and track them" },
  permission: "delivery.view",
  homeFor: ["delivery"],
  shortcut: "g d",
  nav: { path: "/delivery", group: "service", order: 60, mobile: true, useBadge: usePendingDeliveries },
  routes: [{ path: "/delivery/*" }],
  features: [
    { ar: "الطيّار يشوف طلباته والعنوان ويفتح الخريطة", en: "Riders see their orders and open the address in maps" },
    { ar: "حالات: مستني، اتسلّم للطيّار، اتسلّم للزبون", en: "States: waiting, picked up, delivered" },
    { ar: "تسوية الكاش مع الطيّار آخر الشيفت", en: "Cash settlement with riders at end of shift" },
  ],
  data: ["orders", "customers"],
});

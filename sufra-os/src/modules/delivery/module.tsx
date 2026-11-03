import { lazy } from "react";
import { Bike } from "lucide-react";
import { defineModule } from "../types";
import { useDeliveryBadge } from "./watch";

/**
 * Delivery & online-order operations.
 *
 *   /delivery               incoming orders inbox (accept with prep ETA / reject with reason, auto-accept per channel, phone & aggregator entry)
 *   /delivery/dispatch      board (preparing → ready → assigned → out → delivered) + live map, rider suggestions, batching, late alerts
 *   /delivery/settle        rider cash settlement at the till (closes checks, posts short/over)
 *   /delivery/reports       channels, zones, hours, prep/ride times, late %, riders, aggregator commission
 *   /delivery/aggregators   Talabat / elmenus / HungerStation / Jahez / Keeta — how integration gets enabled
 *   /driver                 rider app (phone): shift, my orders, navigate, call/WhatsApp, picked up → arrived → delivered, live GPS
 *   /settings/delivery      zones on the map (polygons / rings, fee, minimum, ETA, free-delivery threshold, hours) + rules
 */
export default defineModule({
  id: "delivery",
  status: "ready",
  icon: Bike,
  title: { ar: "الدليفري", en: "Delivery" },
  description: { ar: "الطلبات الواردة والتوزيع على الطيارين والتتبع المباشر", en: "Incoming orders, dispatch to riders and live tracking" },
  permission: "delivery.view",
  homeFor: ["delivery"],
  shortcut: "g d",
  nav: { path: "/delivery", group: "service", order: 60, mobile: true, useBadge: useDeliveryBadge },
  keywords: ["delivery", "dispatch", "driver", "rider", "talabat", "دليفري", "طيار", "توصيل", "طلبات", "وارد"],
  routes: [
    { path: "/delivery/*", element: lazy(() => import("./DeliveryPage")) },
    { path: "/driver", element: lazy(() => import("./DriverApp")), permission: "delivery.run", title: { ar: "الطيار", en: "Rider" } },
    { path: "/settings/delivery", element: lazy(() => import("./ZonesPage")), permission: "settings.edit", title: { ar: "مناطق التوصيل", en: "Delivery zones" } },
  ],
  data: ["orders", "deliveryZones", "driverShifts", "driverLocations", "customers"],
});

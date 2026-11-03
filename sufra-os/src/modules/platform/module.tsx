import { lazy } from "react";
import { Globe2 } from "lucide-react";
import { defineModule } from "../types";

/**
 * Sufra platform console (Sufra staff, role `platform_admin` — not a restaurant role): restaurants directory, sponsored
 * placements (slots, pricing, bookings calendar, approvals), ad performance and the public feed that the marketplace
 * (sufra-web) reads through `public_sponsored(city, cuisine)` (0009_crm.sql; local equivalent in ./ads.ts + lib/promo).
 */
export default defineModule({
  id: "platform",
  status: "ready",
  icon: Globe2,
  title: { ar: "منصة سُفرة", en: "Sufra platform" },
  description: { ar: "المطاعم والإعلانات المُموَّلة وأداءها", en: "Restaurants, sponsored placements and their performance" },
  permission: "platform.admin",
  homeFor: ["platform_admin"],
  shortcut: "g x",
  nav: { path: "/platform", group: "admin", order: 1, mobile: true },
  keywords: ["platform", "ads", "sponsored", "marketplace", "منصة", "إعلانات", "مموّل"],
  routes: [{ path: "/platform/*", element: lazy(() => import("./PlatformPage")) }],
  data: ["restaurants", "marketProfiles", "adSlots", "adBookings"],
});

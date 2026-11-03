import { lazy } from "react";
import { Megaphone } from "lucide-react";
import { defineModule } from "../types";

/**
 * Marketing: loyalty (points, tiers, stamp cards, rewards), promotions engine (src/lib/promo), gift cards, campaigns and
 * automated journeys (WhatsApp/SMS through src/lib/notify), the restaurant's own promos (QR menu banners, receipt promo
 * block), reviews, customer reports and buying Sufra sponsored placements.
 *
 *   /marketing/*            staff
 *   /r/:slug/me             guest loyalty card (phone + last order no.; OTP via WhatsApp in production — DESIGN.md)
 *   /r/:slug/gift           buy an e-gift card online
 */
export default defineModule({
  id: "marketing",
  status: "ready",
  icon: Megaphone,
  title: { ar: "التسويق والولاء", en: "Marketing & loyalty" },
  description: { ar: "نقاط وعروض وكوبونات وكروت هدايا وحملات واتساب وإعلانات", en: "Points, offers, coupons, gift cards, WhatsApp campaigns and ads" },
  permission: "marketing.view",
  shortcut: "g m",
  nav: { path: "/marketing", group: "manage", order: 22 },
  keywords: ["loyalty", "points", "coupon", "promo", "campaign", "gift card", "ads", "reviews", "نقاط", "كوبون", "عرض", "حملة", "كارت هدية", "إعلان", "تقييم"],
  routes: [
    { path: "/marketing/*", element: lazy(() => import("./MarketingPage")) },
    { path: "/r/:restaurantSlug/me", element: lazy(() => import("./guest/LoyaltyCardPage")), layout: "guest" },
    { path: "/r/:restaurantSlug/gift", element: lazy(() => import("./guest/GiftPage")), layout: "guest" },
  ],
  data: ["loyaltyPrograms", "promotions", "giftCards", "campaigns", "journeys", "promoBanners", "guestFeedback", "adBookings"],
});

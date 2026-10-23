import { lazy } from "react";
import { CalendarClock } from "lucide-react";
import { defineModule } from "../types";
import { usePendingReservations } from "../badges";

export default defineModule({
  id: "reservations",
  status: "ready",
  icon: CalendarClock,
  title: { ar: "الحجوزات", en: "Reservations" },
  description: { ar: "الحجوزات وقايمة الانتظار والحجز أونلاين", en: "Bookings, the waitlist and online booking" },
  permission: "reservations.view",
  shortcut: "g r",
  nav: { path: "/reservations", group: "service", order: 50, useBadge: usePendingReservations },
  routes: [
    { path: "/reservations/*", element: lazy(() => import("./ReservationsPage")) },
    // public "book from home" page (no login)
    { path: "/r/:restaurantSlug/book", element: lazy(() => import("./BookingPage")), layout: "guest", title: { ar: "احجز ترابيزة", en: "Book a table" } },
  ],
  keywords: ["booking", "حجز", "waitlist", "انتظار"],
  features: [
    { ar: "جدول اليوم بالساعة، والتعارضات واضحة", en: "Today's timeline by hour, with clashes highlighted" },
    { ar: "وسوم: عيد ميلاد، VIP، أطفال، هادي", en: "Tags: birthday, VIP, kids, quiet" },
    { ar: "قايمة انتظار برسالة لما الترابيزة تفضى", en: "Waitlist with a message when a table frees up" },
    { ar: "صفحة حجز أونلاين بمواعيد حقيقية", en: "Online booking page with real availability" },
  ],
  data: ["reservations", "customers"],
});

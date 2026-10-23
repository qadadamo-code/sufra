import { CalendarClock } from "lucide-react";
import { defineModule } from "../types";
import { usePendingReservations } from "../badges";

export default defineModule({
  id: "reservations",
  status: "soon",
  icon: CalendarClock,
  title: { ar: "الحجوزات", en: "Reservations" },
  description: { ar: "الحجوزات وقايمة الانتظار", en: "Bookings and the waitlist" },
  permission: "reservations.view",
  shortcut: "g r",
  nav: { path: "/reservations", group: "service", order: 50, useBadge: usePendingReservations },
  routes: [{ path: "/reservations/*" }],
  features: [
    { ar: "جدول اليوم بالساعة، والتعارضات واضحة", en: "Today's timeline by hour, with clashes highlighted" },
    { ar: "وسوم: عيد ميلاد، VIP، أطفال، هادي", en: "Tags: birthday, VIP, kids, quiet" },
    { ar: "قايمة انتظار برسالة لما الترابيزة تفضى", en: "Waitlist with a message when a table frees up" },
  ],
  data: ["reservations", "customers"],
});

import { lazy } from "react";
import { HandPlatter } from "lucide-react";
import { defineModule } from "../types";
import { useOpenCalls } from "../badges";

export default defineModule({
  id: "waiter",
  status: "ready",
  icon: HandPlatter,
  title: { ar: "الجرسون", en: "Waiter" },
  description: { ar: "الطلب من الموبايل جنب الترابيزة، والنداءات", en: "Order from the phone at the table, and guest calls" },
  permission: "waiter.use",
  homeFor: ["waiter"],
  shortcut: "g w",
  nav: { path: "/waiter", group: "service", order: 15, mobile: true, useBadge: useOpenCalls },
  routes: [{ path: "/waiter/*", element: lazy(() => import("./WaiterPage")) }],
  keywords: ["captain", "كابتن", "calls", "نداء"],
  features: [
    { ar: "ترابيزاتي: مين قاعد، طلبوا إيه، وإيه اللي جاهز يتقدّم", en: "My tables: who's seated, what they ordered, what's ready to serve" },
    { ar: "طلب بالكرسي والكورس، والملاحظات (من غير بصل…)", en: "Order by seat and course, with notes (no onions…)" },
    { ar: "نداءات الزباين من الـ QR توصل على الموبايل", en: "Guest calls from the QR arrive on the phone" },
    { ar: "يأكد طلبات الـ QR قبل ما تروح المطبخ", en: "Confirms QR orders before they reach the kitchen" },
  ],
  data: ["tables", "orders", "serviceCalls"],
});

import { lazy } from "react";
import { UserRound } from "lucide-react";
import { defineModule } from "../types";

/**
 * Staff self-service (any role, phone-first): /me — my schedule, clock in/out (geofenced), my attendance, leave balance &
 * requests, advance requests, payslips. /timeclock — the shared-device clock (PIN + optional selfie) on the POS tablet.
 * Rules and data live next to this file (lib/, ops.ts); the manager screens are src/modules/staff.
 */
export default defineModule({
  id: "me",
  status: "ready",
  icon: UserRound,
  title: { ar: "أنا", en: "Me" },
  description: { ar: "جدولي وحضوري وإجازاتي وسلفي ومرتبي", en: "My schedule, attendance, leave, advances and payslips" },
  permission: "hr.self",
  shortcut: "g z",
  nav: { path: "/me", group: "admin", order: 90 },
  keywords: ["me", "my schedule", "clock in", "payslip", "حضور", "بصمة", "جدولي", "مرتبي", "إجازة"],
  routes: [
    { path: "/me/*", element: lazy(() => import("./MePage")) },
    { path: "/timeclock", element: lazy(() => import("./TimeclockPage")), layout: "bare", title: { ar: "ساعة الحضور", en: "Time clock" } },
  ],
});

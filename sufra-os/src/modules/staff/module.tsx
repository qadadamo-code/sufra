import { lazy } from "react";
import { IdCard } from "lucide-react";
import { useLive } from "@/data/hooks";
import { useSession } from "@/auth/session";
import { defineModule } from "../types";

/**
 * Staff & HR (Wave 3): directory + employee files (documents with expiry alerts), weekly rota, attendance board
 * (PIN/selfie kiosk, geofenced phone check-in, ZKTeco terminals, CSV), leave, advances, payroll (owner/admin/accountant),
 * performance and HR settings. Rules: src/modules/hr/lib; self-service (/me, /timeclock): src/modules/hr.
 */
function useStaffBadge() {
  const { can } = useSession();
  const leave = useLive("leaveRequests", { where: { status: "pending" } }, { enabled: can("staff.manage") }).data.length;
  const adv = useLive("advances", { where: { status: "requested" } }, { enabled: can("staff.manage") }).data.length;
  const swaps = useLive("shiftSwaps", { where: { status: "pending" } }, { enabled: can("staff.manage") }).data.length;
  const n = leave + adv + swaps;
  return n || null;
}

export default defineModule({
  id: "staff",
  status: "ready",
  icon: IdCard,
  title: { ar: "الموظفين", en: "Staff" },
  description: { ar: "الموظفين والجدول والحضور والإجازات والسلف والمرتبات", en: "Staff, rota, attendance, leave, advances and payroll" },
  permission: "staff.view",
  shortcut: "g j",
  nav: { path: "/staff", group: "manage", order: 40, useBadge: useStaffBadge },
  keywords: ["hr", "payroll", "attendance", "schedule", "rota", "leave", "advance", "salary", "payslip", "fingerprint", "رواتب", "مرتبات", "حضور", "انصراف", "بصمة", "جدول", "ورديات", "إجازة", "سلفة", "تأمينات"],
  routes: [{ path: "/staff/*", element: lazy(() => import("./StaffPage")) }],
  data: ["memberships", "staffProfiles", "rotaShifts", "attendancePunches", "leaveRequests", "advances", "payrollRuns", "payslips"],
});

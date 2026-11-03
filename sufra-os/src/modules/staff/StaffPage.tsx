import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { BarChart3, CalendarDays, Clock, HandCoins, IdCard, Palmtree, Settings2, Users, Wallet } from "lucide-react";
import { useLive } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { Skeleton } from "@/ui";
import { PageHeader } from "@/shell/PageHeader";
import { RouteTabs } from "@/modules/hr/ui";
import { useHr } from "@/modules/hr/useHr";

const DirectoryPage = lazy(() => import("./DirectoryPage"));
const ProfilePage = lazy(() => import("./ProfilePage"));
const SchedulePage = lazy(() => import("./SchedulePage"));
const AttendancePage = lazy(() => import("./AttendancePage"));
const LeavePage = lazy(() => import("./LeavePage"));
const AdvancesPage = lazy(() => import("./AdvancesPage"));
const PayrollPage = lazy(() => import("./PayrollPage"));
const PerformancePage = lazy(() => import("./PerformancePage"));
const HrSettingsPage = lazy(() => import("./HrSettingsPage"));

export default function StaffPage() {
  const { L } = useT();
  const hr = useHr();
  const leave = useLive("leaveRequests", { where: { status: "pending" } }).data.length;
  const adv = useLive("advances", { where: { status: ["requested", "approved"] } }).data.length;
  const swaps = useLive("shiftSwaps", { where: { status: "pending" } }).data.length;
  return (
    <div className="grid gap-5">
      <PageHeader icon={<IdCard />} title={L("الموظفين", "Staff")} subtitle={L("الفريق، الجدول، الحضور، الإجازات، السلف والمرتبات — في مكان واحد", "Team, rota, attendance, leave, advances and payroll — in one place")} />
      <RouteTabs
        label={L("أقسام الموظفين", "Staff sections")}
        items={[
          { to: "/staff", end: true, label: L("الفريق", "Team"), icon: <Users /> },
          { to: "/staff/schedule", label: L("الجدول", "Rota"), icon: <CalendarDays />, count: swaps || null },
          { to: "/staff/attendance", label: L("الحضور والانصراف", "Attendance"), icon: <Clock /> },
          { to: "/staff/leave", label: L("الإجازات", "Leave"), icon: <Palmtree />, count: leave || null },
          { to: "/staff/advances", label: L("السلف", "Advances"), icon: <HandCoins />, count: adv || null },
          ...(hr.canPay ? [{ to: "/staff/payroll", label: L("الرواتب", "Payroll"), icon: <Wallet /> }] : []),
          { to: "/staff/performance", label: L("الأداء", "Performance"), icon: <BarChart3 /> },
          ...(hr.canManage ? [{ to: "/staff/settings", label: L("الإعدادات", "Settings"), icon: <Settings2 /> }] : []),
        ]}
      />
      <Suspense fallback={<Skeleton className="h-96" rounded="rounded-[20px]" />}>
        <Routes>
          <Route index element={<DirectoryPage />} />
          <Route path="p/:membershipId" element={<ProfilePage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="attendance" element={<AttendancePage />} />
          <Route path="leave" element={<LeavePage />} />
          <Route path="advances" element={<AdvancesPage />} />
          {hr.canPay ? <Route path="payroll/*" element={<PayrollPage />} /> : null}
          <Route path="performance" element={<PerformancePage />} />
          {hr.canManage ? <Route path="settings" element={<HrSettingsPage />} /> : null}
        </Routes>
      </Suspense>
    </div>
  );
}

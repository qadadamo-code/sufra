import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useSession } from "@/auth/session";
import { PageFallback } from "@/shell/AppShell";
import { RequirePermission } from "@/app/guards";

const InboxPage = lazy(() => import("./InboxPage"));
const DispatchPage = lazy(() => import("./DispatchPage"));
const SettlePage = lazy(() => import("./SettlePage"));
const ReportsPage = lazy(() => import("./ReportsPage"));
const AggregatorsPage = lazy(() => import("./AggregatorsPage"));

export default function DeliveryPage() {
  const { can } = useSession();
  // riders land on /delivery (their home) → their own app
  if (!can("delivery.dispatch")) return <Navigate to="/driver" replace />;
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route index element={<InboxPage />} />
        <Route path="dispatch" element={<DispatchPage />} />
        <Route
          path="settle"
          element={
            <RequirePermission permission="payments.take">
              <SettlePage />
            </RequirePermission>
          }
        />
        <Route
          path="reports"
          element={
            <RequirePermission permission="reports.view">
              <ReportsPage />
            </RequirePermission>
          }
        />
        <Route path="aggregators" element={<AggregatorsPage />} />
        <Route path="*" element={<Navigate to="/delivery" replace />} />
      </Routes>
    </Suspense>
  );
}

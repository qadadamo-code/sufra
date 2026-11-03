import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { PageFallback } from "@/shell/AppShell";
import Register from "./Register";

const ShiftPage = lazy(() => import("./ShiftPage"));
const EtaQueue = lazy(() => import("./EtaQueue"));
const ZatcaQueue = lazy(() => import("@/modules/settings/zatca/ZatcaQueue"));

export default function PosPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route index element={<Register />} />
        <Route path="shift" element={<ShiftPage />} />
        <Route path="eta" element={<EtaQueue />} />
        <Route path="zatca" element={<ZatcaQueue />} />
        <Route path="*" element={<Register />} />
      </Routes>
    </Suspense>
  );
}

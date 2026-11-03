import { lazy, Suspense, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Cctv, Grid2x2, Grid3x3, LayoutGrid, Square } from "lucide-react";
import { useLive } from "@/data/hooks";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n/i18n";
import { loadRaw, saveRaw } from "@/lib/storage";
import { PageHeader } from "@/shell/PageHeader";
import { PageFallback } from "@/shell/AppShell";
import { EmptyState, LinkButton, Segmented, Select } from "@/ui";
import { cn } from "@/lib/cn";
import { SubNav } from "../ui";
import { CameraTile } from "./CameraTile";
import { useVideoEvents } from "./useEvents";

const EventsView = lazy(() => import("./EventsView"));
const OccupancyView = lazy(() => import("./OccupancyView"));
const SetupView = lazy(() => import("./SetupView"));

export default function CamerasPage() {
  const { L } = useT();
  const { events } = useVideoEvents(1);
  const acks = useLive("opsAcks", { where: { kind: "event" } }).data;
  const open = useMemo(() => {
    const s = new Set(acks.map((a) => a.id));
    return events.filter((e) => !s.has(e.id) && e.severity !== "info").length;
  }, [events, acks]);
  return (
    <div className="grid gap-4">
      <PageHeader icon={<Cctv />} title={L("الكاميرات", "Cameras")} subtitle={L("البث المباشر واستثناءات الكاشير والإشغال", "Live view, POS exceptions and occupancy")} />
      <SubNav
        label={L("الكاميرات", "Cameras")}
        items={[
          { to: "/cameras", label: L("مباشر", "Live wall"), end: true },
          { to: "/cameras/events", label: L("الاستثناءات", "Exceptions"), badge: open },
          { to: "/cameras/occupancy", label: L("الإشغال", "Occupancy") },
          { to: "/cameras/setup", label: L("الإعداد", "Setup") },
        ]}
      />
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route index element={<LiveWall />} />
          <Route path="events" element={<EventsView />} />
          <Route path="occupancy" element={<OccupancyView />} />
          <Route path="setup" element={<SetupView />} />
          <Route path="*" element={<Navigate to="/cameras" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}

const GRID_KEY = "sufra-os.cameras.grid";
type Grid = "1" | "4" | "9" | "16";

function LiveWall() {
  const { L } = useT();
  const { branchId } = useSession();
  const cams = useLive("cameras", { where: branchId ? { branchId } : {}, orderBy: [{ field: "sort" }] }).data;
  const [grid, setGrid] = useState<Grid>(() => (["1", "4", "9", "16"].includes(loadRaw(GRID_KEY) ?? "") ? (loadRaw(GRID_KEY) as Grid) : "4"));
  const [area, setArea] = useState("");
  const [page, setPage] = useState(0);
  const areas = [...new Set(cams.map((c) => c.area).filter(Boolean))];
  const list = cams.filter((c) => !area || c.area === area);
  const per = Number(grid);
  const pages = Math.max(1, Math.ceil(list.length / per));
  const shown = list.slice(Math.min(page, pages - 1) * per, Math.min(page, pages - 1) * per + per);
  const cols = { "1": "grid-cols-1", "4": "grid-cols-1 sm:grid-cols-2", "9": "grid-cols-2 lg:grid-cols-3", "16": "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" }[grid];
  if (!cams.length)
    return <EmptyState icon={<Cctv />} title={L("مفيش كاميرات لسه", "No cameras yet")} body={L("ضيف كاميرات الفرع من الإعداد.", "Add this branch's cameras in Setup.")} action={<LinkButton to="/cameras/setup">{L("ضيف كاميرا", "Add a camera")}</LinkButton>} />;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label={L("التقسيم", "Layout")}
          size="sm"
          value={grid}
          onChange={(g) => (setGrid(g), setPage(0), saveRaw(GRID_KEY, g))}
          options={[
            { value: "1", label: "1", icon: <Square className="size-4" /> },
            { value: "4", label: "4", icon: <Grid2x2 className="size-4" /> },
            { value: "9", label: "9", icon: <Grid3x3 className="size-4" /> },
            { value: "16", label: "16", icon: <LayoutGrid className="size-4" /> },
          ]}
        />
        <Select aria-label={L("المكان", "Area")} value={area} onChange={(e) => (setArea(e.target.value), setPage(0))} options={[{ value: "", label: L("كل الأماكن", "All areas") }, ...areas.map((a) => ({ value: a, label: a }))]} />
        {pages > 1 ? (
          <div className="ms-auto flex items-center gap-1">
            {Array.from({ length: pages }, (_, i) => (
              <button key={i} type="button" onClick={() => setPage(i)} className={cn("num grid size-9 place-items-center rounded-lg text-[13px] font-semibold", i === page ? "bg-primary text-primary-ink" : "bg-surface-2")}>
                {i + 1}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className={cn("grid gap-2 sm:gap-3", cols)}>
        {shown.map((c) => (
          <CameraTile key={c.id} cam={c} big={grid === "1"} />
        ))}
      </div>
      <p className="text-[12.5px] text-muted">{L("دوسة مزدوجة على أي كاميرا = ملء الشاشة. الكاميرات «التجريبية» رسم متحرك مش فيديو حقيقي.", "Double-tap a camera for fullscreen. “Demo” cameras are an animated drawing, not real video.")}</p>
    </div>
  );
}

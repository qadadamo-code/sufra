import { useState } from "react";
import { Route, Routes, useSearchParams } from "react-router-dom";
import { BarChart3, BellRing, ChefHat, LayoutGrid, Volume2, VolumeX } from "lucide-react";
import { useDict } from "@/i18n/i18n";
import { IconButton } from "@/ui";
import { cn } from "@/lib/cn";
import { isForWaiter, needsManager, playCue, setSoundEnabled, soundEnabled, unlockAudio, useNow, useSla } from "@/lib/service-calls";
import { wdict } from "./dict";
import { CallsTab, StatsTab } from "./CallsTab";
import { ReadyTab, useReadyGroups } from "./ReadyTab";
import { TableDetail } from "./TableDetail";
import { TablesTab } from "./TablesTab";
import { useWaiter } from "./useWaiter";

type Tab = "tables" | "calls" | "ready" | "stats";

export default function WaiterPage() {
  const data = useWaiter();
  const now = useNow(1000);
  const sla = useSla();
  return (
    <div onPointerDown={unlockAudio}>
      <Routes>
        <Route index element={<WaiterHome data={data} now={now} sla={sla} />} />
        <Route path="t/:tableId" element={<TableDetail data={data} now={now} sla={sla} />} />
      </Routes>
    </div>
  );
}

function WaiterHome({ data, now, sla }: { data: ReturnType<typeof useWaiter>; now: number; sla: ReturnType<typeof useSla> }) {
  const w = useDict(wdict);
  const [params, setParams] = useSearchParams();
  const tab = (["tables", "calls", "ready", "stats"].includes(params.get("tab") ?? "") ? params.get("tab") : "tables") as Tab;
  const setTab = (t: Tab) => setParams(t === "tables" ? {} : { tab: t }, { replace: true });
  const [sound, setSound] = useState(() => soundEnabled("calls"));
  const open = data.calls.filter((c) => c.status === "open" && c.type !== "pickup");
  const mineOpen = data.me ? open.filter((c) => isForWaiter(c, data.me!, data.owners, now, sla)) : open;
  const hot = mineOpen.some((c) => needsManager(c, now, sla));
  const ready = useReadyGroups(data).filter((g) => g.v.mine || !g.v.owner).length;
  const soundButton = (
    <IconButton
      variant="secondary"
      label={w("w.sound")}
      aria-pressed={sound}
      onClick={() => {
        unlockAudio();
        setSoundEnabled("calls", !sound);
        setSound(!sound);
        if (!sound) playCue("call");
      }}
    >
      {sound ? <Volume2 /> : <VolumeX />}
    </IconButton>
  );
  const tabs: { value: Tab; label: string; icon: React.ReactNode; badge?: number; hot?: boolean }[] = [
    { value: "tables", label: w("w.tables"), icon: <LayoutGrid /> },
    { value: "calls", label: w("w.calls"), icon: <BellRing />, badge: mineOpen.length, hot },
    { value: "ready", label: w("w.ready"), icon: <ChefHat />, badge: ready },
    { value: "stats", label: w("w.stats"), icon: <BarChart3 /> },
  ];
  return (
    <div className="grid gap-4">
      <div className="sticky top-16 z-20 -mx-4 border-b border-line/60 bg-bg/85 px-4 py-2 backdrop-blur-xl md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <div role="tablist" aria-label={w("w.tables")} className="grid grid-cols-4 gap-1 rounded-[16px] border border-line bg-surface-2 p-1 md:max-w-xl">
          {tabs.map((x) => {
            const on = x.value === tab;
            return (
              <button
                key={x.value}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(x.value)}
                className={cn(
                  "relative flex h-14 flex-col items-center justify-center gap-0.5 rounded-[12px] text-[12.5px] font-semibold transition-colors md:h-11 md:flex-row md:gap-2 md:text-[14px] [&_svg]:size-5",
                  on ? "bg-surface text-ink shadow-sf-sm ring-1 ring-line" : "text-muted hover:text-ink",
                )}
              >
                <span className={cn(x.hot && "text-danger")}>{x.icon}</span>
                <span className="max-w-full truncate px-1">{x.label}</span>
                {x.badge ? (
                  <span className={cn("absolute top-1 end-2 grid min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold leading-5 text-white md:static", x.hot ? "bg-danger" : x.value === "ready" ? "bg-ok" : "bg-brass")}>{x.badge}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      {tab === "tables" ? <TablesTab data={data} now={now} sla={sla} /> : tab === "calls" ? <CallsTab data={data} now={now} sla={sla} soundButton={soundButton} /> : tab === "ready" ? <ReadyTab data={data} now={now} /> : <StatsTab data={data} now={now} sla={sla} />}
    </div>
  );
}

import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence } from "motion/react";
import { Ban, ChefHat, ClipboardList, Expand, Languages, LayoutGrid, Minimize2, Moon, Sun, Undo2, Volume2, VolumeX, CircleCheck, ArrowDownToLine } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import type { OrderItem, OrderPriority } from "@/data/types";
import { useT, useDict } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { clock } from "@/lib/time";
import { loadRaw, saveRaw } from "@/lib/storage";
import { useTheme } from "@/theme/theme";
import { Button, EmptyState, IconButton, Kbd, Segmented, useHotkeys, useToast } from "@/ui";
import { playCue, setSoundEnabled, soundEnabled, unlockAudio, useArrivals, useNow, pingWaiter } from "@/lib/service-calls";
import { kdict } from "./dict";
import { ageLevel, ageMinutes, buildTickets, lastBumped, type Ticket } from "./kds";
import { applyAction, setPriority } from "./ops";
import { TicketCard } from "./TicketCard";
import { AllDayView, EightySixView, ExpoView } from "./views";
import { useKitchen } from "./useKitchen";

type View = "line" | "allday" | "expo" | "86";
const VIEW_KEY = "sufra-os.kds.view";
const STATION_KEY = "sufra-os.kds.station";
const SCROLL_KEY = "sufra-os.kds.autoscroll";

/** Pulsing header for red tickets (module-local keyframes). */
const KDS_CSS = `@keyframes kds-pulse{0%,100%{filter:none}50%{filter:brightness(1.18) saturate(1.1)}}.kds-pulse{animation:kds-pulse 1.6s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.kds-pulse{animation:none}}`;

export function KitchenScreen({ kiosk = false }: { kiosk?: boolean }) {
  const { t, lang, loc, toggleLang } = useT();
  const k = useDict(kdict);
  const db = useDb();
  const theme = useTheme();
  const nav = useNavigate();
  const { toast } = useToast();
  const data = useKitchen();
  const now = useNow(1000);
  const [view, setViewState] = useState<View>(() => (["line", "allday", "expo", "86"].includes(loadRaw(VIEW_KEY) ?? "") ? (loadRaw(VIEW_KEY) as View) : "line"));
  const [station, setStationState] = useState<string | null>(() => loadRaw(STATION_KEY) || null);
  const [sound, setSound] = useState(() => soundEnabled("kds"));
  const [autoScroll, setAutoScroll] = useState(() => loadRaw(SCROLL_KEY) !== "0");
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const history = useRef<{ number: number; items: OrderItem[] }[]>([]);
  const setView = (v: View) => (saveRaw(VIEW_KEY, v), setViewState(v));
  const setStation = (s: string | null) => (saveRaw(STATION_KEY, s), setStationState(s));
  const stationValid = station && data.stationById.has(station) ? station : null;
  const stationOrder = useMemo(() => data.stations.map((s) => s.id), [data.stations]);

  const tickets = useMemo(() => buildTickets(data.orders, data.items, { stationId: stationValid, stationOrder, now }), [data.orders, data.items, stationValid, stationOrder, now]);
  const expo = useMemo(() => buildTickets(data.orders, data.items, { includeReady: true, stationOrder, now }), [data.orders, data.items, stationOrder, now]);
  const allCount = useMemo(() => buildTickets(data.orders, data.items, { now }).length, [data.orders, data.items, now]);
  const perStation = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of data.stations) m.set(s.id, buildTickets(data.orders, data.items, { stationId: s.id, now }).length);
    return m;
  }, [data.orders, data.items, data.stations, now]);
  const itemsLeft = tickets.reduce((a, tk) => a + tk.items.filter((i) => i.status !== "ready").reduce((s, i) => s + i.qty, 0), 0);
  const late = tickets.filter((tk) => ageLevel(ageMinutes(tk.firedAt, now), data.settings) === "red").length;
  const readyCount = expo.filter((tk) => tk.state === "ready").length;
  const outCount = useOutCount();

  /* new tickets: sound + flash + scroll */
  const arrivalKeys = useMemo(() => tickets.map((tk) => ({ id: tk.key, n: tk.order.number })), [tickets]);
  useArrivals(
    arrivalKeys,
    (fresh) => {
      if (sound && data.settings.sound) playCue("ticket");
      toast({ title: k("k.newTicket", { n: fresh.map((f) => f.n).join(", #") }), tone: "default", duration: 2500 });
      setFlash(new Set(fresh.map((f) => f.id)));
      setTimeout(() => setFlash(new Set()), 4000);
      if (autoScroll && view === "line") {
        requestAnimationFrame(() => document.querySelector(`[data-ticket="${fresh[fresh.length - 1].id.split(":")[0]}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
      }
    },
    !data.loading,
  );

  /* actions */
  const bump = useCallback(
    async (tk: Ticket) => {
      const target = tk.items.filter((i) => i.status === "sent" || i.status === "preparing");
      if (!target.length) return;
      await applyAction(db, target, "bump");
      history.current.push({ number: tk.order.number, items: target });
      history.current = history.current.slice(-20);
      toast({
        title: k("k.bumped", { n: tk.order.number }),
        tone: "success",
        duration: 3000,
        action: {
          label: k("k.undo"),
          onClick: () => void recall(),
        },
      });
    },
    [db], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const recall = useCallback(async () => {
    const last = history.current.pop();
    let items: Pick<OrderItem, "id" | "status" | "firedAt" | "orderId">[] = [];
    let number: number | null = null;
    if (last) {
      // re-read current status: only items still "ready" can come back
      const ids = new Set(last.items.map((i) => i.id));
      items = data.items.filter((i) => ids.has(i.id) && i.status === "ready");
      number = last.number;
    }
    if (!items.length) {
      items = lastBumped(data.items, stationValid);
      number = data.orders.find((o) => o.id === items[0]?.orderId)?.number ?? null;
    }
    if (!items.length) return toast({ title: k("k.nothingToRecall") });
    await applyAction(db, items, "recall");
    toast({ title: k("k.recalled", { n: number ?? "?" }), tone: "warn" });
  }, [data.items, data.orders, stationValid, db, toast, k]);
  const start = useCallback((tk: Ticket) => void applyAction(db, tk.items, "start"), [db]);
  const onItem = useCallback((i: OrderItem) => void applyAction(db, [i], i.status === "sent" ? "start" : i.status === "preparing" ? "bump" : "recall"), [db]);
  const onPriority = useCallback((tk: Ticket, p: OrderPriority) => void setPriority(db, tk.order.id, p), [db]);
  const serve = useCallback(
    async (tk: Ticket) => {
      await applyAction(db, tk.items.filter((i) => i.status === "ready"), "serve");
    },
    [db],
  );
  const ping = useCallback(
    async (tk: Ticket) => {
      const c = await pingWaiter(db, tk.order);
      toast({ title: c ? k("k.pinged", { t: tk.order.tableIds.map((x) => data.tableLabel.get(x) ?? "?").join("+") }) : k("k.noTable"), tone: c ? "success" : "default" });
    },
    [db, toast, k, data.tableLabel],
  );

  /* keyboard / bump bar */
  const digits: Record<string, () => void> = {};
  for (let i = 1; i <= 9; i++) digits[String(i)] = () => (view === "line" ? tickets[i - 1] && void bump(tickets[i - 1]) : view === "expo" ? expoReady(expo)[i - 1] && void serve(expoReady(expo)[i - 1]) : undefined);
  useHotkeys(
    { ...digits, r: () => void recall(), l: () => setView("line"), a: () => setView("allday"), e: () => setView("expo"), x: () => setView("86") },
    {
      descriptions: {
        "1": { ar: "١–٩: جاهز للتذكرة رقم كذا", en: "1–9: bump ticket N" },
        r: { ar: "رجّع آخر تذكرة", en: "Recall last ticket" },
        l: { ar: "التذاكر", en: "Tickets view" },
        a: { ar: "المطلوب كله", en: "All-day view" },
        e: { ar: "الباس", en: "Expo view" },
        x: { ar: "قائمة الخلصان (٨٦)", en: "86 list" },
      },
    },
  );

  const toggleSound = () => {
    unlockAudio();
    setSoundEnabled("kds", !sound);
    setSound(!sound);
    if (!sound) playCue("ticket");
  };
  const enterKiosk = () => {
    unlockAudio();
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    nav("/kds");
  };
  const exitKiosk = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    nav("/kitchen");
  };

  const viewOptions = [
    { value: "line" as const, label: k("k.line"), icon: <LayoutGrid />, badge: tickets.length || undefined },
    { value: "allday" as const, label: k("k.allDay"), icon: <ClipboardList /> },
    { value: "expo" as const, label: k("k.expo"), icon: <CircleCheck />, badge: readyCount || undefined },
    { value: "86" as const, label: k("k.86"), icon: <Ban />, badge: outCount || undefined },
  ];

  return (
    <div className={cn("flex flex-col gap-4", kiosk && "min-h-dvh p-4 lg:p-5")} onPointerDown={unlockAudio}>
      <style>{KDS_CSS}</style>
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        {kiosk ? (
          <h1 className="flex items-center gap-2 text-[22px]">
            <ChefHat className="size-6 text-primary" aria-hidden /> {k("k.title")}
          </h1>
        ) : null}
        <Segmented label={k("k.title")} value={view} onChange={setView} options={viewOptions} />
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Stat label={k("k.openTickets")} value={tickets.length} />
          <Stat label={k("k.itemsLeft")} value={itemsLeft} />
          <Stat label={k("k.avgTicket")} value={data.avgTicket === null ? "—" : k("k.min", { n: data.avgTicket })} />
          <Stat label={k("k.late")} value={late} tone={late ? "danger" : undefined} />
          <span className="hidden px-1 font-mono text-[20px] font-semibold tabular-nums xl:inline" dir="ltr">
            {clock(new Date(now).toISOString(), lang)}
          </span>
          <Button variant="secondary" icon={<Undo2 className="size-4.5" />} onClick={() => void recall()} title="R">
            <span className="max-sm:sr-only">{k("k.recall")}</span>
            <Kbd className="max-md:hidden">R</Kbd>
          </Button>
          <IconButton variant="secondary" label={k("k.sound")} onClick={toggleSound} aria-pressed={sound}>
            {sound ? <Volume2 /> : <VolumeX />}
          </IconButton>
          <IconButton
            variant={autoScroll ? "soft" : "secondary"}
            label={k("k.autoScroll")}
            aria-pressed={autoScroll}
            onClick={() => (saveRaw(SCROLL_KEY, autoScroll ? "0" : "1"), setAutoScroll(!autoScroll))}
          >
            <ArrowDownToLine />
          </IconButton>
          {kiosk ? (
            <>
              <IconButton variant="secondary" label={lang === "ar" ? "English" : "عربي"} onClick={toggleLang}>
                <Languages />
              </IconButton>
              <IconButton variant="secondary" label={t("shell.theme")} onClick={theme.toggle}>
                {theme.dark ? <Sun /> : <Moon />}
              </IconButton>
              <IconButton variant="secondary" label={k("k.exitKiosk")} onClick={exitKiosk}>
                <Minimize2 />
              </IconButton>
            </>
          ) : (
            <IconButton variant="secondary" label={k("k.fullscreen")} onClick={enterKiosk}>
              <Expand />
            </IconButton>
          )}
        </div>
      </div>

      {/* stations */}
      {view === "line" || view === "allday" ? (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 no-scrollbar" role="radiogroup" aria-label={k("k.allStations")}>
          <StationChip on={!stationValid} onClick={() => setStation(null)} label={k("k.allStations")} count={allCount} />
          {data.stations.map((s) => (
            <StationChip key={s.id} on={stationValid === s.id} onClick={() => setStation(s.id)} label={loc(s.name)} color={s.color} count={perStation.get(s.id) ?? 0} />
          ))}
        </div>
      ) : null}

      {view === "line" ? (
        tickets.length ? (
          <div className="grid items-start gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
            <AnimatePresence initial={false}>
              {tickets.map((tk, i) => (
                <TicketCard
                  key={tk.key}
                  ticket={tk}
                  index={i}
                  now={now}
                  settings={data.settings}
                  stationById={data.stationById}
                  tableLabel={data.tableLabel}
                  staffName={data.staffName}
                  showStations={!stationValid}
                  highlight={flash.has(tk.key)}
                  onItem={onItem}
                  onStart={start}
                  onBump={bump}
                  onPriority={onPriority}
                />
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <EmptyState icon={<ChefHat />} title={k("k.empty")} body={k("k.emptyBody")} className="rounded-[24px] border border-dashed border-line py-20" />
        )
      ) : view === "allday" ? (
        <AllDayView items={data.items} stationId={stationValid} stationById={data.stationById} prep={data.prep} now={now} settings={data.settings} />
      ) : view === "expo" ? (
        <ExpoView tickets={expo} stationById={data.stationById} tableLabel={data.tableLabel} now={now} settings={data.settings} onServe={serve} onPing={ping} />
      ) : (
        <EightySixView />
      )}

      <p className="hidden text-center text-[12.5px] text-faint md:block">
        {k("k.keys")} · {k("k.tapHint")} · {k("k.settings", { a: data.settings.amberMin, b: data.settings.redMin })}
        {!kiosk ? null : (
          <>
            {" · "}
            <Link to="/kitchen" className="underline">
              {k("k.exitKiosk")}
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

const expoReady = (ts: Ticket[]) => ts.filter((t) => t.state === "ready");
function useOutCount() {
  return useLive("menuItems", { where: { available: false, active: true } }).data.length;
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "danger" }) {
  return (
    <span className={cn("hidden h-11 flex-col justify-center rounded-xl border border-line bg-surface px-3 leading-tight lg:flex", tone === "danger" && "border-danger/40 bg-danger-soft text-danger")}>
      <span className="text-[11px] font-semibold text-muted">{label}</span>
      <span className="font-mono text-[16px] font-bold">{value}</span>
    </span>
  );
}

function StationChip({ on, onClick, label, color, count }: { on: boolean; onClick: () => void; label: string; color?: string; count: number }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-[14.5px] font-semibold transition-colors",
        on ? "border-transparent bg-ink text-bg" : "border-line bg-surface text-ink-2 hover:border-line-strong",
      )}
    >
      {color ? <span className="size-2.5 rounded-full" style={{ background: color }} aria-hidden /> : null}
      {label}
      <span className={cn("rounded-full px-1.5 font-mono text-[12px]", on ? "bg-bg/20" : "bg-surface-3")}>{count}</span>
    </button>
  );
}

export default function KitchenPage() {
  return <KitchenScreen />;
}

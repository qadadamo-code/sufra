/** /delivery/dispatch — board (preparing → ready → assigned → out → delivered) + live map + riders. */
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Bike, CheckCircle2, ChefHat, Clock, Hourglass, Layers, Map as MapIcon, MapPin, Navigation, PackageCheck, Route as RouteIcon, Timer, UserRoundX, Users } from "lucide-react";
import { useDb } from "@/data/hooks";
import type { DriverLocation, LatLng } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { ago, clock } from "@/lib/time";
import { Avatar, Badge, Button, Card, Dialog, EmptyState, Money, Segmented, useMedia, useReduced, useToast } from "@/ui";
import { PageHeader } from "@/shell/PageHeader";
import { batchGroups, suggestDrivers, type Suggestion } from "./assign";
import { project, type Projection } from "./eta";
import { googleDirections, haversineKm } from "./geo";
import { DeliveryMap, type MapPin as Pin } from "./map/DeliveryMap";
import { dispatchOf } from "./settings";
import { shiftCash } from "./settle";
import { assignDriver, counterHandover, deliver, markDelayed, rejectOrder, unassignDriver } from "./stages";
import type { Column } from "./stages";
import { useDeliveryData, useNow, type DeliveryData, type OrderView } from "./useDelivery";
import { ChannelBadge, ContactButtons, DeliveryTabs, ItemLines, STAGE_LABEL } from "./ui";
import { aggregatorInfo } from "./aggregators";

const COLS: { key: Exclude<Column, "inbox">; ar: string; en: string; icon: React.ReactNode; tone: string }[] = [
  { key: "preparing", ar: "بيتجهز", en: "Preparing", icon: <ChefHat />, tone: "text-warn" },
  { key: "ready", ar: "جاهز", en: "Ready", icon: <PackageCheck />, tone: "text-ok" },
  { key: "assigned", ar: "مع طيار", en: "Assigned", icon: <Users />, tone: "text-info" },
  { key: "out", ar: "في الطريق", en: "Out for delivery", icon: <Bike />, tone: "text-primary" },
  { key: "done", ar: "اتسلّم", en: "Delivered", icon: <CheckCircle2 />, tone: "text-muted" },
];

export default function DispatchPage() {
  const { L } = useT();
  const data = useDeliveryData();
  const now = useNow(15_000);
  // ≥1700: board | map side by side · ≥1180: board, then map + riders below · smaller: switch between them
  const side = useMedia("(min-width: 1700px)");
  const wide = useMedia("(min-width: 1180px)");
  const [view, setView] = useState<"board" | "map">("board");
  const [selected, setSelected] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);

  const proj = useMemo(() => {
    const m = new Map<string, Projection>();
    for (const v of data.views) m.set(v.order.id, project(v, data.cfg, v.order.driverId ? (data.locations.get(v.order.driverId) ?? null) : null, now));
    return m;
  }, [data, now]);
  const board = data.views.filter((v) => v.order.source !== "qr" && v.column !== "inbox" && (v.column !== "done" || ["delivered", "failed"].includes(dispatchOf(v.order).stage)));
  const late = board.filter((v) => proj.get(v.order.id)?.late === "late");
  const batches = useMemo(() => {
    const pool = board.filter((v) => (v.column === "ready" || v.column === "preparing") && v.order.mode === "delivery" && !counterHandover(v.order)).map((v) => ({ id: v.order.id, to: v.to, readyBy: proj.get(v.order.id)?.at ?? now }));
    return batchGroups(pool, data.cfg.batchRadiusKm, data.cfg.maxBatch);
  }, [board, proj, data.cfg, now]);
  const batchOf = (id: string) => batches.find((g) => g.includes(id)) ?? null;

  const showBoard = wide || view === "board";
  const showMap = wide || view === "map";
  const sel = selected ? (data.byId.get(selected) ?? null) : null;

  return (
    <div className="mx-auto grid max-w-[1680px] gap-4">
      <PageHeader
        icon={<RouteIcon />}
        title={L("التوزيع", "Dispatch")}
        subtitle={L("مين جاهز، مين مع طيار، ومين متأخر — والخريطة مباشرة", "What's ready, who has what, what's late — live map")}
        actions={
          !wide ? (
            <Segmented
              label={L("العرض", "View")}
              value={view}
              onChange={setView}
              options={[
                { value: "board", label: L("اللوحة", "Board"), icon: <Layers /> },
                { value: "map", label: L("الخريطة", "Map"), icon: <MapIcon /> },
              ]}
            />
          ) : undefined
        }
      />
      <DeliveryTabs />

      {late.length ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-2xl border border-danger/40 bg-danger-soft px-4 py-2.5 text-[14px] text-danger">
          <AlertTriangle className="size-5" />
          <b>{L(`${late.length} متأخر`, `${late.length} late`)}</b>
          {late.map((v) => (
            <button key={v.order.id} type="button" onClick={() => setSelected(v.order.id)} className="num rounded-full bg-danger px-2.5 py-0.5 text-[12.5px] font-bold text-white">
              #{v.order.number}
            </button>
          ))}
          <span className="ms-auto text-[12.5px] text-danger/80">{L("ابعت للعميل الوقت الجديد من تفاصيل الطلب", "Send the customer a new time from the order details")}</span>
        </div>
      ) : null}

      <div className={cn("grid gap-4", side && "grid-cols-[minmax(0,1fr)_minmax(420px,32%)]")}>
        {showBoard ? (
          <div className="-mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
            <div className="grid min-w-[1060px] grid-cols-5 gap-3">
              {COLS.map((c) => {
                const list = board.filter((v) => v.column === c.key).sort((a, b) => (c.key === "done" ? (dispatchOf(b.order).deliveredAt ?? "").localeCompare(dispatchOf(a.order).deliveredAt ?? "") : a.order.openedAt.localeCompare(b.order.openedAt)));
                const shown = c.key === "done" ? list.slice(0, 8) : list;
                return (
                  <section key={c.key} className="flex min-h-[200px] flex-col rounded-[20px] bg-surface-2/70 p-2" aria-label={L(c.ar, c.en)}>
                    <h2 className="flex items-center gap-2 px-2 pt-1 pb-2 font-sans text-[14px] font-bold">
                      <span className={cn("[&_svg]:size-4.5", c.tone)}>{c.icon}</span>
                      {L(c.ar, c.en)}
                      <span className="num ms-auto rounded-full bg-surface px-2 text-[12.5px] text-muted">{list.length}</span>
                    </h2>
                    <ul className="grid content-start gap-2">
                      <AnimatePresence initial={false}>
                        {shown.map((v) => (
                          <BoardCard key={v.order.id} v={v} p={proj.get(v.order.id)!} batch={batchOf(v.order.id)} data={data} selected={selected === v.order.id} onOpen={() => setSelected(v.order.id)} onAssign={() => setAssigning(v.order.id)} now={now} />
                        ))}
                      </AnimatePresence>
                      {!list.length ? <li className="rounded-2xl border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-faint">{L("فاضي", "Empty")}</li> : null}
                    </ul>
                  </section>
                );
              })}
            </div>
          </div>
        ) : null}
        {showMap ? (
          <div className={cn("grid content-start gap-3", side && "sticky top-4 self-start", wide && !side && "grid-cols-[minmax(0,1fr)_340px] items-start")}>
            <LiveMap data={data} board={board} selected={selected} onSelect={setSelected} className={side ? "h-[min(58vh,600px)]" : wide ? "h-[460px]" : "h-[min(62vh,620px)]"} />
            <RidersPanel data={data} now={now} />
          </div>
        ) : null}
      </div>

      <OrderSheet v={sel} p={sel ? proj.get(sel.order.id) : undefined} data={data} onClose={() => setSelected(null)} onAssign={() => sel && setAssigning(sel.order.id)} />
      <AssignDialog orderId={assigning} data={data} proj={proj} batches={batches} onClose={() => setAssigning(null)} />
    </div>
  );
}

function LateBadge({ p }: { p: Projection }) {
  const { L } = useT();
  if (p.late === "ok") return null;
  return (
    <Badge tone={p.late === "late" ? "danger" : "warn"} size="sm" icon={<AlertTriangle />} pulse={p.late === "late"}>
      {p.late === "late" ? L("متأخر", "Late") : L("قرب يتأخر", "At risk")}
    </Badge>
  );
}

function BoardCard({ v, p, batch, data, selected, onOpen, onAssign, now }: { v: OrderView; p: Projection; batch: string[] | null; data: DeliveryData; selected: boolean; onOpen: () => void; onAssign: () => void; now: number }) {
  const { L, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const reduced = useReduced();
  const d = dispatchOf(v.order);
  const agg = aggregatorInfo(d.aggregator?.id);
  const counter = counterHandover(v.order);
  const [busy, setBusy] = useState(false);
  const handOver = async () => {
    setBusy(true);
    try {
      await deliver(db, v.order.id, { collected: v.due > 0 ? { method: "cash", amount: v.due } : { method: "prepaid", amount: 0 } });
      toast({ title: L(`#${v.order.number} اتسلّم`, `#${v.order.number} handed over`), tone: "success", duration: 2000 });
    } catch (e) {
      toast({ title: String((e as Error).message), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <motion.li layout={!reduced} initial={reduced ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
      <article className={cn("rounded-2xl border bg-surface shadow-sf-sm transition-colors", selected ? "border-primary ring-2 ring-primary/25" : p.late === "late" ? "border-danger/50" : "border-line")}>
        <button type="button" onClick={onOpen} className="block w-full p-3 text-start">
          <div className="flex items-center gap-1.5">
            <span className="num text-[17px] font-bold">#{v.order.number}</span>
            {v.order.mode === "takeaway" ? <Badge size="sm" tone="info">{L("استلام", "Pickup")}</Badge> : agg ? <Badge size="sm" tone="warn">{d.aggregator?.theirRider ? L(`مندوب ${agg.name.ar}`, `${agg.name.en} rider`) : agg.name[lang]}</Badge> : null}
            <span className="ms-auto">
              <LateBadge p={p} />
            </span>
          </div>
          <p className="mt-1 truncate text-[13.5px] font-semibold">{v.customer?.name ?? (agg ? d.aggregator?.ref : L("عميل", "Guest"))}</p>
          {v.order.mode === "delivery" && !counter ? (
            <p className="truncate text-[12.5px] text-muted">
              <MapPin className="me-1 inline size-3.5" />
              {v.order.delivery?.area} · {v.order.delivery?.address}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
            {v.column === "preparing" ? (
              <span className="inline-flex items-center gap-1">
                <Hourglass className="size-3.5" /> {L(`باقي ~${p.prepLeftMin} د`, `~${p.prepLeftMin} min left`)}
              </span>
            ) : null}
            {v.column !== "done" && p.inMin !== null ? (
              <span className="num inline-flex items-center gap-1" title={L("الوصول المتوقع", "Projected arrival")}>
                <Timer className="size-3.5" /> {clock(new Date(p.at!).toISOString(), lang)}
              </span>
            ) : null}
            {d.promisedAt && v.column !== "done" ? (
              <span className="num inline-flex items-center gap-1" title={L("الوعد", "Promised")}>
                <Clock className="size-3.5" /> {clock(d.promisedAt, lang)}
              </span>
            ) : null}
            {v.column === "done" ? <span>{d.stage === "failed" ? <b className="text-danger">{L("ماتسلّمش", "Failed")}</b> : ago(d.deliveredAt ?? v.order.updatedAt, lang, now)}</span> : null}
            {v.due > 0 ? <Money value={v.due} compact className="font-bold text-brass-text" /> : <span className="font-semibold text-ok">{L("مدفوع", "Paid")}</span>}
          </div>
          {batch && v.column !== "assigned" ? (
            <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[11.5px] font-bold text-info">
              <Layers className="size-3.5" /> {L("ممكن يتجمّع مع", "Batch with")} {batch.filter((x) => x !== v.order.id).map((x) => `#${data.byId.get(x)?.order.number}`).join(" ")}
            </p>
          ) : null}
        </button>
        {v.column === "ready" || v.column === "preparing" || v.column === "assigned" || v.column === "out" ? (
          <div className="flex items-center gap-2 border-t border-line px-3 py-2">
            {v.driver ? (
              <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] font-semibold">
                <Avatar name={v.driver.name} color={v.driver.color} size="xs" />
                <span className="truncate">{v.driver.name.split(" ")[0]}</span>
              </span>
            ) : (
              <span className="flex-1 text-[12px] text-faint">{counter ? (d.aggregator?.theirRider ? L("مندوب التطبيق", "App rider") : L("العميل هيستلم", "Customer collects")) : L("من غير طيار", "No rider")}</span>
            )}
            {counter && v.column === "ready" ? (
              <Button size="sm" variant="soft" loading={busy} onClick={handOver}>
                {L("اتسلّم", "Handed over")}
              </Button>
            ) : !counter && (v.column === "ready" || v.column === "preparing" || v.column === "assigned") ? (
              <Button size="sm" variant={v.column === "ready" && !v.driver ? "primary" : "secondary"} icon={<Bike />} onClick={onAssign}>
                {v.driver ? L("غيّر", "Reassign") : L("وزّع", "Assign")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </article>
    </motion.li>
  );
}

const TONE_BY_COL: Record<string, Pin["tone"]> = { preparing: "warn", ready: "ok", assigned: "info", out: "primary", done: "muted" };

function LiveMap({ data, board, selected, onSelect, className }: { data: DeliveryData; board: OrderView[]; selected: string | null; onSelect: (id: string | null) => void; className?: string }) {
  const { L, loc } = useT();
  const pins: Pin[] = useMemo(() => {
    const out: Pin[] = [{ id: "kitchen", kind: "kitchen", lat: data.cfg.origin.lat, lng: data.cfg.origin.lng, label: L("المطبخ", "Kitchen") }];
    for (const v of board) if (v.to && v.column !== "done") out.push({ id: v.order.id, kind: "order", lat: v.to.lat, lng: v.to.lng, text: String(v.order.number), label: `#${v.order.number} · ${v.customer?.name ?? ""}`, tone: TONE_BY_COL[v.column] });
    for (const s of data.driverStates) {
      const loc = data.locations.get(s.id);
      if (!loc || (!s.onShift && Date.now() - Date.parse(loc.at) > 30 * 60_000)) continue;
      out.push({ id: `rider:${s.id}`, kind: "rider", lat: loc.lat, lng: loc.lng, label: s.name.split(" ")[0], heading: loc.heading, stale: !s.onShift || Date.now() - Date.parse(loc.at) > 10 * 60_000, tone: s.load.some((l) => l.state === "out") ? "primary" : "brass" });
    }
    return out;
  }, [board, data, L]);
  const lines = useMemo(() => {
    const out: { id: string; points: LatLng[] }[] = [];
    for (const v of board) {
      if (v.column !== "out" || !v.to || !v.order.driverId) continue;
      const l = data.locations.get(v.order.driverId);
      if (l) out.push({ id: v.order.id, points: [{ lat: l.lat, lng: l.lng }, v.to] });
    }
    return out;
  }, [board, data.locations]);
  const shapes = useMemo(() => data.zones.filter((z) => z.active && z.geometry).map((z) => ({ id: z.slug, geometry: z.geometry!, color: z.color, dim: true, label: loc(z.name) })), [data.zones, loc]);
  return (
    <DeliveryMap
      className={cn("rounded-[22px] border border-line shadow-sf-sm", className)}
      ariaLabel={L("خريطة التوصيل المباشرة", "Live delivery map")}
      pins={pins}
      lines={lines}
      shapes={shapes}
      selectedId={selected}
      onSelect={(id) => onSelect(id && !id.startsWith("rider:") && id !== "kitchen" ? id : null)}
      center={data.cfg.origin}
      zoom={14}
    />
  );
}

function RidersPanel({ data, now }: { data: DeliveryData; now: number }) {
  const { L, lang } = useT();
  const shiftOf = (id: string) => data.shifts.find((s) => s.driverId === id && s.status === "on") ?? null;
  return (
    <Card className="p-3">
      <p className="mb-2 flex items-center gap-2 px-1 text-[14.5px] font-bold">
        <Users className="size-4.5 text-muted" /> {L("الطيارين", "Riders")}
      </p>
      <ul className="grid gap-1.5">
        {data.driverStates.map((s) => {
          const m = data.drivers.find((x) => x.id === s.id)!;
          const loc: DriverLocation | undefined = data.locations.get(s.id);
          const sh = shiftOf(s.id);
          const cash = sh ? shiftCash(data.views.filter((v) => v.order.driverId === s.id && dispatchOf(v.order).driverShiftId === sh.id).map((v) => v.order)).cash : 0;
          const out = s.load.filter((l) => l.state === "out").length;
          const waiting = s.load.filter((l) => l.state === "assigned").length;
          const status = !s.onShift ? L("خارج الشيفت", "Off shift") : out ? L(`في الطريق · ${out}`, `On the road · ${out}`) : waiting ? L(`في المطبخ · ${waiting}`, `At kitchen · ${waiting}`) : L("فاضي", "Available");
          return (
            <li key={s.id} className={cn("flex items-center gap-2.5 rounded-2xl px-2 py-1.5", !s.onShift && "opacity-60")}>
              <Avatar name={m.name} color={m.color} size="sm" status={s.onShift ? "online" : null} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold">{m.name}</p>
                <p className="truncate text-[12px] text-muted">
                  {status}
                  {loc ? ` · ${L("آخر موقع", "seen")} ${ago(loc.at, lang, now)}` : ""}
                </p>
              </div>
              {cash ? <Money value={cash} compact className="text-[12.5px] font-bold text-brass-text" /> : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function OrderSheet({ v, p, data, onClose, onAssign }: { v: OrderView | null; p?: Projection; data: DeliveryData; onClose: () => void; onAssign: () => void }) {
  const { L, lang, loc } = useT();
  const db = useDb();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (k: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(k);
    try {
      await fn();
      toast({ title: ok, tone: "success", duration: 2200 });
    } catch (e) {
      toast({ title: String((e as Error).message), tone: "error" });
    } finally {
      setBusy(null);
    }
  };
  if (!v) return <Dialog open={false} onClose={onClose} />;
  const d = dispatchOf(v.order);
  const counter = counterHandover(v.order);
  const live = !["delivered", "failed", "rejected", "cancelled"].includes(d.stage);
  const timeline: [string, string | null][] = [
    [L("وصل", "Received"), d.receivedAt],
    [L("اتقبل", "Accepted"), d.acceptedAt],
    [L("جاهز", "Ready"), d.readyAt],
    [L("اتوزّع", "Assigned"), d.assignedAt],
    [L("خرج", "Picked up"), d.pickedUpAt],
    [L("وصل للعنوان", "Arrived"), d.arrivedAt],
    [L("اتسلّم", "Delivered"), d.deliveredAt],
  ];
  return (
    <Dialog open onClose={onClose} variant="sheet-end" size="md" title={<span className="num">#{v.order.number}</span>} description={loc(STAGE_LABEL[v.column === "preparing" || v.column === "ready" ? v.column : d.stage])}>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <ChannelBadge v={v} size="md" />
          {p ? <LateBadge p={p} /> : null}
          {d.batchId ? <Badge tone="info" icon={<Layers />}>{L("رحلة مجمّعة", "Batched trip")}</Badge> : null}
        </div>
        <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-[15.5px] font-bold">{v.customer?.name ?? (d.aggregator ? `${aggregatorInfo(d.aggregator.id)?.name[lang]} · ${d.aggregator.ref}` : L("عميل", "Guest"))}</p>
            <p className="num text-[13px] text-muted" dir="ltr">{v.customer?.phone ?? ""}</p>
          </div>
          <ContactButtons phone={v.customer?.phone} name={v.customer?.name} />
        </div>
        {v.order.mode === "delivery" && !counter && v.order.delivery ? (
          <div className="flex items-start gap-2 text-[14px]">
            <MapPin className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{v.order.delivery.address}</p>
              <p className="text-[12.5px] text-muted">{[v.order.delivery.area, v.order.delivery.notes, v.to ? `${haversineKm(data.cfg.origin, v.to).toFixed(1)} km` : null, v.approx ? L("موقع تقريبي", "approx.") : null].filter(Boolean).join(" · ")}</p>
            </div>
            <a href={googleDirections(v.to, v.order.delivery.address, data.cfg.origin)} target="_blank" rel="noreferrer" className="grid size-10 place-items-center rounded-full border border-line" aria-label={L("الاتجاهات", "Directions")}>
              <Navigation className="size-4.5" />
            </a>
          </div>
        ) : null}
        <div className="rounded-2xl border border-line p-3">
          <ItemLines items={v.items} />
          <div className="mt-3 flex items-center justify-between border-t border-line pt-2 text-[14px]">
            <span className="text-muted">{v.due > 0 ? L("يتحصّل عند الباب", "Collect at the door") : L("مدفوع", "Paid")}</span>
            <Money value={v.due > 0 ? v.due : (v.check?.total ?? 0)} className="text-[17px] font-bold" />
          </div>
        </div>
        <ol className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
          {timeline.map(([label, at]) => (
            <li key={label} className="contents">
              <span className={cn("num", at ? "text-ink" : "text-faint")} dir="ltr">
                {at ? clock(at, lang) : "—"}
              </span>
              <span className={at ? "font-semibold" : "text-faint"}>{label}</span>
            </li>
          ))}
          {d.promisedAt ? (
            <li className="contents">
              <span className="num text-brass-text" dir="ltr">
                {clock(d.promisedAt, lang)}
              </span>
              <span className="text-brass-text">{L("الوقت الموعود", "Promised")}</span>
            </li>
          ) : null}
          {d.failReason ? <li className="col-span-2 text-danger">{d.failReason}</li> : null}
        </ol>
        {live ? (
          <div className="grid gap-2">
            {!counter && d.stage !== "picked_up" && d.stage !== "arrived" ? (
              <Button icon={<Bike />} onClick={onAssign}>
                {v.driver ? L("غيّر الطيار", "Reassign rider") : L("وزّع على طيار", "Assign a rider")}
              </Button>
            ) : null}
            {d.stage === "assigned" ? (
              <Button variant="secondary" icon={<UserRoundX />} loading={busy === "un"} onClick={() => run("un", () => unassignDriver(db, v.order.id), L("اتشال من الطيار", "Unassigned"))}>
                {L("شيله من الطيار", "Unassign")}
              </Button>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              {[10, 20].map((m) => (
                <Button key={m} variant="outline" icon={<Clock />} loading={busy === `d${m}`} onClick={() => run(`d${m}`, () => markDelayed(db, v.order.id, m, L("ضغط في المطبخ", "Kitchen is busy")), L("العميل اتبلغ بالوقت الجديد", "Customer told the new time"))}>
                  {L(`تأخير +${m} د`, `Delay +${m} min`)}
                </Button>
              ))}
            </div>
            {d.stage === "accepted" || d.stage === "assigned" ? (
              <Button variant="ghost" className="text-danger" loading={busy === "x"} onClick={() => run("x", () => rejectOrder(db, v.order.id, L("الطلب اتلغى من المطعم", "Cancelled by the restaurant")), L("اتلغى وبلّغنا العميل", "Cancelled, customer notified"))}>
                {L("إلغاء الطلب", "Cancel order")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function AssignDialog({ orderId, data, proj, batches, onClose }: { orderId: string | null; data: DeliveryData; proj: Map<string, Projection>; batches: string[][]; onClose: () => void }) {
  const { L } = useT();
  const db = useDb();
  const { toast } = useToast();
  const v = orderId ? data.byId.get(orderId) : null;
  const [withBatch, setWithBatch] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const sugg: Suggestion[] = useMemo(() => (v ? suggestDrivers({ id: v.order.id, to: v.to, prepLeftMin: proj.get(v.order.id)?.prepLeftMin ?? 0 }, data.driverStates, data.cfg) : []), [v, data, proj]);
  const group = v ? (batches.find((g) => g.includes(v.order.id)) ?? []).filter((x) => x !== v.order.id) : [];
  const assign = async (driverId: string, s: Suggestion) => {
    if (!v) return;
    setBusy(driverId);
    try {
      const extra = withBatch ? group.filter((id) => !data.byId.get(id)?.order.driverId) : [];
      const joining = s.reason === "batch" ? s.batchWith : [];
      const first = joining[0] ? data.byId.get(joining[0])?.order : null;
      const batchId = first ? (dispatchOf(first).batchId ?? first.id) : extra.length ? v.order.id : null;
      await assignDriver(db, v.order.id, driverId, batchId);
      for (const id of extra) await assignDriver(db, id, driverId, batchId);
      for (const id of joining) {
        const o = data.byId.get(id)?.order;
        if (o && dispatchOf(o).batchId !== batchId) await db.update("orders", id, { dispatch: { ...dispatchOf(o), batchId } });
      }
      toast({ title: L(`اتوزّع على ${s.name.split(" ")[0]}`, `Assigned to ${s.name.split(" ")[0]}`), description: extra.length ? L(`ومعاه ${extra.length} طلب في نفس الرحلة`, `plus ${extra.length} more on the same trip`) : undefined, tone: "success" });
      onClose();
    } catch (e) {
      toast({ title: String((e as Error).message), tone: "error" });
    } finally {
      setBusy(null);
    }
  };
  const reasonLabel = (s: Suggestion) =>
    ({ idle: L("فاضي", "Available"), batch: L("نفس الطريق — رحلة واحدة", "Same way — one trip"), returning: L("راجع من توصيلة", "Returning from a drop"), full: L("معاه طلبات تانية", "Busy with other orders") })[s.reason];
  return (
    <Dialog open={!!v} onClose={onClose} size="md" title={v ? L(`وزّع #${v.order.number}`, `Assign #${v.order.number}`) : ""} description={L("الترتيب حسب أسرع وصول للعميل", "Ranked by fastest arrival at the customer")}>
      {v ? (
        <div className="grid gap-3">
          {group.length ? (
            <label className="flex items-center gap-3 rounded-2xl border border-info/40 bg-info-soft px-3 py-2.5 text-[13.5px] text-info">
              <input type="checkbox" className="size-5 accent-[var(--sf-info)]" checked={withBatch} onChange={(e) => setWithBatch(e.target.checked)} />
              <Layers className="size-4.5" />
              <span className="flex-1">
                {L("خده مع", "Send together with")} {group.map((x) => `#${data.byId.get(x)?.order.number}`).join(" ")} — {L(`كل العناوين في حدود ${data.cfg.batchRadiusKm} كم`, `doors within ${data.cfg.batchRadiusKm} km`)}
              </span>
            </label>
          ) : null}
          {!sugg.length ? <EmptyState compact icon={<Bike />} title={L("مفيش طيارين في الشيفت", "No riders on shift")} body={L("الطيار يبدأ الشيفت من تطبيقه", "Riders start their shift in the rider app")} /> : null}
          <ul className="grid gap-2">
            {sugg.map((s, i) => {
              const m = data.drivers.find((x) => x.id === s.driverId)!;
              const current = v.order.driverId === s.driverId;
              return (
                <li key={s.driverId}>
                  <button type="button" disabled={current || !!busy} onClick={() => assign(s.driverId, s)} className={cn("flex w-full items-center gap-3 rounded-2xl border p-3 text-start transition-colors", i === 0 && !current ? "border-primary bg-primary-soft/50" : "border-line hover:border-line-strong", current && "opacity-60")}>
                    <Avatar name={m.name} color={m.color} size="md" status="online" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-[15px] font-bold">
                        {m.name}
                        {i === 0 && !current ? <Badge tone="primary" size="sm">{L("مقترح", "Suggested")}</Badge> : null}
                        {current ? <Badge size="sm">{L("الحالي", "Current")}</Badge> : null}
                      </p>
                      <p className="text-[12.5px] text-muted">
                        {reasonLabel(s)} · <span className="num">{s.distanceKm.toFixed(1)} km</span> {L("من المطبخ", "from kitchen")}
                        {s.batchWith.length ? ` · ${L("معاه", "with")} ${s.batchWith.map((x) => `#${data.byId.get(x)?.order.number}`).join(" ")}` : ""}
                      </p>
                    </div>
                    <div className="text-end">
                      <p className="num text-[20px] font-bold leading-none">{s.etaMin}′</p>
                      <p className="text-[11px] text-muted">{L("للعميل", "to door")}</p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </Dialog>
  );
}

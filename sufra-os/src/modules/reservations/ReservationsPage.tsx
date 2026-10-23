import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Armchair, BadgeDollarSign, CalendarClock, CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Hourglass, Link2, ListOrdered, MessageSquare, Phone, Plus, Users, UserX, X } from "lucide-react";
import { useBranch, useSession } from "@/auth/session";
import { useDb } from "@/data/hooks";
import type { Reservation, ReservationStatus } from "@/data/types";
import { useDict, useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, EmptyState, IconButton, Popover, Segmented, useIsMobile, useReduced, useToast, type Tone } from "@/ui";
import { PageHeader } from "@/shell/PageHeader";
import { parseHours } from "@/modules/floor/core/availability";
import { conflictsOf } from "@/modules/floor/core/reservations";
import { coreReservation } from "@/modules/floor/model";
import { useFloorData, useFormatters } from "@/modules/floor/useFloor";
import "@/modules/floor/floor.css";
import { isoDate } from "./booking";
import { resDict } from "./dict";
import { ReservationDialog, type DraftInit } from "./ReservationDialog";
import { TAG_ICON, Timeline } from "./Timeline";
import { Waitlist } from "./Waitlist";
import { addDays, minutesLate, parseDate, sameDay, seatReservation, setStatus, useWeekReservations, weekStart } from "./useRes";

type View = "timeline" | "list" | "waitlist";
const STATUS_TONE: Record<ReservationStatus, Tone> = { pending: "brass", confirmed: "primary", seated: "info", done: "neutral", no_show: "danger", cancelled: "neutral", waiting: "warn" };

export default function ReservationsPage() {
  const r = useDict(resDict);
  const { L, loc } = useT();
  const db = useDb();
  const session = useSession();
  const branch = useBranch();
  const nav = useNavigate();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const reduced = useReduced();
  const floor = useFloorData();
  const { fmtTime } = useFormatters();
  const [date, setDate] = useState(() => isoDate(new Date()));
  const [view, setView] = useState<View>(() => (typeof window !== "undefined" && window.innerWidth < 768 ? "list" : "timeline"));
  const [filter, setFilter] = useState<"all" | ReservationStatus>("all");
  const [dialog, setDialog] = useState<{ editing: Reservation | null; init: DraftInit } | null>(null);
  const { week, waiting } = useWeekReservations(date);
  const canManage = session.can("reservations.manage");

  const hours = parseHours(branch?.openingHours);
  const dayStart = Math.floor(parseDate(date).getTime() / 60000);
  // the service night: opening → closing (may run past midnight)
  const day = useMemo(() => week.filter((x) => {
    const m = Date.parse(x.startsAt) / 60000 - dayStart;
    return m >= hours.open - 120 && m < hours.close + 60;
  }), [week, dayStart, hours.open, hours.close]);
  const live = day.filter((x) => x.status === "pending" || x.status === "confirmed" || x.status === "seated");
  const clashes = useMemo(() => {
    const core = live.map(coreReservation);
    return new Set(core.filter((c) => conflictsOf(c, core).length).map((c) => c.id));
  }, [live]);
  const labels = useMemo(() => new Map(floor.allTables.map((x) => [x.id, x.label])), [floor.allTables]);
  const capacity = (id: string) => floor.view.tables.get(id)?.capacity ?? 0;
  const layout = floor.view.layout;
  const allLive = useMemo(() => [...floor.reservations, ...week].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i), [floor.reservations, week]);

  const act = async (x: Reservation, s: ReservationStatus | "seat") => {
    try {
      if (s === "seat") {
        const tables = await seatReservation(db, x, layout, allLive, floor.checks);
        toast({ title: L(`اتقعدوا على ${tables.map((y) => labels.get(y)).join(" + ")}`, `Seated at ${tables.map((y) => labels.get(y)).join(" + ")}`), tone: "success", action: { label: L("افتح الصالة", "Open floor"), onClick: () => nav("/floor") } });
      } else {
        await setStatus(db, x, s);
        toast({ title: r(`status.${s}`), tone: s === "no_show" || s === "cancelled" ? "warn" : "success", action: { label: L("تراجع", "Undo"), onClick: () => void db.update("reservations", x.id, { status: x.status }) } });
      }
    } catch (e) {
      toast({ title: (e as Error).message === "no_table" ? r("form.noSuggest") : L("حصلت مشكلة", "Something went wrong"), tone: "error" });
    }
  };

  const copyLink = async () => {
    const slug = session.restaurant?.slug ?? "";
    const url = `${location.origin}${import.meta.env.BASE_URL}r/${slug}/book`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: r("res.copied"), description: url, tone: "success" });
    } catch {
      window.open(url, "_blank");
    }
  };

  const summary = {
    bookings: live.length,
    covers: live.reduce((s, x) => s + x.party, 0),
    pending: live.filter((x) => x.status === "pending").length,
    deposits: live.filter((x) => x.deposit).length,
  };

  const headerActions = (
    <>
      <Button variant="secondary" icon={<Link2 />} onClick={copyLink}>
        {r("res.publicLink")}
      </Button>
      {canManage ? (
        <Button icon={<Plus />} onClick={() => setDialog({ editing: null, init: { date } })}>
          {r("res.new")}
        </Button>
      ) : null}
    </>
  );

  const listed = (filter === "all" ? day : day.filter((x) => x.status === filter)).slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return (
    <div className="fl-root space-y-4">
      <PageHeader
        icon={<CalendarClock />}
        title={r("res.title")}
        subtitle={r("res.subtitle")}
        actions={isMobile ? null : headerActions}
      />

      {isMobile ? <div className="grid grid-cols-2 gap-2 [&>*]:w-full">{headerActions}</div> : null}

      <Card className="space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <IconButton label={r("res.prevDay")} variant="secondary" size="sm" onClick={() => setDate((d) => addDays(d, -1))}>
              <ChevronRight className="ltr:rotate-180" />
            </IconButton>
            <CalendarPicker date={date} onPick={setDate} week={week} />
            <IconButton label={r("res.nextDay")} variant="secondary" size="sm" onClick={() => setDate((d) => addDays(d, 1))}>
              <ChevronLeft className="ltr:rotate-180" />
            </IconButton>
            {date !== isoDate(new Date()) ? (
              <Button size="sm" variant="ghost" onClick={() => setDate(isoDate(new Date()))}>
                {r("res.today")}
              </Button>
            ) : null}
          </div>
          <div className="ms-auto">
            <Segmented
              label={r("res.view")}
              value={view}
              onChange={setView}
              options={[
                { value: "timeline", label: r("res.timeline"), icon: <CalendarDays /> },
                { value: "list", label: r("res.list"), icon: <ListOrdered />, badge: summary.pending || undefined },
                { value: "waitlist", label: r("res.waitlist"), icon: <Hourglass />, badge: waiting.length || undefined },
              ]}
            />
          </div>
        </div>
        <WeekStrip date={date} onPick={setDate} week={week} hoursOpen={hours.open} />
        <div className="flex flex-wrap gap-2">
          <Chip icon={<CalendarClock />} label={r("res.bookings")} value={summary.bookings} />
          <Chip icon={<Users />} label={r("res.covers")} value={summary.covers} />
          <Chip icon={<Clock />} label={r("res.pending")} value={summary.pending} tone={summary.pending ? "brass" : undefined} />
          <Chip icon={<BadgeDollarSign />} label={r("res.deposits")} value={summary.deposits} />
          {clashes.size ? <Chip icon={<AlertTriangle />} label={r("res.clashN", { n: clashes.size })} value={null} tone="danger" /> : null}
        </div>
      </Card>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={view} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0 }} transition={{ duration: 0.15 }}>
          {view === "timeline" ? (
            <div className="space-y-2">
              <Timeline
                dayStart={dayStart}
                hours={hours}
                zones={floor.zones}
                tables={floor.tables}
                capacity={capacity}
                reservations={day.filter((x) => x.status !== "cancelled")}
                checks={sameDay(new Date().toISOString(), date) ? floor.checks : []}
                now={floor.now}
                onOpen={(x) => setDialog({ editing: x, init: { date } })}
                onCreate={(tableId, startsAt) => canManage && setDialog({ editing: null, init: { date, startsAt, tableId } })}
                onMove={async (x, patch) => {
                  await db.update("reservations", x.id, patch);
                  toast({ title: r("res.moved"), tone: "success", action: { label: L("تراجع", "Undo"), onClick: () => void db.update("reservations", x.id, { startsAt: x.startsAt, durationMin: x.durationMin, tableIds: x.tableIds }) } });
                }}
                labels={{ unassigned: r("res.unassigned"), now: r("res.now"), seated: r("res.seatedNow"), clash: r("res.clash") }}
                fmtTime={fmtTime}
              />
              <p className="px-1 text-[12.5px] text-muted">{r("res.dragHint")}</p>
            </div>
          ) : view === "list" ? (
            <div className="space-y-3">
              <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                {(["all", "pending", "confirmed", "seated", "done", "no_show", "cancelled"] as const).map((s) => {
                  const n = s === "all" ? day.length : day.filter((x) => x.status === s).length;
                  return (
                    <button key={s} type="button" onClick={() => setFilter(s)} className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold transition-colors", filter === s ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface text-ink-2 hover:border-line-strong")}>
                      {s === "all" ? r("res.all") : r(`status.${s}`)}
                      <span className="num opacity-70">{n}</span>
                    </button>
                  );
                })}
              </div>
              {listed.length ? (
                <div className="grid gap-2.5 lg:grid-cols-2">
                  {listed.map((x) => (
                    <ResCard key={x.id} x={x} labels={labels} clash={clashes.has(x.id)} now={floor.now} fmtTime={fmtTime} canManage={canManage} onOpen={() => setDialog({ editing: x, init: { date } })} onAct={(s) => act(x, s)} />
                  ))}
                </div>
              ) : (
                <EmptyState icon={<CalendarClock />} title={r("res.empty")} body={r("res.emptyBody")} />
              )}
            </div>
          ) : (
            <Waitlist waiting={waiting} layout={layout} reservations={allLive} checks={floor.checks} now={floor.now} labels={labels} restaurantName={session.restaurant ? loc(session.restaurant.name) : ""} />
          )}
        </motion.div>
      </AnimatePresence>

      <ReservationDialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        editing={dialog?.editing ?? null}
        init={dialog?.init ?? { date }}
        layout={layout}
        tables={floor.tables}
        capacity={capacity}
        reservations={allLive.filter((x) => x.status === "pending" || x.status === "confirmed" || x.status === "seated")}
        checks={floor.checks}
      />
    </div>
  );
}

function Chip({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number | null; tone?: "brass" | "danger" }) {
  return (
    <span className={cn("inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-[13px] font-semibold [&_svg]:size-4", tone === "brass" ? "border-brass/40 bg-brass-soft text-brass-text" : tone === "danger" ? "border-danger/30 bg-danger-soft text-danger" : "border-line bg-surface-2 text-ink-2")}>
      {icon}
      <span>{label}</span>
      {value !== null ? <span className="num text-[15px] font-bold text-ink">{value}</span> : null}
    </span>
  );
}

function ResCard({ x, labels, clash, now, fmtTime, canManage, onOpen, onAct }: { x: Reservation; labels: Map<string, string>; clash: boolean; now: number; fmtTime: (iso: string) => string; canManage: boolean; onOpen: () => void; onAct: (s: ReservationStatus | "seat") => void }) {
  const r = useDict(resDict);
  const { t } = useT();
  const open = x.status === "pending" || x.status === "confirmed";
  const late = open ? minutesLate(x, now) : 0;
  return (
    <Card className={cn("p-3.5 transition-shadow hover:shadow-sf", clash && "ring-2 ring-danger/60")}>
      <div className="flex items-start gap-3">
        <button type="button" onClick={onOpen} className="grid w-16 shrink-0 place-items-center rounded-2xl bg-surface-2 py-2 text-center hover:bg-surface-3">
          <span className="num text-[16px] font-bold leading-tight">{fmtTime(x.startsAt)}</span>
          <span className="num text-[11px] text-muted">{x.durationMin}′</span>
        </button>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onOpen} className="flex max-w-full items-center gap-2 text-start">
            <span className="truncate text-[16px] font-bold">{x.name}</span>
            <Badge tone={STATUS_TONE[x.status]} size="sm" dot={x.status === "pending"} pulse={x.status === "pending"}>
              {r(`status.${x.status}`)}
            </Badge>
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" />
              {t("common.guests", { n: x.party })}
            </span>
            <span className="inline-flex items-center gap-1 font-semibold text-ink-2">
              <Armchair className="size-3.5" />
              {x.tableIds.length ? x.tableIds.map((id) => labels.get(id) ?? "?").join(" + ") : r("res.unassigned")}
            </span>
            {x.tags.map((tg) => {
              const I = TAG_ICON[tg];
              return (
                <span key={tg} className="inline-flex items-center gap-1 text-brass-text">
                  <I className="size-3.5" />
                  {r(`tag.${tg}`)}
                </span>
              );
            })}
            {x.deposit ? (
              <span className={cn("inline-flex items-center gap-1 font-semibold", x.depositPaid ? "text-ok" : "text-warn")}>
                <BadgeDollarSign className="size-3.5" />
                {r("form.deposit")}
              </span>
            ) : null}
            <span className="text-faint">{r(`src.${x.source}`)}</span>
          </div>
          {x.note ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-ink-2">
              <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-faint" />
              {x.note}
            </p>
          ) : null}
          {late > 15 ? (
            <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-danger-soft px-2 py-1 text-[12.5px] font-bold text-danger">
              <AlertTriangle className="size-3.5" /> {r("res.late", { n: late })}
            </p>
          ) : null}
          {clash ? (
            <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-danger-soft px-2 py-1 text-[12.5px] font-bold text-danger">
              <AlertTriangle className="size-3.5" /> {r("res.clash")}
            </p>
          ) : null}
        </div>
      </div>
      {canManage && (open || x.status === "no_show" || x.status === "cancelled") ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
          {x.status === "pending" ? (
            <Button size="sm" variant="soft" icon={<Check />} onClick={() => onAct("confirmed")}>
              {r("act.confirm")}
            </Button>
          ) : null}
          {open ? (
            <Button size="sm" icon={<Armchair />} onClick={() => onAct("seat")}>
              {r("act.seat")}
            </Button>
          ) : null}
          {open && late > 0 ? (
            <Button size="sm" variant="danger-soft" icon={<UserX />} onClick={() => onAct("no_show")}>
              {r("act.noShow")}
            </Button>
          ) : null}
          {open ? (
            <Button size="sm" variant="ghost" icon={<X />} onClick={() => onAct("cancelled")}>
              {r("act.cancel")}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => onAct("confirmed")}>
              {r("act.restore")}
            </Button>
          )}
          {x.phone ? (
            <a href={`tel:${x.phone}`} className="ms-auto inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[13.5px] font-semibold text-primary hover:bg-primary-soft">
              <Phone className="size-4" />
              <span className="num ltr">{x.phone}</span>
            </a>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function WeekStrip({ date, onPick, week, hoursOpen }: { date: string; onPick: (d: string) => void; week: Reservation[]; hoursOpen: number }) {
  const { lang } = useT();
  const ws = weekStart(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const covers = days.map((d) => {
    const start = parseDate(d).getTime() / 60000;
    return week.filter((x) => (x.status === "pending" || x.status === "confirmed" || x.status === "seated" || x.status === "done") && Date.parse(x.startsAt) / 60000 - start >= hoursOpen - 120 && Date.parse(x.startsAt) / 60000 - start < 1440 + 360).reduce((s, x) => s + x.party, 0);
  });
  const max = Math.max(10, ...covers);
  const today = isoDate(new Date());
  return (
    <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
      {days.map((d, i) => {
        const dt = parseDate(d);
        const on = d === date;
        return (
          <button key={d} type="button" onClick={() => onPick(d)} aria-pressed={on} className={cn("relative flex flex-col items-center overflow-hidden rounded-xl border px-1 pt-1.5 pb-2 transition-colors", on ? "border-primary bg-primary-soft" : "border-line bg-surface hover:border-line-strong")}>
            <span className={cn("text-[11px] font-semibold", on ? "text-primary" : "text-muted")}>{dt.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { weekday: "short" })}</span>
            <span className={cn("num text-[17px] font-bold leading-tight", d === today && !on && "text-primary")}>{dt.getDate()}</span>
            <span className="num text-[10.5px] text-muted">{covers[i] ? `${covers[i]} ⦁` : "–"}</span>
            <span className="absolute inset-x-0 bottom-0 h-1 bg-surface-3">
              <span className="block h-full bg-primary/70 transition-[width] duration-500" style={{ width: `${(covers[i] / max) * 100}%` }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CalendarPicker({ date, onPick, week }: { date: string; onPick: (d: string) => void; week: Reservation[] }) {
  const r = useDict(resDict);
  const { lang } = useT();
  const [month, setMonth] = useState(() => date.slice(0, 7));
  const d = parseDate(date);
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 1) % 7; // Saturday first
  const daysIn = new Date(y, m, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  const today = isoDate(new Date());
  const busy = new Set(week.map((x) => isoDate(new Date(x.startsAt))));
  const shift = (n: number) => {
    const nd = new Date(y, m - 1 + n, 1);
    setMonth(`${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, "0")}`);
  };
  const wd = Array.from({ length: 7 }, (_, i) => new Date(2026, 0, 3 + i).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { weekday: "narrow" }));
  return (
    <Popover
      width="w-80"
      trigger={({ props }) => (
        <button type="button" {...props} aria-label={r("res.pickDate")} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-[14px] font-bold hover:border-line-strong">
          <CalendarDays className="size-4 text-primary" />
          {d.toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "long" })}
        </button>
      )}
    >
      {(close) => (
        <div className="p-2">
          <div className="mb-2 flex items-center justify-between">
            <IconButton size="sm" label="‹" onClick={() => shift(-1)}>
              <ChevronRight className="ltr:rotate-180" />
            </IconButton>
            <span className="text-[14px] font-bold">{first.toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { month: "long", year: "numeric" })}</span>
            <IconButton size="sm" label="›" onClick={() => shift(1)}>
              <ChevronLeft className="ltr:rotate-180" />
            </IconButton>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {wd.map((w, i) => (
              <span key={i} className="py-1 text-[11px] font-semibold text-faint">
                {w}
              </span>
            ))}
            {cells.map((n, i) => {
              if (!n) return <span key={i} />;
              const iso = `${month}-${String(n).padStart(2, "0")}`;
              const on = iso === date;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    onPick(iso);
                    close();
                  }}
                  className={cn("num relative grid h-9 place-items-center rounded-lg text-[13.5px] font-semibold transition-colors", on ? "bg-primary text-primary-ink" : iso === today ? "text-primary ring-1 ring-primary/40" : "hover:bg-surface-3")}
                >
                  {n}
                  {busy.has(iso) && !on ? <span className="absolute bottom-1 size-1 rounded-full bg-brass" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Popover>
  );
}

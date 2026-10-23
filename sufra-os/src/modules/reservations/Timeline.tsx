/**
 * Reservations timeline (Gantt): one row per table, time across. Drag a booking to move it in time or
 * to another table, drag its end edge to change the length (15-minute steps). Clashes (same table,
 * overlapping incl. the turnover buffer — sufra-floor conflictsOf) are outlined in red, live while dragging.
 * Time runs with the reading direction (right → left in Arabic).
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { AlertTriangle, Baby, BadgeDollarSign, Cake, Cigarette, Crown, Users, VolumeX } from "lucide-react";
import type { Check, DiningTable, Reservation, ReservationTag, Zone } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { conflictsOf, expectedStay } from "@/modules/floor/core/reservations";
import { coreReservation, toMin } from "@/modules/floor/model";

export const TAG_ICON: Record<ReservationTag, typeof Crown> = { vip: Crown, birthday: Cake, kids: Baby, quiet: VolumeX, smoking: Cigarette };
const STEP = 15;
const ROW_H = 54;

export interface TimelineProps {
  dayStart: number; // epoch minute of local midnight
  hours: { open: number; close: number };
  zones: Zone[];
  tables: DiningTable[];
  capacity: (id: string) => number;
  reservations: Reservation[];
  checks: Check[];
  now: number; // epoch ms
  onOpen: (r: Reservation) => void;
  onCreate: (tableId: string | null, startsAt: string) => void;
  onMove: (r: Reservation, patch: { startsAt: string; durationMin: number; tableIds: string[] }) => void;
  labels: { unassigned: string; now: string; seated: string; clash: string };
  fmtTime: (iso: string) => string;
}

type Drag = { id: string; kind: "move" | "resize"; x0: number; y0: number; startMin: number; dur: number; row: number; moved: boolean; dMin: number; dRow: number; dDur: number };

export function Timeline(p: TimelineProps) {
  const { dir, L } = useT();
  const rtl = dir === "rtl";
  const scroller = useRef<HTMLDivElement>(null);
  const [ppm, setPpm] = useState(2.2);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPpm(el.clientWidth < 600 ? 1.5 : el.clientWidth < 1000 ? 1.9 : 2.2));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const span = p.hours.close - p.hours.open;
  const width = span * ppm;

  const rows = useMemo(() => {
    const list: ({ kind: "zone"; zone: Zone } | { kind: "table"; table: DiningTable } | { kind: "none" })[] = [{ kind: "none" }];
    for (const z of p.zones) {
      const ts = p.tables.filter((t) => t.zoneId === z.id).sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }));
      if (!ts.length) continue;
      list.push({ kind: "zone", zone: z });
      for (const t of ts) list.push({ kind: "table", table: t });
    }
    return list;
  }, [p.zones, p.tables]);
  const rowIndexOf = (tableId: string | null) => rows.findIndex((r) => (tableId ? r.kind === "table" && r.table.id === tableId : r.kind === "none"));

  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef(drag);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  const draft = (r: Reservation): Reservation => {
    const d = drag;
    if (!d || d.id !== r.id || !d.moved) return r;
    const startsAt = new Date((toMin(r.startsAt) + d.dMin) * 60000).toISOString();
    let tableIds = r.tableIds;
    if (d.dRow && r.tableIds.length <= 1) {
      const target = targetRow(d.row + d.dRow);
      tableIds = target && target.kind === "table" ? [target.table.id] : target?.kind === "none" ? [] : r.tableIds;
    }
    return { ...r, startsAt, durationMin: Math.max(30, r.durationMin + d.dDur), tableIds };
  };
  const targetRow = (i: number) => {
    // skip zone header rows
    let j = Math.max(0, Math.min(rows.length - 1, i));
    while (rows[j] && rows[j].kind === "zone") j += i >= (dragRef.current?.row ?? 0) ? 1 : -1;
    return rows[j];
  };

  const drafts = p.reservations.map(draft);
  const clashes = new Set(drafts.filter((r) => conflictsOf(coreReservation(r), drafts.map(coreReservation)).length > 0).map((r) => r.id));

  const x = (min: number) => (min - p.dayStart - p.hours.open) * ppm;

  const onDown = (e: RPointerEvent, r: Reservation, kind: "move" | "resize") => {
    if (r.status !== "pending" && r.status !== "confirmed") return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ id: r.id, kind, x0: e.clientX, y0: e.clientY, startMin: toMin(r.startsAt), dur: r.durationMin, row: rowIndexOf(r.tableIds[0] ?? null), moved: false, dMin: 0, dRow: 0, dDur: 0 });
  };
  const onMoveP = (e: RPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.x0) * (rtl ? -1 : 1);
    const dy = e.clientY - d.y0;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    const dm = Math.round(dx / ppm / STEP) * STEP;
    if (d.kind === "resize") setDrag({ ...d, moved: true, dDur: Math.max(30 - d.dur, dm) });
    else setDrag({ ...d, moved: true, dMin: dm, dRow: Math.round(dy / ROW_H) });
  };
  const onUp = (r: Reservation) => {
    const d = dragRef.current;
    setDrag(null);
    if (!d) return;
    if (!d.moved) return p.onOpen(r);
    const next = draftFrom(r, d);
    if (next.startsAt !== r.startsAt || next.durationMin !== r.durationMin || next.tableIds.join() !== r.tableIds.join()) p.onMove(r, { startsAt: next.startsAt, durationMin: next.durationMin, tableIds: next.tableIds });
  };
  const draftFrom = (r: Reservation, d: Drag) => {
    const startsAt = new Date((toMin(r.startsAt) + d.dMin) * 60000).toISOString();
    let tableIds = r.tableIds;
    if (d.dRow && r.tableIds.length <= 1) {
      const t = targetRow(d.row + d.dRow);
      tableIds = t?.kind === "table" ? [t.table.id] : t?.kind === "none" ? [] : r.tableIds;
    }
    return { startsAt, durationMin: Math.max(30, r.durationMin + d.dDur), tableIds };
  };

  const onEmpty = (e: React.MouseEvent<HTMLDivElement>, tableId: string | null) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const off = rtl ? rect.right - e.clientX : e.clientX - rect.left;
    const m = Math.floor(off / ppm / STEP) * STEP + p.hours.open;
    p.onCreate(tableId, new Date((p.dayStart + m) * 60000).toISOString());
  };

  // scroll to "now" (or opening) once
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const nowMin = p.now / 60000;
    const target = nowMin > p.dayStart + p.hours.open && nowMin < p.dayStart + p.hours.close ? x(nowMin) - 160 : x(p.dayStart + p.hours.open + 6 * 60) - 40;
    el.scrollLeft = rtl ? -Math.max(0, target) : Math.max(0, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.dayStart, ppm]);

  const hoursList: number[] = [];
  for (let m = Math.ceil(p.hours.open / 60) * 60; m <= p.hours.close; m += 60) hoursList.push(m);
  const nowX = x(p.now / 60000);
  const showNow = nowX >= 0 && nowX <= width;
  const start = (n: number) => (rtl ? { right: n } : { left: n });

  const seated = p.checks.filter((c) => (c.status === "open" || c.status === "bill_requested") && toMin(c.openedAt) >= p.dayStart && toMin(c.openedAt) < p.dayStart + 1440 + 360);

  return (
    <div className="fl-root relative flex overflow-hidden rounded-[20px] border border-line bg-surface" onPointerMove={onMoveP}>
      {/* table names */}
      <div className="z-10 w-[6.5rem] shrink-0 border-e border-line bg-surface sm:w-[8.5rem]">
        <div className="h-10 border-b border-line" />
        {rows.map((r, i) =>
          r.kind === "zone" ? (
            <div key={"z" + r.zone.id} className="flex h-8 items-center bg-surface-2 px-3 text-[12px] font-bold text-muted">
              {L(r.zone.name.ar, r.zone.name.en)}
            </div>
          ) : (
            <div key={i} className={cn("flex items-center justify-between gap-1 border-b border-line/70 px-3", r.kind === "none" && "bg-brass-soft/30")} style={{ height: ROW_H }}>
              <span className={cn("truncate font-bold", r.kind === "none" ? "text-[12px] text-brass-text" : "text-[15px]")}>{r.kind === "none" ? p.labels.unassigned : r.table.label}</span>
              {r.kind === "table" ? (
                <span className="inline-flex items-center gap-0.5 text-[11.5px] text-faint">
                  <Users className="size-3" />
                  <span className="num">{p.capacity(r.table.id)}</span>
                </span>
              ) : null}
            </div>
          ),
        )}
      </div>
      {/* grid */}
      <div ref={scroller} className="relative min-w-0 flex-1 overflow-x-auto thin-scrollbar">
        <div className="relative" style={{ width }}>
          <div className="sticky top-0 z-[5] h-10 border-b border-line bg-surface/95 backdrop-blur">
            {hoursList.map((m) => (
              <span key={m} className="absolute top-0 flex h-10 items-center text-[12px] font-semibold text-muted" style={{ ...start(x(p.dayStart + m) + 6) }}>
                <span className="num">{p.fmtTime(new Date((p.dayStart + m) * 60000).toISOString())}</span>
              </span>
            ))}
          </div>
          {rows.map((r, i) => {
            if (r.kind === "zone") return <div key={"zg" + r.zone.id} className="h-8 bg-surface-2/70" />;
            const tid = r.kind === "table" ? r.table.id : null;
            const hl = drag?.moved && drag.dRow !== 0 && targetRow(drag.row + drag.dRow) === r;
            return (
              <div key={"row" + i} className={cn("relative border-b border-line/70", r.kind === "none" && "bg-brass-soft/20", hl && "bg-primary-soft/50")} style={{ height: ROW_H }} onClick={(e) => onEmpty(e, tid)}>
                {hoursList.map((m) => (
                  <span key={m} className="rs-grid-line absolute inset-y-0 border-s" style={start(x(p.dayStart + m))} />
                ))}
                {tid
                  ? seated
                      .filter((c) => c.tableIds.includes(tid))
                      .map((c) => {
                        const s = toMin(c.openedAt);
                        const e = Math.max(p.now / 60000, s + expectedStay(c.guests));
                        return (
                          <div key={c.id} className="fl-st-occupied pointer-events-none absolute top-2 bottom-2 overflow-hidden rounded-xl border border-dashed opacity-80" style={{ ...start(x(s)), width: Math.max(8, (e - s) * ppm), background: "repeating-linear-gradient(135deg, var(--f) 0 8px, transparent 8px 14px)", borderColor: "var(--c)" }}>
                            <span className="fl-text block truncate px-2 pt-1.5 text-[11.5px] font-bold">{p.labels.seated}</span>
                          </div>
                        );
                      })
                  : null}
                {drafts
                  .filter((d) => (tid ? d.tableIds.includes(tid) : d.tableIds.length === 0))
                  .map((d) => {
                    const orig = p.reservations.find((o) => o.id === d.id)!;
                    return <Block key={d.id + (tid ?? "")} r={d} left={x(toMin(d.startsAt))} width={d.durationMin * ppm} clash={clashes.has(d.id)} dragging={drag?.id === d.id && drag.moved} start={start} onDown={(e, k) => onDown(e, orig, k)} onUp={() => onUp(orig)} fmtTime={p.fmtTime} now={p.now} clashLabel={p.labels.clash} />;
                  })}
              </div>
            );
          })}
          {showNow ? (
            <div className="pointer-events-none absolute top-0 bottom-0 z-[6] w-0.5 bg-danger" style={start(nowX)}>
              <span className="absolute -top-0 -translate-x-1/2 rounded-full bg-danger px-1.5 py-0.5 text-[10.5px] font-bold text-white rtl:translate-x-1/2">{p.labels.now}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  pending: "border-2 border-dashed border-brass bg-brass-soft text-brass-text",
  confirmed: "border border-primary/40 bg-primary-soft text-primary",
  seated: "fl-st-occupied fl-soft border border-[var(--c)] fl-text",
  done: "border border-line bg-surface-3 text-faint",
  no_show: "border border-danger/30 bg-danger-soft/60 text-danger line-through",
  cancelled: "border border-line bg-surface-2 text-faint line-through",
};

function Block({ r, left, width, clash, dragging, start, onDown, onUp, fmtTime, now, clashLabel }: { r: Reservation; left: number; width: number; clash: boolean; dragging: boolean; start: (n: number) => { left?: number; right?: number }; onDown: (e: RPointerEvent, k: "move" | "resize") => void; onUp: () => void; fmtTime: (iso: string) => string; now: number; clashLabel: string }) {
  const editable = r.status === "pending" || r.status === "confirmed";
  const late = editable && now > Date.parse(r.startsAt) + 15 * 60000;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${r.name} · ${fmtTime(r.startsAt)} · ${r.party}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.key === "Enter" && onUp()}
      onPointerDown={(e) => onDown(e, "move")}
      onPointerUp={onUp}
      className={cn(
        "group absolute top-1.5 bottom-1.5 select-none overflow-hidden rounded-xl px-2 py-1 shadow-sf-sm transition-[box-shadow,transform] [touch-action:none]",
        STATUS_STYLE[r.status],
        editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        clash && "ring-2 ring-danger ring-offset-1 ring-offset-[var(--sf-surface)]",
        dragging && "z-20 scale-[1.02] shadow-sf-lg",
      )}
      style={{ ...start(left), width: Math.max(26, width - 3) }}
    >
      <div className="flex items-center gap-1 text-[12.5px] font-bold leading-tight">
        {clash ? <AlertTriangle className="size-3.5 shrink-0 text-danger" aria-label={clashLabel} /> : null}
        {late ? <span className="size-2 shrink-0 animate-pulse rounded-full bg-danger" /> : null}
        <span className="truncate">{r.name}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold opacity-85">
        <span className="num">{fmtTime(r.startsAt)}</span>
        <span className="inline-flex items-center gap-0.5">
          <Users className="size-3" />
          <span className="num">{r.party}</span>
        </span>
        {r.tags.map((t) => {
          const I = TAG_ICON[t];
          return <I key={t} className="size-3 shrink-0" />;
        })}
        {r.deposit ? <BadgeDollarSign className={cn("size-3 shrink-0", r.depositPaid ? "text-ok" : "text-warn")} /> : null}
      </div>
      {editable ? (
        <span
          aria-hidden
          onPointerDown={(e) => onDown(e, "resize")}
          className="absolute inset-y-0 end-0 w-3 cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100 [touch-action:none]"
          style={{ background: "linear-gradient(to var(--tw-end, right), transparent, color-mix(in srgb, currentColor 30%, transparent))" }}
        />
      ) : null}
    </div>
  );
}

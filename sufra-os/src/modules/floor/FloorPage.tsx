import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BellRing, CalendarClock, Combine, Gauge, Hourglass, LayoutGrid, MousePointerClick, Move, PencilRuler, Radio, Users, X } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb } from "@/data/hooks";
import type { DecorKind, DiningTable, FloorDecor, TableShape, Zone, ZoneBackground } from "@/data/types";
import { useDict, useT } from "@/i18n/i18n";
import { uuid } from "@/lib/id";
import { cn } from "@/lib/cn";
import { nowIso } from "@/lib/time";
import { AnimatedNumber, Button, Card, EmptyState, Segmented, Skeleton, Tabs, useHotkeys, useIsMobile, useReduced, useToast } from "@/ui";
import { PageHeader } from "@/shell/PageHeader";
import { floorDict } from "./dict";
import { FloorCanvas, STATE_ICON, type CanvasMode, type Suggestion } from "./FloorCanvas";
import { TableSheet } from "./TableSheet";
import { DesignToolbar, Inspector, type InspectorTab } from "./DesignPanel";
import { bbox, overlapping } from "./core/geometry";
import { changeShape, nextLabel } from "./core/layout";
import { turnStats } from "./core/analytics";
import { calibrate, demoPlanSvg, initialBackground, loadDrawing, suggestFromDrawing } from "./drawing";
import { DECOR_DEFAULT, FLOOR_STATES, toMin, type FloorState } from "./model";
import { mergeTables, reconcileContacts, transferTable, type LayoutPatch } from "./ops";
import { inverse, useFloorData, useFormatters, useLayoutHistory, type LayoutOp } from "./useFloor";
import "./floor.css";

const DEFAULT_SIZE: Record<TableShape, { w: number; h: number }> = {
  square: { w: 80, h: 80 },
  rect: { w: 160, h: 80 },
  round: { w: 110, h: 110 },
  oval: { w: 200, h: 110 },
  booth: { w: 180, h: 110 },
  bar: { w: 240, h: 50 },
};

type Pick = { kind: "transfer" | "merge"; from: string } | null;

export default function FloorPage() {
  const f = useDict(floorDict);
  const { t, loc, L } = useT();
  const db = useDb();
  const session = useSession();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const reduced = useReduced();
  const data = useFloorData();
  const { fmtMoney, fmtElapsed, fmtTime } = useFormatters();
  const history = useLayoutHistory();

  const canArrange = session.can("floor.manage");
  const canDesign = session.can("floor.edit");
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [mode, setMode] = useState<CanvasMode>("live");
  const [selected, setSelected] = useState<string[]>([]);
  const [multi, setMulti] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick>(null);
  const [snap, setSnap] = useState(true);
  const [fitSignal, setFitSignal] = useState(0);
  const [tab, setTab] = useState<InspectorTab>("item");
  const [calibrating, setCalibrating] = useState(false);
  const [calibLine, setCalibLine] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const zone = data.zones.find((z) => z.id === zoneId) ?? data.zones[0] ?? null;
  useEffect(() => {
    if (!zoneId && data.zones[0]) setZoneId(data.zones[0].id);
  }, [zoneId, data.zones]);
  const zoneTables = useMemo(() => (zone ? data.tables.filter((x) => x.zoneId === zone.id) : []), [data.tables, zone]);
  const zoneDecor = useMemo(() => (zone ? data.decor.filter((x) => x.zoneId === zone.id) : []), [data.decor, zone]);
  const labels = useMemo(() => new Map(data.allTables.map((x) => [x.id, x.label])), [data.allTables]);
  const waiters = useMemo(() => data.members.filter((m) => m.role === "waiter" || m.role === "manager"), [data.members]);

  // leaving design mode clears design-only state
  useEffect(() => {
    setSelected([]);
    setMulti(false);
    setPick(null);
    setCalibrating(false);
    setCalibLine(null);
    setSuggestions(null);
  }, [mode, zone?.id]);

  /* ───────────── live interactions ───────────── */

  const onTableTap = useCallback(
    async (id: string, how: { long: boolean; toggle: boolean }) => {
      if (mode === "design") return;
      if (pick) {
        const from = data.view.tables.get(pick.from);
        const target = data.view.tables.get(id);
        setPick(null);
        if (!from || !target || id === pick.from) return;
        try {
          if (pick.kind === "transfer" && from.check) {
            await transferTable(db, from.check, pick.from, id);
            toast({ title: f("toast.transferred", { t: target.table.label }), tone: "success" });
          } else {
            await mergeTables(db, [...new Set([...(from.check?.tableIds ?? [pick.from]), id])]);
            toast({ title: f("toast.mergedManual"), tone: "success" });
          }
        } catch {
          toast({ title: f("toast.error"), tone: "error" });
        }
        return;
      }
      if (how.long || multi) {
        setMulti(true);
        setSheetId(null);
        setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
        return;
      }
      setSelected([id]);
      setSheetId(id);
    },
    [mode, pick, multi, data.view, db, toast, f],
  );

  const mergeSelected = async () => {
    const ids = selected;
    setSelected([]);
    setMulti(false);
    try {
      await mergeTables(db, ids);
      toast({ title: f("toast.mergedManual"), tone: "success" });
    } catch {
      toast({ title: f("toast.error"), tone: "error" });
    }
  };

  /* ───────────── layout writes (arrange + design) ───────────── */

  const findRow = (id: string): DiningTable | FloorDecor | undefined => data.allTables.find((x) => x.id === id) ?? data.decor.find((x) => x.id === id);

  const pushStep = async (redo: LayoutOp[], undo: LayoutOp[], reconcileTables = false) => {
    const before = data.allTables;
    await history.push({ redo, undo });
    if (!reconcileTables) return;
    const patches = new Map(redo.filter((o) => o.type === "update" && o.c === "tables").map((o) => [(o as { id: string }).id, (o as { patch: object }).patch]));
    if (!patches.size) return;
    const after = before.map((x) => (patches.has(x.id) ? ({ ...x, ...patches.get(x.id) } as DiningTable) : x));
    try {
      const r = await reconcileContacts(db, before, after, data.links);
      if (r.merged.length) toast({ title: f("toast.merged"), tone: "success" });
      else if (r.separated.length) {
        const c = data.checks.find((x) => x.id === r.separated[0]);
        if (c)
          toast({
            title: f("toast.separated"),
            tone: "warn",
            duration: 8000,
            action: { label: f("toast.splitIt"), onClick: () => void import("./ops").then((m) => m.splitByTable(db, c)).then(() => toast({ title: f("toast.split"), tone: "success" })) },
          });
      }
    } catch {
      /* layout saved; merge failed quietly */
    }
  };

  const onCommit = (patches: LayoutPatch[]) => {
    const redo: LayoutOp[] = [];
    const undo: LayoutOp[] = [];
    for (const p of patches) {
      const row = findRow(p.id);
      if (!row) continue;
      redo.push({ type: "update", c: p.c, id: p.id, patch: p.patch });
      undo.push({ type: "update", c: p.c, id: p.id, patch: inverse(row, p.patch as never) });
    }
    void pushStep(redo, undo, true);
  };

  const patchSelected = (patch: Partial<DiningTable & FloorDecor>) => {
    const redo: LayoutOp[] = [];
    const undo: LayoutOp[] = [];
    for (const id of selected) {
      const row = findRow(id);
      if (!row) continue;
      const isT = "label" in row;
      const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => isT || !["label", "code", "seatsOverride", "shape"].includes(k)));
      redo.push({ type: "update", c: isT ? "tables" : "floorDecor", id, patch: clean });
      undo.push({ type: "update", c: isT ? "tables" : "floorDecor", id, patch: inverse(row, clean as never) });
    }
    void pushStep(redo, undo, "w" in patch || "h" in patch || "x" in patch || "y" in patch || "rotation" in patch);
  };

  const codePrefix = useMemo(() => {
    const m = data.allTables[0]?.code.match(/^[A-Z]+/);
    return m ? m[0] : "T";
  }, [data.allTables]);

  const freeSpot = (w: number, h: number, z: Zone, taken: { x: number; y: number; w: number; h: number; rotation: number }[]) => {
    const cx = z.width / 2;
    const cy = z.height / 2;
    for (let r = 0; r < Math.max(z.width, z.height); r += 40)
      for (let a = 0; a < 360; a += r ? Math.max(10, 3600 / r) : 360) {
        const x = Math.round((cx + r * Math.cos((a * Math.PI) / 180)) / 10) * 10;
        const y = Math.round((cy + r * Math.sin((a * Math.PI) / 180)) / 10) * 10;
        if (x - w / 2 < 20 || y - h / 2 < 20 || x + w / 2 > z.width - 20 || y + h / 2 > z.height - 20) continue;
        const me = { x, y, w: w + 80, h: h + 80, rotation: 0 };
        if (!taken.some((o) => overlapping(me, o))) return { x, y };
      }
    return { x: cx, y: cy };
  };

  const newTableRow = (shape: TableShape, at: { x: number; y: number }, size = DEFAULT_SIZE[shape], used: string[] = []): DiningTable => {
    const all = [...data.allTables, ...used.map((l) => ({ label: l }) as DiningTable)];
    const label = nextLabel(all as never, "");
    let code = `${codePrefix}${label.padStart(2, "0")}`;
    while (data.allTables.some((x) => x.code === code)) code += "A";
    const ts = nowIso();
    return {
      id: uuid(), restaurantId: db.restaurantId, createdAt: ts, updatedAt: ts, branchId: zone!.branchId, zoneId: zone!.id, label, code, shape, x: at.x, y: at.y, w: size.w, h: size.h, rotation: 0,
      seatsOverride: null, status: "free", statusSince: null, active: true,
    };
  };

  const addTable = (shape: TableShape) => {
    if (!zone) return;
    const size = DEFAULT_SIZE[shape];
    const row = newTableRow(shape, freeSpot(size.w, size.h, zone, [...zoneTables, ...zoneDecor]));
    void pushStep([{ type: "insert", c: "tables", row }], [{ type: "remove", c: "tables", id: row.id }]).then(() => {
      setSelected([row.id]);
      setTab("item");
    });
  };

  const addDecor = (kind: DecorKind) => {
    if (!zone) return;
    const size = DECOR_DEFAULT[kind];
    const ts = nowIso();
    const row: FloorDecor = { id: uuid(), restaurantId: db.restaurantId, createdAt: ts, updatedAt: ts, zoneId: zone.id, kind, ...freeSpot(size.w, size.h, zone, [...zoneTables, ...zoneDecor]), ...size, rotation: 0 };
    void pushStep([{ type: "insert", c: "floorDecor", row }], [{ type: "remove", c: "floorDecor", id: row.id }]).then(() => {
      setSelected([row.id]);
      setTab("item");
    });
  };

  const duplicate = () => {
    const redo: LayoutOp[] = [];
    const undo: LayoutOp[] = [];
    const ids: string[] = [];
    const used: string[] = [];
    for (const id of selected) {
      const row = findRow(id);
      if (!row || !zone) continue;
      const at = { x: Math.min(zone.width - row.w / 2, row.x + 40), y: Math.min(zone.height - row.h / 2, row.y + 40) };
      if ("label" in row) {
        const copy = { ...newTableRow(row.shape, at, { w: row.w, h: row.h }, used), rotation: row.rotation, seatsOverride: row.seatsOverride };
        used.push(copy.label);
        redo.push({ type: "insert", c: "tables", row: copy });
        undo.push({ type: "remove", c: "tables", id: copy.id });
        ids.push(copy.id);
      } else {
        const ts = nowIso();
        const copy: FloorDecor = { ...row, ...at, id: uuid(), createdAt: ts, updatedAt: ts };
        redo.push({ type: "insert", c: "floorDecor", row: copy });
        undo.push({ type: "remove", c: "floorDecor", id: copy.id });
        ids.push(copy.id);
      }
    }
    if (redo.length) void pushStep(redo, undo).then(() => setSelected(ids));
  };

  const removeSelected = () => {
    const busy = selected.filter((id) => data.view.tables.get(id)?.check);
    if (busy.length) {
      toast({ title: f("toast.busy"), tone: "error" });
      return;
    }
    const redo: LayoutOp[] = [];
    const undo: LayoutOp[] = [];
    for (const id of selected) {
      const row = findRow(id);
      if (!row) continue;
      const c = "label" in row ? "tables" : "floorDecor";
      redo.push({ type: "remove", c, id });
      undo.push({ type: "insert", c, row });
    }
    setSelected([]);
    void pushStep(redo, undo, true);
  };

  const rotateSelected = () => {
    const redo: LayoutOp[] = [];
    const undo: LayoutOp[] = [];
    for (const id of selected) {
      const row = findRow(id);
      if (!row) continue;
      const c = "label" in row ? "tables" : "floorDecor";
      redo.push({ type: "update", c, id, patch: { rotation: (row.rotation + 45) % 360 } });
      undo.push({ type: "update", c, id, patch: { rotation: row.rotation } });
    }
    void pushStep(redo, undo, true);
  };

  const setShape = (s: TableShape) => {
    const row = findRow(selected[0]);
    if (!row || !("label" in row)) return;
    const next = changeShape(row, s);
    patchSelected({ shape: next.shape, w: next.w, h: next.h });
  };

  const align = (k: "left" | "cx" | "right" | "top" | "cy" | "bottom" | "dh" | "dv") => {
    const rows = selected.map(findRow).filter(Boolean) as (DiningTable | FloorDecor)[];
    if (rows.length < 2) return;
    const boxes = rows.map((r) => ({ r, b: bbox("kind" in r ? { ...r, shape: r.kind } : r) }));
    const U = { x1: Math.min(...boxes.map((x) => x.b.x1)), y1: Math.min(...boxes.map((x) => x.b.y1)), x2: Math.max(...boxes.map((x) => x.b.x2)), y2: Math.max(...boxes.map((x) => x.b.y2)) };
    const target = new Map<string, { x: number; y: number }>();
    if (k === "dh" || k === "dv") {
      const axis = k === "dh" ? "x" : "y";
      const sorted = [...boxes].sort((a, b) => a.r[axis] - b.r[axis]);
      const first = sorted[0].r[axis];
      const last = sorted[sorted.length - 1].r[axis];
      sorted.forEach((x, i) => target.set(x.r.id, { x: x.r.x, y: x.r.y, [axis]: Math.round(first + ((last - first) * i) / (sorted.length - 1)) }));
    } else
      for (const { r, b } of boxes) {
        const hw = (b.x2 - b.x1) / 2;
        const hh = (b.y2 - b.y1) / 2;
        const x = k === "left" ? U.x1 + hw : k === "right" ? U.x2 - hw : k === "cx" ? (U.x1 + U.x2) / 2 : r.x;
        const y = k === "top" ? U.y1 + hh : k === "bottom" ? U.y2 - hh : k === "cy" ? (U.y1 + U.y2) / 2 : r.y;
        target.set(r.id, { x: Math.round(x), y: Math.round(y) });
      }
    onCommit([...target].map(([id, p]) => ({ c: data.allTables.some((x) => x.id === id) ? "tables" : "floorDecor", id, patch: p })));
  };

  const patchZone = (patch: Partial<Zone>) => {
    if (!zone) return;
    void pushStep([{ type: "update", c: "zones", id: zone.id, patch }], [{ type: "update", c: "zones", id: zone.id, patch: inverse(zone, patch) }]);
  };

  const addZone = () => {
    const ts = nowIso();
    const n = data.zones.length + 1;
    const row: Zone = { id: uuid(), restaurantId: db.restaurantId, createdAt: ts, updatedAt: ts, branchId: zone?.branchId ?? data.branch?.id ?? "", name: { ar: `${f("design.newZoneName")} ${n}`, en: `New area ${n}` }, width: 1200, height: 800, sort: Math.max(0, ...data.zones.map((z) => z.sort)) + 1 };
    if (!row.branchId) return;
    void pushStep([{ type: "insert", c: "zones", row }], [{ type: "remove", c: "zones", id: row.id }]).then(() => {
      setZoneId(row.id);
      setTab("zone");
    });
  };

  const deleteZone = () => {
    if (!zone) return;
    if (zoneTables.some((x) => data.view.tables.get(x.id)?.check)) return void toast({ title: f("design.zoneHasChecks"), tone: "error" });
    if (!window.confirm(f("design.deleteZoneConfirm"))) return;
    const redo: LayoutOp[] = [...zoneDecor.map((d) => ({ type: "remove", c: "floorDecor", id: d.id }) as LayoutOp), ...zoneTables.map((x) => ({ type: "remove", c: "tables", id: x.id }) as LayoutOp), { type: "remove", c: "zones", id: zone.id }];
    const undo: LayoutOp[] = [{ type: "insert", c: "zones", row: zone }, ...zoneTables.map((row) => ({ type: "insert", c: "tables", row }) as LayoutOp), ...zoneDecor.map((row) => ({ type: "insert", c: "floorDecor", row }) as LayoutOp)];
    setZoneId(data.zones.find((z) => z.id !== zone.id)?.id ?? null);
    void pushStep(redo, undo);
  };

  const setBackground = (bg: ZoneBackground | null) => patchZone({ background: bg });

  const upload = async (file: File) => {
    if (!zone) return;
    setUploading(true);
    try {
      const d = await loadDrawing(file);
      setBackground(initialBackground(d, zone.width));
      setSuggestions(null);
    } catch (e) {
      const m = (e as Error).message;
      toast({ title: m === "too_big" ? f("draw.tooBig") : m.startsWith("pdf") ? f("draw.pdfFailed") : f("toast.error"), tone: "error" });
    } finally {
      setUploading(false);
    }
  };

  const useDemoPlan = () => {
    if (!zone) return;
    setBackground({ ...initialBackground({ src: demoPlanSvg(), pxW: 1000, pxH: 660, fileName: "sample-plan.svg" }, zone.width), cmPerPx: zone.width / 1000 });
  };

  const detect = async () => {
    const bg = zone?.background;
    if (!bg) return;
    setDetecting(true);
    try {
      const found = await suggestFromDrawing(bg);
      // drop suggestions sitting on an existing table
      setSuggestions(found.filter((s) => !zoneTables.some((x) => overlapping({ ...s, rotation: 0 }, x))).map((s) => ({ id: s.id, shape: s.shape, x: Math.round(s.x), y: Math.round(s.y), w: s.w, h: s.h })));
    } catch {
      toast({ title: f("toast.error"), tone: "error" });
    } finally {
      setDetecting(false);
    }
  };

  const acceptSuggestions = (ids: string[]) => {
    if (!suggestions) return;
    const picked = suggestions.filter((s) => ids.includes(s.id));
    const used: string[] = [];
    const rows = picked.map((s) => {
      const w = s.shape === "square" || s.shape === "round" ? Math.max(s.w, s.h) : s.w;
      const h = s.shape === "square" || s.shape === "round" ? Math.max(s.w, s.h) : s.h;
      const row = newTableRow(s.shape, { x: s.x, y: s.y }, { w, h }, used);
      used.push(row.label);
      return row;
    });
    void pushStep(
      rows.map((row) => ({ type: "insert", c: "tables", row })),
      rows.map((row) => ({ type: "remove", c: "tables", id: row.id })),
    );
    const left = suggestions.filter((s) => !ids.includes(s.id));
    setSuggestions(left.length ? left : null);
  };

  /* ───────────── hotkeys ───────────── */
  const nudge = (dx: number, dy: number) => {
    if (mode !== "design" || !selected.length) return;
    onCommit(selected.map((id) => findRow(id)).filter(Boolean).map((r) => ({ c: "label" in r! ? "tables" : "floorDecor", id: r!.id, patch: { x: r!.x + dx, y: r!.y + dy } })) as LayoutPatch[]);
  };
  useHotkeys(
    {
      "mod+z": () => mode !== "live" && void history.undo(),
      "mod+shift+z": () => mode !== "live" && void history.redo(),
      "mod+y": () => mode !== "live" && void history.redo(),
      delete: () => mode === "design" && removeSelected(),
      backspace: () => mode === "design" && removeSelected(),
      "mod+d": (e) => {
        if (mode !== "design") return;
        e.preventDefault();
        duplicate();
      },
      r: () => mode === "design" && selected.length && rotateSelected(),
      arrowleft: (e) => nudge(e.shiftKey ? -50 : -10, 0),
      arrowright: (e) => nudge(e.shiftKey ? 50 : 10, 0),
      arrowup: (e) => nudge(0, e.shiftKey ? -50 : -10),
      arrowdown: (e) => nudge(0, e.shiftKey ? 50 : 10),
      escape: () => {
        setSelected([]);
        setMulti(false);
        setPick(null);
        setCalibrating(false);
      },
    },
    { descriptions: { "mod+z": { ar: "تراجع (التصميم)", en: "Undo (design)" }, r: { ar: "لف الترابيزة", en: "Rotate table" } } },
  );

  /* ───────────── render ───────────── */

  const counts = useMemo(() => {
    const c = Object.fromEntries(FLOOR_STATES.map((s) => [s, 0])) as Record<FloorState, number>;
    for (const tv of data.view.tables.values()) if (!zone || tv.table.zoneId === zone.id) c[tv.state]++;
    return c;
  }, [data.view, zone]);

  const sheetTv = sheetId ? data.view.tables.get(sheetId) ?? null : null;
  const selection = selected.map(findRow).filter(Boolean) as (DiningTable | FloorDecor)[];
  const capacityOf = (id: string) => data.view.tables.get(id)?.capacity ?? 0;

  if (data.loading && !data.tables.length)
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-60" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-[60dvh] w-full" />
      </div>
    );

  const modeOptions = [
    { value: "live" as const, label: f("floor.live"), icon: <Radio /> },
    ...(canArrange ? [{ value: "arrange" as const, label: f("floor.arrange"), icon: <Move /> }] : []),
    ...(canDesign ? [{ value: "design" as const, label: f("floor.design"), icon: <PencilRuler /> }] : []),
  ];

  const legend = (
    <div className={cn("fl-root flex gap-1.5", isMobile ? "overflow-x-auto pb-1 no-scrollbar" : "flex-wrap")}>
      {FLOOR_STATES.map((s) => {
        const Icon = STATE_ICON[s];
        return (
          <span key={s} className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface/90 ps-1 pe-2.5 text-[12.5px] font-semibold shadow-sf-sm backdrop-blur", `fl-st-${s}`, !counts[s] && "opacity-55")}>
            <span className="fl-swatch grid size-6 place-items-center rounded-full">
              <Icon className="size-3.5" strokeWidth={2.6} />
            </span>
            <span className="text-ink-2">{f(`state.${s}`)}</span>
            <span className="num fl-text">{counts[s]}</span>
          </span>
        );
      })}
    </div>
  );

  return (
    <div className="fl-root space-y-4">
      <PageHeader
        icon={<LayoutGrid />}
        title={f("floor.title")}
        subtitle={
          <span className="inline-flex items-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex size-2 rounded-full bg-ok" />
            </span>
            {data.branch ? loc(data.branch.name) : ""} · {L("بيتحدّث لحظة بلحظة", "Updating live")}
          </span>
        }
        actions={modeOptions.length > 1 ? <Segmented label={f("floor.mode")} value={mode} onChange={setMode} options={modeOptions} /> : null}
      />

      {mode !== "design" ? <FloorStats data={data} fmtElapsed={fmtElapsed} /> : null}

      {!zone ? (
        <EmptyState icon={<LayoutGrid />} title={f("floor.noZones")} action={canDesign ? <Button onClick={addZone}>{f("design.addZone")}</Button> : undefined} />
      ) : (
        <div className={cn("grid gap-4", mode === "design" && "lg:grid-cols-[minmax(0,1fr)_21rem]")}>
          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-2 sm:px-3">
              <Tabs
                label={f("floor.zones")}
                value={zone.id}
                onChange={(id) => setZoneId(id)}
                className="min-w-0 flex-1 border-b-0"
                items={data.zones.map((z) => ({ value: z.id, label: loc(z.name), count: data.tables.filter((x) => x.zoneId === z.id && ["occupied", "long", "bill"].includes(data.view.tables.get(x.id)?.state ?? "")).length || undefined }))}
              />
              {mode === "design" ? (
                <div className="py-1.5">
                  <DesignToolbar onAddTable={addTable} onAddDecor={addDecor} onUndo={() => void history.undo()} onRedo={() => void history.redo()} canUndo={history.canUndo} canRedo={history.canRedo} snap={snap} onSnap={setSnap} />
                </div>
              ) : null}
            </div>
            <div className={cn("relative bg-bg-deep/40", "h-[62dvh] min-h-[380px] md:h-[calc(100dvh-21.5rem)] md:min-h-[420px]", mode === "design" && "md:h-[calc(100dvh-16.5rem)]")}>
              {zoneTables.length || zoneDecor.length || zone.background ? (
                <FloorCanvas
                  zone={zone}
                  tables={zoneTables}
                  decor={zoneDecor}
                  links={data.links}
                  views={data.view.tables}
                  mode={mode}
                  selected={selected}
                  onSelect={(ids) => {
                    setSelected(ids);
                    if (mode === "design") setTab("item");
                  }}
                  onTableTap={onTableTap}
                  onEmptyTap={() => {
                    if (mode !== "design") {
                      setSelected([]);
                      setMulti(false);
                    }
                  }}
                  onCommit={onCommit}
                  baseEdges={data.view.edges}
                  background={zone.background ?? null}
                  onBackgroundMove={(x, y) => zone.background && setBackground({ ...zone.background, x, y })}
                  calibrating={calibrating}
                  onCalibrated={(a, b) => {
                    setCalibrating(false);
                    setCalibLine(Math.hypot(b.x - a.x, b.y - a.y));
                  }}
                  suggestions={mode === "design" ? suggestions ?? undefined : undefined}
                  onSuggestion={(id) => acceptSuggestions([id])}
                  snap={snap}
                  fitSignal={fitSignal}
                  picking={!!pick}
                  fmtMoney={fmtMoney}
                  fmtElapsed={fmtElapsed}
                  fmtTime={fmtTime}
                  label={(k) => f(k === "fit" ? "floor.fit" : k === "zoomIn" ? "floor.zoomIn" : "floor.zoomOut")}
                  ariaLabel={`${f("floor.title")} — ${loc(zone.name)}`}
                >
                  {!isMobile && mode !== "design" ? legend : null}
                </FloorCanvas>
              ) : (
                <EmptyState className="absolute inset-0 m-auto h-fit" icon={<LayoutGrid />} title={f("floor.empty")} body={f("floor.emptyBody")} action={canDesign && mode !== "design" ? <Button icon={<PencilRuler />} onClick={() => setMode("design")}>{f("floor.design")}</Button> : undefined} />
              )}

              <AnimatePresence>
                {pick ? (
                  <Banner key="pick" reduced={reduced}>
                    <MousePointerClick className="size-5 shrink-0 text-brass" />
                    <span className="min-w-0 flex-1 text-[14px] font-semibold">{pick.kind === "merge" ? f("sheet.pickTables") : f("sheet.pickTable")}</span>
                    <Button size="sm" variant="ghost" icon={<X />} onClick={() => setPick(null)}>
                      {f("multi.clear")}
                    </Button>
                  </Banner>
                ) : multi && mode !== "design" ? (
                  <Banner key="multi" reduced={reduced}>
                    <Combine className="size-5 shrink-0 text-brass" />
                    <span className="min-w-0 flex-1 text-[14px] font-semibold">{selected.length ? f("multi.selected", { n: selected.length }) : f("multi.hint")}</span>
                    <Button size="sm" variant="brass" disabled={selected.length < 2 || !canArrange} onClick={mergeSelected}>
                      {f("multi.merge")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => (setSelected([]), setMulti(false))}>
                      {f("multi.clear")}
                    </Button>
                  </Banner>
                ) : calibrating ? (
                  <Banner key="cal" reduced={reduced}>
                    <PencilRuler className="size-5 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 text-[14px] font-semibold">{f("draw.calibrateHint")}</span>
                    <Button size="sm" variant="ghost" icon={<X />} onClick={() => setCalibrating(false)}>
                      {f("design.cancel")}
                    </Button>
                  </Banner>
                ) : null}
              </AnimatePresence>
            </div>
            {mode === "design" ? <p className="border-t border-line px-4 py-2 text-[12.5px] text-muted">{f("design.hint")}</p> : null}
          </Card>

          {mode === "design" ? (
            <Card className="overflow-hidden p-0 lg:max-h-[calc(100dvh-10rem)]">
              <Inspector
                tab={tab}
                onTab={setTab}
                selection={selection}
                capacityOf={capacityOf}
                onPatch={patchSelected}
                onShape={setShape}
                onRotate={rotateSelected}
                onDuplicate={duplicate}
                onDelete={removeSelected}
                onAlign={align}
                zone={zone}
                onZonePatch={patchZone}
                onAddZone={addZone}
                onDeleteZone={deleteZone}
                background={zone.background ?? null}
                onUpload={(file) => void upload(file)}
                uploading={uploading}
                onBackground={setBackground}
                calibrating={calibrating}
                onCalibrate={() => {
                  setCalibLine(null);
                  setCalibrating((v) => !v);
                }}
                calibLineCm={calibLine}
                onApplyScale={(m) => {
                  if (zone.background && calibLine) setBackground(calibrate(zone.background, calibLine, m));
                  setCalibLine(null);
                }}
                onFitZone={() => {
                  const bg = zone.background;
                  if (bg) patchZone({ width: Math.max(200, Math.round((bg.pxW * bg.cmPerPx + bg.x) / 10) * 10), height: Math.max(200, Math.round((bg.pxH * bg.cmPerPx + bg.y) / 10) * 10) });
                  setTimeout(() => setFitSignal((n) => n + 1), 200);
                }}
                onDetect={() => void detect()}
                detecting={detecting}
                suggestions={suggestions ? suggestions.length : null}
                onAcceptAll={() => suggestions && acceptSuggestions(suggestions.map((s) => s.id))}
                onDiscard={() => setSuggestions(null)}
                onDemoPlan={useDemoPlan}
              />
            </Card>
          ) : null}
        </div>
      )}

      {isMobile && mode !== "design" && zone ? legend : null}

      <TableSheet
        tv={sheetTv}
        zoneName={zone ? loc(data.zones.find((z) => z.id === sheetTv?.table.zoneId)?.name ?? zone.name) : ""}
        labels={labels}
        waiters={waiters}
        onClose={() => {
          setSheetId(null);
          setSelected([]);
        }}
        onPick={(kind) => {
          if (!sheetId) return;
          setPick({ kind, from: sheetId });
          setSheetId(null);
        }}
        fmtElapsed={fmtElapsed}
        fmtTime={fmtTime}
      />
      <span hidden>{t("common.loading")}</span>
    </div>
  );
}

function Banner({ children, reduced }: { children: React.ReactNode; reduced: boolean }) {
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      className="absolute inset-x-2.5 top-2.5 z-10 mx-auto flex max-w-xl items-center gap-2.5 rounded-2xl border border-line bg-surface/95 p-2 ps-3.5 shadow-sf-lg backdrop-blur-xl"
    >
      {children}
    </motion.div>
  );
}

/* ───────────── turn analytics strip ───────────── */

function FloorStats({ data, fmtElapsed }: { data: ReturnType<typeof useFloorData>; fmtElapsed: (m: number) => string }) {
  const f = useDict(floorDict);
  const stats = useMemo(() => {
    const turns = turnStats(data.paidToday.filter((c) => c.closedAt).map((c) => ({ openedAt: toMin(c.openedAt), closedAt: toMin(c.closedAt!), guests: c.guests, tableCount: c.tableIds.length })));
    const tvs = [...data.view.tables.values()].filter((x) => x.state !== "blocked");
    const seats = tvs.reduce((s, x) => s + x.capacity, 0);
    const covers = data.checks.filter((c) => c.tableIds.length).reduce((s, c) => s + c.guests, 0);
    const busy = tvs.filter((x) => x.state === "occupied" || x.state === "long" || x.state === "bill").length;
    const soon = data.reservations.filter((r) => (r.status === "pending" || r.status === "confirmed") && Date.parse(r.startsAt) >= data.now - 15 * 60_000 && Date.parse(r.startsAt) <= data.now + 60 * 60_000);
    return { turns, seats, covers, busy, tables: tvs.length, soon, calls: data.calls.filter((c) => c.status === "open").length };
  }, [data]);
  const pct = stats.tables ? Math.round((stats.busy / stats.tables) * 100) : 0;
  return (
    <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 no-scrollbar sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-5">
      <Kpi icon={<Hourglass />} label={f("kpi.turn")} value={stats.turns.avgTurn ? fmtElapsed(stats.turns.avgTurn) : "—"} sub={f("kpi.turnSub", { n: stats.turns.count })} tone="long" />
      <Kpi icon={<Users />} label={f("kpi.covers")} value={<AnimatedNumber value={stats.covers} />} sub={f("kpi.coversSub", { n: stats.seats })} tone="occupied" />
      <Kpi icon={<Gauge />} label={f("kpi.occupancy")} value={<span className="num">{pct}%</span>} sub={f("kpi.occupancySub", { busy: stats.busy, all: stats.tables })} tone="free" meter={pct} />
      <Kpi icon={<CalendarClock />} label={f("kpi.arrivals")} value={<AnimatedNumber value={stats.soon.length} />} sub={stats.soon.length ? `${stats.soon.reduce((s, r) => s + r.party, 0)} · ${f("kpi.arrivalsSub")}` : f("kpi.arrivalsSub")} tone="reserved" />
      <Kpi icon={<BellRing className={cn(stats.calls && "animate-pulse")} />} label={f("kpi.calls")} value={<AnimatedNumber value={stats.calls} />} sub={stats.calls ? undefined : "—"} tone={stats.calls ? "reserved" : "blocked"} />
    </div>
  );
}

function Kpi({ icon, label, value, sub, tone, meter }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; tone: FloorState; meter?: number }) {
  return (
    <div className={cn("relative flex min-w-[11.5rem] shrink-0 items-center gap-3 overflow-hidden rounded-[18px] border border-line bg-surface px-3 py-2.5 shadow-sf-sm", `fl-st-${tone}`)}>
      <span className="fl-soft fl-text grid size-10 shrink-0 place-items-center rounded-xl [&_svg]:size-[18px]">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[12.5px] font-semibold text-muted">{label}</span>
          <span className="font-display text-[22px] font-semibold leading-none">{value}</span>
        </div>
        {sub ? <div className="mt-1 truncate text-[11.5px] text-faint">{sub}</div> : null}
      </div>
      {meter != null ? (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-surface-3">
          <div className="fl-dot h-full rounded-e-full transition-[width] duration-700" style={{ width: `${meter}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The floor map. One SVG in floor centimetres, transformed by a pan/zoom view.
 *
 * Gestures (pointer events — mouse, pen and touch alike):
 *   one finger on empty floor ........ pan          (mouse in design mode: marquee select)
 *   two fingers ...................... zoom around the midpoint
 *   two fingers on the selected table  resize it (design) — chairs appear/disappear as it grows/shrinks
 *   tap a table ...................... onTableTap   long-press (450 ms) → multi-select
 *   drag a table (arrange/design) .... move with snapping + guides; edge contact previews a bill merge
 *   handles / rotate grip (design) ... resize from an edge/corner keeping the opposite edge, rotate in 45° steps
 *   wheel / trackpad ................. zoom around the cursor (ctrl+wheel = pinch on trackpads), shift/horizontal = pan
 *
 * The canvas never writes data itself: it previews locally and reports `onCommit(patches)` at the end of a gesture.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { BellRing, CalendarClock, Check, Clock3, Hourglass, Lock, Maximize, Minus, Plus, ReceiptText, Sparkles, Users } from "lucide-react";
import type { DiningTable, FloorDecor, Membership, TableLink, Units, Zone, ZoneBackground } from "@/data/types";
import { cn } from "@/lib/cn";
import { initials } from "@/ui";
import { bbox, clamp, snapBox, toFloor, toLocal, type Box, type Guide, type Placed } from "./core/geometry";
import { computeGroups, edgeKey, obstaclesFor, physicalEdges, pinchResize, resizeFrom, type Handle } from "./core/layout";
import { chairsFor } from "./core/seats";
import type { Layout, Table } from "./core/types";
import type { FloorState, TableView } from "./model";
import type { LayoutPatch } from "./ops";

export type CanvasMode = "live" | "arrange" | "design";
type Pt = { x: number; y: number };
type View = { tx: number; ty: number; k: number };
type Item = DiningTable | FloorDecor;
type Gesture =
  | { kind: "idle" }
  | { kind: "pan"; start: Pt; view: View; moved: boolean }
  | { kind: "zoom"; view: View; dist: number; mid: Pt }
  | { kind: "marquee"; start: Pt; now: Pt; additive: boolean }
  | { kind: "move"; ids: string[]; hitId: string; start: Pt; origin: Map<string, Pt>; moved: boolean; longPressed: boolean; isDecor: boolean }
  | { kind: "resize"; id: string; handle: Handle; start: Pt; origin: Item }
  | { kind: "rotate"; id: string; origin: Item }
  | { kind: "pinchItem"; id: string; v0: Pt; origin: Item }
  | { kind: "bg"; start: Pt; origin: Pt }
  | { kind: "calib"; a: Pt; b: Pt };

const HANDLES: Handle[] = [
  { hx: -1, hy: -1 }, { hx: 0, hy: -1 }, { hx: 1, hy: -1 }, { hx: 1, hy: 0 },
  { hx: 1, hy: 1 }, { hx: 0, hy: 1 }, { hx: -1, hy: 1 }, { hx: -1, hy: 0 },
];

export const STATE_ICON: Record<FloorState, typeof Check> = {
  free: Check,
  reserved: CalendarClock,
  dirty: Sparkles,
  occupied: Users,
  long: Hourglass,
  bill: ReceiptText,
  blocked: Lock,
};

export interface Suggestion {
  id: string;
  shape: Table["shape"];
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FloorCanvasProps {
  zone: Zone;
  tables: DiningTable[];
  decor: FloorDecor[];
  links: TableLink[];
  views: Map<string, TableView>;
  mode: CanvasMode;
  selected: string[];
  onSelect: (ids: string[]) => void;
  onTableTap: (id: string, how: { long: boolean; toggle: boolean }) => void;
  onEmptyTap?: () => void;
  onCommit: (patches: LayoutPatch[]) => void;
  /** contacts as last committed (a new contact previews a bill merge) */
  baseEdges: Set<string>;
  background?: ZoneBackground | null;
  onBackgroundMove?: (x: number, y: number) => void;
  calibrating?: boolean;
  onCalibrated?: (a: Pt, b: Pt) => void;
  suggestions?: Suggestion[];
  onSuggestion?: (id: string) => void;
  snap?: boolean;
  fitSignal?: number;
  /** tables to emphasise (pick-a-table flows) */
  picking?: boolean;
  fmtMoney: (u: Units) => string;
  fmtElapsed: (min: number) => string;
  fmtTime: (iso: string) => string;
  label: (k: "zoomIn" | "zoomOut" | "fit") => string;
  ariaLabel: string;
  className?: string;
  children?: ReactNode;
}

const isDecorItem = (x: Item): x is FloorDecor => "kind" in x;
const placedOf = (x: Item): Placed => (isDecorItem(x) ? { ...x, shape: x.kind } : x);

export function FloorCanvas(p: FloorCanvasProps) {
  const { zone, mode } = p;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ tx: 0, ty: 0, k: 0.5 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [preview, setPreview] = useState<Map<string, Partial<Item>>>(new Map());
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const [guides, setGuides] = useState<Guide[]>([]);
  const [live, setLive] = useState<string | null>(null); // item being resized: seat bubble
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [calib, setCalib] = useState<{ a: Pt; b: Pt } | null>(null);
  const [bgDrag, setBgDrag] = useState<Pt | null>(null);
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<Gesture>({ kind: "idle" });
  const longTimer = useRef<number | undefined>(undefined);
  const propsRef = useRef(p);
  propsRef.current = p;

  const designing = mode === "design";

  // ── items with the in-flight preview applied ──
  const tables = useMemo(() => p.tables.map((t) => (preview.has(t.id) ? ({ ...t, ...preview.get(t.id) } as DiningTable) : t)), [p.tables, preview]);
  const decor = useMemo(() => p.decor.map((d) => (preview.has(d.id) ? ({ ...d, ...preview.get(d.id) } as FloorDecor) : d)), [p.decor, preview]);
  const itemsRef = useRef<{ tables: DiningTable[]; decor: FloorDecor[] }>({ tables, decor });
  itemsRef.current = { tables: p.tables, decor: p.decor };
  const findItem = (id: string): Item | undefined => itemsRef.current.tables.find((t) => t.id === id) ?? itemsRef.current.decor.find((d) => d.id === id);

  const layout: Layout = useMemo(() => ({ zones: [zone], tables, decor }), [zone, tables, decor]);
  const geo = useMemo(() => {
    const m = new Map<string, { chairs: ReturnType<typeof chairsFor>; capacity: number }>();
    for (const t of tables) {
      const chairs = chairsFor(t, obstaclesFor(t, layout));
      m.set(t.id, { chairs, capacity: chairs.filter((c) => !c.blocked).length });
    }
    return m;
  }, [tables, layout]);
  const groups = useMemo(() => computeGroups(tables, p.links.filter((l) => l.tableIds.some((id) => tables.some((t) => t.id === id)))), [tables, p.links]);
  const edges = useMemo(() => (preview.size ? physicalEdges(tables) : p.baseEdges), [preview, tables, p.baseEdges]);
  const newEdges = useMemo(() => [...edges].filter((e) => !p.baseEdges.has(e)), [edges, p.baseEdges]);

  // ── view fitting ──
  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const pad = r.width < 500 ? 18 : 36;
    const k = Math.min((r.width - pad * 2) / zone.width, (r.height - pad * 2 - 24) / zone.height);
    setView({ k, tx: (r.width - zone.width * k) / 2, ty: (r.height - zone.height * k) / 2 - 6 });
  }, [zone.width, zone.height]);
  useLayoutEffect(fit, [fit, zone.id, p.fitSignal]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const zoomBy = (f: number, at?: Pt) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const v = viewRef.current;
    const px = at ? at.x : r.width / 2;
    const py = at ? at.y : r.height / 2;
    const k = clamp(v.k * f, 0.08, 4);
    setView({ k, tx: px - ((px - v.tx) * k) / v.k, ty: py - ((py - v.ty) * k) / v.k });
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = viewRef.current;
      if (e.ctrlKey || (!e.shiftKey && Math.abs(e.deltaY) >= Math.abs(e.deltaX))) {
        zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), { x: e.clientX - r.left, y: e.clientY - r.top });
      } else setView({ ...v, tx: v.tx - (e.shiftKey ? e.deltaY : e.deltaX), ty: v.ty });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const toFloorPt = (cx: number, cy: number): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.tx) / v.k, y: (cy - r.top - v.ty) / v.k };
  };

  // ── gestures ──
  const clearLong = () => window.clearTimeout(longTimer.current);
  const begin = () => setDragging(true);
  const end = () => {
    setDragging(false);
    setGuides([]);
    setLive(null);
  };
  const commitPreview = () => {
    const pv = previewRef.current;
    if (!pv.size) return;
    const patches: LayoutPatch[] = [];
    for (const [id, patch] of pv) {
      const isT = itemsRef.current.tables.some((t) => t.id === id);
      const clean: Record<string, number> = {};
      for (const [k, v] of Object.entries(patch)) if (typeof v === "number") clean[k] = k === "rotation" ? v : Math.round(v);
      patches.push({ c: isT ? "tables" : "floorDecor", id, patch: clean });
    }
    propsRef.current.onCommit(patches);
    // keep showing the preview until the live rows arrive (no flicker back)
    window.setTimeout(() => setPreview(new Map()), 260);
  };

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    const el = svgRef.current!;
    if (e.button === 2) return;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const P = propsRef.current;

    if (pointers.current.size === 2) {
      clearLong();
      const [a, b] = [...pointers.current.values()];
      const pinchId = g.kind === "move" && g.ids.length === 1 && !g.isDecor ? g.hitId : g.kind === "resize" ? g.id : null;
      if (pinchId && P.mode === "design") {
        const origin = findItem(pinchId)!;
        setPreview(new Map([[pinchId, {}]]));
        gesture.current = { kind: "pinchItem", id: pinchId, v0: { x: b.x - a.x, y: b.y - a.y }, origin };
        setGuides([]);
        setLive(pinchId);
        begin();
        return;
      }
      if (g.kind === "move" && g.moved) setPreview(new Map());
      gesture.current = { kind: "zoom", view: viewRef.current, dist: Math.hypot(b.x - a.x, b.y - a.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      setGuides([]);
      return;
    }
    if (pointers.current.size > 2) return;

    const start = { x: e.clientX, y: e.clientY };
    if (P.calibrating) {
      const f = toFloorPt(e.clientX, e.clientY);
      gesture.current = { kind: "calib", a: f, b: f };
      setCalib({ a: f, b: f });
      return;
    }
    const target = (e.target as Element).closest("[data-hit]") as SVGElement | null;
    const hit = target?.dataset;
    if (hit?.sug) {
      P.onSuggestion?.(hit.sug);
      gesture.current = { kind: "idle" };
      return;
    }
    if (hit?.handle && hit.owner && P.mode === "design") {
      const [hx, hy] = hit.handle.split(",").map(Number) as [Handle["hx"], Handle["hy"]];
      gesture.current = { kind: "resize", id: hit.owner, handle: { hx, hy }, start, origin: findItem(hit.owner)! };
      setLive(hit.owner);
      begin();
      return;
    }
    if (hit?.rot && P.mode === "design") {
      gesture.current = { kind: "rotate", id: hit.rot, origin: findItem(hit.rot)! };
      setLive(hit.rot);
      begin();
      return;
    }
    if (hit?.item) {
      const id = hit.item;
      const isDecor = hit.kind === "decor";
      const sel = P.selected;
      const ids = P.mode === "design" && sel.includes(id) && sel.length > 1 ? sel : [id];
      const origin = new Map<string, Pt>();
      for (const x of ids) {
        const it = findItem(x);
        if (it) origin.set(x, { x: it.x, y: it.y });
      }
      gesture.current = { kind: "move", ids, hitId: id, start, origin, moved: false, longPressed: false, isDecor };
      if (!isDecor && P.mode !== "design") {
        longTimer.current = window.setTimeout(() => {
          const g2 = gesture.current;
          if (g2.kind === "move" && !g2.moved) {
            g2.longPressed = true;
            navigator.vibrate?.(12);
            propsRef.current.onTableTap(id, { long: true, toggle: true });
          }
        }, 450);
      }
      return;
    }
    if (hit?.bg && P.mode === "design" && P.background && !P.background.locked) {
      gesture.current = { kind: "bg", start, origin: { x: P.background.x, y: P.background.y } };
      begin();
      return;
    }
    if (P.mode === "design" && e.pointerType === "mouse" && !e.altKey) {
      const f = toFloorPt(e.clientX, e.clientY);
      gesture.current = { kind: "marquee", start: f, now: f, additive: e.shiftKey || e.metaKey || e.ctrlKey };
      return;
    }
    gesture.current = { kind: "pan", start, view: viewRef.current, moved: false };
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pt = { x: e.clientX, y: e.clientY };
    const v = viewRef.current;
    const P = propsRef.current;

    switch (g.kind) {
      case "pan": {
        if (!g.moved && Math.hypot(pt.x - g.start.x, pt.y - g.start.y) < 6) return;
        g.moved = true;
        setView({ ...g.view, tx: g.view.tx + pt.x - g.start.x, ty: g.view.ty + pt.y - g.start.y });
        return;
      }
      case "zoom": {
        if (pointers.current.size < 2) return;
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const r = svgRef.current!.getBoundingClientRect();
        const k = clamp((g.view.k * dist) / g.dist, 0.08, 4);
        const fx = (g.mid.x - r.left - g.view.tx) / g.view.k;
        const fy = (g.mid.y - r.top - g.view.ty) / g.view.k;
        setView({ k, tx: mid.x - r.left - fx * k, ty: mid.y - r.top - fy * k });
        return;
      }
      case "marquee": {
        g.now = toFloorPt(pt.x, pt.y);
        setMarquee({ x1: Math.min(g.start.x, g.now.x), y1: Math.min(g.start.y, g.now.y), x2: Math.max(g.start.x, g.now.x), y2: Math.max(g.start.y, g.now.y) });
        return;
      }
      case "calib": {
        g.b = toFloorPt(pt.x, pt.y);
        setCalib({ a: g.a, b: g.b });
        return;
      }
      case "bg": {
        const nx = g.origin.x + (pt.x - g.start.x) / v.k;
        const ny = g.origin.y + (pt.y - g.start.y) / v.k;
        setBgDrag({ x: nx, y: ny });
        return;
      }
      case "pinchItem": {
        if (pointers.current.size < 2) return;
        const [a, b] = [...pointers.current.values()];
        // spread measured in the table's own frame, so a rotated table grows along its own sides
        const l0 = toLocal({ ...g.origin, x: 0, y: 0 }, g.v0.x, g.v0.y);
        const l1 = toLocal({ ...g.origin, x: 0, y: 0 }, b.x - a.x, b.y - a.y);
        const sx = Math.abs(l0.x) > 16 ? Math.abs(l1.x) / Math.abs(l0.x) : 1;
        const sy = Math.abs(l0.y) > 16 ? Math.abs(l1.y) / Math.abs(l0.y) : 1;
        const next = pinchResize(placedOf(g.origin) as Table, sx, sy);
        setPreview(new Map([[g.id, { w: next.w, h: next.h }]]));
        return;
      }
      case "resize": {
        const dx = (pt.x - g.start.x) / v.k;
        const dy = (pt.y - g.start.y) / v.k;
        const next = resizeFrom(placedOf(g.origin) as Table, g.handle, dx, dy);
        setPreview(new Map([[g.id, { w: next.w, h: next.h, x: next.x, y: next.y }]]));
        return;
      }
      case "rotate": {
        const f = toFloorPt(pt.x, pt.y);
        const ang = (Math.atan2(f.y - g.origin.y, f.x - g.origin.x) * 180) / Math.PI + 90;
        const snapped = ((Math.round(ang / 45) * 45) % 360 + 360) % 360;
        setPreview(new Map([[g.id, { rotation: snapped }]]));
        return;
      }
      case "move": {
        const threshold = P.mode === "design" ? 5 : 10;
        if (!g.moved && Math.hypot(pt.x - g.start.x, pt.y - g.start.y) < threshold) return;
        if (g.longPressed) return;
        if (!canMoveNow(P, g.isDecor)) {
          clearLong();
          gesture.current = { kind: "pan", start: g.start, view: viewRef.current, moved: true };
          return;
        }
        if (!g.moved) {
          g.moved = true;
          clearLong();
          begin();
          if (P.mode === "design" && !P.selected.includes(g.hitId)) P.onSelect([g.hitId]);
        }
        const dx = (pt.x - g.start.x) / v.k;
        const dy = (pt.y - g.start.y) / v.k;
        const moving = g.ids.map((id) => ({ ...placedOf(findItem(id)!), ...g.origin.get(id)! }));
        const boxes = moving.map((m) => bbox({ ...m, x: m.x + dx, y: m.y + dy }));
        const union: Box = { x1: Math.min(...boxes.map((b) => b.x1)), y1: Math.min(...boxes.map((b) => b.y1)), x2: Math.max(...boxes.map((b) => b.x2)), y2: Math.max(...boxes.map((b) => b.y2)) };
        const others = [...itemsRef.current.tables, ...itemsRef.current.decor].filter((o) => o.zoneId === zone.id && !g.ids.includes(o.id)).map((o) => bbox(placedOf(o)));
        const snap = P.snap === false ? { dx: Math.round(union.x1 / 5) * 5 - union.x1, dy: Math.round(union.y1 / 5) * 5 - union.y1, guides: [] } : snapBox(union, others, 14 / v.k, 10);
        // keep everything inside the room
        const fx = clamp(dx + snap.dx, -union.x1 + dx, zone.width - union.x2 + dx);
        const fy = clamp(dy + snap.dy, -union.y1 + dy, zone.height - union.y2 + dy);
        setGuides(snap.guides);
        const next = new Map<string, Partial<Item>>();
        for (const id of g.ids) {
          const o = g.origin.get(id)!;
          next.set(id, { x: o.x + fx, y: o.y + fy });
        }
        setPreview(next);
        return;
      }
    }
  };

  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    const P = propsRef.current;
    clearLong();
    if (g.kind === "zoom" || g.kind === "pinchItem") {
      if (pointers.current.size === 0) {
        if (g.kind === "pinchItem") {
          commitPreview();
          end();
        }
        gesture.current = { kind: "idle" };
      }
      return;
    }
    switch (g.kind) {
      case "move":
        if (g.moved) {
          commitPreview();
          end();
        } else if (!g.longPressed) {
          const toggle = e.shiftKey || e.metaKey || e.ctrlKey;
          if (P.mode === "design" || g.isDecor) P.onSelect(toggle ? xor(P.selected, g.hitId) : [g.hitId]);
          if (!g.isDecor) P.onTableTap(g.hitId, { long: false, toggle });
        }
        break;
      case "resize":
      case "rotate":
        commitPreview();
        end();
        break;
      case "pan":
        if (!g.moved) P.onEmptyTap?.();
        break;
      case "marquee": {
        const m = { x1: Math.min(g.start.x, g.now.x), y1: Math.min(g.start.y, g.now.y), x2: Math.max(g.start.x, g.now.x), y2: Math.max(g.start.y, g.now.y) };
        setMarquee(null);
        if (m.x2 - m.x1 < 4 && m.y2 - m.y1 < 4) {
          if (!g.additive) P.onSelect([]);
          P.onEmptyTap?.();
          break;
        }
        const inside = [...itemsRef.current.tables, ...itemsRef.current.decor]
          .filter((it) => it.zoneId === zone.id)
          .filter((it) => {
            const b = bbox(placedOf(it));
            return b.x1 >= m.x1 && b.x2 <= m.x2 && b.y1 >= m.y1 && b.y2 <= m.y2;
          })
          .map((it) => it.id);
        P.onSelect(g.additive ? [...new Set([...P.selected, ...inside])] : inside);
        break;
      }
      case "calib":
        setCalib(null);
        if (Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) > 5) P.onCalibrated?.(g.a, g.b);
        break;
      case "bg":
        if (bgDragRef.current) P.onBackgroundMove?.(Math.round(bgDragRef.current.x), Math.round(bgDragRef.current.y));
        window.setTimeout(() => setBgDrag(null), 260);
        end();
        break;
    }
    if (pointers.current.size === 0) gesture.current = { kind: "idle" };
  };
  const bgDragRef = useRef(bgDrag);
  bgDragRef.current = bgDrag;

  // ── render ──
  const k = view.k;
  const views = p.views;
  const selected = new Set(p.selected);
  const single = p.selected.length === 1 ? tables.find((t) => t.id === p.selected[0]) ?? decor.find((d) => d.id === p.selected[0]) : undefined;
  const bg = p.background ? { ...p.background, ...(bgDrag ?? {}) } : null;

  // guests sit on chairs: spread a bill's guests over its tables in order
  const taken = new Map<string, number>();
  if (mode !== "design") {
    const seen = new Set<string>();
    for (const tv of views.values()) {
      const c = tv.check;
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      let left = c.guests;
      for (const id of c.tableIds) {
        const g = geo.get(id);
        if (!g) continue;
        const n = Math.min(g.capacity, left);
        taken.set(id, n);
        left -= n;
      }
    }
  }

  return (
    <div ref={wrapRef} className={cn("fl-root relative h-full w-full overflow-hidden", p.className)}>
      <svg
        ref={svgRef}
        className={cn("fl-svg absolute inset-0 h-full w-full", `fl-mode-${mode}`, dragging && "fl-dragging", gesture.current.kind === "pan" && "panning", p.calibrating && "cursor-crosshair")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        role="application"
        aria-label={p.ariaLabel}
      >
        <defs>
          <pattern id="fl-grid-minor" width={50} height={50} patternUnits="userSpaceOnUse">
            <circle cx={0} cy={0} r={2} className="fl-grid-dot" />
          </pattern>
          <pattern id="fl-grid" width={100} height={100} patternUnits="userSpaceOnUse">
            <rect width={100} height={100} fill="url(#fl-grid-minor)" />
            <path d="M100 0H0V100" className="fl-grid-line" fill="none" />
          </pattern>
          <pattern id="fl-pat-reserved" width={14} height={14} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={14} stroke="var(--st-reserved)" strokeWidth={4} strokeOpacity={0.28} />
          </pattern>
          <pattern id="fl-pat-dirty" width={14} height={14} patternUnits="userSpaceOnUse">
            <circle cx={7} cy={7} r={2.6} fill="var(--st-dirty)" fillOpacity={0.4} />
          </pattern>
          <pattern id="fl-pat-bill" width={16} height={16} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <path d="M0 8H16M8 0V16" stroke="var(--st-bill)" strokeWidth={2.2} strokeOpacity={0.3} />
          </pattern>
          <pattern id="fl-pat-blocked" width={10} height={10} patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <line x1={0} y1={0} x2={0} y2={10} stroke="var(--st-blocked)" strokeWidth={3} strokeOpacity={0.35} />
          </pattern>
          <pattern id="fl-pat-long" width={18} height={18} patternUnits="userSpaceOnUse">
            <path d="M0 9 Q4.5 4 9 9 T18 9" fill="none" stroke="var(--st-long)" strokeWidth={2} strokeOpacity={0.35} />
          </pattern>
        </defs>
        <g transform={`translate(${view.tx} ${view.ty}) scale(${k})`}>
          <rect x={0} y={0} width={zone.width} height={zone.height} rx={14} className="fl-room-bg" strokeWidth={2 / k} />
          {bg && bg.visible ? (
            <image
              href={bg.src}
              x={bg.x}
              y={bg.y}
              width={bg.pxW * bg.cmPerPx}
              height={bg.pxH * bg.cmPerPx}
              opacity={bg.opacity}
              preserveAspectRatio="none"
              data-hit={designing && !bg.locked ? "1" : undefined}
              data-bg={designing && !bg.locked ? "1" : undefined}
              style={{ cursor: designing && !bg.locked ? "move" : undefined }}
            />
          ) : null}
          <rect x={0} y={0} width={zone.width} height={zone.height} fill="url(#fl-grid)" pointerEvents="none" opacity={bg?.visible ? 0.5 : 1} />
          <RoomRuler zone={zone} k={k} />

          {decor.map((d) => (
            <DecorGlyph key={d.id} d={d} selected={selected.has(d.id)} designing={designing} />
          ))}

          {groups.map((g) => (
            <GroupMark key={g.id} ids={g.tableIds} tables={tables} physical={g.physical} merging={newEdges.some((e) => e.split("|").every((x) => g.tableIds.includes(x))) && g.tableIds.some((id) => views.get(id)?.check)} k={k} capacity={g.tableIds.reduce((s, id) => s + (geo.get(id)?.capacity ?? 0), 0)} />
          ))}

          {tables.map((t) => {
            const tv = views.get(t.id);
            const g = geo.get(t.id)!;
            return <TableGlyph key={t.id} t={t} chairs={g.chairs} state={designing ? "design" : tv?.state ?? "free"} taken={taken.get(t.id) ?? 0} selected={selected.has(t.id)} multi={!designing && p.selected.length > 1 && selected.has(t.id)} overlap={designing && !!tv?.overlaps} />;
          })}

          {tables.map((t) => {
            const tv = views.get(t.id);
            return <TableInfo key={t.id} t={t} tv={tv} capacity={geo.get(t.id)!.capacity} k={k} designing={designing} fmtMoney={p.fmtMoney} fmtElapsed={p.fmtElapsed} fmtTime={p.fmtTime} />;
          })}

          {p.suggestions?.map((s) => (
            <g key={s.id} className="fl-suggest" data-hit="1" data-sug={s.id} style={{ cursor: "pointer" }}>
              {s.shape === "round" || s.shape === "oval" ? <ellipse cx={s.x} cy={s.y} rx={s.w / 2} ry={s.h / 2} strokeWidth={3 / k} /> : <rect x={s.x - s.w / 2} y={s.y - s.h / 2} width={s.w} height={s.h} rx={6} strokeWidth={3 / k} />}
              <text x={s.x} y={s.y + 6 / k} textAnchor="middle" fontSize={16 / k} className="fl-label" style={{ fill: "var(--sf-brass-text)" }}>
                +
              </text>
            </g>
          ))}

          {guides.map((gd, i) =>
            gd.axis === "x" ? <line key={i} x1={gd.at} x2={gd.at} y1={gd.from - 40} y2={gd.to + 40} className="fl-guide" strokeWidth={1.5 / k} /> : <line key={i} y1={gd.at} y2={gd.at} x1={gd.from - 40} x2={gd.to + 40} className="fl-guide" strokeWidth={1.5 / k} />,
          )}

          {designing && single ? <Handles item={single} k={k} /> : null}
          {live && tables.find((t) => t.id === live) ? <SeatBubble t={tables.find((t) => t.id === live)!} capacity={geo.get(live)?.capacity ?? 0} k={k} /> : null}
          {live && decor.find((d) => d.id === live) ? <SizeBubble d={decor.find((d) => d.id === live)!} k={k} /> : null}

          {marquee ? <rect x={marquee.x1} y={marquee.y1} width={marquee.x2 - marquee.x1} height={marquee.y2 - marquee.y1} className="fl-marquee" strokeWidth={1.5 / k} /> : null}
          {calib ? (
            <g className="fl-calib">
              <line x1={calib.a.x} y1={calib.a.y} x2={calib.b.x} y2={calib.b.y} strokeWidth={3 / k} />
              <circle cx={calib.a.x} cy={calib.a.y} r={6 / k} />
              <circle cx={calib.b.x} cy={calib.b.y} r={6 / k} />
            </g>
          ) : null}
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5 sm:p-3">
        <div className="pointer-events-auto min-w-0">{p.children}</div>
        <div className="pointer-events-auto flex shrink-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface/90 shadow-sf backdrop-blur-xl">
          <ZoomBtn label={p.label("zoomIn")} onClick={() => zoomBy(1.25)}>
            <Plus />
          </ZoomBtn>
          <ZoomBtn label={p.label("zoomOut")} onClick={() => zoomBy(0.8)}>
            <Minus />
          </ZoomBtn>
          <ZoomBtn label={p.label("fit")} onClick={fit}>
            <Maximize />
          </ZoomBtn>
        </div>
      </div>
    </div>
  );
}

function canMoveNow(P: FloorCanvasProps, isDecor: boolean) {
  if (P.mode === "design") return true;
  if (P.mode === "arrange") return !isDecor;
  return false;
}
const xor = (xs: string[], id: string) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]);

function ZoomBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="grid size-11 place-items-center text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink [&_svg]:size-[18px] [&+&]:border-t [&+&]:border-line">
      {children}
    </button>
  );
}

/* ───────────── glyphs ───────────── */

function RoomRuler({ zone, k }: { zone: Zone; k: number }) {
  const m = (v: number) => (v / 100).toLocaleString("en-US", { maximumFractionDigits: 1 });
  return (
    <text x={zone.width - 6} y={zone.height + 20 / k} className="fl-ruler" fontSize={11 / k} textAnchor="end">
      {`${m(zone.width)} × ${m(zone.height)} m`}
    </text>
  );
}

function ChairGlyph({ x, y, angle, taken }: { x: number; y: number; angle: number; taken: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <g className={cn("fl-chair fl-chair-enter", taken && "taken")}>
        <rect x={-15} y={-17} width={30} height={34} rx={9} />
        <rect x={-21} y={-15} width={6} height={30} rx={3} className="back" />
      </g>
    </g>
  );
}

function TableGlyph({ t, chairs, state, taken, selected, multi, overlap }: { t: DiningTable; chairs: ReturnType<typeof chairsFor>; state: FloorState | "design"; taken: number; selected: boolean; multi: boolean; overlap: boolean }) {
  let seated = 0;
  const round = t.shape === "round" || t.shape === "oval";
  const pattern = state === "reserved" || state === "dirty" || state === "bill" || state === "blocked" || state === "long" ? `url(#fl-pat-${state})` : null;
  const ring = 12;
  return (
    <g data-hit="1" data-item={t.id} data-kind="table" className={cn("fl-table", `fl-st-${state}`, overlap && "fl-overlap")} aria-label={t.label}>
      <g className="fl-move" style={{ transform: `translate(${t.x}px, ${t.y}px) rotate(${t.rotation}deg)` }}>
        {chairs.map((c, i) => {
          if (c.blocked) return null;
          const isTaken = seated++ < taken;
          const l = toLocal(t, c.x, c.y);
          return <ChairGlyph key={i} x={l.x} y={l.y} angle={c.angle - t.rotation} taken={isTaken} />;
        })}
        {t.shape === "booth" ? (
          t.w >= t.h ? (
            <>
              <rect x={-t.w / 2} y={-t.h / 2 - 46} width={t.w} height={16} rx={8} className="fl-bench" />
              <rect x={-t.w / 2} y={t.h / 2 + 30} width={t.w} height={16} rx={8} className="fl-bench" />
            </>
          ) : (
            <>
              <rect x={-t.w / 2 - 46} y={-t.h / 2} width={16} height={t.h} rx={8} className="fl-bench" />
              <rect x={t.w / 2 + 30} y={-t.h / 2} width={16} height={t.h} rx={8} className="fl-bench" />
            </>
          )
        ) : null}
        {round ? <ellipse rx={t.w / 2} ry={t.h / 2} className="fl-top" /> : <rect x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} rx={t.shape === "bar" ? 6 : 12} className="fl-top" />}
        {pattern ? round ? <ellipse rx={t.w / 2 - 1.5} ry={t.h / 2 - 1.5} fill={pattern} className="fl-top-pattern" /> : <rect x={-t.w / 2 + 1.5} y={-t.h / 2 + 1.5} width={t.w - 3} height={t.h - 3} rx={10} fill={pattern} className="fl-top-pattern" /> : null}
        {selected ? round ? <ellipse rx={t.w / 2 + ring} ry={t.h / 2 + ring} className={multi ? "fl-multi-ring" : "fl-sel-ring"} /> : <rect x={-t.w / 2 - ring} y={-t.h / 2 - ring} width={t.w + ring * 2} height={t.h + ring * 2} rx={18} className={multi ? "fl-multi-ring" : "fl-sel-ring"} /> : null}
        {/* invisible padding makes small tables easy to grab with a finger */}
        <rect x={-t.w / 2 - 16} y={-t.h / 2 - 16} width={t.w + 32} height={t.h + 32} className="fl-grab" />
      </g>
    </g>
  );
}

function TableInfo({ t, tv, capacity, k, designing, fmtMoney, fmtElapsed, fmtTime }: { t: DiningTable; tv: TableView | undefined; capacity: number; k: number; designing: boolean; fmtMoney: (u: Units) => string; fmtElapsed: (m: number) => string; fmtTime: (iso: string) => string }) {
  const fb = bbox(t);
  const ox = (fb.x1 + fb.x2) / 2;
  const oy = (fb.y1 + fb.y2) / 2;
  // drawn relative to the table centre so remote moves animate smoothly
  const b = { x1: fb.x1 - ox, y1: fb.y1 - oy, x2: fb.x2 - ox, y2: fb.y2 - oy };
  const cx = 0;
  const cy = 0;
  const small = Math.min(b.x2 - b.x1, b.y2 - b.y1);
  const px = small * k; // on-screen size of the table
  const state: FloorState | "design" = designing ? "design" : tv?.state ?? "free";
  const fs = Math.max(Math.min(small * 0.34, 34), 12.5 / k);
  const sub = Math.max(fs * 0.5, 9 / k);
  const tiny = px < 30;
  const Icon = state === "design" ? Users : STATE_ICON[state];
  const check = tv?.check ?? null;
  let line2 = "";
  if (designing || state === "free" || state === "blocked" || state === "dirty") line2 = `${capacity}`;
  else if (state === "reserved" && tv?.next) line2 = fmtTime(tv.next.startsAt);
  else if (tv && tv.guests) line2 = `${tv.guests}/${capacity}`;
  else line2 = `${capacity}`;
  const chip = 10.5 / k; // chip font (screen px)
  const showChips = !designing && px >= 28;
  const primary = check && check.tableIds[0] === t.id;
  const elapsed = !designing && tv?.elapsed != null && primary ? fmtElapsed(tv.elapsed) : null;
  const money = !designing && primary && check && check.total > 0 ? fmtMoney(check.total) : null;
  const calls = !designing ? tv?.calls.filter((c) => c.status === "open").length ?? 0 : 0;
  const acked = !designing ? tv?.calls.filter((c) => c.status === "ack").length ?? 0 : 0;
  const waiter = !designing && primary ? tv?.waiter ?? null : null;
  const r = (px >= 40 ? 13 : 10) / k;
  return (
    <g className={cn("fl-move", `fl-st-${state}`)} pointerEvents="none" style={{ transform: `translate(${ox}px, ${oy}px)` }}>
      <text x={cx} y={tiny ? cy + fs * 0.35 : cy - sub * 0.15} fontSize={tiny ? Math.min(small * 0.5, Math.max(fs, 11 / k)) : fs} textAnchor="middle" className="fl-label" direction="ltr">
        {t.label}
      </text>
      {!tiny ? (
        <g transform={`translate(${cx} ${cy + fs * 0.42 + sub * 0.9})`} className="fl-text">
          <Icon x={-sub * 1.05 - (line2.length * sub * 0.29)} y={-sub * 0.85} width={sub} height={sub} strokeWidth={2.6} style={{ color: "var(--c)" }} />
          <text x={sub * 0.18} y={0} fontSize={sub} textAnchor="middle" className="fl-sub num" direction="ltr" style={{ fill: "var(--c)" }}>
            {line2}
          </text>
        </g>
      ) : null}
      {showChips && elapsed ? (
        <Chip x={cx} y={b.y1 - 30 - chip * 0.6} fs={chip} k={k} className="fl-chip" icon={Clock3}>
          {elapsed}
        </Chip>
      ) : null}
      {showChips && money ? (
        <Chip x={cx} y={b.y2 + 30 + chip * 0.6} fs={chip} k={k} className="fl-money">
          {money}
        </Chip>
      ) : null}
      {showChips && !elapsed && state !== "reserved" && tv?.next ? (
        <Chip x={cx} y={b.y1 - 30 - chip * 0.6} fs={chip * 0.92} k={k} className={cn("fl-chip", "fl-st-reserved")} icon={CalendarClock}>
          {`${fmtTime(tv.next.startsAt)} · ${tv.next.party}`}
        </Chip>
      ) : null}
      {tiny && state !== "design" ? (
        <g transform={`translate(${b.x1 + 1 / k} ${b.y1 + 1 / k})`} className="fl-state-badge">
          <circle r={8.5 / k} strokeWidth={2 / k} />
          <Icon x={-5.5 / k} y={-5.5 / k} width={11 / k} height={11 / k} strokeWidth={3} />
        </g>
      ) : null}
      {waiter && px >= 30 ? (
        <g className="fl-waiter" transform={`translate(${b.x1 + 2 / k} ${b.y2 - 2 / k})`}>
          <circle r={r} fill={waiter.color} strokeWidth={2.5 / k} />
          <text y={r * 0.36} fontSize={r * 0.95} textAnchor="middle">
            {initials(waiter.name)}
          </text>
        </g>
      ) : null}
      {calls || acked ? (
        <g className="fl-call" transform={`translate(${b.x2 - 2 / k} ${b.y1 + 2 / k})`}>
          {calls ? <circle r={r} className="ring" strokeWidth={2.5 / k} /> : null}
          <circle r={r} className="dot" strokeWidth={2.5 / k} style={calls ? undefined : { fill: "var(--sf-warn)" }} />
          {calls ? (
            <text y={r * 0.38} fontSize={r * 1.05} textAnchor="middle" className="num">
              {calls}
            </text>
          ) : (
            <BellRing x={-r * 0.55} y={-r * 0.55} width={r * 1.1} height={r * 1.1} color="#fff" strokeWidth={2.5} />
          )}
        </g>
      ) : null}
    </g>
  );
}

function Chip({ x, y, fs, k, className, icon: Icon, children }: { x: number; y: number; fs: number; k: number; className: string; icon?: typeof Check; children: string }) {
  const iconW = Icon ? fs * 1.25 : 0;
  const w = children.length * fs * 0.6 + fs * 1.4 + iconW;
  const h = fs * 1.9;
  return (
    <g className={className} transform={`translate(${x} ${y})`}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} strokeWidth={1.2 / k} />
      {Icon ? <Icon x={-w / 2 + fs * 0.6} y={-fs * 0.5} width={fs} height={fs} strokeWidth={2.6} className="fl-chip-icon" /> : null}
      <text x={iconW / 2} y={fs * 0.36} fontSize={fs} textAnchor="middle" className="num" direction="ltr">
        {children}
      </text>
    </g>
  );
}

function GroupMark({ ids, tables, physical, merging, k, capacity }: { ids: string[]; tables: DiningTable[]; physical: boolean; merging: boolean; k: number; capacity: number }) {
  const ts = ids.map((id) => tables.find((t) => t.id === id)).filter(Boolean) as DiningTable[];
  if (ts.length < 2) return null;
  const bs = ts.map((t) => bbox(t));
  const b = { x1: Math.min(...bs.map((x) => x.x1)), y1: Math.min(...bs.map((x) => x.y1)), x2: Math.max(...bs.map((x) => x.x2)), y2: Math.max(...bs.map((x) => x.y2)) };
  const pad = 40;
  const fs = 11.5 / k;
  const text = `${merging ? "⇄ " : "∞ "}${capacity}`;
  const w = text.length * fs * 0.62 + fs * 1.6;
  return (
    <g pointerEvents="none">
      {physical || merging ? (
        <rect className={cn("fl-group", merging && "merge-preview")} x={b.x1 - pad} y={b.y1 - pad} width={b.x2 - b.x1 + pad * 2} height={b.y2 - b.y1 + pad * 2} rx={30} strokeWidth={(merging ? 4 : 2.5) / Math.max(k, 0.6)} />
      ) : (
        ts.slice(1).map((t, i) => <line key={t.id} x1={ts[i].x} y1={ts[i].y} x2={t.x} y2={t.y} className="fl-link-line" strokeWidth={4 / Math.max(k, 0.6)} />)
      )}
      <g className={cn("fl-group-chip", merging && "merge")} transform={`translate(${(b.x1 + b.x2) / 2} ${b.y2 + pad})`}>
        <rect x={-w / 2} y={-fs} width={w} height={fs * 2} rx={fs} />
        <text y={fs * 0.36} fontSize={fs} textAnchor="middle" className="num" direction="ltr">
          {text}
        </text>
      </g>
    </g>
  );
}

function DecorGlyph({ d, selected, designing }: { d: FloorDecor; selected: boolean; designing: boolean }) {
  const body = (() => {
    switch (d.kind) {
      case "pillar":
        return <rect x={-d.w / 2} y={-d.h / 2} width={d.w} height={d.h} rx={4} className="fl-decor-pillar" />;
      case "plant":
        return (
          <g className="fl-decor-plant">
            <circle r={Math.min(d.w, d.h) / 2} className="pot" />
            {[0, 72, 144, 216, 288].map((a) => (
              <ellipse key={a} rx={d.w * 0.32} ry={d.w * 0.14} transform={`rotate(${a}) translate(${d.w * 0.22} 0)`} className="leaf" />
            ))}
          </g>
        );
      case "door":
        return (
          <g className="fl-decor-door">
            <rect x={-d.w / 2} y={-d.h / 2} width={d.w} height={d.h} className="frame" />
            <path d={`M${-d.w / 2} ${-d.h / 2} A ${d.w} ${d.w} 0 0 1 ${d.w / 2} ${-d.h / 2 - d.w}`} className="swing" />
            <line x1={-d.w / 2} y1={-d.h / 2} x2={-d.w / 2} y2={-d.h / 2 - d.w} className="swing" />
          </g>
        );
      case "window":
        return <rect x={-d.w / 2} y={-d.h / 2} width={d.w} height={d.h} rx={3} className="fl-decor-window" />;
      case "counter":
        return <rect x={-d.w / 2} y={-d.h / 2} width={d.w} height={d.h} rx={8} className="fl-decor-counter" />;
      default:
        return <rect x={-d.w / 2} y={-d.h / 2} width={d.w} height={d.h} rx={3} className="fl-decor-wall" />;
    }
  })();
  return (
    <g data-hit={designing ? "1" : undefined} data-item={d.id} data-kind="decor" style={{ cursor: designing ? "move" : undefined }} pointerEvents={designing ? undefined : "none"}>
      <g className="fl-move" style={{ transform: `translate(${d.x}px, ${d.y}px) rotate(${d.rotation}deg)` }}>
        {body}
        {selected ? <rect x={-d.w / 2 - 8} y={-d.h / 2 - 8} width={d.w + 16} height={d.h + 16} rx={8} className="fl-decor-sel" /> : null}
        <rect x={-d.w / 2 - 12} y={-d.h / 2 - 12} width={d.w + 24} height={d.h + 24} className="fl-grab" />
      </g>
    </g>
  );
}

function Handles({ item, k }: { item: Item; k: number }) {
  const pl = placedOf(item);
  const hitR = clamp(Math.min(pl.w, pl.h) * k * 0.3, 12, 22) / k;
  const top = toFloor(pl, 0, -pl.h / 2);
  const grip = toFloor(pl, 0, -pl.h / 2 - 44 / k);
  return (
    <g>
      <g className="fl-rot" data-hit="1" data-rot={item.id} style={{ cursor: "grab" }}>
        <line x1={top.x} y1={top.y} x2={grip.x} y2={grip.y} className="stem" strokeWidth={2 / k} />
        <circle cx={grip.x} cy={grip.y} r={hitR} fill="transparent" />
        <circle cx={grip.x} cy={grip.y} r={8 / k} className="fl-handle-dot" fill="var(--sf-primary)" stroke="var(--sf-surface)" strokeWidth={2 / k} />
        <path d={`M${grip.x - 4 / k} ${grip.y}a${4 / k} ${4 / k} 0 1 1 ${4 / k} ${4 / k}`} fill="none" stroke="var(--sf-primary-ink)" strokeWidth={1.6 / k} />
      </g>
      {HANDLES.map((h) => {
        const pt = toFloor(pl, (h.hx * pl.w) / 2, (h.hy * pl.h) / 2);
        const corner = h.hx !== 0 && h.hy !== 0;
        return (
          <g key={`${h.hx},${h.hy}`} data-hit="1" data-handle={`${h.hx},${h.hy}`} data-owner={item.id} className="fl-handle" style={{ cursor: corner ? "nwse-resize" : h.hx ? "ew-resize" : "ns-resize" }}>
            <circle cx={pt.x} cy={pt.y} r={hitR} className="hit" />
            <circle cx={pt.x} cy={pt.y} r={(corner ? 7.5 : 6) / k} strokeWidth={2.2 / k} className="dot" />
          </g>
        );
      })}
    </g>
  );
}

function SeatBubble({ t, capacity, k }: { t: DiningTable; capacity: number; k: number }) {
  const b = bbox(t);
  const text = `${capacity} ⑁ · ${t.w}×${t.h}`;
  const fs = 13 / k;
  const w = text.length * fs * 0.62 + fs * 2;
  return (
    <g className="fl-bubble" transform={`translate(${(b.x1 + b.x2) / 2} ${b.y1 - 78 / k})`} pointerEvents="none">
      <rect x={-w / 2} y={-fs * 1.1} width={w} height={fs * 2.2} rx={fs * 1.1} />
      <Users x={-w / 2 + fs * 0.7} y={-fs * 0.55} width={fs * 1.1} height={fs * 1.1} color="var(--sf-surface)" strokeWidth={2.4} />
      <text x={fs * 0.5} y={fs * 0.38} fontSize={fs} textAnchor="middle" className="num" direction="ltr">
        {text.replace(" ⑁", "")}
      </text>
    </g>
  );
}

function SizeBubble({ d, k }: { d: FloorDecor; k: number }) {
  const b = bbox({ ...d, shape: d.kind });
  const text = `${d.w}×${d.h} cm`;
  const fs = 13 / k;
  const w = text.length * fs * 0.62 + fs * 1.4;
  return (
    <g className="fl-bubble" transform={`translate(${(b.x1 + b.x2) / 2} ${b.y1 - 40 / k})`} pointerEvents="none">
      <rect x={-w / 2} y={-fs * 1.1} width={w} height={fs * 2.2} rx={fs * 1.1} />
      <text y={fs * 0.38} fontSize={fs} textAnchor="middle" className="num" direction="ltr">
        {text}
      </text>
    </g>
  );
}

export { edgeKey };
export type { Membership };

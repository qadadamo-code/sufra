import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { bbox, clamp, snapBox, toFloor, toLocal, type Box, type Guide } from '../core/geometry'
import { pinchResize, resizeFrom, type Handle } from '../core/layout'
import { checkTotal, formatMoney } from '../core/checks'
import { fmtTime, isLate } from '../core/reservations'
import type { Decor, Table, Zone } from '../core/types'
import type { FloorView, TableView } from '../derive'
import { store, type Data } from '../store'
import { useUI } from './ctx'

type View = { tx: number; ty: number; k: number }
type Pt = { x: number; y: number }

type Gesture =
  | { kind: 'idle' }
  | { kind: 'pan'; start: Pt; view: View; moved: boolean }
  | { kind: 'zoom'; view: View; dist: number; mid: Pt }
  | {
      kind: 'move'
      ids: string[]
      hitId: string
      start: Pt
      origin: Map<string, Pt>
      moved: boolean
      longPressed: boolean
    }
  | { kind: 'resize'; id: string; handle: Handle; start: Pt; origin: Table | Decor }
  | { kind: 'pinchItem'; id: string; v0: Pt; origin: Table | Decor }

const HANDLES: Handle[] = [
  { hx: -1, hy: -1 },
  { hx: 0, hy: -1 },
  { hx: 1, hy: -1 },
  { hx: 1, hy: 0 },
  { hx: 1, hy: 1 },
  { hx: 0, hy: 1 },
  { hx: -1, hy: 1 },
  { hx: -1, hy: 0 },
]

const findItem = (d: Data, id: string): Table | Decor | undefined =>
  d.layout.tables.find((t) => t.id === id) ?? d.layout.decor.find((x) => x.id === id)

function patchItems(d: Data, items: Map<string, Partial<Table & Decor>>): Data {
  return {
    ...d,
    layout: {
      ...d.layout,
      tables: d.layout.tables.map((t) => (items.has(t.id) ? { ...t, ...items.get(t.id) } : t)),
      decor: d.layout.decor.map((x) => (items.has(x.id) ? { ...x, ...items.get(x.id) } : x)),
    },
  }
}

export function FloorCanvas({
  zone,
  floor,
  data,
  onTap,
  fitSignal,
}: {
  zone: Zone
  floor: FloorView
  data: Data
  onTap: (id: string | null, toggle: boolean) => void
  fitSignal: number
}) {
  const ui = useUI()
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>({ tx: 0, ty: 0, k: 0.6 })
  const viewRef = useRef(view)
  viewRef.current = view
  const [guides, setGuides] = useState<Guide[]>([])
  const [liveId, setLiveId] = useState<string | null>(null) // item being resized: show the seat bubble
  const pointers = useRef(new Map<number, Pt>())
  const gesture = useRef<Gesture>({ kind: 'idle' })
  const longTimer = useRef<number | undefined>(undefined)
  const uiRef = useRef(ui)
  uiRef.current = ui

  const designing = ui.mode === 'design'
  const canMove = designing || !ui.locked

  // --- view fitting -------------------------------------------------------
  const fit = useCallback(() => {
    const el = svgRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const pad = 24
    const k = Math.min((r.width - pad * 2) / zone.width, (r.height - pad * 2) / zone.height)
    setView({ k, tx: (r.width - zone.width * k) / 2, ty: (r.height - zone.height * k) / 2 })
  }, [zone.width, zone.height])
  useLayoutEffect(fit, [fit, zone.id, fitSignal])
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(() => fit())
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])

  // Wheel / trackpad zoom around the cursor.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const v = viewRef.current
      if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        const k = clamp(v.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), 0.15, 4)
        const px = e.clientX - r.left
        const py = e.clientY - r.top
        setView({ k, tx: px - ((px - v.tx) * k) / v.k, ty: py - ((py - v.ty) * k) / v.k })
      } else setView({ ...v, tx: v.tx - e.deltaX })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // --- gestures -----------------------------------------------------------
  const clearLong = () => window.clearTimeout(longTimer.current)

  const onPointerDown = (e: React.PointerEvent) => {
    const el = svgRef.current!
    el.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current

    if (pointers.current.size === 2) {
      clearLong()
      const [a, b] = [...pointers.current.values()]
      // Two fingers on the selected table resize it; anywhere else they zoom.
      // On a phone a small table is mostly covered by its handles, so a pinch
      // that starts on a handle counts too.
      const pinchId = g.kind === 'move' && g.ids.length === 1 ? g.hitId : g.kind === 'resize' ? g.id : null
      if (pinchId && designing && !ui.locked) {
        if (g.kind === 'move') store.preview((s) => patchItems(s, new Map([[pinchId, g.origin.get(pinchId)!]])))
        if (g.kind === 'resize') store.preview((s) => patchItems(s, new Map([[pinchId, g.origin]])))
        if (!(g.kind === 'move' && g.moved) && g.kind !== 'resize') store.begin()
        gesture.current = { kind: 'pinchItem', id: pinchId, v0: { x: b.x - a.x, y: b.y - a.y }, origin: findItem(store.data, pinchId)! }
        setGuides([])
        setLiveId(pinchId)
        return
      }
      if (g.kind === 'move' || g.kind === 'resize') store.end()
      gesture.current = { kind: 'zoom', view: viewRef.current, dist: Math.hypot(b.x - a.x, b.y - a.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
      setGuides([])
      return
    }
    if (pointers.current.size > 2) return

    const target = (e.target as Element).closest('[data-hit]') as HTMLElement | null
    const hit = target?.dataset
    const start = { x: e.clientX, y: e.clientY }

    if (hit?.handle && hit.owner) {
      const [hx, hy] = hit.handle.split(',').map(Number) as [Handle['hx'], Handle['hy']]
      store.begin()
      gesture.current = { kind: 'resize', id: hit.owner, handle: { hx, hy }, start, origin: findItem(store.data, hit.owner)! }
      setLiveId(hit.owner)
      return
    }
    if (hit?.item) {
      const id = hit.item
      const isDecor = hit.kind === 'decor'
      if (!designing && isDecor) {
        gesture.current = { kind: 'pan', start, view: viewRef.current, moved: false }
        return
      }
      const sel = uiRef.current.selected
      const ids = sel.includes(id) && sel.length > 1 && designing ? sel : [id]
      const origin = new Map<string, Pt>()
      for (const x of ids) {
        const it = findItem(store.data, x)
        if (it) origin.set(x, { x: it.x, y: it.y })
      }
      gesture.current = { kind: 'move', ids, hitId: id, start, origin, moved: false, longPressed: false }
      if (!isDecor) {
        longTimer.current = window.setTimeout(() => {
          const g2 = gesture.current
          if (g2.kind === 'move' && !g2.moved) {
            g2.longPressed = true
            navigator.vibrate?.(12)
            onTap(id, true)
          }
        }, 450)
      }
      return
    }
    gesture.current = { kind: 'pan', start, view: viewRef.current, moved: false }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    const p = { x: e.clientX, y: e.clientY }

    if (g.kind === 'pan') {
      if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) < 5) return
      g.moved = true
      setView({ ...g.view, tx: g.view.tx + p.x - g.start.x, ty: g.view.ty + p.y - g.start.y })
      return
    }
    if (g.kind === 'zoom') {
      if (pointers.current.size < 2) return
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(b.x - a.x, b.y - a.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const r = svgRef.current!.getBoundingClientRect()
      const k = clamp((g.view.k * dist) / g.dist, 0.15, 4)
      const fx = (g.mid.x - r.left - g.view.tx) / g.view.k
      const fy = (g.mid.y - r.top - g.view.ty) / g.view.k
      setView({ k, tx: mid.x - r.left - fx * k, ty: mid.y - r.top - fy * k })
      return
    }
    if (g.kind === 'pinchItem') {
      if (pointers.current.size < 2) return
      const [a, b] = [...pointers.current.values()]
      // Measure the spread in the table's own frame so a rotated table grows along its own sides.
      const l0 = toLocal({ ...g.origin, x: 0, y: 0 }, g.v0.x, g.v0.y)
      const l1 = toLocal({ ...g.origin, x: 0, y: 0 }, b.x - a.x, b.y - a.y)
      const sx = Math.abs(l0.x) > 16 ? Math.abs(l1.x) / Math.abs(l0.x) : 1
      const sy = Math.abs(l0.y) > 16 ? Math.abs(l1.y) / Math.abs(l0.y) : 1
      const next = pinchResize(g.origin as Table, sx, sy)
      store.preview((s) => patchItems(s, new Map([[g.id, { w: next.w, h: next.h }]])))
      return
    }
    if (g.kind === 'resize') {
      const v = viewRef.current
      const dx = (p.x - g.start.x) / v.k
      const dy = (p.y - g.start.y) / v.k
      const next = resizeFrom(g.origin as Table, g.handle, dx, dy)
      store.preview((s) => patchItems(s, new Map([[g.id, { w: next.w, h: next.h, x: next.x, y: next.y }]])))
      return
    }
    if (g.kind === 'move') {
      const threshold = designing ? 6 : 12
      if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) < threshold) return
      if (g.longPressed) return
      if (!canMove) {
        // Locked floor: dragging on a table just pans the view.
        gesture.current = { kind: 'pan', start: g.start, view: viewRef.current, moved: true }
        return
      }
      if (!g.moved) {
        g.moved = true
        clearLong()
        store.begin()
        if (!uiRef.current.selected.includes(g.hitId)) uiRef.current.set({ selected: [g.hitId] })
      }
      const v = viewRef.current
      const dx = (p.x - g.start.x) / v.k
      const dy = (p.y - g.start.y) / v.k
      const d = store.data
      const moving = g.ids.map((id) => ({ ...findItem(d, id)!, ...g.origin.get(id)! }))
      const boxes = moving.map((m) => bbox({ ...m, x: m.x + dx, y: m.y + dy }))
      const union: Box = {
        x1: Math.min(...boxes.map((b) => b.x1)),
        y1: Math.min(...boxes.map((b) => b.y1)),
        x2: Math.max(...boxes.map((b) => b.x2)),
        y2: Math.max(...boxes.map((b) => b.y2)),
      }
      const others = [...d.layout.tables, ...d.layout.decor]
        .filter((o) => o.zoneId === zone.id && !g.ids.includes(o.id))
        .map((o) => bbox(o))
      const snap = snapBox(union, others, 14 / v.k, 10)
      // Keep everything inside the room.
      const fx = clamp(dx + snap.dx, -union.x1 + dx, zone.width - union.x2 + dx)
      const fy = clamp(dy + snap.dy, -union.y1 + dy, zone.height - union.y2 + dy)
      setGuides(snap.guides)
      const patch = new Map<string, Partial<Table>>()
      for (const id of g.ids) {
        const o = g.origin.get(id)!
        patch.set(id, { x: o.x + fx, y: o.y + fy })
      }
      store.preview((s) => patchItems(s, patch))
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    clearLong()
    if (g.kind === 'zoom' || g.kind === 'pinchItem') {
      if (pointers.current.size === 0) {
        if (g.kind === 'pinchItem') {
          // The pinch began as a move; commit the size change as one step.
          store.end()
          setLiveId(null)
        }
        gesture.current = { kind: 'idle' }
      }
      return
    }
    if (g.kind === 'move') {
      if (g.moved) store.end()
      else if (!g.longPressed) {
        onTap(g.hitId, e.shiftKey || e.metaKey || e.ctrlKey)
      }
    } else if (g.kind === 'resize') {
      store.end()
      setLiveId(null)
    } else if (g.kind === 'pan' && !g.moved) onTap(null, false)
    setGuides([])
    if (pointers.current.size === 0) gesture.current = { kind: 'idle' }
  }

  // Keyboard nudging and deleting for desktop users.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? store.redo() : store.undo()
        return
      }
      const sel = uiRef.current.selected
      if (!sel.length || uiRef.current.mode !== 'design') return
      const step = e.shiftKey ? 50 : 10
      const delta: Record<string, Pt> = {
        ArrowLeft: { x: -step, y: 0 },
        ArrowRight: { x: step, y: 0 },
        ArrowUp: { x: 0, y: -step },
        ArrowDown: { x: 0, y: step },
      }
      if (delta[e.key]) {
        e.preventDefault()
        const d = store.data
        store.commit((s) =>
          patchItems(
            s,
            new Map(
              sel.flatMap((id) => {
                const it = findItem(d, id)
                return it ? [[id, { x: it.x + delta[e.key].x, y: it.y + delta[e.key].y }] as [string, Partial<Table>]] : []
              }),
            ),
          ),
        )
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // --- render ---------------------------------------------------------------
  const k = view.k
  const zoneTables = data.layout.tables.filter((t) => t.zoneId === zone.id)
  const zoneDecor = data.layout.decor.filter((d) => d.zoneId === zone.id)
  const zoneGroups = floor.groups.filter((g) => g.tableIds.some((id) => floor.tables.get(id)?.table.zoneId === zone.id))
  const singleSel = ui.selected.length === 1 ? findItem(data, ui.selected[0]) : undefined
  const showHandles = designing && !!singleSel && singleSel.zoneId === zone.id

  // Mark chairs as taken for seated guests, spread over the bill's tables.
  const taken = new Map<string, number>()
  for (const c of data.checks) {
    if (c.status === 'paid') continue
    let left = c.guests
    for (const id of c.tableIds) {
      const tv = floor.tables.get(id)
      if (!tv) continue
      const free = tv.chairs.filter((x) => !x.blocked).length
      const n = Math.min(free, left)
      taken.set(id, n)
      left -= n
    }
  }

  return (
    <svg
      ref={svgRef}
      className={`floor-svg ${ui.pick ? 'picking' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
      role="application"
      aria-label={zone.name[ui.lang]}
    >
      <defs>
        <pattern id="grid-minor" width={50} height={50} patternUnits="userSpaceOnUse">
          <circle cx={0} cy={0} r={1.6} className="grid-dot" />
        </pattern>
        <pattern id="grid-major" width={100} height={100} patternUnits="userSpaceOnUse">
          <rect width={100} height={100} fill="url(#grid-minor)" />
          <path d="M100 0H0V100" className="grid-line" fill="none" />
        </pattern>
        <pattern id="hatch" width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={8} height={8} className="hatch-bg" />
          <line x1={0} y1={0} x2={0} y2={8} className="hatch-line" />
        </pattern>
      </defs>
      <g transform={`translate(${view.tx} ${view.ty}) scale(${k})`}>
        <rect x={0} y={0} width={zone.width} height={zone.height} rx={12} className="room" />
        <rect x={0} y={0} width={zone.width} height={zone.height} fill="url(#grid-major)" className="room-grid" />
        <RoomRuler zone={zone} k={k} lang={ui.lang} />

        {zoneDecor.map((d) => (
          <DecorGlyph key={d.id} d={d} selected={ui.selected.includes(d.id)} designing={designing} label={ui.t(d.kind)} />
        ))}

        {zoneGroups.map((g) => (
          <GroupOutline key={g.id} floor={floor} ids={g.tableIds} physical={g.physical} />
        ))}

        {zoneTables.map((t) => (
          <TableGlyph
            key={t.id}
            tv={floor.tables.get(t.id)!}
            taken={taken.get(t.id) ?? 0}
            selected={ui.selected.includes(t.id)}
            designing={designing}
          />
        ))}

        {zoneTables.map((t) => (
          <TableLabel key={t.id} tv={floor.tables.get(t.id)!} now={data.now} designing={designing} k={k} />
        ))}

        {zoneGroups.map((g) => (
          <GroupChip key={g.id} floor={floor} ids={g.tableIds} physical={g.physical} k={k} />
        ))}

        {guides.map((gd, i) =>
          gd.axis === 'x' ? (
            <line key={i} x1={gd.at} x2={gd.at} y1={gd.from - 30} y2={gd.to + 30} className="guide" strokeWidth={1.5 / k} />
          ) : (
            <line key={i} y1={gd.at} y2={gd.at} x1={gd.from - 30} x2={gd.to + 30} className="guide" strokeWidth={1.5 / k} />
          ),
        )}

        {showHandles && singleSel && !ui.locked && (
          <g>
            {HANDLES.map((h) => {
              const p = toFloor(singleSel, (h.hx * singleSel.w) / 2, (h.hy * singleSel.h) / 2)
              const corner = h.hx !== 0 && h.hy !== 0
              const hitR = clamp(Math.min(singleSel.w, singleSel.h) * k * 0.3, 10, 22) / k
              return (
                <g key={`${h.hx},${h.hy}`} data-hit="1" data-handle={`${h.hx},${h.hy}`} data-owner={singleSel.id} className="handle">
                  <circle cx={p.x} cy={p.y} r={hitR} className="handle-hit" />
                  <circle cx={p.x} cy={p.y} r={(corner ? 7 : 5.5) / k} strokeWidth={2 / k} className="handle-dot" />
                </g>
              )
            })}
          </g>
        )}

        {liveId && floor.tables.get(liveId) && <SeatBubble tv={floor.tables.get(liveId)!} k={k} t={ui.t} />}
      </g>
    </svg>
  )
}

// ---------------------------------------------------------------------------

function RoomRuler({ zone, k, lang }: { zone: Zone; k: number; lang: 'ar' | 'en' }) {
  const m = (v: number) => (v / 100).toLocaleString('en-US', { maximumFractionDigits: 1 })
  const label = lang === 'ar' ? `${m(zone.width)} × ${m(zone.height)} م` : `${m(zone.width)} × ${m(zone.height)} m`
  return (
    <text x={zone.width - 8} y={zone.height + 22 / k} className="ruler" fontSize={11 / k} textAnchor={lang === 'ar' ? 'start' : 'end'}>
      {label}
    </text>
  )
}

function SeatBubble({ tv, k, t }: { tv: TableView; k: number; t: ReturnType<typeof useUI>['t'] }) {
  const b = bbox(tv.table)
  const text = `${tv.capacity} ${t('seats')} · ${tv.table.w}×${tv.table.h}`
  const w = (text.length * 7.4 + 24) / k
  return (
    <g className="seat-bubble" transform={`translate(${(b.x1 + b.x2) / 2} ${b.y1 - 52 / k})`}>
      <rect x={-w / 2} y={-14 / k} width={w} height={28 / k} rx={14 / k} />
      <text y={5 / k} fontSize={13 / k} textAnchor="middle">
        {text}
      </text>
    </g>
  )
}

function ChairGlyph({ x, y, angle, taken }: { x: number; y: number; angle: number; taken: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`} className={`chair ${taken ? 'taken' : ''}`}>
      <rect x={-15} y={-17} width={30} height={34} rx={9} />
      <rect x={-21} y={-15} width={6} height={30} rx={3} className="chair-back" />
    </g>
  )
}

function TableGlyph({ tv, taken, selected, designing }: { tv: TableView; taken: number; selected: boolean; designing: boolean }) {
  const { table: t } = tv
  let seated = 0
  const status = designing ? 'design' : tv.status
  return (
    <g data-hit="1" data-item={t.id} data-kind="table" className={`table st-${status} ${selected ? 'sel' : ''} ${tv.overlaps ? 'overlap' : ''}`}>
      {tv.chairs.map((c, i) => {
        if (c.blocked) return null
        const isTaken = !designing && seated++ < taken
        return <ChairGlyph key={i} x={c.x} y={c.y} angle={c.angle} taken={isTaken} />
      })}
      <g transform={`translate(${t.x} ${t.y}) rotate(${t.rotation})`}>
        {t.shape === 'round' || t.shape === 'oval' ? (
          <ellipse rx={t.w / 2} ry={t.h / 2} className="top" />
        ) : (
          <rect x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} rx={t.shape === 'bar' ? 6 : 10} className="top" />
        )}
        {t.shape === 'booth' &&
          (t.w >= t.h ? (
            <>
              <rect x={-t.w / 2} y={-t.h / 2 - 46} width={t.w} height={14} rx={7} className="bench" />
              <rect x={-t.w / 2} y={t.h / 2 + 32} width={t.w} height={14} rx={7} className="bench" />
            </>
          ) : (
            <>
              <rect x={-t.w / 2 - 46} y={-t.h / 2} width={14} height={t.h} rx={7} className="bench" />
              <rect x={t.w / 2 + 32} y={-t.h / 2} width={14} height={t.h} rx={7} className="bench" />
            </>
          ))}
        {/* invisible padding makes small tables easy to grab with a finger */}
        <rect x={-t.w / 2 - 14} y={-t.h / 2 - 14} width={t.w + 28} height={t.h + 28} className="grab" />
      </g>
    </g>
  )
}

function TableLabel({ tv, now, designing, k }: { tv: TableView; now: number; designing: boolean; k: number }) {
  const ui = useUI()
  const { table: t, check } = tv
  const b = bbox(t)
  const cx = (b.x1 + b.x2) / 2
  const cy = (b.y1 + b.y2) / 2
  const small = Math.min(b.x2 - b.x1, b.y2 - b.y1)
  const fs = clamp(small * 0.3, 16, 30)
  const sub = clamp(fs * 0.55, 10, 16)
  let line2 = ''
  if (designing) line2 = tv.capacity === 1 ? ui.t('seat1') : ui.t('seatsN', { n: tv.capacity })
  else if (check) line2 = ui.t('minutes', { n: Math.max(0, now - check.openedAt) })
  else if (tv.status === 'reserved' && tv.next) line2 = fmtTime(tv.next.start, ui.lang)
  else line2 = `${tv.capacity}`
  const showMoney = !designing && check && check.tableIds[0] === t.id && small >= 60
  const late = tv.next && isLate(tv.next, now)
  // One chip per booking, on its first table.
  const badge = !designing && tv.next && tv.status !== 'reserved' && tv.next.tableIds[0] === t.id ? tv.next : null
  const chipText = badge ? `${fmtTime(badge.start, ui.lang)} · ${badge.party}` : ''
  const chipW = chipText.length * 8.2 + 22
  // Zoomed far out (phones): just the table name, sized to fit the table.
  const tiny = small * k < 46
  const minPx = 9 / k
  return (
    <g className={`tlabel st-${designing ? 'design' : tv.status}`} pointerEvents="none">
      <text x={cx} y={tiny ? cy + small * 0.15 : cy - (showMoney ? sub * 0.6 : 0)} fontSize={tiny ? Math.min(small * 0.42, Math.max(fs, minPx * 1.2)) : Math.max(fs, minPx * 1.4)} textAnchor="middle" className="tl-name">
        {t.label}
      </text>
      {!tiny && (
      <text x={cx} y={cy + fs * 0.75 - (showMoney ? sub * 0.6 : 0)} fontSize={Math.max(sub, minPx)} textAnchor="middle" className="tl-sub">
        {line2}
      </text>
      )}
      {showMoney && !tiny && (
        <text x={cx} y={cy + fs * 0.75 + sub * 0.7} fontSize={Math.max(sub, minPx)} textAnchor="middle" className="tl-money">
          {formatMoney(checkTotal(check!), 'en').replace('EGP ', '')}
        </text>
      )}
      {badge && (
        <g transform={`translate(${cx} ${b.y1 - 64})`} className={`res-chip ${tv.atRisk ? 'risk' : ''} ${late ? 'late' : ''}`}>
          <rect x={-chipW / 2} y={-13} width={chipW} height={26} rx={13} />
          <text y={5} fontSize={14} textAnchor="middle" direction="ltr">
            {chipText}
          </text>
        </g>
      )}
    </g>
  )
}

function groupBox(floor: FloorView, ids: string[]) {
  const boxes = ids.map((id) => floor.tables.get(id)).filter(Boolean).map((tv) => bbox(tv!.table))
  return {
    x1: Math.min(...boxes.map((b) => b.x1)),
    y1: Math.min(...boxes.map((b) => b.y1)),
    x2: Math.max(...boxes.map((b) => b.x2)),
    y2: Math.max(...boxes.map((b) => b.y2)),
  }
}

function GroupOutline({ floor, ids, physical }: { floor: FloorView; ids: string[]; physical: boolean }) {
  const centers = ids.map((id) => floor.tables.get(id)!.table)
  if (!physical) {
    return (
      <g className="link-lines" pointerEvents="none">
        {centers.slice(1).map((c, i) => (
          <line key={c.id} x1={centers[i].x} y1={centers[i].y} x2={c.x} y2={c.y} />
        ))}
      </g>
    )
  }
  const b = groupBox(floor, ids)
  const pad = 34
  return <rect className="group-outline" x={b.x1 - pad} y={b.y1 - pad} width={b.x2 - b.x1 + pad * 2} height={b.y2 - b.y1 + pad * 2} rx={28} pointerEvents="none" />
}

function GroupChip({ floor, ids, physical, k }: { floor: FloorView; ids: string[]; physical: boolean; k: number }) {
  const ui = useUI()
  const b = groupBox(floor, ids)
  const seats = ids.reduce((s, id) => s + (floor.tables.get(id)?.capacity ?? 0), 0)
  const text = ui.t(physical ? 'combined' : 'linked', { n: seats })
  const fs = clamp(11 / k, 13, 20)
  const w = text.length * fs * 0.56 + fs * 2.6
  return (
    <g className="group-chip" transform={`translate(${(b.x1 + b.x2) / 2} ${b.y2 + 34})`} pointerEvents="none">
      <rect x={-w / 2} y={-fs} width={w} height={fs * 2} rx={fs} />
      <g transform={`translate(${-w / 2 + fs * 1.1} 0) scale(${fs / 14})`}>
        <path d="M-5 -3a3 3 0 0 1 3-3h3a3 3 0 0 1 0 6h-1M5 3a3 3 0 0 1-3 3h-3a3 3 0 0 1 0-6h1" className="chip-icon" />
      </g>
      <text x={fs * 0.7} y={fs * 0.36} fontSize={fs} textAnchor="middle">
        {text}
      </text>
    </g>
  )
}

function DecorGlyph({ d, selected, designing, label }: { d: Decor; selected: boolean; designing: boolean; label: string }) {
  const body = (() => {
    switch (d.kind) {
      case 'pillar':
        return <rect x={-d.w / 2} y={-d.h / 2} width={d.w} height={d.h} rx={4} className="d-pillar" />
      case 'plant':
        return (
          <g className="d-plant">
            <circle r={d.w / 2} className="pot" />
            {[0, 72, 144, 216, 288].map((a) => (
              <ellipse key={a} rx={d.w * 0.32} ry={d.w * 0.14} transform={`rotate(${a}) translate(${d.w * 0.22} 0)`} className="leaf" />
            ))}
          </g>
        )
      case 'door':
        return (
          <g className="d-door">
            <rect x={-d.w / 2} y={-d.h / 2} width={d.w} height={d.h} className="frame" />
            <path d={`M${-d.w / 2} ${-d.h / 2} A ${d.w} ${d.w} 0 0 1 ${d.w / 2} ${-d.h / 2 - d.w}`} className="swing" />
            <line x1={-d.w / 2} y1={-d.h / 2} x2={-d.w / 2} y2={-d.h / 2 - d.w} className="swing" />
          </g>
        )
      case 'window':
        return <rect x={-d.w / 2} y={-d.h / 2} width={d.w} height={d.h} rx={3} className="d-window" />
      case 'counter':
        return <rect x={-d.w / 2} y={-d.h / 2} width={d.w} height={d.h} rx={8} className="d-counter" />
      default:
        return <rect x={-d.w / 2} y={-d.h / 2} width={d.w} height={d.h} rx={3} className="d-wall" />
    }
  })()
  return (
    <g data-hit={designing ? '1' : undefined} data-item={d.id} data-kind="decor" className={`decor ${selected ? 'sel' : ''}`}>
      <g transform={`translate(${d.x} ${d.y}) rotate(${d.rotation})`}>
        {body}
        {selected && <rect x={-d.w / 2 - 6} y={-d.h / 2 - 6} width={d.w + 12} height={d.h + 12} rx={8} className="decor-sel" />}
        <rect x={-d.w / 2 - 10} y={-d.h / 2 - 10} width={d.w + 20} height={d.h + 20} className="grab" />
      </g>
      {(d.kind === 'counter' || (designing && selected)) && (
        <text x={d.x} y={d.y + 6} fontSize={16} textAnchor="middle" className="decor-label" pointerEvents="none">
          {label}
        </text>
      )}
    </g>
  )
}

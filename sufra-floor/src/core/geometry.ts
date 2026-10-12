import type { Decor, Shape, Table } from './types'

export interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Placed {
  x: number
  y: number
  w: number
  h: number
  rotation: number
  shape?: Shape | Decor['kind']
}

const RAD = Math.PI / 180

export const isAxisAligned = (rotation: number) => ((rotation % 90) + 90) % 90 === 0

export function isRoundish(p: Placed) {
  return p.shape === 'round' || p.shape === 'oval' || p.shape === 'pillar' || p.shape === 'plant'
}

/** Axis-aligned bounding box of a (possibly rotated) element. */
export function bbox(p: Placed): Box {
  const c = Math.abs(Math.cos(p.rotation * RAD))
  const s = Math.abs(Math.sin(p.rotation * RAD))
  // Round tables keep the same footprint whatever the rotation.
  const hw = isRoundish(p) && p.w === p.h ? p.w / 2 : (c * p.w + s * p.h) / 2
  const hh = isRoundish(p) && p.w === p.h ? p.h / 2 : (s * p.w + c * p.h) / 2
  return { x1: p.x - hw, y1: p.y - hh, x2: p.x + hw, y2: p.y + hh }
}

/** Width/height of the element as seen on the floor (w/h swap at 90°). */
export function floorSize(p: Placed) {
  const b = bbox(p)
  return { w: b.x2 - b.x1, h: b.y2 - b.y1 }
}

/** Converts a floor point into the element's own frame (centre origin, unrotated). */
export function toLocal(p: Placed, px: number, py: number) {
  const dx = px - p.x
  const dy = py - p.y
  const c = Math.cos(-p.rotation * RAD)
  const s = Math.sin(-p.rotation * RAD)
  return { x: dx * c - dy * s, y: dx * s + dy * c }
}

export function toFloor(p: Placed, lx: number, ly: number) {
  const c = Math.cos(p.rotation * RAD)
  const s = Math.sin(p.rotation * RAD)
  return { x: p.x + lx * c - ly * s, y: p.y + lx * s + ly * c }
}

export function containsPoint(p: Placed, px: number, py: number, margin = 0) {
  const l = toLocal(p, px, py)
  const a = p.w / 2 + margin
  const b = p.h / 2 + margin
  if (isRoundish(p)) return (l.x * l.x) / (a * a) + (l.y * l.y) / (b * b) <= 1
  return Math.abs(l.x) <= a && Math.abs(l.y) <= b
}

/** Positive = gap between boxes on that axis, negative = overlap length. */
export function gaps(a: Box, b: Box) {
  return {
    x: Math.max(a.x1, b.x1) - Math.min(a.x2, b.x2),
    y: Math.max(a.y1, b.y1) - Math.min(a.y2, b.y2),
  }
}

export const TOUCH_TOLERANCE = 3
export const MIN_SHARED_EDGE = 20

/**
 * Two tables are "pushed together" when an edge of one sits on an edge of the
 * other and they share at least MIN_SHARED_EDGE cm of it. Tables rotated at
 * 45° never count: there is no shared edge to sit at.
 */
export function touching(a: Table, b: Table) {
  if (a.zoneId !== b.zoneId) return false
  if (!isAxisAligned(a.rotation) || !isAxisAligned(b.rotation)) return false
  const g = gaps(bbox(a), bbox(b))
  return (
    (Math.abs(g.x) <= TOUCH_TOLERANCE && -g.y >= MIN_SHARED_EDGE) ||
    (Math.abs(g.y) <= TOUCH_TOLERANCE && -g.x >= MIN_SHARED_EDGE)
  )
}

/** True when two elements genuinely sit on top of each other. */
export function overlapping(a: Placed, b: Placed) {
  const g = gaps(bbox(a), bbox(b))
  return g.x < -TOUCH_TOLERANCE - 1 && g.y < -TOUCH_TOLERANCE - 1
}

export interface Guide {
  axis: 'x' | 'y'
  at: number
  from: number
  to: number
}

export interface SnapResult {
  dx: number
  dy: number
  guides: Guide[]
}

/**
 * Nudges a box being dragged so its edges or centre land on nearby elements'
 * edges/centres (edge-to-edge contact is what triggers a merge). Falls back to
 * the grid on any axis with nothing close enough.
 */
export function snapBox(m: Box, others: Box[], threshold: number, grid: number): SnapResult {
  const mcx = (m.x1 + m.x2) / 2
  const mcy = (m.y1 + m.y2) / 2
  let bestX: { d: number; at: number; o: Box; cost: number } | null = null
  let bestY: { d: number; at: number; o: Box; cost: number } | null = null

  for (const o of others) {
    const ocx = (o.x1 + o.x2) / 2
    const ocy = (o.y1 + o.y2) / 2
    const g = gaps(m, o)
    // Contact snaps only make sense when the boxes face each other.
    const facingY = g.y < threshold
    const facingX = g.x < threshold
    const xs: Array<[number, number]> = [
      [o.x1 - m.x1, o.x1],
      [o.x2 - m.x2, o.x2],
      [ocx - mcx, ocx],
    ]
    if (facingY) xs.push([o.x2 - m.x1, o.x2], [o.x1 - m.x2, o.x1])
    const ys: Array<[number, number]> = [
      [o.y1 - m.y1, o.y1],
      [o.y2 - m.y2, o.y2],
      [ocy - mcy, ocy],
    ]
    if (facingX) ys.push([o.y2 - m.y1, o.y2], [o.y1 - m.y2, o.y1])
    // Edge-to-edge contact wins over mere alignment: it is what the person is
    // trying to do when they drag one table up against another.
    const contactX = xs.length - 3
    const contactY = ys.length - 3
    for (let i = 0; i < xs.length; i++) {
      const [d, at] = xs[i]
      const cost = Math.abs(d) - (i >= 3 && contactX ? threshold : 0)
      if (Math.abs(d) <= threshold && (!bestX || cost < bestX.cost)) bestX = { d, at, o, cost }
    }
    for (let i = 0; i < ys.length; i++) {
      const [d, at] = ys[i]
      const cost = Math.abs(d) - (i >= 3 && contactY ? threshold : 0)
      if (Math.abs(d) <= threshold && (!bestY || cost < bestY.cost)) bestY = { d, at, o, cost }
    }
  }

  const guides: Guide[] = []
  let dx: number
  let dy: number
  if (bestX) {
    dx = bestX.d
    guides.push({ axis: 'x', at: bestX.at, from: Math.min(m.y1, bestX.o.y1), to: Math.max(m.y2, bestX.o.y2) })
  } else {
    dx = grid > 0 ? Math.round(m.x1 / grid) * grid - m.x1 : 0
  }
  if (bestY) {
    dy = bestY.d
    guides.push({ axis: 'y', at: bestY.at, from: Math.min(m.x1, bestY.o.x1) + dx, to: Math.max(m.x2, bestY.o.x2) + dx })
  } else {
    dy = grid > 0 ? Math.round(m.y1 / grid) * grid - m.y1 : 0
  }
  return { dx, dy, guides }
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

export const roundTo = (v: number, step: number) => Math.round(v / step) * step

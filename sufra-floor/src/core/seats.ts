import { containsPoint, toFloor, type Placed } from './geometry'
import type { Shape, Table } from './types'

/** Width one diner needs at the table edge, in cm. */
export const SEAT_PITCH = 60
/** Distance from the table edge to the centre of the chair. */
export const CHAIR_OFFSET = 24
export const CHAIR_SIZE = 40

export interface Chair {
  x: number
  y: number
  /** Degrees; the direction the diner faces (towards the table). */
  angle: number
  blocked: boolean
}

interface Side {
  length: number
  // Local point at parameter t in [0,1] along the side, already pushed out by the chair offset.
  at: (t: number) => { x: number; y: number }
  angle: number
}

function rectSides(shape: Shape, w: number, h: number): Side[] {
  const o = CHAIR_OFFSET
  const top: Side = { length: w, at: (t) => ({ x: -w / 2 + t * w, y: -h / 2 - o }), angle: 90 }
  const bottom: Side = { length: w, at: (t) => ({ x: w / 2 - t * w, y: h / 2 + o }), angle: -90 }
  const left: Side = { length: h, at: (t) => ({ x: -w / 2 - o, y: h / 2 - t * h }), angle: 0 }
  const right: Side = { length: h, at: (t) => ({ x: w / 2 + o, y: -h / 2 + t * h }), angle: 180 }
  if (shape === 'bar') return [bottom]
  if (shape === 'booth') return w >= h ? [top, bottom] : [left, right]
  return [top, right, bottom, left]
}

function perSideAuto(side: Side, shape: Shape) {
  const pitch = shape === 'bar' ? 55 : SEAT_PITCH
  if (side.length < 45) return 0
  return Math.max(1, Math.floor(side.length / pitch))
}

/** Splits n chairs over sides by length using largest remainder. */
function distribute(sides: Side[], n: number) {
  const total = sides.reduce((s, x) => s + x.length, 0)
  const raw = sides.map((s) => (n * s.length) / total)
  const out = raw.map(Math.floor)
  let left = n - out.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (left <= 0) break
    out[i]++
    left--
  }
  return out
}

function ellipsePerimeter(a: number, b: number) {
  // Ramanujan's approximation; exact for circles.
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
}

export function autoSeatCount(t: Pick<Table, 'shape' | 'w' | 'h'>) {
  if (t.shape === 'round' || t.shape === 'oval') {
    return Math.max(2, Math.floor(ellipsePerimeter(t.w / 2, t.h / 2) / SEAT_PITCH))
  }
  return rectSides(t.shape, t.w, t.h).reduce((s, side) => s + perSideAuto(side, t.shape), 0)
}

/** Chairs in the table's local frame, before anything can block them. */
function localChairs(t: Table): Array<{ x: number; y: number; angle: number }> {
  const n = t.seatsOverride ?? autoSeatCount(t)
  if (t.shape === 'round' || t.shape === 'oval') {
    const a = t.w / 2 + CHAIR_OFFSET
    const b = t.h / 2 + CHAIR_OFFSET
    return Array.from({ length: n }, (_, i) => {
      const th = -Math.PI / 2 + (i * 2 * Math.PI) / n
      return { x: a * Math.cos(th), y: b * Math.sin(th), angle: (th * 180) / Math.PI + 180 }
    })
  }
  const sides = rectSides(t.shape, t.w, t.h)
  const counts = t.seatsOverride == null ? sides.map((s) => perSideAuto(s, t.shape)) : distribute(sides, n)
  return sides.flatMap((side, si) =>
    Array.from({ length: counts[si] }, (_, i) => ({ ...side.at((i + 0.5) / counts[si]), angle: side.angle })),
  )
}

/**
 * Chairs placed on the floor. A chair is blocked when it would stand inside
 * another table or a wall/pillar: that is how pushing two tables together
 * removes the chairs on the shared edge.
 */
export function chairsFor(t: Table, obstacles: Placed[]): Chair[] {
  return localChairs(t).map((c) => {
    const p = toFloor(t, c.x, c.y)
    const blocked = obstacles.some((o) => containsPoint(o, p.x, p.y, 2))
    return { x: p.x, y: p.y, angle: c.angle + t.rotation, blocked }
  })
}

export function seatCount(t: Table, obstacles: Placed[]) {
  return chairsFor(t, obstacles).filter((c) => !c.blocked).length
}

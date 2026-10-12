import { bbox, roundTo } from './core/geometry'
import { changeShape, nextLabel, sizeForSeats } from './core/layout'
import { addItem, checkForTable, mergeChecks, openCheck, setStatus, transferTable } from './core/checks'
import { pushTogether } from './core/reservations'
import type { Decor, DecorKind, Layout, MenuItem, Reservation, Shape, Table, WaitEntry } from './core/types'
import { store, uid, type Data } from './store'

const layoutOf = (d: Data, fn: (l: Layout) => Layout): Data => ({ ...d, layout: fn(d.layout) })

/** First spot near `at` where a new element does not sit on anything. */
function freeSpot(l: Layout, zoneId: string, w: number, h: number, at: { x: number; y: number }) {
  const zone = l.zones.find((z) => z.id === zoneId)!
  const items = [...l.tables, ...l.decor].filter((x) => x.zoneId === zoneId).map((x) => bbox(x))
  const pad = 70 // leave room for chairs
  for (let r = 0; r < 1200; r += 20) {
    for (let a = 0; a < 360; a += r === 0 ? 360 : 30) {
      const x = roundTo(at.x + r * Math.cos((a * Math.PI) / 180), 10)
      const y = roundTo(at.y + r * Math.sin((a * Math.PI) / 180), 10)
      if (x - w / 2 < 30 || y - h / 2 < 30 || x + w / 2 > zone.width - 30 || y + h / 2 > zone.height - 30) continue
      const clash = items.some((b) => x + w / 2 + pad > b.x1 && x - w / 2 - pad < b.x2 && y + h / 2 + pad > b.y1 && y - h / 2 - pad < b.y2)
      if (!clash) return { x, y }
    }
  }
  return { x: zone.width / 2, y: zone.height / 2 }
}

export function addTable(zoneId: string, shape: Shape, at: { x: number; y: number }) {
  const size = shape === 'bar' ? { w: 180, h: 50 } : sizeForSeats(shape, shape === 'rect' || shape === 'oval' || shape === 'booth' ? 6 : 4)
  const id = uid('t')
  store.commit((d) =>
    layoutOf(d, (l) => {
      const spot = freeSpot(l, zoneId, size.w, size.h, at)
      const prefix = zoneId === 'terrace' ? 'P' : shape === 'bar' ? 'B' : 'T'
      const t: Table = { id, label: nextLabel(l.tables, prefix), zoneId, shape, ...size, ...spot, rotation: 0, seatsOverride: null }
      return { ...l, tables: [...l.tables, t] }
    }),
  )
  return id
}

const DECOR_SIZE: Record<DecorKind, { w: number; h: number }> = {
  wall: { w: 300, h: 20 },
  pillar: { w: 46, h: 46 },
  door: { w: 100, h: 20 },
  counter: { w: 260, h: 60 },
  plant: { w: 50, h: 50 },
  window: { w: 200, h: 12 },
}

export function addDecor(zoneId: string, kind: DecorKind, at: { x: number; y: number }) {
  const id = uid('d')
  store.commit((d) =>
    layoutOf(d, (l) => {
      const s = DECOR_SIZE[kind]
      const spot = freeSpot(l, zoneId, s.w, s.h, at)
      const item: Decor = { id, zoneId, kind, ...s, ...spot, rotation: 0 }
      return { ...l, decor: [...l.decor, item] }
    }),
  )
  return id
}

export function updateItem(id: string, patch: Partial<Table & Decor>) {
  store.commit((d) =>
    layoutOf(d, (l) => ({
      ...l,
      tables: l.tables.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      decor: l.decor.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),
  )
}

export function setShape(id: string, shape: Shape) {
  store.commit((d) => layoutOf(d, (l) => ({ ...l, tables: l.tables.map((t) => (t.id === id ? changeShape(t, shape) : t)) })))
}

export function rotate(ids: string[]) {
  store.commit((d) =>
    layoutOf(d, (l) => ({
      ...l,
      tables: l.tables.map((t) => (ids.includes(t.id) ? { ...t, rotation: (t.rotation + 45) % 360 } : t)),
      decor: l.decor.map((x) => (ids.includes(x.id) ? { ...x, rotation: (x.rotation + 45) % 360 } : x)),
    })),
  )
}

export function duplicate(ids: string[]) {
  const made: string[] = []
  store.commit((d) =>
    layoutOf(d, (l) => {
      let tables = l.tables
      let decor = l.decor
      for (const id of ids) {
        const t = tables.find((x) => x.id === id)
        const x = decor.find((y) => y.id === id)
        const src = t ?? x
        if (!src) continue
        const spot = freeSpot({ ...l, tables, decor }, src.zoneId, src.w, src.h, { x: src.x + src.w + 80, y: src.y })
        const nid = uid(t ? 't' : 'd')
        made.push(nid)
        if (t) tables = [...tables, { ...t, ...spot, id: nid, label: nextLabel(tables, t.label.replace(/\d+$/, '') || 'T') }]
        else decor = [...decor, { ...x!, ...spot, id: nid }]
      }
      return { ...l, tables, decor }
    }),
  )
  return made
}

/** Tables with an open bill are kept: the cashier would lose track of it. */
export function removeItems(ids: string[]) {
  const d = store.data
  const keep = ids.filter((id) => checkForTable(d.checks, id))
  store.commit((s) =>
    layoutOf(
      {
        ...s,
        links: s.links.map((l) => ({ ...l, tableIds: l.tableIds.filter((t) => !ids.includes(t) || keep.includes(t)) })).filter((l) => l.tableIds.length > 1),
      },
      (l) => ({
        ...l,
        tables: l.tables.filter((t) => !ids.includes(t.id) || keep.includes(t.id)),
        decor: l.decor.filter((x) => !ids.includes(x.id)),
      }),
    ),
  )
  return keep
}

export function align(ids: string[], how: 'top' | 'middle' | 'left') {
  const d = store.data
  const ts = d.layout.tables.filter((t) => ids.includes(t.id))
  if (ts.length < 2) return
  const boxes = ts.map((t) => bbox(t))
  store.commit((s) =>
    layoutOf(s, (l) => ({
      ...l,
      tables: l.tables.map((t) => {
        if (!ids.includes(t.id)) return t
        const b = bbox(t)
        if (how === 'top') return { ...t, y: t.y + Math.min(...boxes.map((x) => x.y1)) - b.y1 }
        if (how === 'left') return { ...t, x: t.x + Math.min(...boxes.map((x) => x.x1)) - b.x1 }
        return { ...t, y: ts.reduce((a, x) => a + x.y, 0) / ts.length }
      }),
    })),
  )
}

export function spread(ids: string[]) {
  const ts = store.data.layout.tables.filter((t) => ids.includes(t.id))
  if (ts.length < 3) return
  const horizontal = Math.max(...ts.map((t) => t.x)) - Math.min(...ts.map((t) => t.x)) >= Math.max(...ts.map((t) => t.y)) - Math.min(...ts.map((t) => t.y))
  const key = horizontal ? 'x' : 'y'
  const sorted = [...ts].sort((a, b) => a[key] - b[key])
  const first = sorted[0][key]
  const step = (sorted[sorted.length - 1][key] - first) / (sorted.length - 1)
  const pos = new Map(sorted.map((t, i) => [t.id, roundTo(first + i * step, 5)]))
  store.commit((s) => layoutOf(s, (l) => ({ ...l, tables: l.tables.map((t) => (pos.has(t.id) ? { ...t, [key]: pos.get(t.id)! } : t)) })))
}

/** Slides each table up against the previous one: the bills merge as a result. */
export function pushIdsTogether(ids: string[]) {
  store.commit((s) =>
    layoutOf(s, (l) => {
      let tables = l.tables
      const ordered = ids.map((id) => tables.find((t) => t.id === id)!).filter(Boolean)
      for (let i = 1; i < ordered.length; i++) {
        const anchor = tables.find((t) => t.id === ordered[i - 1].id)!
        const cur = tables.find((t) => t.id === ordered[i].id)!
        const moved = pushTogether(anchor, cur) ?? sideBySide(anchor, cur)
        tables = tables.map((t) => (t.id === moved.id ? moved : t))
      }
      return { ...l, tables }
    }),
  )
}

/** Fallback when the tables are not lined up: park `b` against `a`'s right side. */
function sideBySide(a: Table, b: Table): Table {
  const A = bbox(a)
  const B = bbox(b)
  return { ...b, zoneId: a.zoneId, x: A.x2 + (B.x2 - B.x1) / 2, y: A.y1 + (B.y2 - B.y1) / 2 }
}

export function linkTables(ids: string[]) {
  store.commit((d) => {
    const merged = mergeChecks(d.checks, ids)
    return { ...d, links: [...d.links.filter((l) => !l.tableIds.some((t) => ids.includes(t))), { id: uid('lk'), tableIds: ids }], checks: merged.checks }
  })
}

export function unlinkTables(ids: string[]) {
  store.commit((d) => ({ ...d, links: d.links.filter((l) => !l.tableIds.some((t) => ids.includes(t))) }))
}

export function saveBase() {
  store.commit((d) => ({ ...d, baseLayout: d.layout }))
}
export function restoreBase() {
  store.commit((d) => ({ ...d, layout: d.baseLayout }))
}

// --- service --------------------------------------------------------------

export function seatTables(tableIds: string[], guests: number, reservationId: string | null = null) {
  store.commit((d) => ({
    ...d,
    checks: openCheck(d.checks, tableIds, guests, d.now, () => uid('c'), reservationId),
    dirty: d.dirty.filter((x) => !tableIds.includes(x.tableId)),
    links: tableIds.length > 1 ? [...d.links, { id: uid('lk'), tableIds }] : d.links,
  }))
}

export function orderItem(checkId: string, item: MenuItem, tableId: string) {
  store.commit((d) => ({ ...d, checks: addItem(d.checks, checkId, item, tableId, () => uid('l')) }))
}

export function changeQty(checkId: string, lineId: string, delta: number) {
  store.commit((d) => ({
    ...d,
    checks: d.checks.map((c) =>
      c.id !== checkId ? c : { ...c, lines: c.lines.map((l) => (l.id === lineId ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0) },
    ),
  }))
}

export function setGuests(checkId: string, guests: number) {
  store.commit((d) => ({ ...d, checks: d.checks.map((c) => (c.id === checkId ? { ...c, guests: Math.max(1, guests) } : c)) }))
}

export function requestBill(checkId: string) {
  store.commit((d) => ({ ...d, checks: setStatus(d.checks, checkId, 'bill_requested') }))
}

export function payAndClose(checkId: string) {
  store.commit((d) => {
    const c = d.checks.find((x) => x.id === checkId)!
    return {
      ...d,
      checks: setStatus(d.checks, checkId, 'paid'),
      dirty: [...d.dirty, ...c.tableIds.map((tableId) => ({ tableId, since: d.now }))],
      links: d.links.filter((l) => !l.tableIds.some((t) => c.tableIds.includes(t))),
      reservations: d.reservations.map((r) => (r.id === c.reservationId ? { ...r, status: 'done' } : r)),
    }
  })
}

export function markClean(tableId: string) {
  store.commit((d) => ({ ...d, dirty: d.dirty.filter((x) => x.tableId !== tableId) }))
}

export function transfer(checkId: string, from: string, to: string) {
  store.commit((d) => ({ ...d, checks: transferTable(d.checks, checkId, from, to) }))
}

// --- reservations -----------------------------------------------------------

export function saveReservation(r: Reservation) {
  store.commit((d) => ({
    ...d,
    reservations: d.reservations.some((x) => x.id === r.id) ? d.reservations.map((x) => (x.id === r.id ? r : x)) : [...d.reservations, r],
  }))
}

export function patchReservation(id: string, patch: Partial<Reservation>) {
  store.commit((d) => ({ ...d, reservations: d.reservations.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
}

export function deleteReservation(id: string) {
  store.commit((d) => ({ ...d, reservations: d.reservations.filter((r) => r.id !== id) }))
}

/**
 * Seats a booking: tables that are meant to be joined are physically pushed
 * together, which also merges anything already on them into one bill.
 */
export function seatReservation(id: string) {
  store.commit((d) => {
    const r = d.reservations.find((x) => x.id === id)!
    let tables = d.layout.tables
    for (let i = 1; i < r.tableIds.length; i++) {
      const a = tables.find((t) => t.id === r.tableIds[i - 1])
      const b = tables.find((t) => t.id === r.tableIds[i])
      if (!a || !b) continue
      const moved = pushTogether(a, b)
      if (moved) tables = tables.map((t) => (t.id === moved.id ? moved : t))
    }
    const busy = r.tableIds.some((t) => checkForTable(d.checks, t))
    let checks = d.checks
    if (busy) checks = mergeChecks(checks, r.tableIds).checks
    else checks = openCheck(checks, r.tableIds, r.party, d.now, () => uid('c'), r.id)
    return {
      ...d,
      layout: { ...d.layout, tables },
      // Pushing tables together records the contact so it is not re-merged later.
      checks,
      dirty: d.dirty.filter((x) => !r.tableIds.includes(x.tableId)),
      links: r.tableIds.length > 1 ? [...d.links.filter((l) => !l.tableIds.some((t) => r.tableIds.includes(t))), { id: uid('lk'), tableIds: r.tableIds }] : d.links,
      reservations: d.reservations.map((x) => (x.id === id ? { ...x, status: 'seated' } : x)),
    }
  })
}

export function addWait(e: Omit<WaitEntry, 'id' | 'addedAt'>) {
  store.commit((d) => ({ ...d, waitlist: [...d.waitlist, { ...e, id: uid('w'), addedAt: d.now }] }))
}

export function removeWait(id: string) {
  store.commit((d) => ({ ...d, waitlist: d.waitlist.filter((w) => w.id !== id) }))
}

export function setNow(now: number) {
  store.quiet((d) => ({ ...d, now }))
}

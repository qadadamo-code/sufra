import { checkForTable } from './core/checks'
import { overlapping } from './core/geometry'
import { capacityOf, computeGroups, type TableGroup } from './core/layout'
import { chairsFor, type Chair } from './core/seats'
import { expectedFreeAt, nextReservationFor, TURN_BUFFER } from './core/reservations'
import { obstaclesFor } from './core/layout'
import type { Check, Reservation, Table } from './core/types'
import type { Data } from './store'

export type TableStatus = 'free' | 'occupied' | 'bill' | 'reserved' | 'dirty'

export interface TableView {
  table: Table
  chairs: Chair[]
  capacity: number
  status: TableStatus
  check: Check | null
  next: Reservation | null
  /** Seated party probably won't leave before the next booking arrives. */
  atRisk: boolean
  overlaps: boolean
}

export interface FloorView {
  tables: Map<string, TableView>
  groups: TableGroup[]
}

export function deriveFloor(d: Data): FloorView {
  const groups = computeGroups(d.layout.tables, d.links, new Set(d.edges))
  const tables = new Map<string, TableView>()
  for (const t of d.layout.tables) {
    const chairs = chairsFor(t, obstaclesFor(t, d.layout))
    const check = checkForTable(d.checks, t.id)
    const next = nextReservationFor(t.id, d.reservations, d.now)
    const dirty = d.dirty.some((x) => x.tableId === t.id)
    let status: TableStatus = 'free'
    if (check) status = check.status === 'bill_requested' ? 'bill' : 'occupied'
    else if (dirty) status = 'dirty'
    else if (next && next.start - d.now <= 30) status = 'reserved'
    const atRisk = !!(check && next && expectedFreeAt(check, d.now) + TURN_BUFFER > next.start)
    const overlaps = d.layout.tables.some((o) => o.id !== t.id && o.zoneId === t.zoneId && overlapping(t, o))
    tables.set(t.id, { table: t, chairs, capacity: capacityOf(t, d.layout), status, check, next, atRisk, overlaps })
  }
  return { tables, groups }
}

/** Seats per table id, used by the reservation timeline and suggestions. */
export function capacities(d: Data) {
  return new Map(d.layout.tables.map((t) => [t.id, capacityOf(t, d.layout)]))
}

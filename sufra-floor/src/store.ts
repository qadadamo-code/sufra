import { useSyncExternalStore } from 'react'
import { physicalEdges } from './core/layout'
import { reconcile, splitCheck } from './core/checks'
import type { Check, DirtyMark, Layout, ManualLink, Reservation, WaitEntry } from './core/types'
import { SEED_CHECKS, SEED_DIRTY, SEED_LAYOUT, SEED_NOW, SEED_RESERVATIONS, SEED_WAITLIST } from './seed'

export interface Data {
  layout: Layout
  /** The arrangement the floor is reset to after service. */
  baseLayout: Layout
  checks: Check[]
  links: ManualLink[]
  reservations: Reservation[]
  waitlist: WaitEntry[]
  dirty: DirtyMark[]
  edges: string[] // touching pairs as of the last reconcile
  now: number
}

export type Toast = {
  id: string
  tone: 'merge' | 'warn' | 'ok'
  text: string
  actions: Array<{ label: string; run: () => void }>
}

const KEY = 'sufra-floor-v1'

export function seedData(): Data {
  return {
    layout: SEED_LAYOUT,
    baseLayout: SEED_LAYOUT,
    checks: SEED_CHECKS,
    links: [],
    reservations: SEED_RESERVATIONS,
    waitlist: SEED_WAITLIST,
    dirty: SEED_DIRTY,
    edges: [...physicalEdges(SEED_LAYOUT.tables)],
    now: SEED_NOW,
  }
}

function load(): Data {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...seedData(), ...JSON.parse(raw) }
  } catch {
    /* storage unavailable: start from the demo night */
  }
  return seedData()
}

let seq = 0
export const uid = (p = 'x') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`

type Listener = () => void

/** Messages shown after the floor changes; text is built by the UI so it follows the language. */
export type FloorEvent =
  | { kind: 'merged'; tableIds: string[] }
  | { kind: 'separated'; checkId: string; tableIds: string[] }

class Store {
  data: Data = load()
  toasts: Toast[] = []
  private past: Data[] = []
  private future: Data[] = []
  private gestureStart: Data | null = null
  private listeners = new Set<Listener>()
  onFloorEvents: (events: FloorEvent[]) => void = () => {}

  subscribe = (l: Listener) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  private emit() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data))
    } catch {
      /* ignore */
    }
    this.listeners.forEach((l) => l())
  }

  get canUndo() {
    return this.past.length > 0
  }
  get canRedo() {
    return this.future.length > 0
  }

  /** One undoable change. */
  commit(fn: (d: Data) => Data) {
    const before = this.data
    const after = this.settle(fn(before))
    if (after === before) return
    this.past = [...this.past.slice(-60), before]
    this.future = []
    this.data = after
    this.emit()
  }

  /** A change that is not worth an undo step (e.g. moving the demo clock). */
  quiet(fn: (d: Data) => Data) {
    this.data = fn(this.data)
    this.emit()
  }

  /** Start of a drag/resize: changes are previewed, then committed once. */
  begin() {
    this.gestureStart = this.data
  }
  preview(fn: (d: Data) => Data) {
    this.data = fn(this.data)
    this.listeners.forEach((l) => l())
  }
  end() {
    const start = this.gestureStart
    this.gestureStart = null
    if (!start || start === this.data) return
    const settled = this.settle(this.data)
    if (JSON.stringify(start) === JSON.stringify(settled)) {
      this.data = start
      this.emit()
      return
    }
    this.past = [...this.past.slice(-60), start]
    this.future = []
    this.data = settled
    this.emit()
  }
  cancelGesture() {
    if (this.gestureStart) this.data = this.gestureStart
    this.gestureStart = null
    this.emit()
  }

  undo = () => {
    const prev = this.past.pop()
    if (!prev) return
    this.future.push(this.data)
    this.data = prev
    this.emit()
  }
  redo = () => {
    const next = this.future.pop()
    if (!next) return
    this.past.push(this.data)
    this.data = next
    this.emit()
  }

  /** Bills follow the floor: new contacts merge bills, broken ones are reported. */
  private settle(d: Data): Data {
    const next = physicalEdges(d.layout.tables)
    const prev = new Set(d.edges)
    const same = next.size === prev.size && [...next].every((e) => prev.has(e))
    if (same && d.links === this.data.links && d.checks === this.data.checks) return d
    const r = reconcile(d.layout.tables, d.links, d.checks, prev, next)
    const events: FloorEvent[] = r.merges.map((m) => ({ kind: 'merged', tableIds: m.tableIds }))
    const known = new Set(this.lastSeparated)
    for (const id of r.separated) {
      if (known.has(id)) continue
      const c = r.checks.find((x) => x.id === id)!
      events.push({ kind: 'separated', checkId: id, tableIds: c.tableIds })
    }
    this.lastSeparated = r.separated
    if (events.length) queueMicrotask(() => this.onFloorEvents(events))
    return { ...d, checks: r.checks, edges: [...next] }
  }
  private lastSeparated: string[] = []

  splitBill(checkId: string) {
    this.commit((d) => ({
      ...d,
      checks: splitCheck(d.checks, checkId, () => uid('c')),
      links: d.links.filter((l) => !l.tableIds.some((t) => d.checks.find((c) => c.id === checkId)?.tableIds.includes(t))),
    }))
  }

  pushToast(t: Omit<Toast, 'id'>) {
    const toast = { ...t, id: uid('t') }
    this.toasts = [...this.toasts.slice(-2), toast]
    this.listeners.forEach((l) => l())
    setTimeout(() => this.dismiss(toast.id), t.actions.length ? 9000 : 4000)
  }
  dismiss(id: string) {
    this.toasts = this.toasts.filter((t) => t.id !== id)
    this.listeners.forEach((l) => l())
  }

  reset() {
    this.past = [...this.past, this.data]
    this.data = seedData()
    this.lastSeparated = []
    this.emit()
  }
}

export const store = new Store()

let snapshot = { data: store.data, toasts: store.toasts }
export function useStore() {
  return useSyncExternalStore(store.subscribe, () => {
    if (snapshot.data !== store.data || snapshot.toasts !== store.toasts) snapshot = { data: store.data, toasts: store.toasts }
    return snapshot
  })
}

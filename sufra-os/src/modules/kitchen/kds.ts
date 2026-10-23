/**
 * Kitchen display — pure logic (no React, no I/O), unit-tested in kds.test.ts.
 *
 *  - tickets:   one per order (optionally limited to a station), items grouped by station, held courses, voids
 *  - aging:     green → amber → red at configurable minutes
 *  - all-day:   how many of each item are outstanding across tickets
 *  - state machine for item status: start / bump / serve / recall
 *  - prep stats: average fired → ready minutes per menu item
 */
import type { Order, OrderItem, OrderItemStatus, Settings } from "@/data/types";

/* ───────── settings ───────── */

export interface KdsSettings {
  amberMin: number;
  redMin: number;
  sound: boolean;
}
export const DEFAULT_KDS: KdsSettings = { amberMin: 10, redMin: 18, sound: true };

export function kdsSettings(s: Pick<Settings, "kitchen"> | null | undefined): KdsSettings {
  const k = s?.kitchen;
  if (!k) return DEFAULT_KDS;
  const amberMin = k.amberMin > 0 ? k.amberMin : DEFAULT_KDS.amberMin;
  const redMin = Math.max(amberMin + 1, k.redMin > 0 ? k.redMin : DEFAULT_KDS.redMin);
  return { amberMin, redMin, sound: k.sound !== false };
}

/* ───────── aging ───────── */

export type Age = "ok" | "amber" | "red";

export function ageMinutes(since: string | null, now: number): number {
  if (!since) return 0;
  return Math.max(0, (now - Date.parse(since)) / 60000);
}

export function ageLevel(minutes: number, k: Pick<KdsSettings, "amberMin" | "redMin"> = DEFAULT_KDS): Age {
  if (minutes >= k.redMin) return "red";
  if (minutes >= k.amberMin) return "amber";
  return "ok";
}

/** "4:07" / "1:02:30" ticket timer. */
export function fmtTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/* ───────── item state machine ───────── */

export type KdsAction = "start" | "bump" | "serve" | "recall";

const TRANSITIONS: Record<KdsAction, Partial<Record<OrderItemStatus, OrderItemStatus>>> = {
  start: { sent: "preparing" },
  bump: { sent: "ready", preparing: "ready" },
  serve: { ready: "served" },
  recall: { ready: "preparing", served: "ready" },
};

export function transition(status: OrderItemStatus, action: KdsAction): OrderItemStatus | null {
  return TRANSITIONS[action][status] ?? null;
}

export type ItemPatch = Partial<Pick<OrderItem, "status" | "readyAt" | "servedAt" | "firedAt">>;

/** The patch to apply for an action, or null when the action doesn't apply to this item's status. */
export function itemPatch(item: Pick<OrderItem, "status" | "firedAt">, action: KdsAction, at: string): ItemPatch | null {
  const next = transition(item.status, action);
  if (!next) return null;
  const p: ItemPatch = { status: next };
  if (action === "bump") p.readyAt = at;
  if (action === "serve") p.servedAt = at;
  if (action === "recall") {
    if (next === "preparing") p.readyAt = null;
    if (next === "ready") p.servedAt = null;
  }
  if (!item.firedAt) p.firedAt = at;
  return p;
}

/** Patches for every item in a set that the action applies to. */
export function patchesFor(items: Pick<OrderItem, "id" | "status" | "firedAt">[], action: KdsAction, at: string): { id: string; patch: ItemPatch }[] {
  return items.flatMap((i) => {
    const patch = itemPatch(i, action, at);
    return patch ? [{ id: i.id, patch }] : [];
  });
}

/**
 * The last bump on the screen, from the data alone: the ready items whose readyAt is the newest
 * (same order, within 2 s of each other). Used by "recall" when this device has no local history.
 */
export function lastBumped<T extends Pick<OrderItem, "orderId" | "status" | "readyAt" | "stationId">>(items: T[], stationId: string | null = null): T[] {
  const ready = items.filter((i) => i.status === "ready" && i.readyAt && (!stationId || i.stationId === stationId));
  if (!ready.length) return [];
  const newest = ready.reduce((a, b) => (Date.parse(b.readyAt!) > Date.parse(a.readyAt!) ? b : a));
  const t = Date.parse(newest.readyAt!);
  return ready.filter((i) => i.orderId === newest.orderId && t - Date.parse(i.readyAt!) <= 2000);
}

/** Order status implied by its items (kitchen side). Closed/void orders keep theirs. */
export function deriveOrderStatus(items: Pick<OrderItem, "status">[], current: Order["status"]): Order["status"] {
  if (current === "closed" || current === "void") return current;
  const live = items.filter((i) => i.status !== "void");
  if (!live.length) return current;
  const fired = live.filter((i) => i.status !== "new");
  if (!fired.length) return current;
  if (fired.some((i) => i.status === "sent" || i.status === "preparing")) return "sent";
  if (fired.some((i) => i.status === "ready")) return "ready";
  return "served";
}

/* ───────── tickets ───────── */

export type TicketState = "new" | "preparing" | "ready";
export type TicketKind = "dine_in" | "takeaway" | "delivery" | "qr";

export interface StationGroup {
  stationId: string | null;
  items: OrderItem[];
}

export interface Ticket {
  key: string;
  order: Order;
  kind: TicketKind;
  /** fired items still on the line (sent / preparing / ready) */
  items: OrderItem[];
  groups: StationGroup[];
  /** later courses not fired yet (greyed) */
  held: OrderItem[];
  /** voided after firing — shown struck through as CANCELLED */
  voided: OrderItem[];
  firedAt: string;
  state: TicketState;
  /** items on this ticket still to cook */
  pending: number;
  /** stations involved in the whole order (for "other stations" hints) */
  stations: (string | null)[];
}

export const ticketKind = (o: Pick<Order, "mode" | "source">): TicketKind => (o.source === "qr" ? "qr" : o.mode);

const ACTIVE: OrderItemStatus[] = ["sent", "preparing", "ready"];

export interface TicketOpts {
  /** limit to one station (null/undefined = all stations) */
  stationId?: string | null;
  /** include tickets whose items are all ready (expo) — default false: bumped tickets leave the line */
  includeReady?: boolean;
  /** station sort order */
  stationOrder?: string[];
  /** a void older than this many ms is no longer shown (default 15 min) */
  voidTtlMs?: number;
  now?: number;
}

export function buildTickets(orders: Order[], items: OrderItem[], opts: TicketOpts = {}): Ticket[] {
  const now = opts.now ?? Date.now();
  const voidTtl = opts.voidTtlMs ?? 15 * 60_000;
  const byOrder = new Map<string, OrderItem[]>();
  for (const i of items) byOrder.set(i.orderId, [...(byOrder.get(i.orderId) ?? []), i]);
  const sOrder = new Map((opts.stationOrder ?? []).map((s, i) => [s, i]));
  const rank = (s: string | null) => (s === null ? 999 : sOrder.get(s) ?? 500);
  const out: Ticket[] = [];
  for (const o of orders) {
    if (o.status === "void" || o.status === "closed") continue;
    const all = byOrder.get(o.id) ?? [];
    const inStation = (i: OrderItem) => !opts.stationId || i.stationId === opts.stationId;
    const mine = all.filter(inStation);
    const active = mine.filter((i) => ACTIVE.includes(i.status));
    if (!active.length) continue;
    const pending = active.filter((i) => i.status !== "ready").length;
    if (!pending && !opts.includeReady) continue;
    const held = mine.filter((i) => i.status === "new");
    const voided = mine.filter((i) => i.status === "void" && i.firedAt && now - Date.parse(i.updatedAt) < voidTtl);
    const firedAt = active.reduce((m, i) => (i.firedAt && i.firedAt < m ? i.firedAt : m), active[0].firedAt ?? o.openedAt);
    const groupsMap = new Map<string | null, OrderItem[]>();
    for (const i of [...active].sort((a, b) => a.course - b.course || (a.seat ?? 0) - (b.seat ?? 0) || a.createdAt.localeCompare(b.createdAt))) {
      groupsMap.set(i.stationId, [...(groupsMap.get(i.stationId) ?? []), i]);
    }
    const groups = [...groupsMap.entries()].map(([stationId, its]) => ({ stationId, items: its })).sort((a, b) => rank(a.stationId) - rank(b.stationId));
    const state: TicketState = !pending ? "ready" : active.some((i) => i.status === "preparing" || i.status === "ready") ? "preparing" : "new";
    out.push({
      key: opts.stationId ? `${o.id}:${opts.stationId}` : o.id,
      order: o,
      kind: ticketKind(o),
      items: active,
      groups,
      held,
      voided,
      firedAt,
      state,
      pending,
      stations: [...new Set(all.filter((i) => i.status !== "void").map((i) => i.stationId))],
    });
  }
  return sortTickets(out);
}

const PRIORITY_RANK = { vip: 2, rush: 1, normal: 0 } as const;

/** Rush/VIP first, then oldest first. */
export function sortTickets(ts: Ticket[]): Ticket[] {
  return [...ts].sort((a, b) => PRIORITY_RANK[b.order.priority ?? "normal"] - PRIORITY_RANK[a.order.priority ?? "normal"] || a.firedAt.localeCompare(b.firedAt) || a.order.number - b.order.number);
}

/* ───────── all-day ───────── */

export interface AllDayRow {
  itemId: string;
  name: OrderItem["name"];
  stationId: string | null;
  /** outstanding = waiting + preparing */
  total: number;
  waiting: number;
  preparing: number;
  tickets: number;
  /** modifier combinations ("½ kg · Fries") with quantities, most common first */
  variants: { label: string[]; qty: number }[];
  oldestFiredAt: string | null;
}

/** Totals of each item still to cook across all tickets (optionally one station). Ready/served/held/void are excluded. */
export function allDay(items: OrderItem[], opts: { stationId?: string | null; lang?: "ar" | "en" } = {}): AllDayRow[] {
  const lang = opts.lang ?? "ar";
  const rows = new Map<string, AllDayRow & { _orders: Set<string>; _v: Map<string, { label: string[]; qty: number }> }>();
  for (const i of items) {
    if (i.status !== "sent" && i.status !== "preparing") continue;
    if (opts.stationId && i.stationId !== opts.stationId) continue;
    let r = rows.get(i.itemId);
    if (!r) {
      r = { itemId: i.itemId, name: i.name, stationId: i.stationId, total: 0, waiting: 0, preparing: 0, tickets: 0, variants: [], oldestFiredAt: null, _orders: new Set(), _v: new Map() };
      rows.set(i.itemId, r);
    }
    r.total += i.qty;
    if (i.status === "sent") r.waiting += i.qty;
    else r.preparing += i.qty;
    r._orders.add(i.orderId);
    if (i.firedAt && (!r.oldestFiredAt || i.firedAt < r.oldestFiredAt)) r.oldestFiredAt = i.firedAt;
    const label = i.modifiers.map((m) => m.name[lang] || m.name.ar);
    const key = label.join("|");
    const v = r._v.get(key) ?? { label, qty: 0 };
    v.qty += i.qty;
    r._v.set(key, v);
  }
  return [...rows.values()]
    .map(({ _orders, _v, ...r }) => ({ ...r, tickets: _orders.size, variants: [...(_v.values())].sort((a, b) => b.qty - a.qty) }))
    .sort((a, b) => b.total - a.total || (a.oldestFiredAt ?? "").localeCompare(b.oldestFiredAt ?? ""));
}

/* ───────── prep stats ───────── */

export interface PrepStat {
  itemId: string;
  n: number;
  avgMin: number;
}

/** Average fired → ready minutes per menu item (lines with both timestamps). */
export function prepStats(items: Pick<OrderItem, "itemId" | "firedAt" | "readyAt" | "status">[]): Map<string, PrepStat> {
  const acc = new Map<string, { n: number; sum: number }>();
  for (const i of items) {
    if (!i.firedAt || !i.readyAt || i.status === "void") continue;
    const min = (Date.parse(i.readyAt) - Date.parse(i.firedAt)) / 60000;
    if (!(min >= 0) || min > 240) continue; // ignore clock skew / forgotten tickets
    const a = acc.get(i.itemId) ?? { n: 0, sum: 0 };
    a.n++;
    a.sum += min;
    acc.set(i.itemId, a);
  }
  return new Map([...acc.entries()].map(([itemId, a]) => [itemId, { itemId, n: a.n, avgMin: Math.round((a.sum / a.n) * 10) / 10 }]));
}

/** Overall average ticket time (fired → last item ready) in minutes for completed tickets. */
export function avgTicketMinutes(items: Pick<OrderItem, "orderId" | "firedAt" | "readyAt" | "status">[]): number | null {
  const by = new Map<string, { first: number; last: number; open: boolean }>();
  for (const i of items) {
    if (i.status === "void" || i.status === "new" || !i.firedAt) continue;
    const b = by.get(i.orderId) ?? { first: Infinity, last: 0, open: false };
    b.first = Math.min(b.first, Date.parse(i.firedAt));
    if (i.readyAt) b.last = Math.max(b.last, Date.parse(i.readyAt));
    else b.open = true;
    by.set(i.orderId, b);
  }
  const done = [...by.values()].filter((b) => !b.open && b.last >= b.first);
  if (!done.length) return null;
  return Math.round((done.reduce((s, b) => s + (b.last - b.first), 0) / done.length / 60000) * 10) / 10;
}

/* ───────── allergy / note highlighting ───────── */

const ALLERGY = /(حساسي|حساسية|allerg|gluten|جلوتين|سوداني|peanut|\bnuts?\b|مكسرات|lactose|لاكتوز|dairy|shellfish|جمبري|سمسم|sesame|\beggs?\b)/i;
/** Notes that mention an allergy are shown in red. */
export const isAllergy = (text: string) => !!text && ALLERGY.test(text);

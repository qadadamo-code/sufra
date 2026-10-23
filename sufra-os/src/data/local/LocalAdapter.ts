/**
 * LocalAdapter — the whole backend, in the browser.
 *
 *  - Rows live in memory (fast synchronous queries) and are written through to IndexedDB.
 *  - Every write is broadcast on a BroadcastChannel, so other tabs on this browser behave like other
 *    devices on the same restaurant network: open the cashier in one tab and the kitchen in another and
 *    they update live.
 *  - First run seeds the demo restaurant (src/data/seed.ts).
 *
 * Semantics match the Supabase adapter (same Repo interface), so modules do not care which one runs.
 */
import { uuid } from "@/lib/id";
import { nowIso, startOfDay } from "@/lib/time";
import { loadRaw, saveRaw } from "@/lib/storage";
import { buildSeed, hashPassword, hashPin, type SeedUser } from "../seed";
import { runQuery } from "../query";
import { priceItems } from "../pricing";
import type { AuthApi, AuthUser, ChangeEvent, GuestApi, GuestMenu, Insertable, Patch, Query, Repo, SyncStatus, Unsubscribe } from "../repo";
import { COLLECTIONS, type CollectionName, type Membership, type Order, type OrderItem, type RowOf, type ServiceCallType } from "../types";
import { openKV, MemoryKV, type KV } from "./store";

type AnyRow = { id: string; restaurantId?: string } & Record<string, unknown>;

type Msg =
  | { t: "change"; from: string; e: ChangeEvent }
  | { t: "hello"; from: string }
  | { t: "bye"; from: string }
  | { t: "reset"; from: string };

const USERS = "_users";
const PINS = "_pins";
const META = "_meta";
const SEED_VERSION = "1";

export interface LocalAdapterOptions {
  /** IndexedDB database + BroadcastChannel name. Tests use unique names. */
  name?: string;
  /** use memory only (tests) */
  memory?: boolean;
  /** seed when empty (default true) */
  seed?: boolean;
  /** clock for the seed */
  now?: () => Date;
  /** where the email session is remembered */
  sessionKey?: string;
}

export class LocalAdapter implements Repo {
  readonly kind = "local" as const;
  private kv: KV;
  private rows = new Map<string, Map<string, AnyRow>>();
  private users = new Map<string, SeedUser>();
  private pins = new Map<string, string>();
  private listeners = new Set<{ cols: Set<string> | null; rid: string | null; cb: (e: ChangeEvent) => void }>();
  private syncListeners = new Set<(s: SyncStatus) => void>();
  private authListeners = new Set<(u: AuthUser | null) => void>();
  private channel: BroadcastChannel | null = null;
  private readonly tabId = uuid();
  private peers = new Map<string, number>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private status: SyncStatus = { mode: "local", online: true, pending: 0, peers: 0, lastSyncAt: null, error: null };
  private readyP: Promise<void>;
  private opts: Required<LocalAdapterOptions>;

  constructor(opts: LocalAdapterOptions = {}) {
    this.opts = { name: "sufra-os", memory: false, seed: true, now: () => new Date(), sessionKey: "sufra-os.session", ...opts };
    this.kv = this.opts.memory ? new MemoryKV() : openKV(this.opts.name);
    for (const c of COLLECTIONS) this.rows.set(c, new Map());
    this.readyP = this.boot();
  }

  /* ───────── lifecycle ───────── */

  private async boot() {
    let stored;
    try {
      stored = await this.kv.loadAll();
    } catch {
      this.kv = new MemoryKV();
      stored = [] as Awaited<ReturnType<KV["loadAll"]>>;
    }
    const meta = stored.find((s) => s.c === META && (s.row as AnyRow).id === "seed");
    if (this.opts.seed && (!meta || (meta.row as { version?: string }).version !== SEED_VERSION)) {
      await this.kv.clear();
      stored = await this.writeSeed();
    }
    this.hydrate(stored);
    this.openChannel();
    this.status = { ...this.status, lastSyncAt: nowIso() };
  }

  private hydrate(stored: { c: string; row: unknown }[]) {
    for (const c of COLLECTIONS) this.rows.get(c)!.clear();
    this.users.clear();
    this.pins.clear();
    for (const s of stored) {
      if (s.c === USERS) {
        const u = s.row as SeedUser;
        this.users.set(u.id, u);
      } else if (s.c === PINS) {
        const p = s.row as { id: string; hash: string };
        this.pins.set(p.id, p.hash);
      } else if (this.rows.has(s.c)) {
        const r = s.row as AnyRow;
        this.rows.get(s.c)!.set(r.id, r);
      }
    }
  }

  private async writeSeed() {
    const seed = buildSeed(this.opts.now());
    const batch: { c: string; id: string; row: unknown }[] = [];
    for (const c of COLLECTIONS) for (const r of seed.data[c] as AnyRow[]) batch.push({ c, id: r.id, row: r });
    for (const u of seed.users) batch.push({ c: USERS, id: u.id, row: u });
    for (const [id, hash] of Object.entries(seed.pinHashes)) batch.push({ c: PINS, id, row: { id, hash } });
    batch.push({ c: META, id: "seed", row: { id: "seed", version: SEED_VERSION, at: nowIso() } });
    await this.kv.putMany(batch);
    return batch.map((b) => ({ k: `${b.c}/${b.id}`, c: b.c, row: b.row }));
  }

  private openChannel() {
    if (typeof BroadcastChannel === "undefined") return;
    this.channel = new BroadcastChannel(`${this.opts.name}:sync`);
    this.channel.onmessage = (ev: MessageEvent<Msg>) => this.onMessage(ev.data);
    this.post({ t: "hello", from: this.tabId });
    this.heartbeat = setInterval(() => {
      this.post({ t: "hello", from: this.tabId });
      const cutoff = Date.now() - 12_000;
      let changed = false;
      for (const [k, at] of this.peers) if (at < cutoff) (this.peers.delete(k), (changed = true));
      if (changed) this.setStatus({ peers: this.peers.size });
    }, 5_000);
    (this.heartbeat as unknown as { unref?: () => void }).unref?.();
    if (typeof window !== "undefined") window.addEventListener("pagehide", () => this.post({ t: "bye", from: this.tabId }));
  }

  private post(m: Msg) {
    try {
      this.channel?.postMessage(m);
    } catch {
      /* channel closed */
    }
  }

  private onMessage(m: Msg) {
    if (!m || m.from === this.tabId) return;
    if (m.t === "hello") {
      const known = this.peers.has(m.from);
      this.peers.set(m.from, Date.now());
      if (!known) {
        this.setStatus({ peers: this.peers.size });
        this.post({ t: "hello", from: this.tabId }); // let the newcomer know we exist
      }
      return;
    }
    if (m.t === "bye") {
      this.peers.delete(m.from);
      this.setStatus({ peers: this.peers.size });
      return;
    }
    if (m.t === "reset") {
      void this.kv.loadAll().then((s) => {
        this.hydrate(s);
        for (const c of COLLECTIONS) this.emit({ collection: c, type: "update", id: "*", origin: "peer" });
      });
      return;
    }
    if (m.t === "change") {
      const e = m.e;
      if (e.collection === (USERS as CollectionName) || e.collection === (PINS as CollectionName)) {
        // auth tables: reload lazily
        void this.kv.loadAll().then((s) => this.hydrate(s));
        return;
      }
      const map = this.rows.get(e.collection);
      if (!map) return;
      if (e.type === "delete") map.delete(e.id);
      else if (e.row) map.set(e.id, e.row as unknown as AnyRow);
      this.peers.set(m.from, Date.now());
      this.setStatus({ lastSyncAt: nowIso(), peers: this.peers.size });
      this.emit({ ...e, origin: "peer", optimistic: false });
    }
  }

  ready() {
    return this.readyP;
  }

  close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.post({ t: "bye", from: this.tabId });
    this.channel?.close();
    this.channel = null;
  }

  async reset() {
    await this.readyP;
    await this.kv.clear();
    const stored = await this.writeSeed();
    this.hydrate(stored);
    this.post({ t: "reset", from: this.tabId });
    for (const c of COLLECTIONS) this.emit({ collection: c, type: "update", id: "*", origin: "local" });
  }

  /* ───────── change feed ───────── */

  private emit(e: ChangeEvent) {
    const rid = (e.row as AnyRow | undefined)?.restaurantId ?? (e.collection === "restaurants" ? e.id : null);
    for (const l of this.listeners) {
      if (l.cols && !l.cols.has(e.collection)) continue;
      if (l.rid && rid && rid !== l.rid) continue;
      try {
        l.cb(e);
      } catch (err) {
        console.error(err);
      }
    }
  }

  subscribe(collections: CollectionName[] | "*", restaurantId: string | null, cb: (e: ChangeEvent) => void): Unsubscribe {
    const l = { cols: collections === "*" ? null : new Set<string>(collections), rid: restaurantId, cb };
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  sync() {
    return this.status;
  }
  onSync(cb: (s: SyncStatus) => void): Unsubscribe {
    this.syncListeners.add(cb);
    return () => this.syncListeners.delete(cb);
  }
  private setStatus(p: Partial<SyncStatus>) {
    this.status = { ...this.status, ...p };
    for (const cb of this.syncListeners) cb(this.status);
  }

  /* ───────── CRUD ───────── */

  private map(c: CollectionName) {
    const m = this.rows.get(c);
    if (!m) throw new Error(`unknown collection ${c}`);
    return m;
  }

  async list<C extends CollectionName>(c: C, q?: Query<RowOf<C>>): Promise<RowOf<C>[]> {
    await this.readyP;
    return runQuery(this.map(c).values() as Iterable<RowOf<C>>, q).map(clone);
  }

  /** synchronous read for code that already awaited ready() (hooks use this for instant first paint) */
  peek<C extends CollectionName>(c: C, q?: Query<RowOf<C>>): RowOf<C>[] {
    return runQuery(this.map(c).values() as Iterable<RowOf<C>>, q).map(clone);
  }

  async get<C extends CollectionName>(c: C, id: string): Promise<RowOf<C> | null> {
    await this.readyP;
    const r = this.map(c).get(id);
    return r ? (clone(r) as unknown as RowOf<C>) : null;
  }

  private commit(c: CollectionName, type: "insert" | "update" | "delete", row: AnyRow) {
    const e: ChangeEvent = { collection: c, type, id: row.id, row: clone(row) as never, origin: "local" };
    this.emit(e);
    this.post({ t: "change", from: this.tabId, e });
    const p = type === "delete" ? this.kv.del(c, row.id) : this.kv.put(c, row.id, row);
    p.catch((err) => this.setStatus({ error: String(err) }));
    return p;
  }

  async insert<C extends CollectionName>(c: C, input: Insertable<RowOf<C>>): Promise<RowOf<C>> {
    await this.readyP;
    const now = nowIso();
    const row = { createdAt: now, updatedAt: now, ...clone(input), id: (input as { id?: string }).id ?? uuid() } as unknown as AnyRow;
    if (this.map(c).has(row.id)) throw new Error(`${c}/${row.id} exists`);
    this.map(c).set(row.id, row);
    await this.commit(c, "insert", row);
    return clone(row) as unknown as RowOf<C>;
  }

  async insertMany<C extends CollectionName>(c: C, rows: Insertable<RowOf<C>>[]): Promise<RowOf<C>[]> {
    const out: RowOf<C>[] = [];
    for (const r of rows) out.push(await this.insert(c, r));
    return out;
  }

  async update<C extends CollectionName>(c: C, id: string, patch: Patch<RowOf<C>>): Promise<RowOf<C>> {
    await this.readyP;
    const cur = this.map(c).get(id);
    if (!cur) throw new Error(`${c}/${id} not found`);
    const row = { ...cur, ...clone(patch), id, updatedAt: nowIso() } as AnyRow;
    this.map(c).set(id, row);
    await this.commit(c, "update", row);
    return clone(row) as unknown as RowOf<C>;
  }

  async remove<C extends CollectionName>(c: C, id: string): Promise<void> {
    await this.readyP;
    const cur = this.map(c).get(id);
    if (!cur) return;
    this.map(c).delete(id);
    await this.commit(c, "delete", cur);
  }

  /* ───────── auth ───────── */

  auth: AuthApi = {
    current: async () => {
      await this.readyP;
      const id = loadRaw(this.opts.sessionKey);
      const u = id ? this.users.get(id) : undefined;
      return u ? { id: u.id, email: u.email, name: u.name } : null;
    },
    signInWithPassword: async (email, password) => {
      await this.readyP;
      const e = email.trim().toLowerCase();
      const u = [...this.users.values()].find((x) => x.email.toLowerCase() === e);
      if (!u || u.passwordHash !== hashPassword(e, password)) throw new AuthError("invalid_credentials");
      saveRaw(this.opts.sessionKey, u.id);
      const au = { id: u.id, email: u.email, name: u.name };
      for (const cb of this.authListeners) cb(au);
      return au;
    },
    signOut: async () => {
      saveRaw(this.opts.sessionKey, null);
      for (const cb of this.authListeners) cb(null);
    },
    onChange: (cb) => {
      this.authListeners.add(cb);
      return () => this.authListeners.delete(cb);
    },
    myMemberships: async () => {
      const u = await this.auth.current();
      if (!u) return [];
      return this.peek("memberships", { where: { userId: u.id, active: true } }).flatMap((m) => {
        const r = this.map("restaurants").get(m.restaurantId);
        return r ? [{ membership: m, restaurant: clone(r) as unknown as RowOf<"restaurants"> }] : [];
      });
    },
    verifyPin: async (restaurantId, membershipId, pin) => {
      await this.readyP;
      const m = this.map("memberships").get(membershipId) as unknown as Membership | undefined;
      if (!m || m.restaurantId !== restaurantId || !m.active) return null;
      const h = this.pins.get(membershipId);
      if (!h || h !== hashPin(restaurantId, membershipId, pin)) return null;
      void this.update("memberships", membershipId, { lastSeenAt: nowIso() });
      return clone(m);
    },
    setPin: async (restaurantId, membershipId, pin) => {
      await this.readyP;
      if (!/^\d{4,6}$/.test(pin)) throw new Error("PIN must be 4–6 digits");
      const hash = hashPin(restaurantId, membershipId, pin);
      this.pins.set(membershipId, hash);
      await this.kv.put(PINS, membershipId, { id: membershipId, hash });
      await this.update("memberships", membershipId, { hasPin: true });
    },
    pinRoster: async (restaurantId) => {
      await this.readyP;
      return this.peek("memberships", { where: { restaurantId, active: true, hasPin: true }, orderBy: [{ field: "name" }] });
    },
  };

  /* ───────── guest (public QR / online ordering) ───────── */

  guest: GuestApi = {
    menu: async (slug, tableCode) => {
      await this.readyP;
      const r = this.peek("restaurants", { where: { slug, active: true } })[0];
      if (!r) return null;
      const rid = r.id;
      const table = tableCode ? this.peek("tables", { where: { restaurantId: rid, code: tableCode.toUpperCase(), active: true } })[0] ?? null : null;
      if (tableCode && !table) return null;
      const branch = table ? this.peek("branches", { where: { id: table.branchId } })[0] : this.peek("branches", { where: { restaurantId: rid, isDefault: true } })[0];
      const settings = this.peek("settings", { where: { restaurantId: rid } })[0];
      const menu: GuestMenu = {
        restaurant: { id: rid, slug: r.slug, name: r.name, currency: r.currency, brandColor: r.brandColor },
        branch: branch ? { id: branch.id, name: branch.name } : null,
        table: table ? { id: table.id, label: table.label, code: table.code } : null,
        categories: this.peek("menuCategories", { where: { restaurantId: rid, active: true }, orderBy: [{ field: "sort" }] }).map((c) => ({ id: c.id, name: c.name, sort: c.sort, icon: c.icon })),
        items: this.peek("menuItems", { where: { restaurantId: rid, active: true }, orderBy: [{ field: "sort" }] }).map((i) => ({
          id: i.id, categoryId: i.categoryId, name: i.name, description: i.description, price: i.price, tags: i.tags, available: i.available, modifierGroupIds: i.modifierGroupIds, imageUrl: i.imageUrl,
        })),
        modifierGroups: this.peek("modifierGroups", { where: { restaurantId: rid }, orderBy: [{ field: "sort" }] }).map((g) => ({ id: g.id, name: g.name, min: g.min, max: g.max })),
        modifiers: this.peek("modifiers", { where: { restaurantId: rid, available: true }, orderBy: [{ field: "sort" }] }).map((m) => ({ id: m.id, groupId: m.groupId, name: m.name, price: m.price, isDefault: m.isDefault })),
        qrOrdering: { enabled: settings?.qrOrdering.enabled ?? false, allowServiceCalls: settings?.qrOrdering.allowServiceCalls ?? false },
        pricing: { priceMode: settings?.tax.priceMode ?? "exclusive", serviceRate: settings?.tax.serviceRate ?? 0, vatRate: settings?.tax.vatRate ?? 0, vatRegistered: settings?.tax.vatRegistered ?? false },
      };
      return menu;
    },

    placeOrder: async (slug, input) => {
      const menu = await this.guest.menu(slug, input.tableCode ?? null);
      if (!menu) throw new Error("not_found");
      if (!menu.qrOrdering.enabled) throw new Error("ordering_disabled");
      if (!input.lines.length) throw new Error("empty_order");
      const rid = menu.restaurant.id;
      const branchId = menu.branch?.id;
      if (!branchId) throw new Error("no_branch");
      const settings = this.peek("settings", { where: { restaurantId: rid } })[0];
      const now = nowIso();
      const orderId = uuid();
      const tableIds = menu.table ? [menu.table.id] : [];
      // server-side pricing: look everything up, ignore anything the client claims about prices
      const items: OrderItem[] = input.lines.map((l) => {
        const it = this.peek("menuItems", { where: { id: l.itemId, restaurantId: rid } })[0];
        if (!it || !it.available || !it.active) throw new Error("item_unavailable");
        if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > 50) throw new Error("bad_qty");
        const mods = l.modifierIds.map((mid) => {
          const m = this.peek("modifiers", { where: { id: mid, restaurantId: rid } })[0];
          if (!m || !it.modifierGroupIds.includes(m.groupId)) throw new Error("bad_modifier");
          return { groupId: m.groupId, modifierId: m.id, name: m.name, price: m.price };
        });
        const cat = this.peek("menuCategories", { where: { id: it.categoryId } })[0];
        return {
          id: uuid(), restaurantId: rid, createdAt: now, updatedAt: now, orderId, itemId: it.id, name: it.name, qty: l.qty, unitPrice: it.price, modifiers: mods,
          notes: (l.notes ?? "").slice(0, 200), seat: null, course: 1, status: "new", stationId: it.stationId ?? cat?.stationId ?? null, originTableId: tableIds[0] ?? null,
          discount: 0, firedAt: null, readyAt: null, servedAt: null, voidReason: null, voidedBy: null, createdBy: null,
        };
      });
      let checkId: string | null = null;
      if (menu.table) {
        const open = this.peek("checks", { where: { restaurantId: rid, status: ["open", "bill_requested"] }, contains: { tableIds: menu.table.id } })[0];
        checkId = open?.id ?? null;
      }
      const number = this.nextOrderNumber(rid, branchId);
      const order: Order = {
        id: orderId, restaurantId: rid, createdAt: now, updatedAt: now, branchId, number, mode: input.mode, source: menu.table ? "qr" : "online", status: "open", tableIds, checkId,
        customerId: null, guests: 1, openedBy: null, waiterId: null, note: (input.note ?? "").slice(0, 300), delivery: null, deliveryStatus: null, driverId: null, deliveryFee: 0, openedAt: now, closedAt: null,
      };
      if (!checkId) {
        checkId = uuid();
        order.checkId = checkId;
        await this.insert("checks", {
          id: checkId, restaurantId: rid, branchId, tableIds, status: "open", guests: 1, reservationId: null, customerId: null, discount: null, discountApprovedBy: null,
          subtotal: 0, discountTotal: 0, service: 0, vat: 0, total: 0, paid: 0, receiptNo: null, etaUuid: null, openedAt: now, closedAt: null,
        });
      }
      await this.insert("orders", order);
      await this.insertMany("orderItems", items);
      if (settings) await this.recomputeCheck(checkId, settings.tax);
      if (menu.table) await this.update("tables", menu.table.id, { status: "ordered", statusSince: now });
      return { orderId, number };
    },

    callWaiter: async (slug, tableCode, type: ServiceCallType, text = "") => {
      const menu = await this.guest.menu(slug, tableCode);
      if (!menu?.table || !menu.branch) throw new Error("not_found");
      if (!menu.qrOrdering.allowServiceCalls) throw new Error("calls_disabled");
      // de-duplicate: the same request from the same table within 2 minutes is one call
      const recent = this.peek("serviceCalls", { where: { restaurantId: menu.restaurant.id, tableId: menu.table.id, type, status: ["open", "ack"] } }).find(
        (c) => Date.now() - Date.parse(c.createdAt) < 120_000,
      );
      if (recent && type !== "other") return { id: recent.id };
      const row = await this.insert("serviceCalls", {
        restaurantId: menu.restaurant.id, branchId: menu.branch.id, tableId: menu.table.id, type, text: text.slice(0, 200), status: "open", source: "qr", ackBy: null, ackAt: null, doneAt: null,
      });
      return { id: row.id };
    },

    orderStatus: async (slug, orderId) => {
      await this.readyP;
      const r = this.peek("restaurants", { where: { slug } })[0];
      const o = r ? this.peek("orders", { where: { id: orderId, restaurantId: r.id } })[0] : undefined;
      if (!o) return null;
      return {
        orderId: o.id, number: o.number, status: o.status,
        items: this.peek("orderItems", { where: { orderId: o.id } }).map((i) => ({ name: i.name, qty: i.qty, status: i.status })),
      };
    },
  };

  private nextOrderNumber(restaurantId: string, branchId: string) {
    const since = startOfDay(this.opts.now()).toISOString();
    const today = this.peek("orders", { where: { restaurantId, branchId }, gte: { openedAt: since } });
    return today.reduce((m, o) => Math.max(m, o.number), 0) + 1;
  }

  private async recomputeCheck(checkId: string, tax: RowOf<"settings">["tax"]) {
    const check = this.peek("checks", { where: { id: checkId } })[0];
    if (!check) return;
    const orders = this.peek("orders", { where: { checkId } });
    const items = this.peek("orderItems", { where: { orderId: orders.map((o) => o.id) } });
    const { totals } = priceItems(items, { mode: orders[0]?.mode ?? "dine_in", tax, discount: check.discount, deliveryFee: orders[0]?.deliveryFee });
    await this.update("checks", checkId, { subtotal: totals.subtotal, discountTotal: totals.discountTotal, service: totals.service, vat: totals.vat, total: totals.total });
  }
}

export class AuthError extends Error {
  constructor(public code: "invalid_credentials" | "no_membership" | "network") {
    super(code);
  }
}

function clone<T>(v: T): T {
  return typeof structuredClone === "function" ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);
}

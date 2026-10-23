/**
 * The data-layer contract. Two implementations:
 *   - LocalAdapter    (src/data/local)    — IndexedDB in the browser + BroadcastChannel between tabs. Runs today, no backend.
 *   - SupabaseAdapter (src/data/supabase) — Postgres + RLS + Realtime. Selected when VITE_SUPABASE_URL/ANON_KEY are set.
 *
 * Modules never import an adapter directly: use the hooks in src/data/hooks.tsx
 * (`useDb()`, `useLive()`, `useRow()`), which are already scoped to the current restaurant.
 */
import type { CollectionName, Membership, Restaurant, RowOf, ServiceCallType, OrderMode, Localized, Units } from "./types";
import type { Role } from "@/auth/roles";

export type Primitive = string | number | boolean | null;

/** A small, portable query: maps 1:1 onto PostgREST filters and onto an in-memory filter. */
export interface Query<T> {
  /** equality; an array value means IN (...) */
  where?: { [K in keyof T]?: Primitive | Primitive[] };
  /** array column contains this value (e.g. tableIds contains a table) */
  contains?: { [K in keyof T]?: Primitive };
  gte?: { [K in keyof T]?: string | number };
  lte?: { [K in keyof T]?: string | number };
  orderBy?: { field: keyof T & string; dir?: "asc" | "desc" }[];
  limit?: number;
}

/** What callers pass to insert(): id/timestamps are optional (the adapter fills them). */
export type Insertable<T> = Omit<T, "id" | "createdAt" | "updatedAt"> & { id?: string; createdAt?: string; updatedAt?: string };
export type Patch<T> = Partial<Omit<T, "id" | "restaurantId" | "createdAt">>;

export type ChangeType = "insert" | "update" | "delete";
export interface ChangeEvent<C extends CollectionName = CollectionName> {
  collection: C;
  type: ChangeType;
  id: string;
  /** the row after the change (before, for deletes) — may be absent when only the id is known */
  row?: RowOf<C>;
  /** true while a write is in flight (optimistic) — a confirming event follows */
  optimistic?: boolean;
  /** "local" = this tab, "peer" = another tab/device, "server" = realtime */
  origin: "local" | "peer" | "server";
  /** a rejected optimistic write: listeners should refetch */
  rollback?: boolean;
}
export type Unsubscribe = () => void;

export interface SyncStatus {
  mode: "local" | "cloud";
  online: boolean;
  /** writes waiting to reach the server (cloud mode offline queue) */
  pending: number;
  /** other tabs/devices currently connected (local mode: tabs on this browser) */
  peers: number;
  lastSyncAt: string | null;
  error: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthApi {
  /** current email session, if any */
  current(): Promise<AuthUser | null>;
  signInWithPassword(email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  onChange(cb: (u: AuthUser | null) => void): Unsubscribe;
  /** memberships of the signed-in user across restaurants (restaurant switcher) */
  myMemberships(): Promise<{ membership: Membership; restaurant: Restaurant }[]>;
  /** checks a staff PIN on a shared device; returns the membership when correct */
  verifyPin(restaurantId: string, membershipId: string, pin: string): Promise<Membership | null>;
  /** sets/changes a PIN (manager+ or the person themselves) */
  setPin(restaurantId: string, membershipId: string, pin: string): Promise<void>;
  /** staff that can sign in on this device with a PIN (no secrets) */
  pinRoster(restaurantId: string): Promise<Membership[]>;
}

/* ───────── Guest (public, no auth) — Supabase: SECURITY DEFINER RPCs; never direct table access ───────── */

export interface GuestMenu {
  restaurant: { id: string; slug: string; name: Localized; currency: string; brandColor: string };
  branch: { id: string; name: Localized } | null;
  table: { id: string; label: string; code: string } | null;
  categories: { id: string; name: Localized; sort: number; icon: string }[];
  items: { id: string; categoryId: string; name: Localized; description: Localized; price: Units; tags: string[]; available: boolean; modifierGroupIds: string[]; imageUrl: string | null }[];
  modifierGroups: { id: string; name: Localized; min: number; max: number }[];
  modifiers: { id: string; groupId: string; name: Localized; price: Units; isDefault: boolean }[];
  qrOrdering: { enabled: boolean; allowServiceCalls: boolean };
}
export interface GuestOrderLine {
  itemId: string;
  qty: number;
  modifierIds: string[];
  notes?: string;
}
export interface GuestOrderStatus {
  orderId: string;
  number: number;
  status: string;
  items: { name: Localized; qty: number; status: string }[];
}

export interface GuestApi {
  menu(slug: string, tableCode?: string | null): Promise<GuestMenu | null>;
  /** prices are computed server-side from the menu; the client only sends ids and quantities */
  placeOrder(slug: string, input: { tableCode?: string | null; mode: OrderMode; lines: GuestOrderLine[]; customer?: { name: string; phone: string } | null; note?: string }): Promise<{ orderId: string; number: number }>;
  callWaiter(slug: string, tableCode: string, type: ServiceCallType, text?: string): Promise<{ id: string }>;
  orderStatus(slug: string, orderId: string): Promise<GuestOrderStatus | null>;
}

/* ───────── The repository ───────── */

export interface Repo {
  readonly kind: "local" | "supabase";
  /** resolves once the adapter can answer queries (IndexedDB loaded / session restored) */
  ready(): Promise<void>;

  list<C extends CollectionName>(c: C, q?: Query<RowOf<C>>): Promise<RowOf<C>[]>;
  get<C extends CollectionName>(c: C, id: string): Promise<RowOf<C> | null>;
  insert<C extends CollectionName>(c: C, row: Insertable<RowOf<C>>): Promise<RowOf<C>>;
  insertMany<C extends CollectionName>(c: C, rows: Insertable<RowOf<C>>[]): Promise<RowOf<C>[]>;
  update<C extends CollectionName>(c: C, id: string, patch: Patch<RowOf<C>>): Promise<RowOf<C>>;
  remove<C extends CollectionName>(c: C, id: string): Promise<void>;

  /** change feed for the given collections, limited to one restaurant ("*" = every collection) */
  subscribe(collections: CollectionName[] | "*", restaurantId: string | null, cb: (e: ChangeEvent) => void): Unsubscribe;

  sync(): SyncStatus;
  onSync(cb: (s: SyncStatus) => void): Unsubscribe;

  auth: AuthApi;
  guest: GuestApi;

  /** demo only (local): wipe and re-seed */
  reset?(): Promise<void>;
  close?(): void;
}

/** Role helpers some adapters need. */
export type { Role };

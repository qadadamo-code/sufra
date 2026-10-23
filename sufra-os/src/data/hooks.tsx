/**
 * React bindings for the data layer.
 *
 *   const db = useDb();                                     // scoped to the current restaurant
 *   const { data: calls } = useLive("serviceCalls", { where: { status: "open" }, orderBy: [{ field: "createdAt" }] });
 *   const { data: table } = useRow("tables", id);
 *   await db.update("serviceCalls", id, { status: "ack" });  // every useLive watching it updates (this tab + other tabs/devices)
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ChangeEvent, Insertable, Patch, Query, Repo, SyncStatus } from "./repo";
import type { CollectionName, RowOf } from "./types";
import { applyChange } from "./query";
import { nowIso } from "@/lib/time";

const RepoCtx = createContext<Repo | null>(null);
const ScopeCtx = createContext<{ restaurantId: string | null; branchId: string | null; actorId: string | null }>({ restaurantId: null, branchId: null, actorId: null });

export function DataProvider({ repo, children }: { repo: Repo; children: ReactNode }) {
  return <RepoCtx.Provider value={repo}>{children}</RepoCtx.Provider>;
}

/** Set by the session provider: which restaurant/branch/staff member the UI is acting as. */
export function ScopeProvider({ restaurantId, branchId, actorId, children }: { restaurantId: string | null; branchId: string | null; actorId: string | null; children: ReactNode }) {
  const v = useMemo(() => ({ restaurantId, branchId, actorId }), [restaurantId, branchId, actorId]);
  return <ScopeCtx.Provider value={v}>{children}</ScopeCtx.Provider>;
}

export function useRepo(): Repo {
  const r = useContext(RepoCtx);
  if (!r) throw new Error("useRepo outside DataProvider");
  return r;
}
export const useScope = () => useContext(ScopeCtx);

/** Tenant-scoped data access: restaurantId is injected into every query and insert. */
export interface Db {
  repo: Repo;
  restaurantId: string;
  branchId: string | null;
  actorId: string | null;
  list<C extends CollectionName>(c: C, q?: Query<RowOf<C>>): Promise<RowOf<C>[]>;
  get<C extends CollectionName>(c: C, id: string): Promise<RowOf<C> | null>;
  insert<C extends CollectionName>(c: C, row: Omit<Insertable<RowOf<C>>, "restaurantId">): Promise<RowOf<C>>;
  update<C extends CollectionName>(c: C, id: string, patch: Patch<RowOf<C>>): Promise<RowOf<C>>;
  remove<C extends CollectionName>(c: C, id: string): Promise<void>;
  /** append to audit_log as the acting staff member */
  audit(action: string, entity: CollectionName | string, entityId: string | null, data?: Record<string, unknown>, approvedBy?: string | null): Promise<void>;
}

export function scopeQuery<C extends CollectionName>(c: C, restaurantId: string, q?: Query<RowOf<C>>): Query<RowOf<C>> {
  const key = c === "restaurants" ? "id" : "restaurantId";
  return { ...q, where: { ...(q?.where ?? {}), [key]: restaurantId } as Query<RowOf<C>>["where"] };
}

export function makeDb(repo: Repo, restaurantId: string, branchId: string | null, actorId: string | null): Db {
  return {
    repo,
    restaurantId,
    branchId,
    actorId,
    list: (c, q) => repo.list(c, scopeQuery(c, restaurantId, q)),
    get: async (c, id) => {
      const r = await repo.get(c, id);
      const rid = c === "restaurants" ? (r as { id?: string } | null)?.id : (r as { restaurantId?: string } | null)?.restaurantId;
      return r && rid === restaurantId ? r : null;
    },
    insert: (c, row) => repo.insert(c, { ...(row as object), restaurantId } as unknown as Insertable<RowOf<typeof c>>),
    update: (c, id, patch) => repo.update(c, id, patch),
    remove: (c, id) => repo.remove(c, id),
    audit: async (action, entity, entityId, data = {}, approvedBy = null) => {
      await repo.insert("auditLog", { restaurantId, branchId, actorId, action, entity, entityId, data, approvedBy, createdAt: nowIso() } as Insertable<RowOf<"auditLog">>);
    },
  };
}

export function useDb(): Db {
  const repo = useRepo();
  const { restaurantId, branchId, actorId } = useScope();
  if (!restaurantId) throw new Error("useDb needs a restaurant in scope (inside the app shell)");
  return useMemo(() => makeDb(repo, restaurantId, branchId, actorId), [repo, restaurantId, branchId, actorId]);
}

export interface Live<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

type Peekable = { peek?: <C extends CollectionName>(c: C, q?: Query<RowOf<C>>) => RowOf<C>[] };

/**
 * Live query. Re-renders on any change to the collection — from this tab (optimistic), other tabs
 * (LocalAdapter BroadcastChannel) or other devices (Supabase Realtime).
 * Scoped to the current restaurant unless `opts.unscoped`.
 */
export function useLive<C extends CollectionName>(c: C, q?: Query<RowOf<C>>, opts: { enabled?: boolean; unscoped?: boolean; also?: CollectionName[] } = {}): Live<RowOf<C>> {
  const repo = useRepo();
  const { restaurantId } = useScope();
  const enabled = opts.enabled !== false && (opts.unscoped || !!restaurantId);
  const key = JSON.stringify([c, q, restaurantId, opts.unscoped, opts.also]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const query = useMemo(() => (opts.unscoped || !restaurantId ? q : scopeQuery(c, restaurantId, q)), [key]);
  const peek = (repo as Peekable).peek;
  const [state, setState] = useState<{ data: RowOf<C>[]; loading: boolean; error: Error | null; key: string }>(() => {
    if (enabled && peek) {
      try {
        return { data: (peek as (c: CollectionName, q?: unknown) => RowOf<C>[]).call(repo, c, query), loading: false, error: null, key };
      } catch {
        /* not ready yet */
      }
    }
    return { data: [], loading: enabled, error: null, key };
  });
  const seq = useRef(0);

  const fetchNow = useCallback(() => {
    if (!enabled) return;
    const my = ++seq.current;
    repo.list(c, query).then(
      (rows) => my === seq.current && setState({ data: rows, loading: false, error: null, key }),
      (err: Error) => my === seq.current && setState((s) => ({ ...s, loading: false, error: err })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, key, enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (state.key !== key) setState((s) => ({ ...s, key, loading: true }));
    fetchNow();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refetchSoon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fetchNow, 120);
    };
    const cols = [c, ...(opts.also ?? [])];
    const off = repo.subscribe(cols, opts.unscoped ? null : restaurantId, (e: ChangeEvent) => {
      if (e.collection === c && e.row && e.id !== "*" && !e.rollback) {
        // instant (optimistic) patch, then a consistent refetch
        setState((s) => ({ ...s, data: applyChange(s.data as never[], e.type, e.id, e.row as never, query as never) as RowOf<C>[] }));
      }
      refetchSoon();
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, key, enabled]);

  return { data: state.data, loading: state.loading, error: state.error, refresh: fetchNow };
}

/** One row by id, live. */
export function useRow<C extends CollectionName>(c: C, id: string | null | undefined) {
  const live = useLive(c, { where: { id: id ?? "" } } as Query<RowOf<C>>, { enabled: !!id });
  return { data: (live.data[0] ?? null) as RowOf<C> | null, loading: live.loading, error: live.error };
}

/** Sync/online status for the indicator. */
export function useSync(): SyncStatus {
  const repo = useRepo();
  return useSyncExternalStore(
    (cb) => repo.onSync(cb),
    () => repo.sync(),
    () => repo.sync(),
  );
}

/** Wrap an async mutation with pending/error state (optimistic updates already flow through useLive). */
export function useMutation<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const run = useCallback(
    async (...a: A) => {
      setPending(true);
      setError(null);
      try {
        return await fn(...a);
      } catch (e) {
        setError(e as Error);
        throw e;
      } finally {
        setPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn],
  );
  return { run, pending, error };
}

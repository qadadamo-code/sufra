/**
 * Persistence for the LocalAdapter: one IndexedDB object store of { k: "collection/id", c, row }.
 * Falls back to memory when IndexedDB is unavailable (private mode, old WebViews) — the app still works,
 * data just does not survive a reload.
 */
export interface StoredRow {
  k: string;
  c: string;
  row: unknown;
}

export interface KV {
  readonly persistent: boolean;
  loadAll(): Promise<StoredRow[]>;
  put(c: string, id: string, row: unknown): Promise<void>;
  putMany(rows: { c: string; id: string; row: unknown }[]): Promise<void>;
  del(c: string, id: string): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryKV implements KV {
  readonly persistent = false;
  private m = new Map<string, StoredRow>();
  async loadAll() {
    return [...this.m.values()];
  }
  async put(c: string, id: string, row: unknown) {
    this.m.set(`${c}/${id}`, { k: `${c}/${id}`, c, row });
  }
  async putMany(rows: { c: string; id: string; row: unknown }[]) {
    for (const r of rows) await this.put(r.c, r.id, r.row);
  }
  async del(c: string, id: string) {
    this.m.delete(`${c}/${id}`);
  }
  async clear() {
    this.m.clear();
  }
}

const STORE = "rows";

export class IdbKV implements KV {
  readonly persistent = true;
  private db: Promise<IDBDatabase>;
  constructor(name: string) {
    this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "k" }).createIndex("c", "c");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("indexedDB blocked"));
    });
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r ? (r.result as T) : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  async loadAll() {
    return ((await this.tx<StoredRow[]>("readonly", (s) => s.getAll())) ?? []) as StoredRow[];
  }
  async put(c: string, id: string, row: unknown) {
    await this.tx("readwrite", (s) => void s.put({ k: `${c}/${id}`, c, row }));
  }
  async putMany(rows: { c: string; id: string; row: unknown }[]) {
    await this.tx("readwrite", (s) => {
      for (const r of rows) s.put({ k: `${r.c}/${r.id}`, c: r.c, row: r.row });
    });
  }
  async del(c: string, id: string) {
    await this.tx("readwrite", (s) => void s.delete(`${c}/${id}`));
  }
  async clear() {
    await this.tx("readwrite", (s) => void s.clear());
  }
  async close() {
    (await this.db).close();
  }
}

export function openKV(name: string): KV {
  try {
    if (typeof indexedDB !== "undefined") return new IdbKV(name);
  } catch {
    /* fall through */
  }
  return new MemoryKV();
}

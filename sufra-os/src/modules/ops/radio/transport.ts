/**
 * Walkie-talkie transport. Clip METADATA always travels as `radioClips` rows through the Repo (LocalAdapter
 * BroadcastChannel between tabs / Supabase Realtime between devices); this layer moves the AUDIO and the
 * "who's on air" presence.
 *
 *   LocalRadioTransport    IndexedDB blobs (same origin → every tab reads them) + BroadcastChannel presence. Demo / one device.
 *   SupabaseRadioTransport Supabase Storage bucket `radio` (radio/<restaurant>/<clip>.<ext>, RLS by membership — 0013_ops.sql)
 *                          + a Realtime broadcast channel `radio:<restaurant>` for presence.
 *   RealtimeVoiceAdapter   live low-latency audio (LiveKit / Agora / Zello Work) — INTERFACE ONLY, see DESIGN.md §Radio.
 *                          env: VITE_PTT_PROVIDER=livekit|agora|zello, VITE_LIVEKIT_URL, VITE_AGORA_APP_ID, VITE_ZELLO_NETWORK;
 *                          server tokens from api/radio-token.ts (LIVEKIT_API_KEY/SECRET, AGORA_APP_CERTIFICATE, ZELLO_*).
 */
import type { Repo, Unsubscribe } from "@/data/repo";
import type { RadioChannelId, RadioClip } from "../types";
import { extFor } from "./ptt";

export interface OnAir {
  who: string;
  name: string;
  channel: RadioChannelId;
  at: number;
}

export interface RadioTransport {
  readonly kind: "local" | "cloud";
  putAudio(clip: Pick<RadioClip, "id" | "restaurantId" | "mime">, blob: Blob): Promise<string>;
  getAudio(clip: Pick<RadioClip, "id" | "storagePath" | "mime">): Promise<Blob | null>;
  announce(a: OnAir | { who: string; off: true }): void;
  onPresence(cb: (a: OnAir | { who: string; off: true }) => void): Unsubscribe;
  /** drop audio older than this (local only; cloud uses a Storage lifecycle) */
  prune?(olderThanMs: number): Promise<void>;
  close(): void;
}

/* ───────── local: IndexedDB + BroadcastChannel ───────── */

const DB_NAME = "sufra-os-radio";
const STORE = "clips";

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    if (typeof indexedDB === "undefined") return rej(new Error("no_idb"));
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

/** Blob → ArrayBuffer (IndexedDB in some engines/tests can't store Blob). */
async function toBuf(b: Blob): Promise<ArrayBuffer> {
  if (typeof b.arrayBuffer === "function") return b.arrayBuffer();
  return new Response(b).arrayBuffer();
}

export class LocalRadioTransport implements RadioTransport {
  readonly kind = "local" as const;
  private db: Promise<IDBDatabase> | null = null;
  private mem = new Map<string, { buf: ArrayBuffer; mime: string; at: number }>();
  private bc: BroadcastChannel | null = null;
  private listeners = new Set<(a: OnAir | { who: string; off: true }) => void>();

  constructor(name = "sufra-os") {
    if (typeof BroadcastChannel !== "undefined") {
      this.bc = new BroadcastChannel(`${name}:radio`);
      this.bc.onmessage = (e) => this.listeners.forEach((l) => l(e.data));
    }
  }

  private idb() {
    if (!this.db) this.db = openDb().catch((e) => ((this.db = null), Promise.reject(e)));
    return this.db;
  }

  async putAudio(clip: Pick<RadioClip, "id" | "mime">, blob: Blob): Promise<string> {
    const buf = await toBuf(blob);
    const rec = { buf, mime: clip.mime || blob.type, at: Date.now() };
    try {
      const db = await this.idb();
      await new Promise<void>((res, rej) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(rec, clip.id);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    } catch {
      this.mem.set(clip.id, rec); // private mode: this tab only
    }
    return clip.id;
  }

  async getAudio(clip: Pick<RadioClip, "id" | "storagePath" | "mime">): Promise<Blob | null> {
    const key = clip.storagePath || clip.id;
    const m = this.mem.get(key);
    if (m) return new Blob([m.buf], { type: m.mime });
    try {
      const db = await this.idb();
      const rec = await new Promise<{ buf: ArrayBuffer; mime: string } | undefined>((res, rej) => {
        const r = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        r.onsuccess = () => res(r.result as { buf: ArrayBuffer; mime: string } | undefined);
        r.onerror = () => rej(r.error);
      });
      return rec ? new Blob([rec.buf], { type: rec.mime || clip.mime }) : null;
    } catch {
      return null;
    }
  }

  announce(a: OnAir | { who: string; off: true }) {
    try {
      this.bc?.postMessage(a);
    } catch {
      /* closed */
    }
  }

  onPresence(cb: (a: OnAir | { who: string; off: true }) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async prune(olderThanMs: number) {
    const cutoff = Date.now() - olderThanMs;
    try {
      const db = await this.idb();
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      const req = st.openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        if (((c.value as { at?: number }).at ?? 0) < cutoff) c.delete();
        c.continue();
      };
    } catch {
      /* nothing stored */
    }
  }

  close() {
    this.bc?.close();
    this.listeners.clear();
  }
}

/* ───────── cloud: Supabase Storage + Realtime broadcast ───────── */

type StorageApi = {
  from(bucket: string): {
    upload(path: string, body: Blob, opts: { contentType: string; upsert: boolean }): Promise<{ error: { message: string } | null }>;
    download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
  };
};
type RealtimeChannel = { on(type: "broadcast", filter: { event: string }, cb: (p: { payload: unknown }) => void): RealtimeChannel; subscribe(): unknown; send(m: { type: "broadcast"; event: string; payload: unknown }): unknown };
type SbClient = { storage: StorageApi; channel(name: string): RealtimeChannel; removeChannel(c: RealtimeChannel): unknown };

export class SupabaseRadioTransport implements RadioTransport {
  readonly kind = "cloud" as const;
  private ch: RealtimeChannel;
  private listeners = new Set<(a: OnAir | { who: string; off: true }) => void>();
  constructor(
    private client: SbClient,
    restaurantId: string,
  ) {
    this.ch = client.channel(`radio:${restaurantId}`).on("broadcast", { event: "air" }, (p) => this.listeners.forEach((l) => l(p.payload as OnAir)));
    this.ch.subscribe();
  }
  async putAudio(clip: Pick<RadioClip, "id" | "restaurantId" | "mime">, blob: Blob): Promise<string> {
    const path = `${clip.restaurantId}/${clip.id}.${extFor(clip.mime)}`;
    const { error } = await this.client.storage.from("radio").upload(path, blob, { contentType: clip.mime, upsert: false });
    if (error) throw new Error(error.message);
    return path;
  }
  async getAudio(clip: Pick<RadioClip, "storagePath">): Promise<Blob | null> {
    const { data } = await this.client.storage.from("radio").download(clip.storagePath);
    return data;
  }
  announce(a: OnAir | { who: string; off: true }) {
    void this.ch.send({ type: "broadcast", event: "air", payload: a });
  }
  onPresence(cb: (a: OnAir | { who: string; off: true }) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  close() {
    this.client.removeChannel(this.ch);
    this.listeners.clear();
  }
}

export function transportFor(repo: Repo, restaurantId: string): RadioTransport {
  const client = (repo as unknown as { client?: SbClient }).client;
  if (repo.kind === "supabase" && client?.storage) return new SupabaseRadioTransport(client, restaurantId);
  return new LocalRadioTransport();
}

/* ───────── live low-latency voice (interface only) ───────── */

/**
 * A real-time PTT room (WebRTC SFU or vendor network). Not implemented: clips (store-and-forward) are what ships.
 * An implementation joins one room per channel, publishes the mic track only while the PTT button is held
 * (`setTalking(true)`), and surfaces remote speakers via `onSpeaking`. Tokens come from api/radio-token.ts.
 */
export interface RealtimeVoiceAdapter {
  readonly provider: "livekit" | "agora" | "zello";
  connect(x: { restaurantId: string; memberId: string; name: string; channels: RadioChannelId[]; token: string }): Promise<void>;
  setTalking(channel: RadioChannelId, on: boolean): Promise<void>;
  onSpeaking(cb: (who: { memberId: string; channel: RadioChannelId; on: boolean }) => void): Unsubscribe;
  disconnect(): Promise<void>;
}

export function realtimeVoiceConfig(env: Record<string, string | undefined>): { provider: RealtimeVoiceAdapter["provider"] | null; ready: boolean; missing: string[] } {
  const p = (env.VITE_PTT_PROVIDER ?? "").toLowerCase();
  if (p === "livekit") return { provider: "livekit", ready: !!env.VITE_LIVEKIT_URL, missing: env.VITE_LIVEKIT_URL ? [] : ["VITE_LIVEKIT_URL"] };
  if (p === "agora") return { provider: "agora", ready: !!env.VITE_AGORA_APP_ID, missing: env.VITE_AGORA_APP_ID ? [] : ["VITE_AGORA_APP_ID"] };
  if (p === "zello") return { provider: "zello", ready: !!env.VITE_ZELLO_NETWORK, missing: env.VITE_ZELLO_NETWORK ? [] : ["VITE_ZELLO_NETWORK"] };
  return { provider: null, ready: false, missing: [] };
}

/**
 * The walkie-talkie runtime: one per tab (module singleton), attached by the shell (ops/shell.tsx) to the signed-in
 * member. Owns the PTT state machine + recorder, publishes clips, auto-plays incoming ones on monitored channels,
 * tracks "who's on air" and unread counts. React reads it with `useRadioEngine()` (useSyncExternalStore).
 */
import { useSyncExternalStore } from "react";
import type { Db } from "@/data/hooks";
import type { ChangeEvent } from "@/data/repo";
import type { Role } from "@/auth/roles";
import { loadJSON, saveJSON } from "@/lib/storage";
import { nowIso } from "@/lib/time";
import type { RadioChannelId, RadioClip } from "../types";
import { DEFAULT_PTT, PTT_IDLE, pttReduce, type PttConfig, type PttEvent, type PttState } from "./ptt";
import { ClipRecorder, MicError } from "./recorder";
import { defaultMonitored, isForMe } from "./channels";
import { transportFor, type OnAir, type RadioTransport } from "./transport";

export interface RadioSnapshot {
  attached: boolean;
  me: string | null;
  role: Role | null;
  ptt: PttState;
  talkingOn: RadioChannelId | null;
  onAir: OnAir[];
  monitored: string[];
  lastRead: Record<string, string>;
  playing: string | null;
  /** autoplay blocked: waiting for a tap */
  blocked: number;
  unlocked: boolean;
  level: number;
  config: PttConfig & { autoplay: boolean };
  /** last error/notice for the UI */
  notice: { kind: "too_short" | "mic_denied" | "unsupported" | "upload_failed" | "sent" | "auto_cut"; at: number } | null;
}

type Listener = () => void;
type IncomingHook = (clip: RadioClip, played: boolean) => void;

const monKey = (me: string) => `sufra-os.radio.monitor.${me}`;
const readKey = (me: string) => `sufra-os.radio.read.${me}`;

export class RadioEngine {
  private snap: RadioSnapshot = {
    attached: false, me: null, role: null, ptt: PTT_IDLE, talkingOn: null, onAir: [], monitored: [], lastRead: {}, playing: null, blocked: 0, unlocked: false, level: 0,
    config: { ...DEFAULT_PTT, autoplay: true }, notice: null,
  };
  private listeners = new Set<Listener>();
  private db: Db | null = null;
  private name = "";
  private transport: RadioTransport | null = null;
  private offs: (() => void)[] = [];
  private rec: ClipRecorder | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private releaseEarly = false;
  private queue: RadioClip[] = [];
  private audio: HTMLAudioElement | null = null;
  private pendingBlocked: RadioClip[] = [];
  private incoming = new Set<IncomingHook>();
  private seen = new Set<string>();

  get = () => this.snap;
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  private set(p: Partial<RadioSnapshot>) {
    this.snap = { ...this.snap, ...p };
    this.listeners.forEach((l) => l());
  }

  onIncoming(h: IncomingHook) {
    this.incoming.add(h);
    return () => {
      this.incoming.delete(h);
    };
  }

  attach(x: { db: Db; me: string; name: string; role: Role | null; config?: Partial<PttConfig & { autoplay: boolean }> }) {
    if (this.snap.attached && this.snap.me === x.me && this.db?.restaurantId === x.db.restaurantId) {
      this.db = x.db;
      if (x.config) this.set({ config: { ...this.snap.config, ...x.config } });
      return;
    }
    this.detach();
    this.db = x.db;
    this.name = x.name;
    this.transport = transportFor(x.db.repo, x.db.restaurantId);
    const monitored = loadJSON<string[] | null>(monKey(x.me), null) ?? defaultMonitored(x.role);
    this.set({ attached: true, me: x.me, role: x.role, monitored, lastRead: loadJSON(readKey(x.me), {}), config: { ...this.snap.config, ...(x.config ?? {}) } });
    this.offs.push(
      x.db.repo.subscribe(["radioClips"], x.db.restaurantId, (e: ChangeEvent) => {
        if (e.type !== "insert" || !e.row || e.optimistic || e.origin === "local") return;
        this.onClip(e.row as RadioClip);
      }),
      this.transport.onPresence((a) => this.onPresence(a)),
    );
    const unlock = () => this.unlock();
    if (typeof window !== "undefined") {
      window.addEventListener("pointerdown", unlock, { once: true, capture: true });
      window.addEventListener("keydown", unlock, { once: true, capture: true });
      this.offs.push(() => {
        window.removeEventListener("pointerdown", unlock, { capture: true });
        window.removeEventListener("keydown", unlock, { capture: true });
      });
    }
    void this.transport.prune?.(24 * 3600_000);
  }

  detach() {
    this.offs.forEach((f) => f());
    this.offs = [];
    this.rec?.cancel();
    this.transport?.close();
    this.transport = null;
    this.db = null;
    this.queue = [];
    this.set({ attached: false, me: null, ptt: PTT_IDLE, onAir: [], playing: null });
  }

  /* ───────── presence ───────── */

  private onPresence(a: OnAir | { who: string; off: true }) {
    const rest = this.snap.onAir.filter((x) => x.who !== a.who && Date.now() - x.at < 35_000);
    this.set({ onAir: "off" in a ? rest : [...rest, a] });
  }

  /* ───────── settings ───────── */

  setMonitored(ids: string[]) {
    if (this.snap.me) saveJSON(monKey(this.snap.me), ids);
    this.set({ monitored: ids });
  }
  markRead(channel: string) {
    const lastRead = { ...this.snap.lastRead, [channel]: nowIso() };
    if (this.snap.me) saveJSON(readKey(this.snap.me), lastRead);
    this.set({ lastRead });
  }

  /* ───────── talk ───────── */

  private dispatch(e: PttEvent) {
    this.set({ ptt: pttReduce(this.snap.ptt, e, this.snap.config) });
  }

  async press(channel: RadioChannelId) {
    if (!this.db || !this.snap.me) return;
    if (this.snap.ptt.phase !== "idle" && this.snap.ptt.phase !== "discarded" && this.snap.ptt.phase !== "error") return;
    this.unlock();
    this.stopPlayback();
    this.releaseEarly = false;
    this.dispatch({ type: "press", t: Date.now() });
    this.set({ talkingOn: channel });
    try {
      navigator.vibrate?.(25);
    } catch {
      /* no vibration */
    }
    this.rec = new ClipRecorder();
    try {
      await this.rec.start();
    } catch (err) {
      const code = err instanceof MicError ? err.code : "unknown";
      this.dispatch({ type: "fail", error: code === "mic_denied" ? "mic_denied" : code === "unsupported" ? "unsupported" : "unknown" });
      this.set({ notice: { kind: code === "mic_denied" ? "mic_denied" : "unsupported", at: Date.now() }, talkingOn: null });
      this.rec = null;
      return;
    }
    if (this.releaseEarly || (this.snap.ptt.phase as string) !== "arming") {
      this.rec.cancel();
      this.rec = null;
      this.set({ notice: { kind: "too_short", at: Date.now() }, talkingOn: null });
      return;
    }
    this.dispatch({ type: "ready", t: Date.now() });
    this.transport?.announce({ who: this.snap.me, name: this.name, channel, at: Date.now() });
    this.ticker = setInterval(() => {
      this.dispatch({ type: "tick", t: Date.now() });
      this.set({ level: this.rec?.level() ?? 0 });
      if (this.snap.ptt.phase === "sending") void this.finish(true);
    }, 100);
  }

  release() {
    const p = this.snap.ptt.phase;
    if (p === "arming") {
      this.releaseEarly = true;
      this.dispatch({ type: "release", t: Date.now() });
      return;
    }
    if (p !== "recording") return;
    this.dispatch({ type: "release", t: Date.now() });
    void this.finish(false);
  }

  cancel() {
    this.dispatch({ type: "cancel" });
    this.clearTicker();
    this.rec?.cancel();
    this.rec = null;
    this.offAir();
    this.set({ talkingOn: null });
  }

  private clearTicker() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }
  private offAir() {
    if (this.snap.me) this.transport?.announce({ who: this.snap.me, off: true });
  }

  private async finish(autoCut: boolean) {
    this.clearTicker();
    const rec = this.rec;
    this.rec = null;
    this.offAir();
    const st = this.snap.ptt;
    const channel = this.snap.talkingOn;
    this.set({ level: 0 });
    if (st.phase === "discarded") {
      rec?.cancel();
      this.set({ notice: { kind: "too_short", at: Date.now() }, talkingOn: null });
      return;
    }
    if (st.phase !== "sending" || !rec || !channel || !this.db || !this.snap.me) return;
    try {
      const blob = await rec.stop();
      await this.publish(channel, blob, rec.mime, st.durationMs);
      this.dispatch({ type: "sent" });
      this.set({ notice: { kind: autoCut ? "auto_cut" : "sent", at: Date.now() }, talkingOn: null });
    } catch {
      this.dispatch({ type: "fail", error: "upload_failed" });
      this.set({ notice: { kind: "upload_failed", at: Date.now() }, talkingOn: null });
    }
  }

  /** Stores the audio, then the row (so receivers always find the blob). Exposed for tests / uploads. */
  async publish(channel: RadioChannelId, blob: Blob, mime: string, durationMs: number): Promise<RadioClip> {
    if (!this.db || !this.transport || !this.snap.me) throw new Error("not_attached");
    const id = crypto.randomUUID();
    const storagePath = await this.transport.putAudio({ id, restaurantId: this.db.restaurantId, mime }, blob);
    const row = await this.db.insert("radioClips", {
      id, branchId: this.db.branchId, channel, fromId: this.snap.me, fromName: this.name, mime, durationMs: Math.round(durationMs), bytes: blob.size, storagePath, text: null, at: nowIso(),
    });
    this.markRead(channel);
    return row;
  }

  async sendText(channel: RadioChannelId, text: string) {
    if (!this.db || !this.snap.me) return;
    await this.db.insert("radioClips", { branchId: this.db.branchId, channel, fromId: this.snap.me, fromName: this.name, mime: "", durationMs: 0, bytes: 0, storagePath: "", text: text.trim().slice(0, 280), at: nowIso() });
    this.markRead(channel);
  }

  /* ───────── listen ───────── */

  private onClip(clip: RadioClip) {
    const me = this.snap.me;
    if (!me || this.seen.has(clip.id)) return;
    this.seen.add(clip.id);
    if (Date.now() - Date.parse(clip.at) > 120_000) return; // a late sync of old clips: don't blast them
    const forMe = isForMe(clip, me, this.snap.role, this.snap.monitored);
    if (!forMe) return;
    const auto = this.snap.config.autoplay;
    if (auto) this.enqueue(clip);
    this.incoming.forEach((h) => h(clip, auto));
  }

  enqueue(clip: RadioClip) {
    this.queue.push(clip);
    if (!this.snap.playing) void this.next();
  }

  /** Plays one clip now (history "play" button) — a user gesture, so it also unlocks audio. */
  playNow(clip: RadioClip) {
    this.unlock();
    this.stopPlayback();
    this.queue.unshift(clip);
    void this.next();
  }

  stopPlayback() {
    this.queue = [];
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    this.set({ playing: null });
  }

  private async next() {
    const clip = this.queue.shift();
    if (!clip) return this.set({ playing: null });
    if (this.snap.ptt.phase === "recording" || this.snap.ptt.phase === "arming") {
      this.queue.unshift(clip);
      return;
    }
    this.set({ playing: clip.id });
    try {
      if (clip.text) await this.speak(clip);
      else await this.playAudio(clip);
      this.markRead(clip.channel);
    } catch (e) {
      if ((e as DOMException)?.name === "NotAllowedError") {
        this.pendingBlocked.push(clip);
        this.set({ blocked: this.pendingBlocked.length });
        try {
          navigator.vibrate?.([80, 60, 80]);
        } catch {
          /* no vibration */
        }
      }
    }
    this.set({ playing: null });
    if (this.queue.length) void this.next();
  }

  private async playAudio(clip: RadioClip) {
    const blob = await this.transport?.getAudio(clip);
    if (!blob || !blob.size) return;
    const url = URL.createObjectURL(blob);
    try {
      await new Promise<void>((res, rej) => {
        const a = new Audio(url);
        this.audio = a;
        a.onended = () => res();
        a.onerror = () => res();
        a.play().catch(rej);
      });
    } finally {
      URL.revokeObjectURL(url);
      this.audio = null;
    }
  }

  private speak(clip: RadioClip) {
    return new Promise<void>((res) => {
      if (typeof speechSynthesis === "undefined" || !clip.text) return res();
      const u = new SpeechSynthesisUtterance(clip.text);
      u.lang = /[؀-ۿ]/.test(clip.text) ? "ar-EG" : "en-US";
      u.onend = () => res();
      u.onerror = () => res();
      speechSynthesis.speak(u);
      setTimeout(res, 8000);
    });
  }

  /** First user gesture: resume an AudioContext and play silence so later auto-plays are allowed. */
  unlock() {
    if (this.snap.unlocked || typeof window === "undefined") return;
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        const ctx = new AC();
        const b = ctx.createBuffer(1, 1, 22050);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.start(0);
        void ctx.resume().finally(() => setTimeout(() => void ctx.close().catch(() => undefined), 200));
      }
    } catch {
      /* ignore */
    }
    this.set({ unlocked: true });
    if (this.pendingBlocked.length) this.playBlocked();
  }

  playBlocked() {
    const list = this.pendingBlocked;
    this.pendingBlocked = [];
    this.set({ blocked: 0 });
    list.forEach((c) => this.enqueue(c));
  }

  getAudio(clip: RadioClip) {
    return this.transport?.getAudio(clip) ?? Promise.resolve(null);
  }
}

export const radio = new RadioEngine();

export function useRadioEngine(): RadioSnapshot {
  return useSyncExternalStore(radio.subscribe, radio.get, radio.get);
}

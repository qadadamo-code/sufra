/**
 * Push-to-talk state machine (pure). The recorder (recorder.ts) and the button (PttButton.tsx) drive it; tests cover it.
 *
 *   idle ──press──▶ arming ──ready──▶ recording ──release (≥ min)──▶ sending ──sent──▶ idle
 *                     │                  │  └──release (< min)──▶ discarded(too_short)
 *                     │                  └──tick ≥ max──▶ sending (auto-cut, like a real radio's TOT)
 *                     └──release before the mic is ready──▶ discarded(too_short)
 *   any ──cancel──▶ discarded(cancelled) · arming/recording ──fail──▶ error · discarded/error ──reset──▶ idle
 */
export interface PttConfig {
  /** clips shorter than this are discarded (accidental taps) */
  minMs: number;
  /** hard cut (time-out timer) */
  maxMs: number;
}
export const DEFAULT_PTT: PttConfig = { minMs: 400, maxMs: 30_000 };

export type PttState =
  | { phase: "idle" }
  | { phase: "arming"; pressedAt: number }
  | { phase: "recording"; pressedAt: number; startedAt: number; elapsedMs: number }
  | { phase: "sending"; durationMs: number; autoCut: boolean }
  | { phase: "discarded"; reason: "too_short" | "cancelled"; durationMs: number }
  | { phase: "error"; error: "mic_denied" | "unsupported" | "upload_failed" | "unknown" };

export type PttEvent =
  | { type: "press"; t: number }
  | { type: "ready"; t: number }
  | { type: "release"; t: number }
  | { type: "tick"; t: number }
  | { type: "cancel" }
  | { type: "sent" }
  | { type: "fail"; error: Extract<PttState, { phase: "error" }>["error"] }
  | { type: "reset" };

export const PTT_IDLE: PttState = { phase: "idle" };

export function pttReduce(s: PttState, e: PttEvent, cfg: PttConfig = DEFAULT_PTT): PttState {
  switch (e.type) {
    case "press":
      return s.phase === "idle" || s.phase === "discarded" || s.phase === "error" ? { phase: "arming", pressedAt: e.t } : s;
    case "ready":
      return s.phase === "arming" ? { phase: "recording", pressedAt: s.pressedAt, startedAt: e.t, elapsedMs: 0 } : s;
    case "release":
      if (s.phase === "arming") return { phase: "discarded", reason: "too_short", durationMs: 0 };
      if (s.phase === "recording") {
        const d = Math.min(cfg.maxMs, Math.max(0, e.t - s.startedAt));
        return d < cfg.minMs ? { phase: "discarded", reason: "too_short", durationMs: d } : { phase: "sending", durationMs: d, autoCut: false };
      }
      return s;
    case "tick":
      if (s.phase !== "recording") return s;
      if (e.t - s.startedAt >= cfg.maxMs) return { phase: "sending", durationMs: cfg.maxMs, autoCut: true };
      return { ...s, elapsedMs: Math.max(0, e.t - s.startedAt) };
    case "cancel":
      return s.phase === "arming" || s.phase === "recording" ? { phase: "discarded", reason: "cancelled", durationMs: s.phase === "recording" ? s.elapsedMs : 0 } : s;
    case "sent":
      return s.phase === "sending" ? PTT_IDLE : s;
    case "fail":
      return s.phase === "idle" ? s : { phase: "error", error: e.error };
    case "reset":
      return s.phase === "discarded" || s.phase === "error" || s.phase === "sending" ? PTT_IDLE : s;
  }
}

/** true while the mic should be open */
export const isLive = (s: PttState) => s.phase === "arming" || s.phase === "recording";

/** 0..1 of the max clip length used */
export const progress = (s: PttState, cfg: PttConfig = DEFAULT_PTT) => (s.phase === "recording" ? Math.min(1, s.elapsedMs / cfg.maxMs) : 0);

/** Recording MIME types in preference order: Opus in WebM (Chrome/Firefox/Edge), Opus in Ogg, AAC in MP4 (Safari/iOS). */
export const MIME_PREFERENCE = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/aac"];

export function pickMime(isSupported: (m: string) => boolean): string | null {
  for (const m of MIME_PREFERENCE) {
    try {
      if (isSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export const extFor = (mime: string) => (mime.includes("webm") ? "webm" : mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : mime.includes("aac") ? "aac" : "bin");

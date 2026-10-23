/**
 * Tiny Web Audio cues (no audio files) + vibration. Safe to call anywhere: no-ops when audio is blocked
 * (autoplay policy before the first tap, tests, SSR).
 */
import { loadRaw, saveRaw } from "@/lib/storage";

export type Cue = "call" | "urgent" | "ticket" | "ready";

const NOTES: Record<Cue, [freq: number, start: number, dur: number][]> = {
  call: [[880, 0, 0.14], [1175, 0.16, 0.22]],
  urgent: [[988, 0, 0.12], [988, 0.18, 0.12], [988, 0.36, 0.12], [1319, 0.54, 0.3]],
  ticket: [[660, 0, 0.12], [990, 0.13, 0.2]],
  ready: [[784, 0, 0.12], [988, 0.12, 0.12], [1175, 0.24, 0.26]],
};
const VIBRATE: Record<Cue, number[]> = { call: [120], urgent: [200, 80, 200, 80, 300], ticket: [80], ready: [100, 60, 100] };

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    const AC = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function playCue(cue: Cue, volume = 0.18) {
  const a = audio();
  if (a && a.state === "running") {
    const t0 = a.currentTime + 0.01;
    for (const [f, s, d] of NOTES[cue]) {
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + s);
      g.gain.linearRampToValueAtTime(volume, t0 + s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + s + d);
      o.connect(g).connect(a.destination);
      o.start(t0 + s);
      o.stop(t0 + s + d + 0.05);
    }
  }
  try {
    globalThis.navigator?.vibrate?.(VIBRATE[cue]);
  } catch {
    /* not supported */
  }
}

/** Call once from a user gesture so later cues are allowed to play. */
export function unlockAudio() {
  audio();
}

/** Per-device on/off switch for a sound channel ("kds", "waiter"…). Default on. */
export const soundKey = (channel: string) => `sufra-os.sound.${channel}`;
export const soundEnabled = (channel: string) => loadRaw(soundKey(channel)) !== "0";
export const setSoundEnabled = (channel: string, on: boolean) => saveRaw(soundKey(channel), on ? "1" : "0");

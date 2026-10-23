/** localStorage that never throws (private windows, blocked storage, SSR/tests). */
export function loadRaw(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
export function saveRaw(key: string, value: string | null) {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage unavailable: the app still works for this session */
  }
}
export function loadJSON<T>(key: string, fallback: T): T {
  const raw = loadRaw(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
export function saveJSON(key: string, value: unknown) {
  saveRaw(key, JSON.stringify(value));
}

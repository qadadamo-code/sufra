/**
 * The user's real position as the origin for every distance/time on the site.
 *  - "استخدم موقعي": one high-accuracy fix (getCurrentPosition) → reverse-geocoded label via Photon (OSM).
 *  - live mode: watchPosition while the tab is visible, throttled (≥ 15 s and ≥ 40 m between updates).
 *  - falls back to the account's home / the chosen area whenever there is no fix.
 * The last fix is remembered for 12 h (in this browser only) so a reload keeps working; "stop" forgets it.
 */
import { useSyncExternalStore } from "react";
import { areas, type Area } from "./data";
import { haversineKm, type LatLng } from "./geo";
import { load, save } from "./storage";

export type LocStatus = "idle" | "locating" | "ok" | "denied" | "timeout" | "unavailable" | "unsupported" | "insecure";
export interface Fix extends LatLng {
  accuracy: number | null;
  at: number;
  label: string | null;
}
interface LocState {
  fix: Fix | null;
  /** distances use the fix (true) or the chosen area/home (false) */
  active: boolean;
  status: LocStatus;
  live: boolean;
}

const KEY = "sufra.location.v1";
const MAX_AGE = 12 * 3600 * 1000;
const saved = load<{ fix: Fix | null; active: boolean } | null>(KEY, null);
let state: LocState = {
  fix: saved?.fix && Date.now() - saved.fix.at < MAX_AGE ? saved.fix : null,
  active: !!(saved?.active && saved.fix && Date.now() - saved.fix.at < MAX_AGE),
  status: saved?.fix ? "ok" : "idle",
  live: false,
};
const ls = new Set<() => void>();
function set(p: Partial<LocState>) {
  state = { ...state, ...p };
  save(KEY, { fix: state.fix, active: state.active });
  ls.forEach((l) => l());
}
export const getLocation = () => state;
export function useLocation(): LocState {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => state,
    () => state,
  );
}

/** Nearest Sufra area to a point (for labels and area-based fallbacks). */
export function nearestArea(p: LatLng): Area {
  let best = areas[0];
  let bd = Infinity;
  for (const a of areas) {
    const d = haversineKm(p, a);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return best;
}

/** Greater Cairo, roughly — outside it the distances still work but we say so. */
export const inCairo = (p: LatLng) => haversineKm(p, { lat: 30.045, lng: 31.235 }) < 60;

/* ───────────── reverse geocoding (Photon, OSM-based, free, no key) ───────────── */
type PhotonProps = { name?: string; street?: string; housenumber?: string; district?: string; locality?: string; suburb?: string; city?: string; county?: string; state?: string };
export function photonLabel(p: PhotonProps | null | undefined): string | null {
  if (!p) return null;
  const first = p.name ?? (p.street ? `${p.street}${p.housenumber ? " " + p.housenumber : ""}` : undefined);
  const second = p.district ?? p.suburb ?? p.locality;
  const third = p.city ?? p.county ?? p.state;
  const parts = [first, second, third].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  return parts.length ? parts.slice(0, 2).join("، ") : null;
}
export async function reverseGeocode(p: LatLng, signal?: AbortSignal): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${p.lat.toFixed(6)}&lon=${p.lng.toFixed(6)}&lang=default`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const j = (await res.json()) as { features?: { properties?: PhotonProps }[] };
    return photonLabel(j.features?.[0]?.properties);
  } catch {
    return null; // offline / blocked — the area name is the fallback label
  } finally {
    clearTimeout(t);
  }
}

/* ───────────── one-shot fix ───────────── */
const errStatus = (e: GeolocationPositionError): LocStatus => (e.code === 1 ? "denied" : e.code === 3 ? "timeout" : "unavailable");

function accept(pos: GeolocationPosition, relabel: boolean) {
  const fix: Fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null, at: Date.now(), label: state.fix?.label ?? null };
  const moved = state.fix ? haversineKm(state.fix, fix) : Infinity;
  set({ fix, active: true, status: "ok" });
  if (relabel || moved > 0.3 || !fix.label) {
    void reverseGeocode(fix).then((label) => {
      if (label && state.fix && state.fix.at === fix.at) set({ fix: { ...state.fix, label } });
    });
  }
}

/** Ask for one high-accuracy fix. Resolves with the final status (the UI shows it). */
export function locate(): Promise<LocStatus> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    set({ status: "unsupported" });
    return Promise.resolve("unsupported");
  }
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    set({ status: "insecure" });
    return Promise.resolve("insecure");
  }
  set({ status: "locating" });
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        accept(pos, true);
        resolve("ok");
      },
      (e) => {
        const s = errStatus(e);
        set({ status: s, active: s === "timeout" && !!state.fix ? state.active : false });
        resolve(s);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}

/* ───────────── live mode ───────────── */
let watchId: number | null = null;
let lastPush = 0;
const MIN_MS = 15000;
const MIN_KM = 0.04;
function startWatch() {
  if (watchId != null || !("geolocation" in navigator)) return;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const now = Date.now();
      const far = !state.fix || haversineKm(state.fix, p) >= MIN_KM;
      if (state.fix && (now - lastPush < MIN_MS || !far)) return; // throttle
      lastPush = now;
      accept(pos, false);
    },
    (e) => {
      const s = errStatus(e);
      if (s === "denied") stopLive();
      set({ status: s === "timeout" ? state.status : s });
    },
    { enableHighAccuracy: true, timeout: 30000, maximumAge: 10000 },
  );
}
function stopWatch() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}
const onVis = () => (document.visibilityState === "visible" ? startWatch() : stopWatch());
export function startLive() {
  if (state.live) return;
  set({ live: true, active: true });
  startWatch();
  document.addEventListener("visibilitychange", onVis);
}
export function stopLive() {
  stopWatch();
  document.removeEventListener("visibilitychange", onVis);
  if (state.live) set({ live: false });
}

/** Go back to the chosen area / home (keeps nothing). */
export function forgetLocation() {
  stopLive();
  set({ fix: null, active: false, status: "idle" });
}
/** Keep the fix but measure from the area/home for now (e.g. the user picked an area). */
export function measureFromArea() {
  stopLive();
  if (state.active) set({ active: false });
}

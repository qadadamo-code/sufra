import Supercluster from "supercluster";
import type { LatLng } from "@/lib/geo";

export type MapPoint = { id: string; lat: number; lng: number; label: string; tone?: "open" | "closed" | "offer" | "courier" };
export type UserDot = LatLng & { accuracy?: number | null };

export interface MapProps {
  points?: MapPoint[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** the user's real position (GPS): blue-teal dot + accuracy circle */
  user?: UserDot | null;
  /** the origin when it is NOT GPS (home or chosen area): brass house marker */
  origin?: LatLng | null;
  center?: LatLng;
  zoom?: number;
  /** fit all points (+ user/origin) on first render */
  fit?: boolean;
  /** tap-to-pick mode (account home picker) */
  onPick?: (p: LatLng) => void;
  /** a dashed route line (tracking) */
  path?: LatLng[];
  className?: string;
  ariaLabel?: string;
}

export interface EngineHandle {
  zoomBy(delta: number): void;
  panTo(p: LatLng, zoom?: number): void;
  fit(): void;
}

export interface EngineProps extends MapProps {
  /** one-finger drag allowed on touch screens (the user tapped "move map") */
  touchDrag: boolean;
  dark: boolean;
  rtl: boolean;
  labels: { cluster: (n: number) => string; you: string; home: string };
  onReady: () => void;
  onFail: (reason: string) => void;
  /** a gesture the map won't take (one-finger drag on touch, plain wheel) → show the hint */
  onHint: (kind: "touch" | "wheel") => void;
}

export const CAIRO: LatLng = { lat: 30.045, lng: 31.235 };

/** Screen-independent clustering shared by both engines. */
export function makeIndex(points: MapPoint[]) {
  const sc = new Supercluster<{ id: string }, Record<string, never>>({ radius: 56, maxZoom: 16, minPoints: 3 });
  sc.load(points.map((p) => ({ type: "Feature", properties: { id: p.id }, geometry: { type: "Point", coordinates: [p.lng, p.lat] } })));
  return sc;
}

export const toneColor = (t?: MapPoint["tone"]) => (t === "offer" || t === "courier" ? "var(--sf-brass)" : t === "closed" ? "var(--sf-muted)" : "var(--sf-primary)");

/** Pin markup (HTML string — Leaflet divIcon and Google AdvancedMarker both take it). */
export function pinHtml(p: MapPoint, selected: boolean): string {
  const c = toneColor(p.tone);
  const s = selected ? 1.3 : 1;
  const esc = p.label.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  const icon = p.tone === "courier" ? `<path d="M9 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm14 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" fill="var(--card)"/>` : `<circle cx="14" cy="14.5" r="4.2" fill="var(--card)"/>`;
  return `<div class="sf-pin${selected ? " is-sel" : ""}" style="--s:${s}"><svg width="28" height="36" viewBox="0 0 28 36" aria-hidden="true"><path d="M14 35s11-11.2 11-20A11 11 0 0 0 3 15c0 8.8 11 20 11 20z" fill="${c}" stroke="var(--card)" stroke-width="2"/>${icon}</svg>${selected ? `<span class="sf-pin-label">${esc}</span>` : ""}</div>`;
}
export function clusterHtml(n: number): string {
  const d = Math.round(Math.min(52, 30 + Math.sqrt(n) * 4));
  return `<div class="sf-cluster" style="width:${d}px;height:${d}px"><span>${n}</span></div>`;
}
export const userHtml = `<div class="sf-user"><i></i></div>`;
export const originHtml = `<div class="sf-origin"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="currentColor"/></svg></div>`;

/** Resolve a CSS custom property to a concrete colour (SVG/canvas attributes can't take var()). */
export function cssVar(name: string, fallback = "#0d5a53"): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

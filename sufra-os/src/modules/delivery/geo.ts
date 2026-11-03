/**
 * Geometry for delivery: distances, ETAs, zones (polygon or radius ring), fees. Pure and tested (geo.test.ts).
 * Coordinates are WGS84 degrees; distances are kilometres.
 */
import type { DeliveryZoneRow, LatLng, ZoneGeometry } from "@/data/types";
import type { Units } from "@/lib/money";

const R_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Streets are not straight lines: Cairo grid detour factor applied to the crow-flies distance. */
export const ROAD_FACTOR = 1.35;
/** parking + stairs + hand-over at the door */
export const HANDOVER_MIN = 3;

/** Minutes to ride from a to b at `speedKmh` (road factor included, rounded up). */
export function travelMinutes(a: LatLng, b: LatLng, speedKmh: number, opts: { handover?: boolean } = {}): number {
  const km = haversineKm(a, b) * ROAD_FACTOR;
  const v = Math.max(5, speedKmh);
  return Math.ceil((km / v) * 60) + (opts.handover === false ? 0 : HANDOVER_MIN);
}

/**
 * Door ETA for an order: kitchen time left (if not ready) + ride from where the rider is (or the kitchen) + hand-over.
 * `prepLeftMin` is 0 once the food is ready / picked up.
 */
export function etaMinutes(x: { from: LatLng; to: LatLng; speedKmh: number; prepLeftMin?: number; stopsBefore?: number }): number {
  const ride = travelMinutes(x.from, x.to, x.speedKmh);
  return Math.max(0, x.prepLeftMin ?? 0) + ride + (x.stopsBefore ?? 0) * (HANDOVER_MIN + 2);
}

/** Ray casting, works for concave polygons. Points are lat/lng (treated as planar — fine at city scale). */
export function pointInPolygon(p: LatLng, poly: LatLng[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}

export function inGeometry(p: LatLng, g: ZoneGeometry | null): boolean {
  if (!g) return false;
  if (g.kind === "ring") return haversineKm(p, g.center) <= g.radiusKm;
  return pointInPolygon(p, g.points);
}

/** Centre of a zone (ring centre / polygon vertex mean) — the fallback pin for addresses without GPS. */
export function geometryCenter(g: ZoneGeometry | null): LatLng | null {
  if (!g) return null;
  if (g.kind === "ring") return g.center;
  if (!g.points.length) return null;
  const s = g.points.reduce((a, p) => ({ lat: a.lat + p.lat, lng: a.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: s.lat / g.points.length, lng: s.lng / g.points.length };
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return ((h || 0) % 24) * 60 + (m || 0);
};

/** Hours that may cross midnight; null = always. */
export function withinHours(hours: { open: string; close: string } | null, minutesNow: number): boolean {
  if (!hours) return true;
  const o = toMin(hours.open);
  const c = toMin(hours.close);
  const span = (c - o + 1440) % 1440 || 1440;
  return (minutesNow - o + 1440) % 1440 < span;
}

type ZoneLike = Pick<DeliveryZoneRow, "geometry" | "active" | "hours" | "sort">;

/** The zone a point falls in: active, open now, smallest sort first (inner rings before outer ones). */
export function zoneFor<Z extends ZoneLike>(p: LatLng, zones: Z[], minutesNow?: number): Z | null {
  const hits = zones.filter((z) => z.active && inGeometry(p, z.geometry) && (minutesNow === undefined || withinHours(z.hours, minutesNow)));
  return hits.sort((a, b) => a.sort - b.sort)[0] ?? null;
}

/** Delivery fee for a basket: free at/above the zone's threshold. */
export function zoneFee(z: { fee: Units; freeOver?: Units | null }, subtotal: Units): Units {
  if (z.freeOver != null && z.freeOver > 0 && subtotal >= z.freeOver) return 0;
  return z.fee;
}

/** Whether the basket meets the zone minimum, and what is missing. */
export function minOrderGap(z: { minOrder: Units }, subtotal: Units): Units {
  return Math.max(0, z.minOrder - subtotal);
}

/** Ring polygon approximation (map drawing / GeoJSON export). */
export function ringPoints(center: LatLng, radiusKm: number, n = 48): LatLng[] {
  const dLat = (radiusKm / R_KM) * (180 / Math.PI);
  const dLng = dLat / Math.cos(rad(center.lat));
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * 2 * Math.PI;
    return { lat: center.lat + dLat * Math.sin(t), lng: center.lng + dLng * Math.cos(t) };
  });
}

/** Area of a geometry in km² (zone list caption). */
export function areaKm2(g: ZoneGeometry | null): number {
  if (!g) return 0;
  if (g.kind === "ring") return Math.PI * g.radiusKm ** 2;
  const pts = g.points;
  if (pts.length < 3) return 0;
  const lat0 = rad(pts[0].lat);
  const xy = pts.map((p) => ({ x: rad(p.lng) * Math.cos(lat0) * R_KM, y: rad(p.lat) * R_KM }));
  let s = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** A stable small offset (≤ ~250 m) so several addresses without GPS in the same zone don't stack on one pin. */
export function jitter(p: LatLng, seed: string, km = 0.25): LatLng {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const a = ((h >>> 0) % 3600) / 10;
  const r = (((h >>> 12) % 1000) / 1000) * km;
  const dLat = (r / R_KM) * (180 / Math.PI);
  return { lat: p.lat + dLat * Math.sin(rad(a)), lng: p.lng + (dLat / Math.cos(rad(p.lat))) * Math.cos(rad(a)) };
}

export const googleDirections = (to: LatLng | null, address: string, from?: LatLng | null) => {
  const dest = to ? `${to.lat.toFixed(6)},${to.lng.toFixed(6)}` : address;
  const q = new URLSearchParams({ api: "1", destination: dest, travelmode: "driving" });
  if (from) q.set("origin", `${from.lat.toFixed(6)},${from.lng.toFixed(6)}`);
  return `https://www.google.com/maps/dir/?${q.toString()}`;
};

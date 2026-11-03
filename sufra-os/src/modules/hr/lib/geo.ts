/** Geofence for mobile check-in: great-circle distance (haversine) from the branch's coordinates. */
const R = 6_371_008.8; // mean Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface GeofenceCheck {
  inside: boolean;
  distanceM: number;
  /** inside only thanks to the GPS accuracy margin (shown as "near") */
  marginal: boolean;
}

/**
 * Inside when the distance is within the radius; a poor GPS fix gets up to 50 m of benefit of the doubt
 * (half the reported accuracy), never more — so a phone across town can't check in.
 */
export function checkGeofence(fix: { lat: number; lng: number; accuracyM?: number | null }, fence: { lat: number; lng: number; radiusM: number }): GeofenceCheck {
  const d = distanceM(fix, fence);
  const margin = Math.min(50, Math.max(0, (fix.accuracyM ?? 0) / 2));
  const inside = d <= fence.radiusM + margin;
  return { inside, distanceM: Math.round(d), marginal: inside && d > fence.radiusM };
}

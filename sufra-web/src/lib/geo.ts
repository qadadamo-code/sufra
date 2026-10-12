export type LatLng = { lat: number; lng: number };

const R = 6371; // km
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cairo traffic: ≈ 22 km/h door-to-door average + 4 min to park/leave. Walking 4.8 km/h, only shown under 2 km. */
export function travel(km: number): { car: number; walk: number | null } {
  const car = Math.round((km / 22) * 60 + 4);
  const walk = km < 2 ? Math.max(1, Math.round((km / 4.8) * 60)) : null;
  return { car, walk };
}

export function fmtKm(km: number, lang: "ar" | "en"): string {
  const v = km < 10 ? km.toFixed(1) : String(Math.round(km));
  return lang === "ar" ? `${v} كم` : `${v} km`;
}

/** Google Maps directions from the user's origin to a place (works with or without a Maps key). */
export function directionsUrl(origin: LatLng | null, dest: LatLng, mode: "driving" | "walking" = "driving"): string {
  const q = new URLSearchParams({ api: "1", destination: `${dest.lat.toFixed(6)},${dest.lng.toFixed(6)}`, travelmode: mode });
  if (origin) q.set("origin", `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`);
  return `https://www.google.com/maps/dir/?${q.toString().replace(/%2C/g, ",")}`;
}

/**
 * Demo delivery data for src/data/seed.ts: zones drawn around the Zamalek kitchen, rider shifts and positions,
 * and dispatch records for the seeded delivery orders. Addresses/coordinates are real streets; people are fictional.
 */
import type { DeliveryZoneRow, DispatchInfo, DriverLocation, DriverShift, LatLng, Localized, OrderChannel, ZoneGeometry } from "@/data/types";
import { major, type Units } from "@/lib/money";
import { DEMO_ORIGIN, newDispatch } from "./settings";
import { locationId } from "./driverOps";

const P = (lat: number, lng: number): LatLng => ({ lat, lng });

/** Seeded doors (lat/lng) — used by seed.ts for the delivery orders. */
export const DEMO_DOORS = {
  abuElFeda: { address: "١٤ شارع أبو الفدا، الدور الرابع", area: "الزمالك", ...P(30.0655, 31.2224) },
  hassanSabri: { address: "٣ شارع حسن صبري، شقة ٧", area: "الزمالك", ...P(30.0589, 31.2205) },
  mesaha: { address: "٢٢ شارع المساحة، الدقي — عمارة البنك", area: "الدقي", ...P(30.0389, 31.2106) },
  shehab: { address: "٤٧ شارع شهاب، المهندسين، الدور ٦", area: "المهندسين", ...P(30.0566, 31.1992) },
  tahrirDokki: { address: "٩٠ شارع التحرير، الدقي، شقة ١٢", area: "الدقي", ...P(30.0384, 31.2068) },
  july26: { address: "١٥٧ شارع ٢٦ يوليو، الزمالك", area: "الزمالك", ...P(30.0610, 31.2199) },
  lebanon: { address: "١٢ ميدان لبنان، المهندسين", area: "المهندسين", ...P(30.0573, 31.2003) },
  gameatDowal: { address: "٦٠ شارع جامعة الدول العربية، المهندسين", area: "المهندسين", ...P(30.0541, 31.2033) },
};

export const DEMO_RIDERS = { islam: P(30.0641, 31.2214), mahmoud: P(30.0628, 31.2183), omar: P(30.0545, 31.2012) };

const Z = (slug: string, name: Localized, fee: number, minOrder: number, eta: [number, number], geometry: ZoneGeometry, color: string, sort: number, freeOver: number | null = null): Omit<DeliveryZoneRow, "id" | "restaurantId" | "createdAt" | "updatedAt"> => ({
  branchId: null, slug, name, fee: major(fee), minOrder: major(minOrder), freeOver: freeOver === null ? null : major(freeOver), etaMin: eta[0], etaMax: eta[1], geometry, hours: null, color, sort, active: true,
});

/** Same slugs, fees and ETAs as 0005_guest.sql's demo zones, now with shapes on the map. */
export const DEMO_ZONE_DEFS = [
  Z("zamalek", { ar: "الزمالك", en: "Zamalek" }, 25, 150, [25, 35], { kind: "polygon", points: [P(30.0752, 31.2190), P(30.0712, 31.2262), P(30.0590, 31.2252), P(30.0478, 31.2238), P(30.0492, 31.2178), P(30.0600, 31.2146), P(30.0712, 31.2132)] }, "#0d5a53", 1, 600),
  Z("garden-city", { ar: "جاردن سيتي", en: "Garden City" }, 35, 200, [30, 45], { kind: "ring", center: P(30.0362, 31.2318), radiusKm: 0.75 }, "#6b4fa0", 2),
  Z("downtown", { ar: "وسط البلد", en: "Downtown" }, 35, 200, [30, 45], { kind: "ring", center: P(30.0478, 31.2412), radiusKm: 1.1 }, "#a8700c", 3),
  Z("agouza", { ar: "العجوزة", en: "Agouza" }, 40, 250, [35, 50], { kind: "polygon", points: [P(30.0712, 31.2128), P(30.0670, 31.2058), P(30.0590, 31.2072), P(30.0530, 31.2112), P(30.0560, 31.2150), P(30.0640, 31.2140)] }, "#2f6f9f", 4),
  Z("mohandessin", { ar: "المهندسين", en: "Mohandessin" }, 40, 250, [35, 50], { kind: "polygon", points: [P(30.0668, 31.2052), P(30.0638, 31.1892), P(30.0498, 31.1880), P(30.0450, 31.2010), P(30.0528, 31.2108), P(30.0590, 31.2072)] }, "#c2412d", 5, 900),
  Z("dokki", { ar: "الدقي", en: "Dokki" }, 40, 250, [35, 50], { kind: "polygon", points: [P(30.0450, 31.2010), P(30.0458, 31.2160), P(30.0372, 31.2178), P(30.0300, 31.2120), P(30.0310, 31.1985), P(30.0400, 31.1950)] }, "#1d7f4a", 6),
];

type Ctx = { R: string; B: string; T: (minutesAgo: number) => string; id: (k: string) => string; S: (key: string) => string; created: string };

export function demoDeliveryRows(c: Ctx, settled: { cash: Units }): { deliveryZones: DeliveryZoneRow[]; driverShifts: DriverShift[]; driverLocations: DriverLocation[] } {
  const base = (k: string) => ({ id: c.id(k), restaurantId: c.R, createdAt: c.created, updatedAt: c.created });
  const deliveryZones: DeliveryZoneRow[] = DEMO_ZONE_DEFS.map((z) => ({ ...base(`dzone:${z.slug}`), ...z }));
  const shift = (k: string, driver: string, started: number, status: DriverShift["status"], ended: number | null = null, settlement: DriverShift["settlement"] = null): DriverShift => ({
    ...base(`dshift:${k}`), createdAt: c.T(started), updatedAt: c.T(ended ?? started), branchId: c.B, driverId: c.S(driver), status, startedAt: c.T(started), endedAt: ended === null ? null : c.T(ended), settlement,
  });
  const driverShifts: DriverShift[] = [
    shift("islam", "delivery", 240, "on"),
    shift("mahmoud", "delivery2", 150, "on"),
    shift("omar", "delivery3", 620, "settled", 280, { expected: settled.cash, handedIn: settled.cash, difference: 0, orders: 1, settledBy: c.S("cashier1"), settledAt: c.T(278), posShiftId: null, note: "" }),
  ];
  const loc = (driver: string, p: LatLng, ago: number, onShift: boolean, heading: number | null = null): DriverLocation => ({
    id: locationId(c.S(driver)), restaurantId: c.R, createdAt: c.T(ago), updatedAt: c.T(ago), driverId: c.S(driver), lat: p.lat, lng: p.lng, accuracy: 12, heading, speed: onShift ? 6 : 0, at: c.T(ago), onShift,
  });
  const driverLocations: DriverLocation[] = [loc("delivery", DEMO_RIDERS.islam, 0.5, true, 40), loc("delivery2", DEMO_RIDERS.mahmoud, 1, true), loc("delivery3", DEMO_RIDERS.omar, 280, false)];
  return { deliveryZones, driverShifts, driverLocations };
}

/** Dispatch record for a seeded order, timestamps as minutes-ago. */
export function demoDispatch(T: (minutesAgo: number) => string, channel: OrderChannel, x: {
  stage: DispatchInfo["stage"]; received: number; accepted?: number; prep?: number; promised?: number; ready?: number; assigned?: number; picked?: number; delivered?: number; expires?: number;
  otp?: string; zone?: string; shift?: string | null; collected?: DispatchInfo["collected"]; aggregator?: DispatchInfo["aggregator"]; batchId?: string | null;
}): DispatchInfo {
  const t = (m?: number) => (m === undefined ? null : T(m));
  return newDispatch(channel, T(x.received), {
    stage: x.stage, expiresAt: t(x.expires), acceptedAt: t(x.accepted), prepMin: x.prep ?? (x.accepted !== undefined ? 20 : null), promisedAt: t(x.promised), readyAt: t(x.ready),
    assignedAt: t(x.assigned), pickedUpAt: t(x.picked), deliveredAt: t(x.delivered), otp: x.otp ?? null, zone: x.zone ?? null, driverShiftId: x.shift ?? null,
    collected: x.collected ?? null, aggregator: x.aggregator ?? null, batchId: x.batchId ?? null,
    proof: x.delivered !== undefined ? { kind: "otp", photo: null, at: T(x.delivered) } : null,
  });
}

export { DEMO_ORIGIN };

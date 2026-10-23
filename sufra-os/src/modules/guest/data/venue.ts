/**
 * Online-ordering venue facts that the core schema does not carry yet: delivery zones, hours logic,
 * ETAs. In Supabase these come from `delivery_zones` + `guest_venue()` (supabase/migrations/0005_guest.sql);
 * the local demo uses DEMO_ZONES.
 */
import { major, type Units } from "@/lib/money";
import type { Localized } from "@/data/types";

export interface DeliveryZone {
  id: string;
  name: Localized;
  fee: Units;
  minOrder: Units;
  /** minutes, door to door */
  etaMin: number;
  etaMax: number;
}

export const DEMO_ZONES: DeliveryZone[] = [
  { id: "zamalek", name: { ar: "الزمالك", en: "Zamalek" }, fee: major(25), minOrder: major(150), etaMin: 25, etaMax: 35 },
  { id: "garden-city", name: { ar: "جاردن سيتي", en: "Garden City" }, fee: major(35), minOrder: major(200), etaMin: 30, etaMax: 45 },
  { id: "downtown", name: { ar: "وسط البلد", en: "Downtown" }, fee: major(35), minOrder: major(200), etaMin: 30, etaMax: 45 },
  { id: "mohandessin", name: { ar: "المهندسين", en: "Mohandessin" }, fee: major(40), minOrder: major(250), etaMin: 35, etaMax: 50 },
  { id: "dokki", name: { ar: "الدقي", en: "Dokki" }, fee: major(40), minOrder: major(250), etaMin: 35, etaMax: 50 },
  { id: "agouza", name: { ar: "العجوزة", en: "Agouza" }, fee: major(40), minOrder: major(250), etaMin: 35, etaMax: 50 },
];

export const PICKUP_MINUTES = 20;

/* ───────── opening hours ───────── */

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h % 24) * 60 + (m || 0);
};

/** Minutes since local midnight in the venue's timezone. */
export function venueMinutes(now: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return (h % 24) * 60 + m;
  } catch {
    return now.getHours() * 60 + now.getMinutes();
  }
}

/** Open/closed for hours that may run past midnight (e.g. 12:00 → 01:00). null hours = always open. */
export function openState(hours: { open: string; close: string } | null, minutesNow: number): { open: boolean; closesInMin: number | null; opensInMin: number | null } {
  if (!hours) return { open: true, closesInMin: null, opensInMin: null };
  const o = toMin(hours.open);
  const c = toMin(hours.close);
  const span = (c - o + 1440) % 1440 || 1440;
  const since = (minutesNow - o + 1440) % 1440;
  if (since < span) return { open: true, closesInMin: span - since, opensInMin: null };
  return { open: false, closesInMin: null, opensInMin: (o - minutesNow + 1440) % 1440 };
}

/** Pickup slots (every 15 min) from now+prep until closing, max 16. Values are "HH:MM" local. */
export function pickupSlots(hours: { open: string; close: string } | null, minutesNow: number, prep = PICKUP_MINUTES): string[] {
  const st = openState(hours, minutesNow);
  if (!st.open) return [];
  const until = st.closesInMin ?? 600;
  const first = Math.ceil((minutesNow + prep) / 15) * 15;
  const out: string[] = [];
  for (let t = first; t <= minutesNow + until - 10 && out.length < 16; t += 15) {
    const m = ((t % 1440) + 1440) % 1440;
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

/**
 * Wall-clock ↔ instant helpers for a restaurant time zone (no dependencies, no path aliases — also used by
 * /api/attendance-push through a relative import). Works for any IANA zone via Intl; DST-safe (two-pass offset).
 */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface WallParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

/** wall-clock parts of an instant in `tz` */
export function wallParts(ms: number, tz: string): WallParts {
  const p: Record<string, number> = {};
  for (const x of fmt(tz).formatToParts(new Date(ms))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return { y: p.year, m: p.month, d: p.day, hh: p.hour === 24 ? 0 : p.hour, mm: p.minute, ss: p.second };
}

/** offset of `tz` at instant `ms`, in minutes (Cairo summer = +180) */
export function tzOffsetMin(ms: number, tz: string): number {
  const w = wallParts(ms, tz);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm, w.ss);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** "2026-11-03" + "09:30[:00]" in tz → epoch ms */
export function zonedToMs(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss = 0] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  const off1 = tzOffsetMin(guess, tz);
  const t1 = guess - off1 * 60000;
  const off2 = tzOffsetMin(t1, tz);
  return off2 === off1 ? t1 : guess - off2 * 60000;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** local calendar date YYYY-MM-DD of an instant */
export function localDate(ms: number, tz: string): string {
  const w = wallParts(ms, tz);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}`;
}

/** local HH:MM of an instant */
export function localTime(ms: number, tz: string): string {
  const w = wallParts(ms, tz);
  return `${pad(w.hh)}:${pad(w.mm)}`;
}

/** Restaurants close after midnight: a punch at 01:30 belongs to the previous business day. */
export const DAY_CUTOFF_HOURS = 5;
export function businessDate(ms: number, tz: string, cutoffHours = DAY_CUTOFF_HOURS): string {
  return localDate(ms - cutoffHours * 3_600_000, tz);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** every date in [from, to] */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "2026-10" → first and last day */
export function periodBounds(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${pad(last)}` };
}

export function addMonths(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}

/** "HH:MM" → minutes after midnight */
export const hm = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
export const fromMin = (min: number) => `${pad(Math.floor((((min % 1440) + 1440) % 1440) / 60))}:${pad((((min % 1440) + 1440) % 1440) % 60)}`;

/** Saturday-first week (Egyptian restaurants plan Sat → Fri) containing `date` */
export function weekStart(date: string, firstDay = 6): string {
  const wd = weekday(date);
  return addDays(date, -((wd - firstDay + 7) % 7));
}

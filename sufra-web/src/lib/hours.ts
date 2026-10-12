import type { Lang, Restaurant } from "./data";

/** Minutes since local midnight. */
export const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

export type OpenState = {
  open: boolean;
  /** minutes until it closes (when open) or opens (when closed); null = not today/tomorrow */
  in: number | null;
  /** minutes-since-midnight of the next change, normalised to 0..1439 */
  at: number | null;
  closingSoon: boolean;
};

/**
 * hours[d] = [open, close] minutes since 00:00 for weekday d (0 = Sunday).
 * close may exceed 1440 (after midnight). The tail of yesterday's late shift counts as open today.
 */
export function openState(hours: [number, number][], now: Date = new Date()): OpenState {
  const d = now.getDay();
  const m = minutesOf(now);
  const y = (d + 6) % 7;
  const [yo, yc] = hours[y] ?? [0, 0];
  if (yc > 1440 && m < yc - 1440 && yc > yo) {
    const left = yc - 1440 - m;
    return { open: true, in: left, at: (yc - 1440) % 1440, closingSoon: left <= 45 };
  }
  const [o, c] = hours[d] ?? [0, 0];
  if (c > o && m >= o && m < c) {
    const left = c - m;
    return { open: true, in: left, at: c % 1440, closingSoon: left <= 45 };
  }
  if (c > o && m < o) return { open: false, in: o - m, at: o, closingSoon: false };
  // after today's close → tomorrow's opening
  for (let k = 1; k <= 7; k++) {
    const [no, nc] = hours[(d + k) % 7] ?? [0, 0];
    if (nc > no) return { open: false, in: k * 1440 - m + no, at: no, closingSoon: false };
  }
  return { open: false, in: null, at: null, closingSoon: false };
}

export const isOpenNow = (r: Restaurant, now = new Date()) => openState(r.hours, now).open;

/** 13:30 → "1:30 م" / "1:30 PM" — Latin digits like Egyptian apps. */
export function fmtTime(min: number, lang: Lang): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const pm = h24 >= 12;
  const t = `${h12}:${String(mm).padStart(2, "0")}`;
  return lang === "ar" ? `${t} ${pm ? "م" : "ص"}` : `${t} ${pm ? "PM" : "AM"}`;
}

export function fmtRange([o, c]: [number, number], lang: Lang): string {
  if (c <= o) return lang === "ar" ? "مقفول" : "Closed";
  if (c - o >= 1440) return lang === "ar" ? "24 ساعة" : "24 hours";
  return `${fmtTime(o, lang)} – ${fmtTime(c, lang)}`;
}

export type DayPart = "morning" | "afternoon" | "evening" | "late";
export const DAY_PARTS: { id: DayPart; ar: string; en: string; from: number; to: number }[] = [
  { id: "morning", ar: "الصبح", en: "Morning", from: 6 * 60, to: 12 * 60 },
  { id: "afternoon", ar: "الضهر والعصر", en: "Afternoon", from: 12 * 60, to: 17 * 60 },
  { id: "evening", ar: "بالليل", en: "Evening", from: 17 * 60, to: 22 * 60 },
  { id: "late", ar: "سهر بعد 12", en: "Late (after 12)", from: 24 * 60, to: 27 * 60 },
];

/** Does the venue's schedule for `day` overlap the given part of the day? */
export function openDuring(hours: [number, number][], part: DayPart, day: number): boolean {
  const p = DAY_PARTS.find((x) => x.id === part)!;
  const [o, c] = hours[day] ?? [0, 0];
  if (c <= o) return false;
  return o < p.to && c > p.from;
}

/** Bookable 30-minute slots for a date: from opening to one hour before closing; for today only future slots (+30 min). */
export function timeSlots(hours: [number, number][], date: Date, now: Date = new Date()): number[] {
  const [o, c] = hours[date.getDay()] ?? [0, 0];
  if (c <= o) return [];
  const sameDay = date.toDateString() === now.toDateString();
  const earliest = sameDay ? minutesOf(now) + 30 : 0;
  const out: number[] = [];
  for (let t = Math.ceil(o / 30) * 30; t <= c - 60; t += 30) if (t >= earliest) out.push(t);
  return out;
}

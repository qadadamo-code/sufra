/**
 * Attendance rules (الحضور والانصراف): one person's day compared with their rota — late, early leave, absent, overtime,
 * breaks — and the period summary payroll uses. Pure: punches + shifts + settings in, numbers out.
 *
 * A punch belongs to the business day of (local time − 5 h), so a 01:30 punch-out closes the previous evening's shift.
 */
import type { AttendancePunch, LeaveType, RotaShift } from "@/data/hrTypes";
import type { HrSettings } from "./settings";
import { businessDate, hm, zonedToMs, addDays } from "./tz";

export type DayStatus = "on_time" | "late" | "absent" | "leave" | "off" | "upcoming" | "working" | "missing_out" | "extra";

export interface DayEval {
  date: string;
  status: DayStatus;
  scheduledMin: number;
  workedMin: number;
  breakMin: number;
  lateMin: number;
  earlyMin: number;
  overtimeMin: number;
  /** overtime that falls in the night window (paid at the night rate) */
  nightOvertimeMin: number;
  /** worked on a day with no shift (rest day) */
  restDayMin: number;
  firstIn: string | null;
  lastOut: string | null;
  /** deductions in days' pay (lateness + early leave tiers, absence) */
  deductionDays: number;
  leave: LeaveType | null;
  punches: number;
}

type ShiftLike = Pick<RotaShift, "date" | "start" | "end" | "breakMin">;
type PunchLike = Pick<AttendancePunch, "at" | "kind" | "voided">;

export function shiftWindow(s: ShiftLike, tz: string): { start: number; end: number; netMin: number } {
  const start = zonedToMs(s.date, s.start, tz);
  const endDate = hm(s.end) <= hm(s.start) ? addDays(s.date, 1) : s.date;
  const end = zonedToMs(endDate, s.end, tz);
  return { start, end, netMin: Math.max(0, Math.round((end - start) / 60000) - (s.breakMin || 0)) };
}

export const tierDays = (min: number, tiers: { fromMin: number; days: number }[]) => tiers.filter((t) => min >= t.fromMin).reduce((m, t) => Math.max(m, t.days), 0);

/** Minutes of [a, b] (ms) that fall inside the nightly window [from, to) local time. */
function nightMinutes(a: number, b: number, tz: string, from: string, to: string): number {
  if (b <= a) return 0;
  let total = 0;
  const startDay = businessDate(a, tz, 0);
  for (let d = addDays(startDay, -1); d <= addDays(businessDate(b, tz, 0), 0); d = addDays(d, 1)) {
    const ns = zonedToMs(d, from, tz);
    const ne = zonedToMs(hm(to) <= hm(from) ? addDays(d, 1) : d, to, tz);
    total += Math.max(0, Math.min(b, ne) - Math.max(a, ns));
  }
  return Math.round(total / 60000);
}

/** Pairs in/out and break punches into worked intervals. Open "in" stays open (end = null). */
export function workIntervals(punches: PunchLike[]): { intervals: { start: number; end: number | null }[]; breakMs: number; openBreak: boolean } {
  const ps = punches.filter((p) => !p.voided).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const intervals: { start: number; end: number | null }[] = [];
  let open: number | null = null;
  let breakStart: number | null = null;
  let breakMs = 0;
  for (const p of ps) {
    const t = Date.parse(p.at);
    if (p.kind === "in") {
      if (open === null) open = t; // double "in" → keep the first
    } else if (p.kind === "out") {
      if (open !== null) {
        intervals.push({ start: open, end: t });
        open = null;
      }
      if (breakStart !== null) {
        breakMs += t - breakStart;
        breakStart = null;
      }
    } else if (p.kind === "break_start") {
      if (open !== null && breakStart === null) breakStart = t;
    } else if (p.kind === "break_end") {
      if (breakStart !== null) {
        breakMs += t - breakStart;
        breakStart = null;
      }
    }
  }
  if (open !== null) intervals.push({ start: open, end: null });
  return { intervals, breakMs, openBreak: breakStart !== null };
}

/**
 * Evaluate one person's business day.
 * `shifts` = their published shifts that day (split shifts allowed); `punches` = their punches for that business day.
 */
export function evaluateDay(x: { date: string; shifts: ShiftLike[]; punches: PunchLike[]; leave: LeaveType | null; now: number; tz: string; rules: HrSettings }): DayEval {
  const { rules, tz } = x;
  const windows = x.shifts.map((s) => shiftWindow(s, tz)).sort((a, b) => a.start - b.start);
  // paid breaks are part of the scheduled time (worked time keeps them too); unpaid ones come off both
  const scheduledMin = windows.reduce((a, w, i) => a + (rules.breaks.paid ? w.netMin + (x.shifts[i]?.breakMin || 0) : w.netMin), 0);
  const { intervals, breakMs } = workIntervals(x.punches);
  const first = windows[0];
  const last = windows[windows.length - 1];
  const dayOver = last ? x.now > last.end + 2 * 3_600_000 : x.now > zonedToMs(addDays(x.date, 1), "05:00", tz);

  // an open interval: still working (today) or forgot to punch out (closed at the scheduled end, flagged)
  let missingOut = false;
  const closed = intervals.map((iv) => {
    if (iv.end !== null) return iv as { start: number; end: number };
    if (!dayOver) return { start: iv.start, end: Math.max(iv.start, x.now) };
    missingOut = true;
    return { start: iv.start, end: Math.max(iv.start, last?.end ?? iv.start) };
  });
  const grossMs = closed.reduce((a, iv) => a + (iv.end - iv.start), 0);
  const breakMin = Math.round(breakMs / 60000);
  const workedMin = Math.max(0, Math.round(grossMs / 60000) - (rules.breaks.paid ? 0 : breakMin));
  const firstIn = closed.length ? closed[0].start : null;
  const lastOut = intervals.length && intervals[intervals.length - 1].end !== null ? (intervals[intervals.length - 1].end as number) : null;

  const base: DayEval = {
    date: x.date, status: "off", scheduledMin, workedMin, breakMin, lateMin: 0, earlyMin: 0, overtimeMin: 0, nightOvertimeMin: 0, restDayMin: 0,
    firstIn: firstIn ? new Date(firstIn).toISOString() : null, lastOut: lastOut ? new Date(lastOut).toISOString() : null, deductionDays: 0, leave: x.leave, punches: x.punches.filter((p) => !p.voided).length,
  };

  if (x.leave) return { ...base, status: "leave" };

  if (!first) {
    // no shift: a rest day; any work is rest-day overtime
    if (!closed.length) return base;
    return { ...base, status: !dayOver && intervals.some((i) => i.end === null) ? "working" : "extra", restDayMin: workedMin };
  }

  if (!closed.length) {
    const started = x.now > first.start + rules.graceMin * 60000;
    if (!started) return { ...base, status: "upcoming" };
    if (!dayOver && x.now < last.end) return { ...base, status: "absent", deductionDays: 0 }; // not in yet — counts once the day is over
    return { ...base, status: "absent", deductionDays: rules.absenceDays };
  }

  const lateRaw = Math.max(0, Math.round(((firstIn as number) - first.start) / 60000));
  const lateMin = lateRaw > rules.graceMin ? lateRaw : 0;
  const leftAt = lastOut ?? (missingOut ? last.end : null);
  const earlyMin = leftAt !== null && dayOver ? Math.max(0, Math.round((last.end - leftAt) / 60000)) : 0;
  const extra = workedMin - scheduledMin;
  const overtimeMin = dayOver || lastOut ? (extra >= rules.overtime.afterMin ? extra : 0) : 0;
  // the overtime minutes are the ones after the scheduled end (late stays); count how many of those are at night
  const nightOvertimeMin = overtimeMin > 0 && lastOut ? Math.min(overtimeMin, nightMinutes(Math.max(last.end, lastOut - overtimeMin * 60000), lastOut, tz, rules.overtime.nightFrom, rules.overtime.nightTo)) : 0;
  const deductionDays = tierDays(lateMin, rules.lateTiers) + (missingOut ? 0 : tierDays(earlyMin, rules.earlyTiers));
  const working = !dayOver && intervals.some((i) => i.end === null);
  const status: DayStatus = working ? "working" : missingOut ? "missing_out" : lateMin > 0 ? "late" : "on_time";
  return { ...base, status: working && lateMin > 0 ? "late" : status, lateMin, earlyMin, overtimeMin, nightOvertimeMin, deductionDays };
}

export interface PeriodSummary {
  scheduledDays: number;
  workedDays: number;
  absentDays: number;
  leaveDays: number;
  lateCount: number;
  lateMin: number;
  earlyMin: number;
  workedMin: number;
  overtimeMin: number;
  nightOvertimeMin: number;
  restDayMin: number;
  /** lateness + early-leave tier deductions (days' pay), excluding absences */
  lateDeductionDays: number;
  missingOut: number;
  /** days worked with no shift (rest days) */
  extraDays: number;
  /** 0–100: on time = 1, late = ½, absent = 0, over scheduled days */
  score: number;
}

export function summarize(days: DayEval[]): PeriodSummary {
  const sched = days.filter((d) => d.scheduledMin > 0 && d.status !== "leave" && d.status !== "upcoming");
  const s: PeriodSummary = {
    scheduledDays: sched.length,
    workedDays: days.filter((d) => d.workedMin > 0).length,
    absentDays: days.filter((d) => d.status === "absent" && d.deductionDays > 0).length,
    leaveDays: days.filter((d) => d.status === "leave").length,
    lateCount: days.filter((d) => d.lateMin > 0).length,
    lateMin: days.reduce((a, d) => a + d.lateMin, 0),
    earlyMin: days.reduce((a, d) => a + d.earlyMin, 0),
    workedMin: days.reduce((a, d) => a + d.workedMin, 0),
    overtimeMin: days.reduce((a, d) => a + d.overtimeMin, 0),
    nightOvertimeMin: days.reduce((a, d) => a + d.nightOvertimeMin, 0),
    restDayMin: days.reduce((a, d) => a + d.restDayMin, 0),
    lateDeductionDays: days.filter((d) => d.status !== "absent").reduce((a, d) => a + d.deductionDays, 0),
    missingOut: days.filter((d) => d.status === "missing_out").length,
    extraDays: days.filter((d) => d.scheduledMin === 0 && d.restDayMin > 0).length,
    score: 100,
  };
  if (sched.length) {
    const pts = sched.reduce((a, d) => a + (d.status === "absent" ? 0 : d.lateMin > 0 || d.earlyMin > 30 ? 0.5 : 1), 0);
    s.score = Math.round((pts / sched.length) * 100);
  }
  return s;
}

/** Group punches by person and business day. */
export function punchesByDay<P extends Pick<AttendancePunch, "at" | "membershipId" | "voided">>(punches: P[], tz: string): Map<string, P[]> {
  const m = new Map<string, P[]>();
  for (const p of punches) {
    if (!p.membershipId || p.voided) continue;
    const k = `${p.membershipId}|${businessDate(Date.parse(p.at), tz)}`;
    const arr = m.get(k);
    if (arr) arr.push(p);
    else m.set(k, [p]);
  }
  return m;
}

/** Who is clocked in right now (last valid punch is "in" or a break), with since-when. */
export function presence<P extends Pick<AttendancePunch, "at" | "membershipId" | "kind" | "voided">>(punches: P[], now: number, maxHours = 16): Map<string, { state: "in" | "break"; since: string }> {
  const lastBy = new Map<string, P>();
  for (const p of punches) {
    if (!p.membershipId || p.voided) continue;
    const t = Date.parse(p.at);
    if (t > now || now - t > maxHours * 3_600_000) continue;
    const cur = lastBy.get(p.membershipId);
    if (!cur || Date.parse(cur.at) < t) lastBy.set(p.membershipId, p);
  }
  const out = new Map<string, { state: "in" | "break"; since: string }>();
  for (const [id, p] of lastBy) {
    if (p.kind === "in" || p.kind === "break_end") out.set(id, { state: "in", since: p.at });
    else if (p.kind === "break_start") out.set(id, { state: "break", since: p.at });
  }
  return out;
}

/** What the clock-in button should do next for a person. */
export function nextPunch(state: "in" | "break" | undefined): "in" | "out" {
  return state ? "out" : "in";
}

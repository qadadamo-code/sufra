/**
 * HR operations on the Repo (Db): staff files, rota, punches & corrections, leave, advances, payroll runs, devices.
 * Rules come from ./lib (pure, tested). Every sensitive change writes audit_log; money posts through the accounting API
 * (`postJournal` → ledgerEntries, append-only).
 */
import type { Db } from "@/data/hooks";
import type {
  Advance, AttendancePunch, LeaveRequest, LeaveType, Membership, PayMethod, PayrollRun, Payslip, PunchKind, PunchSource, Role, RotaShift, Settings, Shift,
  StaffCompensation, StaffProfile,
} from "@/data/types";
import type { Insertable, Patch } from "@/data/repo";
import { nowIso } from "@/lib/time";
import { sha256 } from "@/lib/sha256";
import { uuid } from "@/lib/id";
import { roundMinor, type Units } from "@/lib/money";
import { ACC, SOURCE, postJournal } from "@/modules/accounting/api";
import { hrSettings, payDate, type HrSettings } from "./lib/settings";
import { checkGeofence } from "./lib/geo";
import { evaluateDay, punchesByDay, summarize, type DayEval, type PeriodSummary } from "./lib/attendance";
import { addDays, businessDate, dateRange, periodBounds, weekday } from "./lib/tz";
import { leaveDays } from "./lib/leave";
import { dueInPeriod, installmentSchedule } from "./lib/advances";
import { computePayslip, computePools, effectiveComp, payrollJournalLines, payoutAccount, runTotals, type PayslipDraft } from "./lib/payroll";
import { attlogExternalId, attlogInstant, resolveAutoKinds, type CsvPunch } from "./lib/zkteco";

export class HrError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

export const tzOf = (s: Settings | null | undefined) => s?.locale?.timezone || "Africa/Cairo";
export async function loadHr(db: Db): Promise<{ settings: Settings | null; rules: HrSettings; tz: string }> {
  const [settings] = await db.list("settings");
  return { settings: settings ?? null, rules: hrSettings(settings), tz: tzOf(settings) };
}

/* ───────── staff file ───────── */

export function blankProfile(membershipId: string, today: string): Omit<StaffProfile, "id" | "restaurantId" | "createdAt" | "updatedAt"> {
  return {
    membershipId, photoUrl: null, nationalId: null, nationality: "EG", birthDate: null, hireDate: today, contractType: "permanent", contractEnd: null,
    position: { ar: "", en: "" }, station: null, foodHandler: false, emergencyContact: null, address: null, documents: [], deviceUserId: null, weeklyOff: [5],
    terminatedAt: null, terminationReason: null, notes: "",
  };
}

export async function profileOf(db: Db, membershipId: string): Promise<StaffProfile | null> {
  return (await db.list("staffProfiles", { where: { membershipId } }))[0] ?? null;
}

export async function saveProfile(db: Db, membershipId: string, patch: Patch<StaffProfile>): Promise<StaffProfile> {
  const cur = await profileOf(db, membershipId);
  if (cur) return db.update("staffProfiles", cur.id, patch);
  return db.insert("staffProfiles", { ...blankProfile(membershipId, nowIso().slice(0, 10)), ...patch } as Omit<Insertable<StaffProfile>, "restaurantId">);
}

export async function saveCompensation(db: Db, membershipId: string, patch: Partial<Omit<StaffCompensation, "id" | "restaurantId" | "createdAt" | "updatedAt" | "membershipId">>) {
  const [cur] = await db.list("staffCompensation", { where: { membershipId } });
  const row = cur ? await db.update("staffCompensation", cur.id, patch) : await db.insert("staffCompensation", { membershipId, monthlySalary: 0, hourlyRate: 0, ...patch });
  await db.audit("staff.compensation", "staffCompensation", row.id, { membershipId, fields: Object.keys(patch) });
  return row;
}

export interface NewStaff {
  name: string;
  role: Role;
  phone: string;
  email: string | null;
  branchIds: string[];
  pin: string | null;
  color: string;
  profile: Partial<StaffProfile>;
  comp: Partial<StaffCompensation> | null;
}

/**
 * Adds a person: membership (+ PIN for shared devices), staff file, compensation. With an email the person can also sign in on
 * their own phone — in cloud mode the owner sends the invite from Supabase Auth (the membership links to the user on first login).
 */
export async function createStaff(db: Db, x: NewStaff): Promise<Membership> {
  if (!x.name.trim()) throw new HrError("name");
  if (x.pin && !/^\d{4,6}$/.test(x.pin)) throw new HrError("pin");
  const m = await db.insert("memberships", {
    userId: null, name: x.name.trim(), role: x.role, branchIds: x.branchIds, phone: x.phone.trim() || null, email: x.email?.trim().toLowerCase() || null, color: x.color,
    hasPin: !!x.pin, active: true, lastSeenAt: null,
  });
  if (x.pin) await db.repo.auth.setPin(db.restaurantId, m.id, x.pin);
  await saveProfile(db, m.id, x.profile);
  if (x.comp) await saveCompensation(db, m.id, x.comp);
  await db.audit("staff.create", "memberships", m.id, { role: x.role, email: !!x.email, pin: !!x.pin });
  return m;
}

export async function setStaffActive(db: Db, m: Membership, active: boolean, reason = "") {
  await db.update("memberships", m.id, { active });
  await saveProfile(db, m.id, active ? { terminatedAt: null, terminationReason: null } : { terminatedAt: nowIso().slice(0, 10), terminationReason: reason || null });
  await db.audit(active ? "staff.reactivate" : "staff.deactivate", "memberships", m.id, { reason });
}

export async function changeRole(db: Db, m: Membership, role: Role, branchIds: string[]) {
  await db.update("memberships", m.id, { role, branchIds });
  await db.audit("staff.role", "memberships", m.id, { from: m.role, to: role, branchIds });
}

/** Document alerts: missing mandatory health certificate (food handlers) and anything expiring within `days`. */
export function documentAlerts(p: StaffProfile | null | undefined, today: string, days = 30): { kind: string; state: "missing" | "expired" | "soon"; expiresAt: string | null }[] {
  if (!p) return [];
  const out: { kind: string; state: "missing" | "expired" | "soon"; expiresAt: string | null }[] = [];
  if (p.foodHandler && !p.documents.some((d) => d.kind === "health_certificate")) out.push({ kind: "health_certificate", state: "missing", expiresAt: null });
  const soon = addDays(today, days);
  for (const d of p.documents) {
    if (!d.expiresAt) continue;
    if (d.expiresAt < today) out.push({ kind: d.kind, state: "expired", expiresAt: d.expiresAt });
    else if (d.expiresAt <= soon) out.push({ kind: d.kind, state: "soon", expiresAt: d.expiresAt });
  }
  return out;
}

/* ───────── rota ───────── */

export async function saveShift(db: Db, s: Partial<RotaShift> & { id?: string }): Promise<RotaShift> {
  if (s.id) {
    const { id, ...patch } = s;
    return db.update("rotaShifts", id, { ...patch, published: false, publishedAt: null });
  }
  const branchId = s.branchId ?? db.branchId;
  if (!branchId) throw new HrError("branch");
  return db.insert("rotaShifts", {
    branchId, membershipId: s.membershipId ?? null, date: s.date!, start: s.start ?? "16:00", end: s.end ?? "00:00", breakMin: s.breakMin ?? 30, station: s.station ?? null,
    templateId: s.templateId ?? null, published: false, publishedAt: null, note: s.note ?? "",
  });
}

/** Drag-and-drop: move (or copy with alt) a shift to another person/day. */
export async function moveShift(db: Db, shift: RotaShift, to: { membershipId: string | null; date: string }, copy = false) {
  if (copy) return saveShift(db, { ...shift, id: undefined, membershipId: to.membershipId, date: to.date });
  return saveShift(db, { id: shift.id, membershipId: to.membershipId, date: to.date });
}

export async function publishWeek(db: Db, branchId: string, from: string, to: string): Promise<number> {
  const shifts = await db.list("rotaShifts", { where: { branchId, published: false }, gte: { date: from }, lte: { date: to } });
  const t = nowIso();
  for (const s of shifts) await db.update("rotaShifts", s.id, { published: true, publishedAt: t });
  await db.audit("rota.publish", "rotaShifts", null, { branchId, from, to, count: shifts.length });
  return shifts.length;
}

/** Copies last week's shifts into this week (unpublished), skipping people/days that already have a shift. */
export async function copyWeek(db: Db, branchId: string, fromWeekStart: string, toWeekStart: string): Promise<number> {
  const src = await db.list("rotaShifts", { where: { branchId }, gte: { date: fromWeekStart }, lte: { date: addDays(fromWeekStart, 6) } });
  const existing = await db.list("rotaShifts", { where: { branchId }, gte: { date: toWeekStart }, lte: { date: addDays(toWeekStart, 6) } });
  const taken = new Set(existing.map((s) => `${s.membershipId}|${s.date}|${s.start}`));
  let n = 0;
  const shift = (d: string) => addDays(toWeekStart, Math.round((Date.parse(d) - Date.parse(fromWeekStart)) / 86_400_000));
  for (const s of src) {
    const date = shift(s.date);
    if (taken.has(`${s.membershipId}|${date}|${s.start}`)) continue;
    await saveShift(db, { branchId, membershipId: s.membershipId, date, start: s.start, end: s.end, breakMin: s.breakMin, station: s.station, templateId: s.templateId, note: s.note });
    n++;
  }
  return n;
}

export async function requestSwap(db: Db, shift: RotaShift, toId: string | null, reason: string) {
  if (!db.actorId || shift.membershipId !== db.actorId) throw new HrError("not_your_shift");
  const s = await db.insert("shiftSwaps", { shiftId: shift.id, fromId: db.actorId, toId, reason: reason.trim(), status: "pending", decidedBy: null, decidedAt: null });
  await db.audit("rota.swap.request", "shiftSwaps", s.id, { shiftId: shift.id, toId });
  return s;
}

export async function decideSwap(db: Db, swapId: string, approve: boolean, takerId?: string | null) {
  const sw = await db.get("shiftSwaps", swapId);
  if (!sw || sw.status !== "pending") throw new HrError("swap_state");
  const taker = takerId ?? sw.toId;
  if (approve) {
    if (!taker) throw new HrError("swap_taker");
    const shift = await db.get("rotaShifts", sw.shiftId);
    if (!shift) throw new HrError("swap_shift");
    await db.update("rotaShifts", shift.id, { membershipId: taker }); // stays published: the change is approved
  }
  await db.update("shiftSwaps", sw.id, { status: approve ? "approved" : "rejected", toId: taker ?? null, decidedBy: db.actorId, decidedAt: nowIso() });
  await db.audit(approve ? "rota.swap.approve" : "rota.swap.reject", "shiftSwaps", sw.id, { taker });
}

/* ───────── punches ───────── */

export interface PunchInput {
  membershipId: string;
  kind: PunchKind;
  source: PunchSource;
  branchId?: string | null;
  fix?: { lat: number; lng: number; accuracyM: number | null } | null;
  photoUrl?: string | null;
  note?: string;
}

/** Records a punch. Mobile check-ins must be inside the branch geofence (when the branch has one). */
export async function punch(db: Db, x: PunchInput): Promise<AttendancePunch> {
  const { rules } = await loadHr(db);
  const branchId = x.branchId ?? db.branchId ?? null;
  let distance: number | null = null;
  if (x.source === "mobile") {
    if (!rules.mobileCheckIn) throw new HrError("mobile_off");
    const fence = branchId ? rules.geofences[branchId] : undefined;
    if (fence) {
      if (!x.fix) throw new HrError("no_location");
      const g = checkGeofence(x.fix, fence);
      distance = g.distanceM;
      if (!g.inside) throw new HrError("outside", String(g.distanceM));
    }
  }
  const p = await db.insert("attendancePunches", {
    branchId, membershipId: x.membershipId, at: nowIso(), kind: x.kind, source: x.source, lat: x.fix?.lat ?? null, lng: x.fix?.lng ?? null, accuracyM: x.fix?.accuracyM ?? null,
    distanceM: distance, photoUrl: x.photoUrl ?? null, deviceSn: null, deviceUserId: null, externalId: null, voided: false, correctedBy: null, note: x.note ?? "",
  });
  return p;
}

/** Manager correction: add a punch at a given time (e.g. forgot to clock out). Audited with the reason. */
export async function addManualPunch(db: Db, x: { membershipId: string; at: string; kind: PunchKind; reason: string; branchId?: string | null }) {
  if (!x.reason.trim()) throw new HrError("reason");
  const p = await db.insert("attendancePunches", {
    branchId: x.branchId ?? db.branchId, membershipId: x.membershipId, at: x.at, kind: x.kind, source: "manual", lat: null, lng: null, accuracyM: null, distanceM: null, photoUrl: null,
    deviceSn: null, deviceUserId: null, externalId: null, voided: false, correctedBy: db.actorId, note: x.reason.trim(),
  });
  await db.audit("attendance.correct.add", "attendancePunches", p.id, { membershipId: x.membershipId, at: x.at, kind: x.kind, reason: x.reason.trim() });
  return p;
}

/** Voids (never deletes) a punch — the original stays for the audit trail. */
export async function voidPunch(db: Db, p: AttendancePunch, reason: string) {
  if (!reason.trim()) throw new HrError("reason");
  await db.update("attendancePunches", p.id, { voided: true, correctedBy: db.actorId, note: `${p.note ? p.note + " · " : ""}${reason.trim()}` });
  await db.audit("attendance.correct.void", "attendancePunches", p.id, { membershipId: p.membershipId, at: p.at, kind: p.kind, reason: reason.trim() });
}

/** Moves a punch's time (void + re-add, so both versions are kept). */
export async function editPunchTime(db: Db, p: AttendancePunch, at: string, reason: string) {
  await voidPunch(db, p, reason);
  return addManualPunch(db, { membershipId: p.membershipId!, at, kind: p.kind, reason, branchId: p.branchId });
}

/** CSV / device import. Idempotent per externalId; unknown device users are kept (membershipId null) to map later. */
export async function importPunches(db: Db, rows: CsvPunch[], opts: { serial: string; source: "csv" | "device"; branchId: string | null; tz: string; map: Record<string, string> }): Promise<{ added: number; duplicates: number; unmapped: number }> {
  const resolved = resolveAutoKinds(rows);
  const existing = new Set((await db.list("attendancePunches", { where: { source: opts.source } })).map((p) => p.externalId).filter(Boolean) as string[]);
  let added = 0;
  let duplicates = 0;
  let unmapped = 0;
  for (const r of resolved) {
    const status = r.kind === "in" ? 0 : r.kind === "out" ? 1 : r.kind === "break_start" ? 2 : 3;
    const ext = attlogExternalId(opts.serial, { userId: r.userId, local: r.local, status, verify: 0, workcode: "0" });
    if (existing.has(ext)) {
      duplicates++;
      continue;
    }
    existing.add(ext);
    const mid = opts.map[r.userId] ?? null;
    if (!mid) unmapped++;
    await db.insert("attendancePunches", {
      branchId: opts.branchId, membershipId: mid, at: attlogInstant({ userId: r.userId, local: r.local, status, verify: 0, workcode: "0" }, opts.tz), kind: r.kind, source: opts.source,
      lat: null, lng: null, accuracyM: null, distanceM: null, photoUrl: null, deviceSn: opts.serial, deviceUserId: r.userId, externalId: ext, voided: false, correctedBy: null, note: r.name ?? "",
    });
    added++;
  }
  await db.audit("attendance.import", "attendancePunches", null, { source: opts.source, serial: opts.serial, added, duplicates, unmapped });
  return { added, duplicates, unmapped };
}

/** Registers a terminal; returns the secret ONCE (only its sha256 is stored). */
export async function registerDevice(db: Db, x: { branchId: string; name: string; serial: string; model: string; timezone: string; allowedIps: string[] }): Promise<{ id: string; secret: string }> {
  const serial = x.serial.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{4,40}$/.test(serial)) throw new HrError("serial");
  if ((await db.list("attendanceDevices", { where: { serial } })).length) throw new HrError("serial_taken");
  const secret = uuid().replace(/-/g, "").slice(0, 24);
  const d = await db.insert("attendanceDevices", { branchId: x.branchId, name: x.name.trim() || serial, serial, model: x.model, secretHash: sha256(secret), timezone: x.timezone, active: true, lastSeenAt: null, lastStamp: null, allowedIps: x.allowedIps });
  await db.audit("attendance.device.add", "attendanceDevices", d.id, { serial });
  return { id: d.id, secret };
}

export async function rotateDeviceSecret(db: Db, deviceId: string): Promise<string> {
  const secret = uuid().replace(/-/g, "").slice(0, 24);
  await db.update("attendanceDevices", deviceId, { secretHash: sha256(secret) });
  await db.audit("attendance.device.rotate", "attendanceDevices", deviceId, {});
  return secret;
}

/* ───────── attendance evaluation (board, reports, payroll) ───────── */

export interface AttendanceData {
  shifts: Pick<RotaShift, "membershipId" | "date" | "start" | "end" | "breakMin" | "published">[];
  punches: Pick<AttendancePunch, "membershipId" | "at" | "kind" | "voided">[];
  leaves: Pick<LeaveRequest, "membershipId" | "type" | "from" | "to" | "status">[];
}

/** Evaluate every day of [from, to] for one person. Only published shifts count against people. */
export function evaluateRange(memberId: string, from: string, to: string, data: AttendanceData, rules: HrSettings, tz: string, now = Date.now()): DayEval[] {
  const byDay = punchesByDay(data.punches.filter((p) => p.membershipId === memberId) as AttendancePunch[], tz);
  const today = businessDate(now, tz);
  return dateRange(from, to > today ? today : to).map((date) => {
    const shifts = data.shifts.filter((s) => s.membershipId === memberId && s.date === date && s.published);
    const lv = data.leaves.find((l) => l.membershipId === memberId && l.status === "approved" && l.from <= date && l.to >= date);
    return evaluateDay({ date, shifts, punches: byDay.get(`${memberId}|${date}`) ?? [], leave: lv?.type ?? null, now, tz, rules });
  });
}

export async function loadAttendance(db: Db, from: string, to: string): Promise<AttendanceData> {
  const [shifts, punches, leaves] = await Promise.all([
    db.list("rotaShifts", { gte: { date: from }, lte: { date: to } }),
    db.list("attendancePunches", { gte: { at: new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString() }, lte: { at: new Date(Date.parse(`${to}T00:00:00Z`) + 2 * 86_400_000).toISOString() } }),
    db.list("leaveRequests", { where: { status: "approved" } }),
  ]);
  return { shifts, punches, leaves };
}

/* ───────── leave ───────── */

export async function requestLeave(db: Db, x: { membershipId: string; type: LeaveType; from: string; to: string; reason: string }) {
  if (x.to < x.from) throw new HrError("dates");
  const prof = await profileOf(db, x.membershipId);
  const days = leaveDays(x.from, x.to, prof?.weeklyOff ?? []);
  if (days <= 0) throw new HrError("days");
  const r = await db.insert("leaveRequests", { membershipId: x.membershipId, type: x.type, from: x.from, to: x.to, days, reason: x.reason.trim(), status: "pending", decidedBy: null, decidedAt: null, decisionNote: "" });
  await db.audit("leave.request", "leaveRequests", r.id, { type: x.type, from: x.from, to: x.to, days });
  return r;
}

export async function decideLeave(db: Db, r: LeaveRequest, approve: boolean, note = "") {
  if (r.status !== "pending") throw new HrError("leave_state");
  await db.update("leaveRequests", r.id, { status: approve ? "approved" : "rejected", decidedBy: db.actorId, decidedAt: nowIso(), decisionNote: note.trim() });
  await db.audit(approve ? "leave.approve" : "leave.reject", "leaveRequests", r.id, { type: r.type, days: r.days, note });
}

export async function cancelLeave(db: Db, r: LeaveRequest) {
  await db.update("leaveRequests", r.id, { status: "cancelled" });
  await db.audit("leave.cancel", "leaveRequests", r.id, {});
}

/** Approved leave days taken in a year, by type. */
export function takenByType(reqs: LeaveRequest[], membershipId: string, year: number, status: LeaveRequest["status"][] = ["approved"]) {
  const out: Partial<Record<LeaveType, number>> = {};
  for (const r of reqs) if (r.membershipId === membershipId && status.includes(r.status) && r.from.startsWith(String(year))) out[r.type] = (out[r.type] ?? 0) + r.days;
  return out;
}

/* ───────── advances ───────── */

export async function requestAdvance(db: Db, x: { membershipId: string; amount: Units; installments: number; startPeriod: string; reason: string; kind?: "advance" | "loan" }) {
  if (x.amount <= 0) throw new HrError("amount");
  const a = await db.insert("advances", {
    membershipId: x.membershipId, branchId: db.branchId, kind: x.kind ?? "advance", amount: roundMinor(x.amount), installments: Math.max(1, Math.floor(x.installments)), startPeriod: x.startPeriod,
    reason: x.reason.trim(), status: "requested", requestedAt: nowIso(), approvedBy: null, approvedAt: null, paidVia: null, paidAt: null, paidBy: null, cashMovementId: null, recovered: 0,
  });
  await db.audit("advance.request", "advances", a.id, { amount: a.amount, installments: a.installments });
  return a;
}

export async function decideAdvance(db: Db, a: Advance, approve: boolean, edits: { installments?: number; startPeriod?: string } = {}) {
  if (a.status !== "requested") throw new HrError("advance_state");
  await db.update("advances", a.id, { status: approve ? "approved" : "rejected", approvedBy: db.actorId, approvedAt: nowIso(), ...edits });
  await db.audit(approve ? "advance.approve" : "advance.reject", "advances", a.id, { amount: a.amount, ...edits });
}

/**
 * Pays an approved advance. Cash comes out of an open POS drawer (a cash movement on that shift, so the Z report expects it)
 * and posts Dr 1202 staff advances / Cr 1101 cash; bank/wallet posts Cr 1105 bank.
 */
export async function payAdvance(db: Db, a: Advance, via: "cash" | "bank" | "wallet", shift: Shift | null) {
  if (a.status !== "approved") throw new HrError("advance_state");
  let cashMovementId: string | null = null;
  const member = await db.get("memberships", a.membershipId);
  const reason = `سلفة ${member?.name ?? ""} / staff advance`.trim();
  if (via === "cash") {
    if (!shift || shift.status !== "open") throw new HrError("no_shift");
    const m = await db.insert("cashMovements", { branchId: shift.branchId, shiftId: shift.id, kind: "out", amount: a.amount, reason, actorId: db.actorId, approvedBy: a.approvedBy });
    cashMovementId = m.id;
  }
  const branchId = shift?.branchId ?? a.branchId ?? db.branchId;
  await postJournal(db, {
    branchId, sourceType: SOURCE.staffAdvance, sourceId: a.id, memo: reason,
    lines: [
      { account: ACC.staffAdvances, debit: a.amount, credit: 0, dims: { staff: a.membershipId } },
      { account: via === "cash" ? ACC.cash : ACC.bank, debit: 0, credit: a.amount, ...(via === "cash" && shift ? { dims: { drawer: shift.device } } : {}) },
    ],
  });
  await db.update("advances", a.id, { status: "paid", paidVia: via, paidAt: nowIso(), paidBy: db.actorId, cashMovementId });
  await db.audit("advance.pay", "advances", a.id, { via, amount: a.amount, cashMovementId });
}

export const advanceSchedule = (a: Advance) => installmentSchedule(a.amount, a.installments, a.startPeriod);

/* ───────── payroll ───────── */

export interface RunDraft {
  period: string;
  branchId: string | null;
  slips: (PayslipDraft & { summary: PeriodSummary })[];
  totals: ReturnType<typeof runTotals>;
  pools: { tips: Units; service: Units; serviceCollected: Units };
  journal: { account: string; debit: Units; credit: Units }[];
}

/** People on payroll: active, with a salary (owner without one is skipped), in the branch. */
export function onPayroll(m: Membership, comp: StaffCompensation | undefined, branchId: string | null) {
  if (!m.active || m.role === "platform_admin") return false;
  if (!comp || (comp.monthlySalary <= 0 && !(comp.dailyRate ?? 0) && comp.hourlyRate <= 0)) return false;
  return !branchId || !m.branchIds.length || m.branchIds.includes(branchId);
}

/** Computes (does not save) a payroll for `period`. */
export async function buildRun(db: Db, period: string, branchId: string | null, now = Date.now()): Promise<RunDraft> {
  const { rules, tz } = await loadHr(db);
  const { from, to } = periodBounds(period);
  const [members, comps, profiles, adjustments, advances, payments, checks] = await Promise.all([
    db.list("memberships"),
    db.list("staffCompensation"),
    db.list("staffProfiles"),
    db.list("payrollAdjustments", { where: { period } }),
    db.list("advances", { where: { status: "paid" } }),
    db.list("payments", { where: { status: "captured", ...(branchId ? { branchId } : {}) }, gte: { createdAt: `${from}T00:00:00` }, lte: { createdAt: `${addDays(to, 1)}T05:00:00` } }),
    db.list("checks", { where: { status: "paid", ...(branchId ? { branchId } : {}) }, gte: { createdAt: `${from}T00:00:00` }, lte: { createdAt: `${addDays(to, 1)}T05:00:00` } }),
  ]);
  const data = await loadAttendance(db, from, to);
  const allLeave = await db.list("leaveRequests", { where: { status: "approved" } });
  const compBy = new Map(comps.map((c) => [c.membershipId, c]));
  const profBy = new Map(profiles.map((p) => [p.membershipId, p]));
  const people = members.filter((m) => onPayroll(m, compBy.get(m.id), branchId));
  const evals = new Map(people.map((m) => [m.id, evaluateRange(m.id, from, to, data, rules, tz, now)]));
  const sums = new Map([...evals].map(([id, d]) => [id, summarize(d)]));

  const tipsTotal = payments.reduce((a, p) => a + (p.tip || 0), 0);
  const serviceCollected = checks.reduce((a, c) => a + (c.service || 0), 0);
  const pools = computePools(
    rules,
    people.map((m) => {
      const c = effectiveComp(compBy.get(m.id), rules);
      return { id: m.id, hours: (sums.get(m.id)?.workedMin ?? 0) / 60, points: c.servicePoints, tipsEligible: c.tipsEligible, tipsTaken: payments.filter((p) => p.takenBy === m.id).reduce((a, p) => a + p.tip, 0) };
    }),
    tipsTotal,
    serviceCollected,
  );

  const slips = people.map((m) => {
    const prof = profBy.get(m.id);
    const unpaid = allLeave.filter((l) => l.membershipId === m.id && l.type === "unpaid").reduce((a, l) => a + dateRange(l.from > from ? l.from : from, l.to < to ? l.to : to).filter((d) => !(prof?.weeklyOff ?? []).includes(weekday(d))).length, 0);
    const due = advances.filter((a) => a.membershipId === m.id).reduce((x, a) => x + dueInPeriod(a, period), 0);
    const summary = sums.get(m.id)!;
    const draft = computePayslip(
      {
        membershipId: m.id, name: m.name, position: prof?.position?.ar || m.role, branchId: branchId ?? m.branchIds[0] ?? db.branchId, nationality: prof?.nationality ?? "EG",
        hireDate: prof?.hireDate ?? from, comp: compBy.get(m.id) ?? null, summary, unpaidLeaveDays: unpaid, tips: pools.tips[m.id] ?? 0, service: pools.service[m.id] ?? 0,
        adjustments: adjustments.filter((a) => a.membershipId === m.id), advanceDue: due, periodStart: from,
      },
      rules,
    );
    return { ...draft, summary };
  });
  return { period, branchId, slips, totals: runTotals(slips), pools: { tips: pools.tipsPool, service: pools.servicePool, serviceCollected }, journal: payrollJournalLines(slips) };
}

/** Saves a draft run (replacing an existing draft for the same period/branch). */
export async function saveRun(db: Db, d: RunDraft): Promise<PayrollRun> {
  const { rules } = await loadHr(db);
  const existing = (await db.list("payrollRuns", { where: { period: d.period } })).find((r) => r.branchId === d.branchId);
  if (existing && existing.status !== "draft") throw new HrError("run_locked");
  let run: PayrollRun;
  const fields = { totals: d.totals, snapshot: { pools: d.pools, rules: { country: rules.country, insuranceEG: rules.insuranceEG, taxEG: { ...rules.taxEG }, servicePool: rules.servicePool, tipsPool: rules.tipsPool } }, country: rules.country };
  if (existing) {
    run = await db.update("payrollRuns", existing.id, fields);
    for (const s of await db.list("payslips", { where: { runId: existing.id } })) await db.remove("payslips", s.id);
  } else {
    run = await db.insert("payrollRuns", { branchId: d.branchId, period: d.period, status: "draft", createdBy: db.actorId, approvedBy: null, approvedAt: null, paidAt: null, paidBy: null, ledgerEntryIds: [], note: "", ...fields });
  }
  for (const s of d.slips) {
    await db.insert("payslips", {
      runId: run.id, membershipId: s.membershipId, branchId: s.branchId, period: d.period, name: s.name, position: s.position, earnings: s.earnings, deductions: s.deductions, employer: s.employer,
      gross: s.gross, totalDeductions: s.totalDeductions, net: s.net, insurableWage: s.insurableWage, employeeInsurance: s.employeeInsurance, employerInsurance: s.employerInsurance,
      incomeTax: s.incomeTax, advanceRecovered: s.advanceRecovered, workedDays: s.workedDays, absentDays: s.absentDays, lateMinutes: s.lateMinutes, overtimeMinutes: s.overtimeMinutes,
      payMethod: s.payMethod, status: "draft", paidAt: null,
    });
  }
  await db.audit("payroll.draft", "payrollRuns", run.id, { period: d.period, net: d.totals.net, headcount: d.totals.headcount });
  return run;
}

/** Rebuilds the journal from stored payslips (so approval posts exactly what was reviewed). */
export function slipsToDrafts(slips: Payslip[]): PayslipDraft[] {
  const sumCodes = (s: Payslip, codes: string[]) => [...s.earnings, ...s.deductions].filter((l) => codes.includes(l.code)).reduce((a, l) => a + l.amount, 0);
  return slips.map((s) => ({
    ...s, preDeductions: sumCodes(s, ["absence", "unpaid_leave", "lateness", "penalty", "deduction"]), bonuses: sumCodes(s, ["bonus", "allowance"]),
    tips: sumCodes(s, ["tips"]), service: sumCodes(s, ["service"]), eosb: s.employer.filter((l) => l.code === "eosb").reduce((a, l) => a + l.amount, 0),
  }));
}

/** Approve: locks the run, posts the accrual journal, books advance recoveries. Owner/admin/accountant (staff.payroll). */
export async function approveRun(db: Db, run: PayrollRun): Promise<PayrollRun> {
  if (run.status !== "draft") throw new HrError("run_state");
  const slips = await db.list("payslips", { where: { runId: run.id } });
  const drafts = slipsToDrafts(slips);
  const { rules } = await loadHr(db);
  const lines = payrollJournalLines(drafts);
  const date = payDate(run.period, rules.payDay);
  const je = await postJournal(db, { date, branchId: run.branchId, sourceType: SOURCE.payroll, sourceId: run.id, memo: `Payroll ${run.period} · الرواتب`, lines });
  // advance recoveries, oldest first
  const advances = (await db.list("advances", { where: { status: "paid" } })).sort((a, b) => (a.startPeriod < b.startPeriod ? -1 : 1));
  for (const s of slips) {
    let left = s.advanceRecovered;
    for (const a of advances.filter((x) => x.membershipId === s.membershipId)) {
      if (left <= 0) break;
      const take = Math.min(left, a.amount - a.recovered);
      if (take <= 0) continue;
      left -= take;
      await db.update("advances", a.id, { recovered: a.recovered + take, status: a.recovered + take >= a.amount ? "settled" : "paid" });
    }
    await db.update("payslips", s.id, { status: "approved" });
  }
  const next = await db.update("payrollRuns", run.id, { status: "approved", approvedBy: db.actorId, approvedAt: nowIso(), ledgerEntryIds: [...run.ledgerEntryIds, je.id], totals: runTotals(drafts) });
  await db.audit("payroll.approve", "payrollRuns", run.id, { period: run.period, net: next.totals.net, entry: je.id });
  return next;
}

/** Mark paid: posts Dr 2401 salaries payable / Cr cash or bank per pay method. */
export async function markRunPaid(db: Db, run: PayrollRun, method: PayMethod | "by_person"): Promise<PayrollRun> {
  if (run.status !== "approved") throw new HrError("run_state");
  const slips = await db.list("payslips", { where: { runId: run.id } });
  const byAccount = new Map<string, Units>();
  for (const s of slips) {
    const m = method === "by_person" ? s.payMethod : method;
    const acc = payoutAccount(m);
    byAccount.set(acc, (byAccount.get(acc) ?? 0) + s.net);
  }
  const total = slips.reduce((a, s) => a + s.net, 0);
  const lines = [{ account: ACC.salariesPayable, debit: total, credit: 0 }, ...[...byAccount].filter(([, v]) => v > 0).map(([account, v]) => ({ account, debit: 0, credit: v }))];
  const ids = [...run.ledgerEntryIds];
  if (total > 0) {
    const je = await postJournal(db, { branchId: run.branchId, sourceType: SOURCE.payrollPayment, sourceId: run.id, memo: `Salaries paid ${run.period} · صرف الرواتب`, lines });
    ids.push(je.id);
  }
  const t = nowIso();
  for (const s of slips) await db.update("payslips", s.id, { status: "paid", paidAt: t, payMethod: method === "by_person" ? s.payMethod : method });
  const next = await db.update("payrollRuns", run.id, { status: "paid", paidAt: t, paidBy: db.actorId, ledgerEntryIds: ids });
  await db.audit("payroll.paid", "payrollRuns", run.id, { method, total });
  return next;
}

/** Generic bank transfer file (one row per person paid by bank/wallet). KSA: banks convert this into the WPS/Mudad SIF file. */
export function bankCsv(slips: Payslip[], comps: StaffCompensation[], profiles: StaffProfile[], period: string, country: "EG" | "SA"): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = country === "SA" ? ["employee_id", "name", "iqama_or_national_id", "bank", "iban", "basic", "housing", "other_earnings", "deductions", "net", "currency", "period"] : ["employee_id", "name", "national_id", "bank", "account_or_iban", "wallet", "net", "currency", "period"];
  const rows = [head.join(",")];
  for (const s of slips) {
    const c = comps.find((x) => x.membershipId === s.membershipId);
    const p = profiles.find((x) => x.membershipId === s.membershipId);
    const method = c?.payMethod ?? s.payMethod;
    if (method !== "bank" && method !== "wallet" && method !== "instapay") continue;
    const money = (u: Units) => (u / 100_000).toFixed(2);
    if (country === "SA") {
      const basic = s.earnings.find((l) => l.code === "basic")?.amount ?? 0;
      const housing = s.earnings.find((l) => l.code === "housing")?.amount ?? 0;
      rows.push([s.membershipId.slice(0, 8), s.name, p?.nationalId ?? "", c?.bankName ?? "", c?.iban ?? "", money(basic), money(housing), money(s.gross - basic - housing), money(s.totalDeductions), money(s.net), "SAR", period].map(esc).join(","));
    } else rows.push([s.membershipId.slice(0, 8), s.name, p?.nationalId ?? "", c?.bankName ?? "", c?.iban ?? "", c?.walletNumber ?? "", money(s.net), "EGP", period].map(esc).join(","));
  }
  return rows.join("\r\n") + "\r\n";
}

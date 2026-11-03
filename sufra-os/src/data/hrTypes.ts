/**
 * HR, scheduling, attendance, leave, advances & payroll (Wave 3). Postgres: supabase/migrations/0010_hr.sql.
 * Rules live in src/modules/hr/lib (pure, tested); screens in src/modules/staff (managers) and src/modules/hr (/me, /timeclock).
 *
 * Visibility (RLS mirrors this):
 *  - staffProfiles, rotaShifts, shiftTemplates, attendancePunches, leaveRequests, leaveBalances, shiftSwaps: managers+ see all,
 *    every member sees their own rows.
 *  - staffCompensation (salary, bank), payrollRuns, payslips, payrollAdjustments: owner/admin/accountant only (+ own payslips).
 *  - advances: managers+ (requests/approval) and the employee (own).
 *  - attendanceDevices: owner/admin/manager; the device secret is only ever stored hashed (sha256).
 * Money is Units (0.00001 EGP/SAR); dates are YYYY-MM-DD business days; times "HH:MM" local to the restaurant.
 */
import type { Units } from "@/lib/money";

export type ContractType = "permanent" | "fixed_term" | "part_time" | "probation" | "daily";
export type SalaryType = "monthly" | "daily" | "hourly";
export type PayMethod = "cash" | "bank" | "wallet" | "instapay";
export type StaffDocKind = "national_id" | "health_certificate" | "contract" | "criminal_record" | "military_status" | "iqama" | "passport" | "work_permit" | "other";

export interface StaffDocument {
  id: string;
  kind: StaffDocKind;
  number: string;
  issuedAt: string | null;
  /** YYYY-MM-DD; null = does not expire */
  expiresAt: string | null;
  /** small data: URL or storage URL (scan/photo) */
  fileUrl: string | null;
  note: string;
}

/** Non-financial employee file (one per membership). */
export interface StaffProfile {
  id: string;
  restaurantId: string;
  createdAt: string;
  updatedAt: string;
  membershipId: string;
  /** small JPEG data: URL (≤ ~40 KB) or storage URL */
  photoUrl: string | null;
  nationalId: string | null;
  nationality: string; // ISO-2, e.g. "EG", "SA"
  birthDate: string | null;
  hireDate: string;
  contractType: ContractType;
  contractEnd: string | null;
  /** job title shown on the rota and payslip */
  position: { ar: string; en: string };
  /** default station/section on the rota (kitchen station id or "floor"/"bar"/"cashier"/"delivery") */
  station: string | null;
  /** handles food → health certificate is mandatory (Egypt: شهادة صحية) */
  foodHandler: boolean;
  emergencyContact: { name: string; phone: string; relation: string } | null;
  address: string | null;
  documents: StaffDocument[];
  /** fingerprint device user number (ZKTeco "PIN" / enrollment id) */
  deviceUserId: string | null;
  /** days of the week normally off (0 = Sunday … 6 = Saturday) */
  weeklyOff: number[];
  terminatedAt: string | null;
  terminationReason: string | null;
  notes: string;
}

/** Rota row: one shift of one person on one day. A shift may cross midnight (end < start). */
export interface RotaShift {
  id: string;
  restaurantId: string;
  createdAt: string;
  updatedAt: string;
  branchId: string;
  membershipId: string | null; // null = open shift (anyone can pick it up)
  date: string; // YYYY-MM-DD (the day the shift starts)
  start: string; // HH:MM
  end: string; // HH:MM
  breakMin: number;
  station: string | null;
  templateId: string | null;
  published: boolean;
  publishedAt: string | null;
  note: string;
}

export interface ShiftTemplate {
  id: string;
  restaurantId: string;
  createdAt: string;
  updatedAt: string;
  branchId: string | null;
  name: { ar: string; en: string };
  start: string;
  end: string;
  breakMin: number;
  station: string | null;
  color: string;
  sort: number;
}

export type SwapStatus = "pending" | "accepted" | "approved" | "rejected" | "cancelled";
export interface ShiftSwap {
  id: string;
  restaurantId: string;
  createdAt: string;
  updatedAt: string;
  shiftId: string;
  fromId: string;
  /** colleague who takes it; null = "anyone" (give away) */
  toId: string | null;
  reason: string;
  status: SwapStatus;
  decidedBy: string | null;
  decidedAt: string | null;
}

export type PunchKind = "in" | "out" | "break_start" | "break_end";
export type PunchSource = "pin" | "selfie" | "mobile" | "device" | "csv" | "manual";

export interface AttendancePunch {
  id: string;
  restaurantId: string;
  createdAt: string;
  updatedAt: string;
  branchId: string | null;
  /** null when a fingerprint device sends a user number nobody is mapped to yet */
  membershipId: string | null;
  at: string; // ISO instant
  kind: PunchKind;
  source: PunchSource;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  /** distance from the branch geofence centre (mobile check-in) */
  distanceM: number | null;
  /** selfie snapshot (small JPEG data: URL) */
  photoUrl: string | null;
  deviceSn: string | null;
  deviceUserId: string | null;
  /** idempotency key (device pushes / CSV imports): unique per restaurant */
  externalId: string | null;
  /** manager corrections: who, why; voided punches are kept for the audit trail */
  voided: boolean;
  correctedBy: string | null;
  note: string;
}

export interface AttendanceDevice {
  id: string;
  restaurantId: string;
  createdAt: string;
  updatedAt: string;
  branchId: string;
  name: string;
  /** ZKTeco serial number (the SN= the device sends) */
  serial: string;
  model: string;
  /** sha256 hex of the shared secret; the secret itself is shown once when the device is registered */
  secretHash: string;
  timezone: string;
  active: boolean;
  lastSeenAt: string | null;
  lastStamp: string | null;
}

export type LeaveType = "annual" | "casual" | "sick" | "unpaid" | "hajj" | "maternity" | "other";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequest {
  id: string;
  restaurantId: string;
  createdAt: string;
  updatedAt: string;
  membershipId: string;
  type: LeaveType;
  from: string; // YYYY-MM-DD
  to: string; // inclusive
  days: number;
  reason: string;
  status: LeaveStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string;
}

/** Opening/adjustment per person, year and type; accrual itself is computed (src/modules/hr/lib/leave.ts). */
export interface LeaveBalance {
  id: string;
  restaurantId: string;
  createdAt: string;
  updatedAt: string;
  membershipId: string;
  year: number;
  type: LeaveType;
  /** carried over from last year */
  carried: number;
  /** manual +/- (audited) */
  adjustment: number;
  /** override the legal entitlement (null = by law/policy) */
  entitlement: number | null;
}

export type AdvanceStatus = "requested" | "approved" | "rejected" | "paid" | "settled";
export interface Advance {
  id: string;
  restaurantId: string;
  createdAt: string;
  updatedAt: string;
  membershipId: string;
  branchId: string | null;
  kind: "advance" | "loan";
  amount: Units;
  installments: number;
  /** first payroll month that deducts, YYYY-MM */
  startPeriod: string;
  reason: string;
  status: AdvanceStatus;
  requestedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  paidVia: "cash" | "bank" | "wallet" | null;
  paidAt: string | null;
  paidBy: string | null;
  /** cash from the drawer: the cash movement posted on the open shift */
  cashMovementId: string | null;
  /** recovered so far through payroll */
  recovered: Units;
}

export type AdjustmentKind = "bonus" | "penalty" | "deduction" | "allowance";
export interface PayrollAdjustment {
  id: string;
  restaurantId: string;
  createdAt: string;
  updatedAt: string;
  membershipId: string;
  period: string; // YYYY-MM
  kind: AdjustmentKind;
  amount: Units;
  reason: string;
  createdBy: string | null;
}

export type PayrollStatus = "draft" | "approved" | "paid";
export interface PayrollTotals {
  gross: Units;
  deductions: Units;
  employeeInsurance: Units;
  employerInsurance: Units;
  incomeTax: Units;
  advances: Units;
  net: Units;
  tips: Units;
  service: Units;
  eosb: Units;
  headcount: number;
}

export interface PayrollRun {
  id: string;
  restaurantId: string;
  createdAt: string;
  updatedAt: string;
  /** null = all branches */
  branchId: string | null;
  period: string; // YYYY-MM
  country: "EG" | "SA";
  status: PayrollStatus;
  totals: PayrollTotals;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  paidBy: string | null;
  /** journal entries posted (accrual at approval, payment when paid) */
  ledgerEntryIds: string[];
  /** pools and rules used (frozen at approval) */
  snapshot: Record<string, unknown>;
  note: string;
}

export interface PayslipLine {
  code: string;
  label: { ar: string; en: string };
  amount: Units;
  /** quantity shown on the slip (hours, days, minutes) */
  qty?: number;
  unit?: "h" | "d" | "min" | "pts";
}

export interface Payslip {
  id: string;
  restaurantId: string;
  createdAt: string;
  updatedAt: string;
  runId: string;
  membershipId: string;
  branchId: string | null;
  period: string;
  name: string;
  position: string;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  /** employer-side cost lines (not on the net): employer insurance, EOSB accrual */
  employer: PayslipLine[];
  gross: Units;
  totalDeductions: Units;
  net: Units;
  insurableWage: Units;
  employeeInsurance: Units;
  employerInsurance: Units;
  incomeTax: Units;
  advanceRecovered: Units;
  workedDays: number;
  absentDays: number;
  lateMinutes: number;
  overtimeMinutes: number;
  payMethod: PayMethod;
  status: PayrollStatus;
  paidAt: string | null;
}

/**
 * Leave entitlement & accrual (Egypt defaults: Labour Law 14/2025 — 15 days in the first year after 6 months' service,
 * 21 days, 30 days after 10 years or from age 50; casual 6 days a year taken from the annual balance).
 */
import type { LeaveType } from "@/data/hrTypes";
import type { HrSettings } from "./settings";
import { addDays, dateRange, weekday } from "./tz";

const monthsBetween = (from: string, to: string) => {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
};
const yearsBetween = (from: string, to: string) => Math.floor(monthsBetween(from, to) / 12);

/** Annual-leave days the person is entitled to for the year containing `asOf`. */
export function annualEntitlement(p: { hireDate: string; birthDate: string | null }, asOf: string, cfg: HrSettings["leave"]): number {
  const months = monthsBetween(p.hireDate, asOf);
  if (months < cfg.minMonths) return 0;
  const age = p.birthDate ? yearsBetween(p.birthDate, asOf) : 0;
  if (yearsBetween(p.hireDate, asOf) >= cfg.seniorYears || age >= cfg.seniorAge) return cfg.annualSenior;
  if (months >= 12) return cfg.annual;
  return cfg.annualFirstYear;
}

/** Accrued so far this year: entitlement × months worked in the year ÷ 12, in half days (rounded down). */
export function accruedAnnual(entitlement: number, p: { hireDate: string }, asOf: string): number {
  const year = asOf.slice(0, 4);
  const start = p.hireDate > `${year}-01-01` ? p.hireDate : `${year}-01-01`;
  if (start > asOf) return 0;
  const months = Math.min(12, monthsBetween(start, asOf) + 1); // the current month counts once started
  return Math.floor(((entitlement * months) / 12) * 2) / 2;
}

/** Working days in [from, to] (weekly days off excluded). */
export function leaveDays(from: string, to: string, weeklyOff: number[] = []): number {
  if (to < from) return 0;
  return dateRange(from, to).filter((d) => !weeklyOff.includes(weekday(d))).length;
}

export interface BalanceInput {
  type: LeaveType;
  entitlement: number;
  accrued: number;
  carried: number;
  adjustment: number;
  /** approved days taken this year by type */
  taken: Partial<Record<LeaveType, number>>;
  pending: Partial<Record<LeaveType, number>>;
}

export interface Balance {
  type: LeaveType;
  entitlement: number;
  accrued: number;
  taken: number;
  pending: number;
  available: number;
}

/** Annual balance (casual days count against it when casualFromAnnual) and the casual sub-limit. */
export function balances(x: Omit<BalanceInput, "type">, cfg: HrSettings["leave"]): { annual: Balance; casual: Balance; sick: Balance } {
  const t = (k: LeaveType) => x.taken[k] ?? 0;
  const p = (k: LeaveType) => x.pending[k] ?? 0;
  const annualTaken = t("annual") + (cfg.casualFromAnnual ? t("casual") : 0);
  const annualPending = p("annual") + (cfg.casualFromAnnual ? p("casual") : 0);
  const annualAvail = x.carried + x.accrued + x.adjustment - annualTaken;
  const annual: Balance = { type: "annual", entitlement: x.entitlement + x.carried, accrued: x.accrued + x.carried + x.adjustment, taken: annualTaken, pending: annualPending, available: annualAvail };
  const casualLeft = Math.max(0, cfg.casual - t("casual"));
  const casual: Balance = { type: "casual", entitlement: cfg.casual, accrued: cfg.casual, taken: t("casual"), pending: p("casual"), available: cfg.casualFromAnnual ? Math.min(casualLeft, Math.max(0, annualAvail)) : casualLeft };
  const sick: Balance = { type: "sick", entitlement: cfg.sickPaid, accrued: cfg.sickPaid, taken: t("sick"), pending: p("sick"), available: Math.max(0, cfg.sickPaid - t("sick")) };
  return { annual, casual, sick };
}

/** Can this request be approved against the balance? (sick/unpaid/hajj/other are not capped here) */
export function fitsBalance(type: LeaveType, days: number, b: ReturnType<typeof balances>): boolean {
  if (type === "annual") return days <= b.annual.available;
  if (type === "casual") return days <= b.casual.available;
  return true;
}

export const nextDay = (d: string) => addDays(d, 1);

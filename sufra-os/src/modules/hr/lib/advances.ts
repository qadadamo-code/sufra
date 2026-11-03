/** Salary advances (سلف) and loans: instalment schedule and what the next payroll deducts. */
import { UNITS_PER_MINOR, type Units } from "@/lib/money";
import { addMonths } from "./tz";

/** Equal instalments in whole piastres; the last one absorbs the remainder so Σ === amount. */
export function installmentSchedule(amount: Units, installments: number, startPeriod: string): { period: string; amount: Units }[] {
  const n = Math.max(1, Math.floor(installments));
  const piastres = Math.round(amount / UNITS_PER_MINOR);
  const each = Math.floor(piastres / n);
  const out: { period: string; amount: Units }[] = [];
  for (let i = 0; i < n; i++) out.push({ period: addMonths(startPeriod, i), amount: (i === n - 1 ? piastres - each * (n - 1) : each) * UNITS_PER_MINOR });
  return out;
}

export interface AdvanceLike {
  amount: Units;
  installments: number;
  startPeriod: string;
  recovered: Units;
  status: string;
}

/** What payroll for `period` deducts: everything scheduled up to that month that is not recovered yet (catches up a skipped month). */
export function dueInPeriod(a: AdvanceLike, period: string): Units {
  if (a.status !== "paid") return 0;
  if (period < a.startPeriod) return 0;
  const sched = installmentSchedule(a.amount, a.installments, a.startPeriod);
  const scheduledToDate = sched.filter((s) => s.period <= period).reduce((x, s) => x + s.amount, 0);
  return Math.max(0, Math.min(a.amount - a.recovered, scheduledToDate - a.recovered));
}

export const outstanding = (a: Pick<AdvanceLike, "amount" | "recovered" | "status">) => (a.status === "paid" ? Math.max(0, a.amount - a.recovered) : 0);

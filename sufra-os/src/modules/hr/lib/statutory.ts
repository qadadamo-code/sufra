/**
 * Statutory payroll maths — Egypt social insurance + salary tax, KSA GOSI + end-of-service. Pure, Units in/out,
 * rounded to whole piastres/halalas. Rates and bounds come from HrSettings (see settings.ts for sources).
 * Every figure is an estimate the accountant reviews before filing.
 */
import { UNITS_PER_MINOR, type Units } from "@/lib/money";
import type { HrSettings, TaxBracket } from "./settings";

/** round half away from zero to whole minor units (piastres) */
export const toMinor = (u: number): Units => {
  const p = Math.round(Math.abs(u) / UNITS_PER_MINOR) * UNITS_PER_MINOR;
  return u < 0 ? -p : p;
};
/** u × bps / 10 000, rounded to piastres */
export const pct = (u: Units, bps: number): Units => toMinor((u * bps) / 10_000);

/* ───────── Egypt: social insurance (Law 148/2019) ───────── */

/** Insurable wage clamped to the year's bounds (EGP 2,700 – 16,700 in 2026). */
export function egInsurableWage(wage: Units, cfg: HrSettings["insuranceEG"]): Units {
  if (wage <= 0) return 0;
  return Math.min(cfg.maxWage, Math.max(cfg.minWage, wage));
}

export function egSocialInsurance(wage: Units, cfg: HrSettings["insuranceEG"], insured = true) {
  if (!insured) return { wage: 0, employee: 0, employer: 0 };
  const w = egInsurableWage(wage, cfg);
  return { wage: w, employee: pct(w, cfg.employeeBps), employer: pct(w, cfg.employerBps) };
}

/* ───────── Egypt: salary tax ───────── */

/** Progressive tax on an annual amount over brackets starting at index `from` (that band then starts at zero). */
function bandTax(annual: Units, brackets: TaxBracket[], from: number): Units {
  let tax = 0;
  let lower = 0;
  for (let i = from; i < brackets.length; i++) {
    const b = brackets[i];
    const upper = b.upTo ?? Infinity;
    if (annual > lower) tax += ((Math.min(annual, upper) - lower) * b.bps) / 10_000;
    lower = upper;
    if (annual <= upper) break;
  }
  return tax;
}

/**
 * Law 30/2023 "high earners lose the lower bands": annual taxable above 600k starts at the 10 % band, above 700k at 15 %,
 * above 800k at 20 %, above 900k at 22.5 %, above 1.2m at 25 % (each first band then starts at zero).
 */
export const HIGH_EARNER_STEPS: { over: Units; from: number }[] = [
  { over: 1_200_000 * 100_000, from: 5 },
  { over: 900_000 * 100_000, from: 4 },
  { over: 800_000 * 100_000, from: 3 },
  { over: 700_000 * 100_000, from: 2 },
  { over: 600_000 * 100_000, from: 1 },
];

/** Annual salary tax for an annual taxable income *after* the personal exemption. */
export function egAnnualTax(taxable: Units, cfg: Pick<HrSettings["taxEG"], "brackets" | "highEarnerRule" | "roundTo">): Units {
  if (taxable <= 0) return 0;
  const t = cfg.roundTo > 0 ? Math.floor(taxable / cfg.roundTo) * cfg.roundTo : taxable;
  const step = cfg.highEarnerRule && cfg.brackets.length === 7 ? HIGH_EARNER_STEPS.find((s) => t > s.over) : undefined;
  return toMinor(bandTax(t, cfg.brackets, step?.from ?? 0));
}

/**
 * Monthly salary tax: (monthly taxable − employee insurance) × 12 − exemption → annual tax ÷ 12.
 * `monthlyTaxable` = gross pay after attendance deductions/penalties (tips and service share are taxable).
 */
export function egMonthlyTax(monthlyTaxable: Units, employeeInsurance: Units, cfg: HrSettings["taxEG"]): { annualTaxable: Units; annualTax: Units; monthly: Units } {
  if (!cfg.enabled) return { annualTaxable: 0, annualTax: 0, monthly: 0 };
  const annualTaxable = Math.max(0, (monthlyTaxable - employeeInsurance) * 12 - cfg.exemption);
  const annualTax = egAnnualTax(annualTaxable, cfg);
  return { annualTaxable, annualTax, monthly: toMinor(annualTax / 12) };
}

/* ───────── KSA: GOSI ───────── */

export function gosiBase(basic: Units, housing: Units, cfg: HrSettings["ksa"]): Units {
  const b = basic + housing;
  if (b <= 0) return 0;
  return Math.min(cfg.maxBase, Math.max(cfg.minBase, b));
}

export function gosi(basic: Units, housing: Units, who: { saudi: boolean; scheme?: "legacy" | "new" }, cfg: HrSettings["ksa"]) {
  const base = gosiBase(basic, housing, cfg);
  if (!who.saudi) return { base, employee: 0, employer: pct(base, cfg.nonSaudiEmployerBps) };
  const r = who.scheme === "new" ? cfg.newEntrant : cfg.legacy;
  return { base, employee: pct(base, r.employeeBps), employer: pct(base, r.employerBps) };
}

/* ───────── KSA: end-of-service benefit (Labour Law art. 84) ───────── */

/** Full EOSB for `years` of service on the last wage: ½ month per year for the first 5 years, 1 month per year after. */
export function eosbTotal(monthlyWage: Units, years: number): Units {
  if (years <= 0) return 0;
  const first = Math.min(years, 5) * 0.5;
  const rest = Math.max(0, years - 5) * 1;
  return toMinor(monthlyWage * (first + rest));
}

/** This month's accrual (provision) for someone with `years` of service at the start of the month. */
export function eosbMonthlyAccrual(monthlyWage: Units, years: number): Units {
  return toMinor((monthlyWage * (years < 5 ? 0.5 : 1)) / 12);
}

/** years of service (fractional) between hire date and a date */
export function serviceYears(hireDate: string, asOf: string): number {
  const ms = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${hireDate}T00:00:00Z`);
  return Math.max(0, ms / (365.25 * 86_400_000));
}

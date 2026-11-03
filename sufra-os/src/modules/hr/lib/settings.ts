/**
 * HR & payroll rules per restaurant (settings.hr, 0010_hr.sql). Every number here is editable in Staff → Settings;
 * the defaults follow Egyptian practice and law, checked 2026-11:
 *
 *  - Social insurance, Law 148/2019: employee 11 %, employer 18.75 % of the insurable wage; 2026 bounds EGP 2,700 – 16,700 / month
 *    (NOSI announcement for 1 Jan 2026 — businesstodayegypt.com/Article/1/6950, eg.andersen.com/social-insurance-in-egypt).
 *  - Salary tax, Income Tax Law 91/2005 as amended by Law 30/2023 (brackets + "high earners lose the lower bands") and
 *    Law 7/2024 (annual personal exemption EGP 20,000): 0 % to 40k · 10 % to 55k · 15 % to 70k · 20 % to 200k ·
 *    22.5 % to 400k · 25 % to 1.2m · 27.5 % above (annual, after the exemption).
 *    Sources: taxsummaries.pwc.com/egypt/individual/taxes-on-personal-income · eg.andersen.com/personal-income-tax.
 *  - Leave (Labour Law 14/2025, same days as 12/2003): 15 days in the first year (after 6 months), 21 days, 30 days after
 *    10 years' service or from age 50; casual leave 6 days a year counted from the annual balance.
 *  - Overtime: +35 % day, +70 % night, rest day ×2 (Labour Law). Daily wage = monthly ÷ 30.
 *  - KSA (GOSI): Saudi legacy employee 9.75 % / employer 11.75 %; new entrants (since Jul 2024) on the rising schedule;
 *    non-Saudi employer 2 % occupational hazards; base = basic + housing, SAR 1,500 – 45,000. Verify on gosi.gov.sa.
 * All tax / insurance figures in the app are labelled "تقديري — يراجعه المحاسب" (estimate — accountant reviews).
 */
import { major, type Units } from "@/lib/money";

export interface TaxBracket {
  /** upper bound of the band (annual, after the exemption); null = no limit */
  upTo: Units | null;
  bps: number;
}

export interface HrSettings {
  country: "EG" | "SA";
  /** day of the month salaries are paid (1–28; 0 = last day) */
  payDay: number;
  /** remind the owner/accountant this many days before pay day */
  reminderDays: number;
  /** the week on the rota starts on (6 = Saturday) */
  weekStartsOn: number;
  workHoursPerDay: number;
  /** daily wage = monthly ÷ this (Egypt: 30) */
  daysPerMonth: number;
  /** minutes late before anything is recorded against the person */
  graceMin: number;
  /** deduction (in days' pay) per late arrival, by minutes late — highest matching tier wins */
  lateTiers: { fromMin: number; days: number }[];
  /** same for leaving early */
  earlyTiers: { fromMin: number; days: number }[];
  /** days' pay deducted per unexcused absence (1 = the day itself; some contracts use 2) */
  absenceDays: number;
  overtime: { afterMin: number; dayBps: number; nightBps: number; restDayBps: number; nightFrom: string; nightTo: string };
  breaks: { paid: boolean; defaultMin: number };
  /** per branch: restaurant coordinates + radius for mobile check-in */
  geofences: Record<string, { lat: number; lng: number; radiusM: number }>;
  mobileCheckIn: boolean;
  /** shared-device clock-in: camera snapshot */
  kioskSelfie: "off" | "optional" | "required";
  /** service charge (12 %) pool: share that goes to staff, and how it is split */
  servicePool: { enabled: boolean; staffShareBps: number; method: "points" | "hours" | "points_hours" };
  /** POS tips: pooled and split by hours, equally, or kept by whoever took the payment */
  tipsPool: { enabled: boolean; method: "hours" | "equal" | "by_taker" };
  insuranceEG: { employeeBps: number; employerBps: number; minWage: Units; maxWage: Units; year: number };
  taxEG: { enabled: boolean; exemption: Units; brackets: TaxBracket[]; highEarnerRule: boolean; roundTo: Units; source: string };
  ksa: {
    legacy: { employeeBps: number; employerBps: number };
    newEntrant: { employeeBps: number; employerBps: number };
    nonSaudiEmployerBps: number;
    minBase: Units;
    maxBase: Units;
  };
  leave: { annualFirstYear: number; annual: number; annualSenior: number; seniorYears: number; seniorAge: number; minMonths: number; casual: number; casualFromAnnual: boolean; sickPaid: number };
  /** advances: max share of one month's salary, and default instalments */
  advances: { maxBps: number; defaultInstallments: number };
  /** labour-cost forecast: fallback daily sales when there is no sales history, and the target labour % */
  expectedDailySales: Units;
  labourTargetBps: number;
}

export const EG_TAX_BRACKETS_2026: TaxBracket[] = [
  { upTo: major(40_000), bps: 0 },
  { upTo: major(55_000), bps: 1000 },
  { upTo: major(70_000), bps: 1500 },
  { upTo: major(200_000), bps: 2000 },
  { upTo: major(400_000), bps: 2250 },
  { upTo: major(1_200_000), bps: 2500 },
  { upTo: null, bps: 2750 },
];

export const DEFAULT_HR: HrSettings = {
  country: "EG",
  payDay: 28,
  reminderDays: 3,
  weekStartsOn: 6,
  workHoursPerDay: 8,
  daysPerMonth: 30,
  graceMin: 10,
  lateTiers: [
    { fromMin: 15, days: 0.25 },
    { fromMin: 30, days: 0.5 },
    { fromMin: 60, days: 1 },
  ],
  earlyTiers: [
    { fromMin: 30, days: 0.25 },
    { fromMin: 60, days: 0.5 },
  ],
  absenceDays: 1,
  overtime: { afterMin: 30, dayBps: 13500, nightBps: 17000, restDayBps: 20000, nightFrom: "23:00", nightTo: "06:00" },
  breaks: { paid: true, defaultMin: 30 },
  geofences: {},
  mobileCheckIn: true,
  kioskSelfie: "optional",
  servicePool: { enabled: true, staffShareBps: 8000, method: "points_hours" },
  tipsPool: { enabled: true, method: "hours" },
  insuranceEG: { employeeBps: 1100, employerBps: 1875, minWage: major(2_700), maxWage: major(16_700), year: 2026 },
  taxEG: {
    enabled: true,
    exemption: major(20_000),
    brackets: EG_TAX_BRACKETS_2026,
    highEarnerRule: true,
    roundTo: major(10),
    source: "Law 91/2005 as amended by Laws 30/2023 & 7/2024 — PwC tax summaries / Andersen Egypt (checked 2026-11)",
  },
  ksa: {
    legacy: { employeeBps: 975, employerBps: 1175 },
    // new entrants (joined from 3 Jul 2024): annuities rise 0.5 pt a year each side; Jul 2026 → 10 % + SANED 0.75 % (+2 % OH employer)
    newEntrant: { employeeBps: 1075, employerBps: 1275 },
    nonSaudiEmployerBps: 200,
    minBase: major(1_500),
    maxBase: major(45_000),
  },
  leave: { annualFirstYear: 15, annual: 21, annualSenior: 30, seniorYears: 10, seniorAge: 50, minMonths: 6, casual: 6, casualFromAnnual: true, sickPaid: 15 },
  advances: { maxBps: 5000, defaultInstallments: 3 },
  expectedDailySales: major(85_000),
  labourTargetBps: 2800,
};

/** settings.hr merged over the defaults (rows written before Wave 3 have no hr field). */
export function hrSettings(s: { hr?: Partial<HrSettings> | null } | null | undefined): HrSettings {
  const h = s?.hr ?? {};
  return {
    ...DEFAULT_HR,
    ...h,
    overtime: { ...DEFAULT_HR.overtime, ...(h.overtime ?? {}) },
    breaks: { ...DEFAULT_HR.breaks, ...(h.breaks ?? {}) },
    servicePool: { ...DEFAULT_HR.servicePool, ...(h.servicePool ?? {}) },
    tipsPool: { ...DEFAULT_HR.tipsPool, ...(h.tipsPool ?? {}) },
    insuranceEG: { ...DEFAULT_HR.insuranceEG, ...(h.insuranceEG ?? {}) },
    taxEG: { ...DEFAULT_HR.taxEG, ...(h.taxEG ?? {}) },
    ksa: { ...DEFAULT_HR.ksa, ...(h.ksa ?? {}) },
    leave: { ...DEFAULT_HR.leave, ...(h.leave ?? {}) },
    advances: { ...DEFAULT_HR.advances, ...(h.advances ?? {}) },
    geofences: { ...(h.geofences ?? {}) },
  };
}

/** The pay date for a period ("2026-11" → "2026-11-28"; payDay 0 = last day). */
export function payDate(period: string, payDay: number): string {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = payDay <= 0 || payDay > last ? last : payDay;
  return `${period}-${String(d).padStart(2, "0")}`;
}

/** The label every tax / insurance figure carries. */
export const ESTIMATE_LABEL = { ar: "تقديري — يراجعه المحاسب", en: "Estimate — accountant reviews" };

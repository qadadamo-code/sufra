/**
 * Payroll maths (الرواتب): one payslip per person from compensation + attendance summary + pools + adjustments + advances,
 * run totals, and the journal lines the run posts. Pure; every amount is Units rounded to piastres.
 *
 *   gross  = base (+ allowances) + overtime + tips share + service share + bonuses
 *   net    = gross − attendance deductions − penalties − employee insurance − salary tax − advance instalment
 *   cost   = gross − attendance deductions − penalties + employer insurance (+ EOSB accrual in KSA)
 *
 * Journal at approval (balanced by construction — see payrollJournalLines):
 *   Dr 6301 salaries (base, OT, net of deductions) · Dr 6303 bonuses · Dr 2203 tips payable · Dr 2202 service payable ·
 *   Dr 6302 employer insurance · Dr 6304 EOSB (KSA)
 *   Cr 2401 salaries payable (net) · Cr 2304 insurance payable (employee + employer) · Cr 2303 salary tax payable ·
 *   Cr 1202 staff advances (recovered) · Cr 2102 accrued EOSB (KSA)
 */
import type { AdjustmentKind, PayMethod, PayrollTotals, PayslipLine, SalaryType } from "@/data/hrTypes";
import type { Units } from "@/lib/money";
import { ACC } from "@/modules/accounting/chart";
import type { PeriodSummary } from "./attendance";
import type { HrSettings } from "./settings";
import { egMonthlyTax, egSocialInsurance, eosbMonthlyAccrual, gosi, pct, serviceYears, toMinor } from "./statutory";
import { splitPool, serviceWeight } from "./pool";

export interface CompLike {
  salaryType?: SalaryType;
  monthlySalary: Units;
  dailyRate?: Units;
  hourlyRate: Units;
  allowances?: { housing: Units; transport: Units; meal: Units; other: Units };
  insurableWage?: Units | null;
  insured?: boolean;
  gosiScheme?: "legacy" | "new";
  servicePoints?: number;
  tipsEligible?: boolean;
  payMethod?: PayMethod;
}

export const NO_ALLOWANCES = { housing: 0, transport: 0, meal: 0, other: 0 };

export function effectiveComp(c: CompLike | null | undefined, rules: Pick<HrSettings, "daysPerMonth">): Required<Omit<CompLike, "insurableWage">> & { insurableWage: Units | null } {
  const monthly = c?.monthlySalary ?? 0;
  return {
    salaryType: c?.salaryType ?? "monthly",
    monthlySalary: monthly,
    dailyRate: c?.dailyRate ?? toMinor(monthly / rules.daysPerMonth),
    hourlyRate: c?.hourlyRate ?? 0,
    allowances: { ...NO_ALLOWANCES, ...(c?.allowances ?? {}) },
    insurableWage: c?.insurableWage ?? null,
    insured: c?.insured ?? true,
    gosiScheme: c?.gosiScheme ?? "legacy",
    servicePoints: c?.servicePoints ?? 0,
    tipsEligible: c?.tipsEligible ?? false,
    payMethod: c?.payMethod ?? "cash",
  };
}

export interface PayInput {
  membershipId: string;
  name: string;
  position: string;
  branchId: string | null;
  nationality: string;
  hireDate: string;
  comp: CompLike | null;
  summary: PeriodSummary;
  unpaidLeaveDays: number;
  tips: Units;
  service: Units;
  adjustments: { kind: AdjustmentKind; amount: Units; reason: string }[];
  advanceDue: Units;
  periodStart: string;
}

export interface PayslipDraft {
  membershipId: string;
  branchId: string | null;
  name: string;
  position: string;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  employer: PayslipLine[];
  gross: Units;
  totalDeductions: Units;
  net: Units;
  insurableWage: Units;
  employeeInsurance: Units;
  employerInsurance: Units;
  incomeTax: Units;
  advanceRecovered: Units;
  /** attendance deductions + penalties/other deductions (reduce the salary cost) */
  preDeductions: Units;
  bonuses: Units;
  tips: Units;
  service: Units;
  eosb: Units;
  workedDays: number;
  absentDays: number;
  lateMinutes: number;
  overtimeMinutes: number;
  payMethod: PayMethod;
}

const L = (ar: string, en: string) => ({ ar, en });
const line = (code: string, label: { ar: string; en: string }, amount: Units, qty?: number, unit?: PayslipLine["unit"]): PayslipLine => ({ code, label, amount: toMinor(amount), ...(qty !== undefined ? { qty: Math.round(qty * 100) / 100 } : {}), ...(unit ? { unit } : {}) });

export function computePayslip(x: PayInput, rules: HrSettings): PayslipDraft {
  const c = effectiveComp(x.comp, rules);
  const s = x.summary;
  const daily = c.salaryType === "monthly" ? toMinor(c.monthlySalary / rules.daysPerMonth) : c.dailyRate;
  const hourly = c.salaryType === "hourly" ? c.hourlyRate : toMinor(daily / rules.workHoursPerDay);
  const earnings: PayslipLine[] = [];
  const deductions: PayslipLine[] = [];
  const employer: PayslipLine[] = [];

  // base
  if (c.salaryType === "monthly") {
    earnings.push(line("basic", L("الأساسي", "Basic salary"), c.monthlySalary));
    const a = c.allowances;
    if (a.housing) earnings.push(line("housing", L("بدل سكن", "Housing allowance"), a.housing));
    if (a.transport) earnings.push(line("transport", L("بدل انتقالات", "Transport allowance"), a.transport));
    if (a.meal) earnings.push(line("meal", L("بدل وجبة", "Meal allowance"), a.meal));
    if (a.other) earnings.push(line("other_allowance", L("بدلات أخرى", "Other allowances"), a.other));
  } else if (c.salaryType === "daily") {
    const days = Math.max(0, s.workedDays - s.extraDays);
    earnings.push(line("basic", L("يوميات", "Daily wages"), days * c.dailyRate, days, "d"));
  } else {
    const regMin = Math.max(0, s.workedMin - s.overtimeMin - s.restDayMin);
    earnings.push(line("basic", L("ساعات العمل", "Hours worked"), (regMin / 60) * c.hourlyRate, regMin / 60, "h"));
  }

  // overtime
  const dayOt = s.overtimeMin - s.nightOvertimeMin;
  if (dayOt > 0) earnings.push(line("overtime", L("وقت إضافي", "Overtime"), pct((dayOt / 60) * hourly, rules.overtime.dayBps), dayOt / 60, "h"));
  if (s.nightOvertimeMin > 0) earnings.push(line("overtime_night", L("إضافي ليلي", "Night overtime"), pct((s.nightOvertimeMin / 60) * hourly, rules.overtime.nightBps), s.nightOvertimeMin / 60, "h"));
  if (s.restDayMin > 0) earnings.push(line("rest_day", L("شغل يوم الراحة", "Rest-day work"), pct((s.restDayMin / 60) * hourly, rules.overtime.restDayBps), s.restDayMin / 60, "h"));

  if (x.tips) earnings.push(line("tips", L("نصيبك من البقشيش", "Tips share"), x.tips));
  if (x.service) earnings.push(line("service", L("نصيبك من الخدمة", "Service-charge share"), x.service));
  let bonuses = 0;
  for (const a of x.adjustments) {
    if (a.kind === "bonus" || a.kind === "allowance") {
      earnings.push(line(a.kind, a.kind === "bonus" ? L(`حافز — ${a.reason}`, `Bonus — ${a.reason}`) : L(`بدل — ${a.reason}`, `Allowance — ${a.reason}`), a.amount));
      bonuses += toMinor(a.amount);
    }
  }
  const gross = earnings.reduce((t, l) => t + l.amount, 0);

  // attendance deductions (monthly + daily; hourly staff are simply not paid for the time)
  let pre = 0;
  const addPre = (l: PayslipLine) => {
    if (l.amount <= 0) return;
    deductions.push(l);
    pre += l.amount;
  };
  if (c.salaryType === "monthly") {
    addPre(line("absence", L("خصم غياب", "Absence"), s.absentDays * rules.absenceDays * daily, s.absentDays * rules.absenceDays, "d"));
    addPre(line("unpaid_leave", L("إجازة بدون مرتب", "Unpaid leave"), x.unpaidLeaveDays * daily, x.unpaidLeaveDays, "d"));
  }
  if (c.salaryType !== "hourly") addPre(line("lateness", L("خصم تأخير وانصراف بدري", "Lateness & early leave"), s.lateDeductionDays * daily, s.lateDeductionDays, "d"));
  for (const a of x.adjustments) if (a.kind === "penalty" || a.kind === "deduction") addPre(line(a.kind, a.kind === "penalty" ? L(`جزاء — ${a.reason}`, `Penalty — ${a.reason}`) : L(`خصم — ${a.reason}`, `Deduction — ${a.reason}`), a.amount));
  if (pre > gross) {
    // never deduct more than was earned: trim the last lines
    let over = pre - gross;
    for (let i = deductions.length - 1; i >= 0 && over > 0; i--) {
      const cut = Math.min(over, deductions[i].amount);
      deductions[i] = { ...deductions[i], amount: deductions[i].amount - cut };
      over -= cut;
    }
    pre = gross;
  }

  // statutory
  let insurableWage = 0;
  let ee = 0;
  let er = 0;
  let tax = 0;
  let eosb = 0;
  const contractMonthly = c.salaryType === "monthly" ? c.monthlySalary + c.allowances.housing + c.allowances.transport + c.allowances.meal + c.allowances.other : c.salaryType === "daily" ? c.dailyRate * 26 : c.hourlyRate * rules.workHoursPerDay * 26;
  if (rules.country === "EG") {
    const si = egSocialInsurance(c.insurableWage ?? contractMonthly, rules.insuranceEG, c.insured);
    insurableWage = si.wage;
    ee = si.employee;
    er = si.employer;
    if (ee) deductions.push(line("si_employee", L("تأمينات اجتماعية (١١٪)", "Social insurance (11%)"), ee));
    tax = egMonthlyTax(gross - pre, ee, rules.taxEG).monthly;
    if (tax) deductions.push(line("income_tax", L("ضريبة كسب العمل", "Salary tax"), tax));
    if (er) employer.push(line("si_employer", L("تأمينات حصة صاحب العمل (١٨٫٧٥٪)", "Employer insurance (18.75%)"), er));
  } else {
    const basicM = c.salaryType === "monthly" ? c.monthlySalary : c.dailyRate * 30;
    const g = c.insured ? gosi(basicM, c.allowances.housing, { saudi: x.nationality === "SA", scheme: c.gosiScheme }, rules.ksa) : { base: 0, employee: 0, employer: 0 };
    insurableWage = g.base;
    ee = g.employee;
    er = g.employer;
    if (ee) deductions.push(line("gosi_employee", L("التأمينات (GOSI)", "GOSI (employee)"), ee));
    if (er) employer.push(line("gosi_employer", L("GOSI حصة المنشأة", "GOSI (employer)"), er));
    eosb = eosbMonthlyAccrual(basicM + c.allowances.housing + c.allowances.transport, serviceYears(x.hireDate, x.periodStart));
    if (eosb) employer.push(line("eosb", L("مخصص مكافأة نهاية الخدمة", "End-of-service accrual"), eosb));
  }

  const beforeAdvance = gross - pre - ee - tax;
  const advance = Math.max(0, Math.min(toMinor(x.advanceDue), beforeAdvance));
  if (advance) deductions.push(line("advance", L("قسط سلفة", "Advance instalment"), advance));
  const totalDeductions = pre + ee + tax + advance;
  return {
    membershipId: x.membershipId, branchId: x.branchId, name: x.name, position: x.position,
    earnings, deductions: deductions.filter((d) => d.amount > 0), employer,
    gross, totalDeductions, net: gross - totalDeductions, insurableWage, employeeInsurance: ee, employerInsurance: er, incomeTax: tax, advanceRecovered: advance,
    preDeductions: pre, bonuses, tips: toMinor(x.tips), service: toMinor(x.service), eosb,
    workedDays: s.workedDays, absentDays: s.absentDays, lateMinutes: s.lateMin, overtimeMinutes: s.overtimeMin + s.restDayMin, payMethod: c.payMethod,
  };
}

export function runTotals(slips: PayslipDraft[]): PayrollTotals {
  const sum = (f: (s: PayslipDraft) => Units) => slips.reduce((a, s) => a + f(s), 0);
  return {
    gross: sum((s) => s.gross), deductions: sum((s) => s.totalDeductions), employeeInsurance: sum((s) => s.employeeInsurance), employerInsurance: sum((s) => s.employerInsurance),
    incomeTax: sum((s) => s.incomeTax), advances: sum((s) => s.advanceRecovered), net: sum((s) => s.net), tips: sum((s) => s.tips), service: sum((s) => s.service), eosb: sum((s) => s.eosb),
    headcount: slips.length,
  };
}

/** Accrual journal for a run (Units). Debits === credits by construction; `validate` in tests proves it. */
export function payrollJournalLines(slips: PayslipDraft[]): { account: string; debit: Units; credit: Units }[] {
  const sum = (f: (s: PayslipDraft) => Units) => slips.reduce((a, s) => a + f(s), 0);
  const tips = sum((s) => s.tips);
  const service = sum((s) => s.service);
  const bonuses = sum((s) => s.bonuses);
  const salaries = sum((s) => s.gross - s.tips - s.service - s.bonuses - s.preDeductions);
  const er = sum((s) => s.employerInsurance);
  const ee = sum((s) => s.employeeInsurance);
  const eosb = sum((s) => s.eosb);
  const signed: [string, Units][] = [
    [ACC.salaries, salaries],
    [ACC.bonuses, bonuses],
    [ACC.tipsPayable, tips],
    [ACC.servicePayable, service],
    [ACC.socialInsurance, er],
    [ACC.staffBenefits, eosb],
    [ACC.salariesPayable, -sum((s) => s.net)],
    [ACC.socialInsurancePayable, -(ee + er)],
    [ACC.payrollTaxPayable, -sum((s) => s.incomeTax)],
    [ACC.staffAdvances, -sum((s) => s.advanceRecovered)],
    [ACC.accrued, -eosb],
  ];
  return signed.filter(([, v]) => v !== 0).map(([account, v]) => ({ account, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0 }));
}

/** Pay-out account for a method (wallet/InstaPay salaries go out of the bank). */
/** cash salaries come out of the safe (not a till), everything else out of the bank */
export const payoutAccount = (m: PayMethod | "cash" | "bank" | "wallet") => (m === "cash" ? ACC.safe : ACC.bank);

/* ───────── pools ───────── */

export interface PoolPerson {
  id: string;
  hours: number;
  points: number;
  tipsEligible: boolean;
  /** tips on payments this person took (by_taker) */
  tipsTaken: Units;
}

/** Splits the period's tips and the staff share of service charge; each pool's shares add up exactly. */
export function computePools(rules: HrSettings, people: PoolPerson[], tipsTotal: Units, serviceCollected: Units) {
  const servicePool = rules.servicePool.enabled ? toMinor((serviceCollected * rules.servicePool.staffShareBps) / 10_000) : 0;
  const service = splitPool(servicePool, people.map((p) => ({ id: p.id, weight: serviceWeight(rules.servicePool.method, p.points, p.hours) })));
  let tips: Record<string, Units> = {};
  const tipsPool = rules.tipsPool.enabled ? toMinor(tipsTotal) : 0;
  if (rules.tipsPool.method === "by_taker") {
    for (const p of people) tips[p.id] = toMinor(p.tipsTaken);
  } else {
    tips = splitPool(tipsPool, people.map((p) => ({ id: p.id, weight: p.tipsEligible && p.hours > 0 ? (rules.tipsPool.method === "hours" ? p.hours : 1) : 0 })));
  }
  return { servicePool, tipsPool, service, tips };
}

import { describe, expect, it } from "vitest";
import { major } from "@/lib/money";
import { DEFAULT_HR, hrSettings, payDate, type HrSettings } from "./settings";
import { egAnnualTax, egInsurableWage, egMonthlyTax, egSocialInsurance, eosbMonthlyAccrual, eosbTotal, gosi } from "./statutory";
import { splitPool, serviceWeight } from "./pool";
import { dueInPeriod, installmentSchedule, outstanding } from "./advances";
import { accruedAnnual, annualEntitlement, balances, fitsBalance, leaveDays } from "./leave";
import { checkGeofence, distanceM } from "./geo";
import { evaluateDay, presence, summarize, type DayEval } from "./attendance";
import { computePayslip, computePools, payrollJournalLines, runTotals, type PayInput } from "./payroll";
import { attlogExternalId, attlogInstant, parseAttendanceCsv, parseAttlog, resolveAutoKinds, statusToKind } from "./zkteco";
import { businessDate, zonedToMs } from "./tz";

const E = major;
const TZ = "Africa/Cairo";
const rules: HrSettings = hrSettings(null);

describe("Egypt social insurance (Law 148/2019, 2026 bounds)", () => {
  it("11 % employee / 18.75 % employer on the insurable wage", () => {
    expect(egSocialInsurance(E(10_000), rules.insuranceEG)).toEqual({ wage: E(10_000), employee: E(1_100), employer: E(1_875) });
  });
  it("clamps to EGP 2,700 – 16,700", () => {
    expect(egInsurableWage(E(1_500), rules.insuranceEG)).toBe(E(2_700));
    expect(egInsurableWage(E(40_000), rules.insuranceEG)).toBe(E(16_700));
    expect(egSocialInsurance(E(40_000), rules.insuranceEG).employee).toBe(E(1_837));
    expect(egSocialInsurance(E(40_000), rules.insuranceEG).employer).toBe(E("3131.25"));
    expect(egSocialInsurance(E(1_000), rules.insuranceEG).employee).toBe(E(297));
    expect(egSocialInsurance(E(9_000), rules.insuranceEG, false)).toEqual({ wage: 0, employee: 0, employer: 0 });
  });
});

describe("Egypt salary tax brackets", () => {
  const cfg = rules.taxEG;
  it("progressive bands after the exemption", () => {
    expect(egAnnualTax(E(40_000), cfg)).toBe(0);
    expect(egAnnualTax(E(55_000), cfg)).toBe(E(1_500));
    expect(egAnnualTax(E(70_000), cfg)).toBe(E(3_750));
    expect(egAnnualTax(E(200_000), cfg)).toBe(E(29_750));
    expect(egAnnualTax(E(400_000), cfg)).toBe(E(74_750));
    expect(egAnnualTax(E(500_000), cfg)).toBe(E(99_750));
  });
  it("high earners lose the lower bands (Law 30/2023)", () => {
    // 650k: starts at the 10 % band → 55k×10% + 15k×15% + 130k×20% + 200k×22.5% + 250k×25%
    expect(egAnnualTax(E(650_000), cfg)).toBe(E(5_500 + 2_250 + 26_000 + 45_000 + 62_500));
    // above 1.2m: everything up to 1.2m at 25 %, the rest 27.5 %
    expect(egAnnualTax(E(1_300_000), cfg)).toBe(E(300_000 + 27_500));
    expect(egAnnualTax(E(1_300_000), { ...cfg, highEarnerRule: false })).toBe(E(3_750 + 26_000 + 45_000 + 200_000 + 27_500));
  });
  it("monthly: (taxable − employee insurance) × 12 − 20,000 exemption, ÷ 12", () => {
    // 15,000 gross, 1,650 insurance → 13,350 × 12 = 160,200 − 20,000 = 140,200 → 3,750 + 70,200×20% = 17,790 → 1,482.50 / month
    const r = egMonthlyTax(E(15_000), E(1_650), cfg);
    expect(r.annualTaxable).toBe(E(140_200));
    expect(r.annualTax).toBe(E(17_790));
    expect(r.monthly).toBe(E("1482.50"));
    // minimum wage (7,000): 6,230 × 12 − 20,000 = 54,760 → 14,760 × 10 % = 1,476 a year → 123 / month
    expect(egMonthlyTax(E(7_000), E(770), cfg).monthly).toBe(E(123));
    expect(egMonthlyTax(E(5_000), E(550), cfg).monthly).toBe(0);
    expect(egMonthlyTax(E(30_000), 0, { ...cfg, enabled: false }).monthly).toBe(0);
  });
  it("brackets are configurable", () => {
    const flat = { ...cfg, brackets: [{ upTo: null, bps: 1000 }], highEarnerRule: true };
    expect(egAnnualTax(E(100_000), flat)).toBe(E(10_000));
  });
});

describe("KSA GOSI & end of service", () => {
  it("Saudi legacy 9.75 / 11.75, non-Saudi employer 2 %, base capped at 45,000", () => {
    expect(gosi(E(8_000), E(2_000), { saudi: true }, rules.ksa)).toEqual({ base: E(10_000), employee: E(975), employer: E(1_175) });
    expect(gosi(E(8_000), E(2_000), { saudi: false }, rules.ksa)).toEqual({ base: E(10_000), employee: 0, employer: E(200) });
    expect(gosi(E(60_000), 0, { saudi: true }, rules.ksa).base).toBe(E(45_000));
  });
  it("EOSB ½ month per year for 5 years, then a month", () => {
    expect(eosbTotal(E(10_000), 4)).toBe(E(20_000));
    expect(eosbTotal(E(10_000), 7)).toBe(E(25_000 + 20_000));
    expect(eosbMonthlyAccrual(E(12_000), 2)).toBe(E(500));
    expect(eosbMonthlyAccrual(E(12_000), 6)).toBe(E(1_000));
  });
});

describe("service-charge pool & tips", () => {
  it("shares add up to the pool exactly", () => {
    const shares = splitPool(E("1000.01"), [{ id: "a", weight: 1 }, { id: "b", weight: 1 }, { id: "c", weight: 1 }]);
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBe(E("1000.01"));
    expect(shares).toEqual({ a: E("333.34"), b: E("333.34"), c: E("333.33") });
  });
  it("points × hours, zero weights get nothing, random pools always balance", () => {
    expect(serviceWeight("points_hours", 3, 200)).toBe(600);
    expect(serviceWeight("points", 3, 0)).toBe(0);
    for (let k = 0; k < 200; k++) {
      const total = E((Math.floor(Math.random() * 9_999_999) / 100).toFixed(2));
      const people = Array.from({ length: 1 + (k % 9) }, (_, i) => ({ id: `p${i}`, weight: Math.round(Math.random() * 300) / 10 }));
      people[0].weight += 1;
      const s = splitPool(total, people);
      expect(Object.values(s).reduce((a, b) => a + b, 0)).toBe(total);
      for (const v of Object.values(s)) expect(v % 1000).toBe(0);
    }
  });
  it("computePools: staff share of service, tips by hours", () => {
    const people = [
      { id: "w1", hours: 200, points: 3, tipsEligible: true, tipsTaken: 0 },
      { id: "w2", hours: 100, points: 3, tipsEligible: true, tipsTaken: 0 },
      { id: "k1", hours: 200, points: 1.5, tipsEligible: false, tipsTaken: 0 },
    ];
    const p = computePools(rules, people, E(3_000), E(10_000));
    expect(p.servicePool).toBe(E(8_000));
    expect(p.service.w1 + p.service.w2 + p.service.k1).toBe(E(8_000));
    expect(p.service.w1).toBe(E(4_000)); // 600 of 1,200 weight
    expect(p.tips).toEqual({ w1: E(2_000), w2: E(1_000), k1: 0 });
  });
});

describe("advances (السلف)", () => {
  it("equal instalments, remainder on the last, Σ = amount", () => {
    const s = installmentSchedule(E(1_000), 3, "2026-11");
    expect(s.map((x) => x.period)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(s.map((x) => x.amount)).toEqual([E("333.33"), E("333.33"), E("333.34")]);
  });
  it("due per period, catches up, never more than outstanding", () => {
    const a = { amount: E(3_000), installments: 3, startPeriod: "2026-10", recovered: 0, status: "paid" };
    expect(dueInPeriod(a, "2026-09")).toBe(0);
    expect(dueInPeriod(a, "2026-10")).toBe(E(1_000));
    expect(dueInPeriod({ ...a, recovered: E(1_000) }, "2026-11")).toBe(E(1_000));
    expect(dueInPeriod(a, "2026-11")).toBe(E(2_000)); // skipped October
    expect(dueInPeriod({ ...a, recovered: E(2_500) }, "2027-05")).toBe(E(500));
    expect(dueInPeriod({ ...a, status: "approved" }, "2026-10")).toBe(0);
    expect(outstanding({ ...a, recovered: E(1_000) })).toBe(E(2_000));
  });
});

describe("leave (الإجازات)", () => {
  const L = rules.leave;
  it("entitlement by service and age", () => {
    expect(annualEntitlement({ hireDate: "2026-08-01", birthDate: "1998-01-01" }, "2026-11-03", L)).toBe(0);
    expect(annualEntitlement({ hireDate: "2026-03-01", birthDate: "1998-01-01" }, "2026-11-03", L)).toBe(15);
    expect(annualEntitlement({ hireDate: "2022-03-01", birthDate: "1998-01-01" }, "2026-11-03", L)).toBe(21);
    expect(annualEntitlement({ hireDate: "2015-03-01", birthDate: "1998-01-01" }, "2026-11-03", L)).toBe(30);
    expect(annualEntitlement({ hireDate: "2024-03-01", birthDate: "1975-05-01" }, "2026-11-03", L)).toBe(30);
  });
  it("accrues monthly in half days", () => {
    expect(accruedAnnual(21, { hireDate: "2020-01-01" }, "2026-11-03")).toBe(19); // 21 × 11/12 = 19.25 → 19
    expect(accruedAnnual(21, { hireDate: "2020-01-01" }, "2026-06-15")).toBe(10.5);
    expect(accruedAnnual(21, { hireDate: "2026-09-10" }, "2026-11-03")).toBe(3.5); // Sep 10 → Nov 3: 2 started months
  });
  it("balances: casual counts against annual, capped at 6", () => {
    const b = balances({ entitlement: 21, accrued: 19, carried: 2, adjustment: 0, taken: { annual: 5, casual: 2 }, pending: {} }, L);
    expect(b.annual.available).toBe(14);
    expect(b.casual.available).toBe(4);
    expect(fitsBalance("annual", 14, b)).toBe(true);
    expect(fitsBalance("annual", 15, b)).toBe(false);
    expect(fitsBalance("casual", 5, b)).toBe(false);
    expect(fitsBalance("sick", 40, b)).toBe(true);
  });
  it("counts working days only", () => {
    expect(leaveDays("2026-11-01", "2026-11-07", [5])).toBe(6); // Friday off
  });
});

describe("geofence", () => {
  const zamalek = { lat: 30.0626, lng: 31.2197, radiusM: 120 };
  it("haversine distance", () => {
    // Zamalek → Tahrir Square ≈ 2.4 km
    const d = distanceM(zamalek, { lat: 30.0444, lng: 31.2357 });
    expect(d).toBeGreaterThan(2_300);
    expect(d).toBeLessThan(2_600);
    expect(distanceM(zamalek, zamalek)).toBe(0);
  });
  it("inside / outside / GPS margin capped at 50 m", () => {
    expect(checkGeofence({ lat: 30.0630, lng: 31.2199 }, zamalek).inside).toBe(true);
    const near = checkGeofence({ lat: 30.0626 + 0.0012, lng: 31.2197, accuracyM: 60 }, zamalek); // ~133 m
    expect(near.inside && near.marginal).toBe(true);
    expect(checkGeofence({ lat: 30.0626 + 0.003, lng: 31.2197, accuracyM: 2_000 }, zamalek).inside).toBe(false); // ~333 m
  });
});

describe("attendance: lateness, overtime, absence", () => {
  const at = (date: string, time: string) => new Date(zonedToMs(date, time, TZ)).toISOString();
  const shift = { date: "2026-10-12", start: "16:00", end: "00:00", breakMin: 30 };
  const after = zonedToMs("2026-10-13", "12:00", TZ);
  const ev = (punches: { at: string; kind: "in" | "out" | "break_start" | "break_end" }[], extra: Partial<Parameters<typeof evaluateDay>[0]> = {}) =>
    evaluateDay({ date: "2026-10-12", shifts: [shift], punches: punches.map((p) => ({ ...p, voided: false })), leave: null, now: after, tz: TZ, rules, ...extra });

  it("on time inside the grace period", () => {
    const d = ev([{ at: at("2026-10-12", "16:08"), kind: "in" }, { at: at("2026-10-13", "00:02"), kind: "out" }]);
    expect(d.status).toBe("on_time");
    expect(d.lateMin).toBe(0);
    expect(d.deductionDays).toBe(0);
  });
  it("late 35 min → half a day by the default tiers; early leave tier adds", () => {
    const d = ev([{ at: at("2026-10-12", "16:35"), kind: "in" }, { at: at("2026-10-12", "23:20"), kind: "out" }]);
    expect(d.status).toBe("late");
    expect(d.lateMin).toBe(35);
    expect(d.earlyMin).toBe(40);
    expect(d.deductionDays).toBe(0.75);
  });
  it("overtime after the threshold, night part at the night rate; a 01:30 punch belongs to the evening", () => {
    const out = at("2026-10-13", "01:30");
    expect(businessDate(Date.parse(out), TZ)).toBe("2026-10-12");
    const d = ev([{ at: at("2026-10-12", "15:55"), kind: "in" }, { at: out, kind: "out" }]);
    // 9h35 on the clock, paid breaks: scheduled 8h → 1h35 overtime; 90 min of it after midnight (night window 23:00–06:00)
    expect(d.workedMin).toBe(575);
    expect(d.overtimeMin).toBe(95);
    expect(d.nightOvertimeMin).toBe(90);
    const short = ev([{ at: at("2026-10-12", "16:00"), kind: "in" }, { at: at("2026-10-13", "00:20"), kind: "out" }]);
    expect(short.overtimeMin).toBe(0); // 20 min over: below the 30-min threshold
  });
  it("absent once the day is over; not yet while it runs; leave excuses", () => {
    expect(ev([]).status).toBe("absent");
    expect(ev([]).deductionDays).toBe(1);
    const during = ev([], { now: zonedToMs("2026-10-12", "17:00", TZ) });
    expect(during.status).toBe("absent");
    expect(during.deductionDays).toBe(0);
    expect(ev([], { now: zonedToMs("2026-10-12", "12:00", TZ) }).status).toBe("upcoming");
    expect(ev([], { leave: "sick" }).status).toBe("leave");
  });
  it("forgot to punch out → flagged, closed at the scheduled end", () => {
    const d = ev([{ at: at("2026-10-12", "16:00"), kind: "in" }]);
    expect(d.status).toBe("missing_out");
    expect(d.workedMin).toBe(480);
  });
  it("rest-day work and summary score", () => {
    const rest = evaluateDay({ date: "2026-10-16", shifts: [], punches: [{ at: at("2026-10-16", "12:00"), kind: "in", voided: false }, { at: at("2026-10-16", "18:00"), kind: "out", voided: false }], leave: null, now: after + 5 * 86_400_000, tz: TZ, rules });
    expect(rest.status).toBe("extra");
    expect(rest.restDayMin).toBe(360);
    const days: DayEval[] = [ev([{ at: at("2026-10-12", "16:00"), kind: "in" }, { at: at("2026-10-13", "00:00"), kind: "out" }]), ev([{ at: at("2026-10-12", "16:40"), kind: "in" }, { at: at("2026-10-13", "00:00"), kind: "out" }]), ev([]), rest];
    const s = summarize(days);
    expect(s.scheduledDays).toBe(3);
    expect(s.absentDays).toBe(1);
    expect(s.lateCount).toBe(1);
    expect(s.lateDeductionDays).toBe(0.5);
    expect(s.extraDays).toBe(1);
    expect(s.score).toBe(50);
  });
  it("presence board: last punch in → in", () => {
    const now = Date.parse(at("2026-10-12", "20:00"));
    const p = presence(
      [
        { membershipId: "a", at: at("2026-10-12", "16:00"), kind: "in", voided: false },
        { membershipId: "b", at: at("2026-10-12", "16:00"), kind: "in", voided: false },
        { membershipId: "b", at: at("2026-10-12", "19:00"), kind: "out", voided: false },
        { membershipId: "c", at: at("2026-10-12", "18:00"), kind: "break_start", voided: false },
      ],
      now,
    );
    expect([...p.keys()].sort()).toEqual(["a", "c"]);
    expect(p.get("c")?.state).toBe("break");
  });
});

describe("payroll", () => {
  const summary = summarize([]);
  const base: PayInput = {
    membershipId: "m1", name: "أحمد", position: "Waiter", branchId: "b1", nationality: "EG", hireDate: "2022-01-01",
    comp: { monthlySalary: E(12_000), hourlyRate: 0, allowances: { housing: 0, transport: E(600), meal: 0, other: 0 } },
    summary: { ...summary, workedDays: 24, scheduledDays: 26, absentDays: 1, lateDeductionDays: 0.5, overtimeMin: 300, nightOvertimeMin: 60, lateMin: 75, workedMin: 24 * 480 },
    unpaidLeaveDays: 0, tips: E("850.50"), service: E(2_400), adjustments: [{ kind: "bonus", amount: E(500), reason: "أفضل جرسون" }, { kind: "penalty", amount: E(100), reason: "كسر أطباق" }],
    advanceDue: E(1_000), periodStart: "2026-10-01",
  };

  it("earnings, overtime, attendance deductions, insurance, tax, advance", () => {
    const s = computePayslip(base, rules);
    const by = (c: string) => [...s.earnings, ...s.deductions, ...s.employer].find((l) => l.code === c)?.amount ?? 0;
    // daily 400, hourly 50
    expect(by("overtime")).toBe(E(270)); // 4h × 50 × 1.35
    expect(by("overtime_night")).toBe(E(85)); // 1h × 50 × 1.70
    expect(s.gross).toBe(E(12_000 + 600 + 270 + 85 + 850.5 + 2_400 + 500));
    expect(by("absence")).toBe(E(400));
    expect(by("lateness")).toBe(E(200));
    expect(by("penalty")).toBe(E(100));
    expect(s.insurableWage).toBe(E(12_600));
    expect(s.employeeInsurance).toBe(E(1_386));
    expect(s.employerInsurance).toBe(E(2_362.5));
    const expectedTax = egMonthlyTax(s.gross - E(700), E(1_386), rules.taxEG).monthly;
    expect(s.incomeTax).toBe(expectedTax);
    expect(s.advanceRecovered).toBe(E(1_000));
    expect(s.net).toBe(s.gross - E(700) - E(1_386) - expectedTax - E(1_000));
    expect(s.net).toBe(s.gross - s.totalDeductions);
  });

  it("daily and hourly staff; never deduct more than earned; advance limited to what is left", () => {
    const daily = computePayslip({ ...base, comp: { salaryType: "daily", dailyRate: E(450), monthlySalary: 0, hourlyRate: 0 }, tips: 0, service: 0, adjustments: [], advanceDue: 0 }, rules);
    expect(daily.earnings[0].amount).toBe(E(24 * 450));
    const hourly = computePayslip({ ...base, comp: { salaryType: "hourly", hourlyRate: E(60), monthlySalary: 0 }, tips: 0, service: 0, adjustments: [], advanceDue: 0 }, rules);
    expect(hourly.earnings[0].qty).toBe((24 * 480 - 300) / 60);
    const broke = computePayslip({ ...base, comp: { monthlySalary: E(3_000), hourlyRate: 0, insured: false }, tips: 0, service: 0, adjustments: [{ kind: "penalty", amount: E(5_000), reason: "x" }], advanceDue: E(2_000) }, rules);
    expect(broke.net).toBe(0);
    expect(broke.advanceRecovered).toBe(0);
  });

  it("KSA mode: GOSI + EOSB accrual, no income tax", () => {
    const sa = hrSettings({ hr: { country: "SA" } });
    const s = computePayslip({ ...base, nationality: "SA", comp: { monthlySalary: E(8_000), hourlyRate: 0, allowances: { housing: E(2_000), transport: E(500), meal: 0, other: 0 } }, tips: 0, service: 0, adjustments: [], advanceDue: 0, summary }, sa);
    expect(s.employeeInsurance).toBe(E(975));
    expect(s.employerInsurance).toBe(E(1_175));
    expect(s.incomeTax).toBe(0);
    expect(s.eosb).toBe(E("437.50")); // 10,500 × ½ ÷ 12
  });

  it("run journal balances and matches the payslips", () => {
    const slips = [computePayslip(base, rules), computePayslip({ ...base, membershipId: "m2", comp: { monthlySalary: E(30_000), hourlyRate: 0 }, tips: 0, service: E(1_000), adjustments: [], advanceDue: 0 }, rules), computePayslip({ ...base, membershipId: "m3", nationality: "SA" }, hrSettings({ hr: { country: "SA" } }))];
    const lines = payrollJournalLines(slips);
    const dr = lines.reduce((a, l) => a + l.debit, 0);
    const cr = lines.reduce((a, l) => a + l.credit, 0);
    expect(dr).toBe(cr);
    const t = runTotals(slips);
    expect(lines.find((l) => l.account === "2401")?.credit).toBe(t.net);
    expect(lines.find((l) => l.account === "2303")?.credit).toBe(t.incomeTax);
    expect(lines.find((l) => l.account === "2304")?.credit).toBe(t.employeeInsurance + t.employerInsurance);
    expect(lines.find((l) => l.account === "1202")?.credit).toBe(t.advances);
    expect(t.net).toBe(t.gross - t.deductions);
    for (const l of lines) expect(l.debit === 0 || l.credit === 0).toBe(true);
  });

  it("pay day", () => {
    expect(payDate("2026-02", 30)).toBe("2026-02-28");
    expect(payDate("2026-11", 0)).toBe("2026-11-30");
    expect(payDate("2026-11", DEFAULT_HR.payDay)).toBe("2026-11-28");
  });
});

describe("ZKTeco ATTLOG (ADMS push)", () => {
  const body = ["1\t2026-10-12 15:58:21\t0\t1\t0\t0\t0", "1\t2026-10-13 00:04:10\t1\t1\t0\t0\t0", "  ", "27\t2026-10-12 16:31:00\t0\t15\t0", "9 2026-10-12 16:02:00 255 1", "x y", "5\t2026-13-40 10:00:00\t0\t1", "3\t2026-10-12 16:00\t2\t1"].join("\r\n");
  it("parses tab and space lines, rejects bad ones", () => {
    const r = parseAttlog(body);
    expect(r.records.map((x) => x.userId)).toEqual(["1", "1", "27", "9", "3"]);
    expect(r.records[2]).toEqual({ userId: "27", local: "2026-10-12 16:31:00", status: 0, verify: 15, workcode: "0" });
    expect(r.records[4].local).toBe("2026-10-12 16:00:00");
    expect(r.errors.map((e) => e.line)).toEqual([6, 7]);
  });
  it("status codes, local time → UTC (Cairo), stable idempotency key", () => {
    expect([0, 1, 2, 3, 4, 5, 255].map(statusToKind)).toEqual(["in", "out", "break_start", "break_end", "in", "out", null]);
    const r = parseAttlog(body).records[0];
    expect(attlogInstant(r, TZ)).toBe("2026-10-12T12:58:21.000Z"); // EEST (+3) in October 2026
    expect(attlogInstant({ ...r, local: "2026-12-12 15:58:21" }, TZ)).toBe("2026-12-12T13:58:21.000Z"); // EET (+2)
    expect(attlogExternalId("CQZ7231460021", r)).toBe("zk:CQZ7231460021:1:2026-10-12 15:58:21:0");
    expect(parseAttlog(body).records.map((x) => attlogExternalId("S", x))).toEqual([...new Set(parseAttlog(body).records.map((x) => attlogExternalId("S", x)))]);
  });
  it("CSV fallback: ZKTeco export headers, dd/mm/yyyy AM/PM, auto in/out", () => {
    const csv = "AC-No.,Name,Time,State\r\n1,أحمد سمير,12/10/2026 3:58 PM,C/In\r\n1,أحمد سمير,13/10/2026 12:04 AM,C/Out\r\n27,سارة,12/10/2026 16:31,\r\n27,سارة,12/10/2026 23:59,\r\n,,bad,\r\n";
    const r = parseAttendanceCsv(csv);
    expect(r.punches).toHaveLength(4);
    expect(r.punches[0]).toMatchObject({ userId: "1", local: "2026-10-12 15:58:00", kind: "in" });
    expect(r.punches[1].local).toBe("2026-10-13 00:04:00");
    expect(r.errors).toHaveLength(1);
    const auto = resolveAutoKinds(r.punches.filter((p) => p.userId === "27"));
    expect(auto.map((p) => p.kind)).toEqual(["in", "out"]);
    expect(parseAttendanceCsv("foo,bar\n1,2").errors[0].reason).toMatch(/need/);
  });
});

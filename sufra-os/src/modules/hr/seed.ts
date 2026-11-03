/**
 * Demo HR rows for the seed restaurant (src/data/seed.ts calls this). Deterministic (seeded PRNG + seedId), fictional.
 *
 *  - staff files for everyone (hire dates, national IDs, health certificates — one expiring soon, one missing), richer
 *    compensation (allowances, service points, pay method; one daily-paid rider)
 *  - shift templates; rota from the start of last month through next week (current week published, next week draft)
 *  - attendance punches from the 1st of last month until now: mostly on time, realistic lates (15–55 min), a few absences,
 *    forgotten clock-outs, overtime on busy nights; today's evening shift is clocked in
 *  - leave balances + requests (approved annual, sick, pending casual, rejected), 2 advances, a bonus and a penalty
 *  - last month's payroll run — computed with the real rules, approved and paid, with its two journal entries
 *  - one ZKTeco terminal, the branch geofence and HR settings
 */
import type {
  Advance, AttendanceDevice, AttendancePunch, LeaveBalance, LeaveRequest, Localized, Membership, PayrollAdjustment, PayrollRun, Payslip, RotaShift, Settings, ShiftSwap,
  ShiftTemplate, StaffCompensation, StaffProfile, LedgerEntry,
} from "@/data/types";
import { major } from "@/lib/money";
import { sha256 } from "@/lib/sha256";
import { DEFAULT_HR, payDate, type HrSettings } from "./lib/settings";
import { addDays, addMonths, businessDate, dateRange, periodBounds, weekStart, weekday, zonedToMs } from "./lib/tz";
import { evaluateDay, punchesByDay, summarize } from "./lib/attendance";
import { computePayslip, computePools, effectiveComp, payrollJournalLines, payoutAccount, runTotals } from "./lib/payroll";
import { ACC } from "@/modules/accounting/chart";

interface Ctx {
  restaurantId: string;
  branchId: string;
  now: Date;
  id: (key: string) => string;
  staffId: (k: string) => string;
  memberships: Membership[];
  staffCompensation: StaffCompensation[];
  settings: Settings[];
  created: string;
  origin: { lat: number; lng: number };
}

const L = (ar: string, en: string): Localized => ({ ar, en });
const E = major;
const TZ = "Africa/Cairo";

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** per demo person: job, station, template, weekly day off (0 Sun … 6 Sat), hire date, birth, device number */
const PEOPLE: Record<string, { pos: Localized; station: string; tpl: string; off: number; hire: string; birth: string; food: boolean; dev: string; nid: string }> = {
  admin: { pos: L("مديرة إدارية", "Operations admin"), station: "office", tpl: "office", off: 5, hire: "2019-02-10", birth: "1988-06-02", food: false, dev: "2", nid: "28806020101234" },
  manager: { pos: L("مدير الصالة", "Floor manager"), station: "floor", tpl: "evening", off: 2, hire: "2020-09-01", birth: "1986-03-14", food: false, dev: "3", nid: "28603140102345" },
  cashier1: { pos: L("كاشير", "Cashier"), station: "cashier", tpl: "evening", off: 3, hire: "2023-04-15", birth: "1997-11-21", food: false, dev: "4", nid: "29711210103456" },
  cashier2: { pos: L("كاشير", "Cashier"), station: "cashier", tpl: "morning", off: 4, hire: "2024-01-20", birth: "1999-02-08", food: false, dev: "5", nid: "29902080104567" },
  waiter1: { pos: L("جرسون أول", "Head waiter"), station: "floor", tpl: "evening", off: 1, hire: "2021-06-01", birth: "1995-08-30", food: true, dev: "6", nid: "29508300105678" },
  waiter2: { pos: L("جرسون", "Waiter"), station: "floor", tpl: "evening", off: 0, hire: "2024-07-01", birth: "2000-01-12", food: true, dev: "7", nid: "30001120106789" },
  waiter3: { pos: L("جرسونة", "Waitress"), station: "floor", tpl: "late", off: 3, hire: "2026-04-01", birth: "2001-05-05", food: true, dev: "8", nid: "30105050107890" },
  chef: { pos: L("شيف تنفيذي", "Executive chef"), station: "grill", tpl: "kitchen", off: 1, hire: "2016-03-01", birth: "1974-12-01", food: true, dev: "9", nid: "27412010108901" },
  kitchen: { pos: L("مساعد شيف", "Commis chef"), station: "hot", tpl: "kitchen", off: 4, hire: "2022-10-10", birth: "1996-09-17", food: true, dev: "10", nid: "29609170109012" },
  delivery: { pos: L("طيار دليفري", "Delivery rider"), station: "delivery", tpl: "rider", off: 2, hire: "2023-08-01", birth: "1998-04-04", food: false, dev: "11", nid: "29804040110123" },
  delivery2: { pos: L("طيار دليفري", "Delivery rider"), station: "delivery", tpl: "rider", off: 0, hire: "2024-11-15", birth: "1999-07-19", food: false, dev: "12", nid: "29907190111234" },
  delivery3: { pos: L("طيار (يومية)", "Rider (daily)"), station: "delivery", tpl: "rider", off: 6, hire: "2025-12-01", birth: "2002-03-03", food: false, dev: "13", nid: "30203030112345" },
  accountant: { pos: L("محاسبة", "Accountant"), station: "office", tpl: "office", off: 5, hire: "2021-01-05", birth: "1990-10-10", food: false, dev: "14", nid: "29010100113456" },
};

const TEMPLATES: { key: string; name: Localized; start: string; end: string; breakMin: number; station: string | null; color: string }[] = [
  { key: "morning", name: L("صباحي", "Morning"), start: "10:00", end: "18:00", breakMin: 30, station: null, color: "#2f6f9f" },
  { key: "kitchen", name: L("مطبخ", "Kitchen"), start: "12:00", end: "21:00", breakMin: 45, station: "grill", color: "#c2412d" },
  { key: "rider", name: L("دليفري", "Delivery"), start: "13:00", end: "22:00", breakMin: 30, station: "delivery", color: "#3a5f7a" },
  { key: "evening", name: L("مسائي", "Evening"), start: "16:00", end: "00:00", breakMin: 30, station: null, color: "#0d5a53" },
  { key: "late", name: L("قفل", "Closing"), start: "18:00", end: "02:00", breakMin: 30, station: null, color: "#6b4fa0" },
  { key: "office", name: L("إداري", "Office"), start: "10:00", end: "18:00", breakMin: 60, station: "office", color: "#5b6a64" },
];

/** compensation extras by person (base salaries come from src/data/seed.ts) */
const COMP: Record<string, Partial<StaffCompensation>> = {
  admin: { allowances: { housing: 0, transport: E(1_500), meal: 0, other: 0 }, servicePoints: 0, payMethod: "bank", bankName: "CIB", iban: "EG380010015100000100012345678" },
  manager: { allowances: { housing: 0, transport: E(1_000), meal: E(600), other: 0 }, servicePoints: 4, payMethod: "bank", bankName: "Banque Misr", iban: "EG800002000156789012345678901" },
  cashier1: { allowances: { housing: 0, transport: E(600), meal: E(400), other: 0 }, servicePoints: 2, tipsEligible: true, payMethod: "wallet", walletNumber: "01005550104" },
  cashier2: { allowances: { housing: 0, transport: E(600), meal: E(400), other: 0 }, servicePoints: 2, tipsEligible: true, payMethod: "cash" },
  waiter1: { allowances: { housing: 0, transport: E(500), meal: E(400), other: 0 }, servicePoints: 3, tipsEligible: true, payMethod: "instapay", walletNumber: "01005550106" },
  waiter2: { allowances: { housing: 0, transport: E(500), meal: E(400), other: 0 }, servicePoints: 3, tipsEligible: true, payMethod: "cash" },
  waiter3: { allowances: { housing: 0, transport: E(500), meal: E(400), other: 0 }, servicePoints: 2, tipsEligible: true, payMethod: "cash" },
  chef: { allowances: { housing: 0, transport: E(2_000), meal: 0, other: E(1_000) }, servicePoints: 4, payMethod: "bank", bankName: "QNB", iban: "EG230037000908180000001234567", insurableWage: E(16_700) },
  kitchen: { allowances: { housing: 0, transport: E(500), meal: E(400), other: 0 }, servicePoints: 2, payMethod: "cash" },
  delivery: { allowances: { housing: 0, transport: E(800), meal: E(400), other: 0 }, servicePoints: 1, payMethod: "wallet", walletNumber: "01005550111" },
  delivery2: { allowances: { housing: 0, transport: E(800), meal: E(400), other: 0 }, servicePoints: 1, payMethod: "cash" },
  delivery3: { salaryType: "daily", dailyRate: E(450), servicePoints: 1, payMethod: "cash", insured: false },
  accountant: { allowances: { housing: 0, transport: E(1_000), meal: 0, other: 0 }, servicePoints: 0, payMethod: "bank", bankName: "NBE", iban: "EG070003000120000000045678901" },
};

export function demoHrRows(c: Ctx) {
  const R = c.restaurantId;
  const B = c.branchId;
  const nowMs = c.now.getTime();
  const base = (k: string, at = c.created) => ({ id: c.id(`hr:${k}`), restaurantId: R, createdAt: at, updatedAt: at });
  const rnd = prng(20261103);
  const today = businessDate(nowMs, TZ);
  const thisPeriod = today.slice(0, 7);
  const lastPeriod = addMonths(thisPeriod, -1);
  const from = periodBounds(lastPeriod).from;
  const keyOf = new Map(Object.keys(PEOPLE).map((k) => [c.staffId(k), k]));
  const people = Object.keys(PEOPLE);

  /* settings */
  const hr: HrSettings = { ...DEFAULT_HR, geofences: { [B]: { lat: c.origin.lat, lng: c.origin.lng, radiusM: 150 } } };
  if (c.settings[0]) c.settings[0].hr = hr;

  /* compensation */
  for (const comp of c.staffCompensation) {
    const k = keyOf.get(comp.membershipId);
    if (k && COMP[k]) Object.assign(comp, { salaryType: "monthly", insured: true, tipsEligible: false, ...COMP[k] });
  }
  const compBy = new Map(c.staffCompensation.map((x) => [x.membershipId, x]));

  /* staff files */
  const healthExpiry = (k: string) => (k === "waiter2" ? addDays(today, 12) : k === "kitchen" ? addDays(today, -6) : addDays(today, 180 + people.indexOf(k) * 9));
  const staffProfiles: StaffProfile[] = people.map((k) => {
    const p = PEOPLE[k];
    const docs: StaffProfile["documents"] = [
      { id: c.id(`hr:doc:${k}:nid`), kind: "national_id", number: p.nid, issuedAt: "2021-05-01", expiresAt: k === "cashier2" ? addDays(today, 25) : "2028-05-01", fileUrl: null, note: "" },
      { id: c.id(`hr:doc:${k}:contract`), kind: "contract", number: `CT-${p.dev.padStart(3, "0")}`, issuedAt: p.hire, expiresAt: null, fileUrl: null, note: "" },
    ];
    // waiter3 (new) has no health certificate yet → "missing" alert
    if (p.food && k !== "waiter3") docs.push({ id: c.id(`hr:doc:${k}:health`), kind: "health_certificate", number: `HC-${p.nid.slice(-6)}`, issuedAt: addDays(healthExpiry(k), -365), expiresAt: healthExpiry(k), fileUrl: null, note: "مكتب صحة الزمالك" });
    return {
      ...base(`profile:${k}`), membershipId: c.staffId(k), photoUrl: null, nationalId: p.nid, nationality: "EG", birthDate: p.birth, hireDate: p.hire,
      contractType: k === "delivery3" ? "daily" : k === "waiter3" ? "probation" : "permanent", contractEnd: k === "waiter3" ? "2026-12-31" : null, position: p.pos, station: p.station,
      foodHandler: p.food, emergencyContact: { name: k === "chef" ? "أم أحمد" : "ولي الأمر", phone: `0122${p.nid.slice(-7)}`, relation: k === "chef" ? "زوجة" : "أب" },
      address: "القاهرة", documents: docs, deviceUserId: p.dev, weeklyOff: [p.off], terminatedAt: null, terminationReason: null, notes: "",
    };
  });
  // the owner gets a file too (no payroll)
  staffProfiles.push({ ...base("profile:owner"), membershipId: c.staffId("owner"), photoUrl: null, nationalId: null, nationality: "EG", birthDate: "1978-01-01", hireDate: "2015-01-01", contractType: "permanent", contractEnd: null, position: L("صاحب المطعم", "Owner"), station: "office", foodHandler: false, emergencyContact: null, address: null, documents: [], deviceUserId: "1", weeklyOff: [5], terminatedAt: null, terminationReason: null, notes: "" });

  const shiftTemplates: ShiftTemplate[] = TEMPLATES.map((t, i) => ({ ...base(`tpl:${t.key}`), branchId: B, name: t.name, start: t.start, end: t.end, breakMin: t.breakMin, station: t.station, color: t.color, sort: i }));
  const tplBy = new Map(TEMPLATES.map((t) => [t.key, t]));

  /* rota: start of last month → end of next week */
  const thisWeek = weekStart(today, hr.weekStartsOn);
  const lastDay = addDays(thisWeek, 13);
  const rotaShifts: RotaShift[] = [];
  for (const k of people) {
    const p = PEOPLE[k];
    for (const d of dateRange(from, lastDay)) {
      if (weekday(d) === p.off) continue;
      const t = tplBy.get(p.tpl)!;
      const nextWeek = d > addDays(thisWeek, 6);
      // busy Thursday/Friday nights: the evening crew stays to close
      const end = (weekday(d) === 4 || weekday(d) === 5) && p.tpl === "evening" ? "01:00" : t.end;
      rotaShifts.push({
        ...base(`rota:${k}:${d}`), branchId: B, membershipId: c.staffId(k), date: d, start: t.start, end, breakMin: t.breakMin, station: p.station, templateId: c.id(`hr:tpl:${t.key}`),
        published: !nextWeek || d <= addDays(thisWeek, 9), publishedAt: nextWeek && d > addDays(thisWeek, 9) ? null : c.created, note: "",
      });
    }
  }
  // an open shift on Friday night (anyone can pick it up)
  rotaShifts.push({ ...base("rota:open:fri"), branchId: B, membershipId: null, date: addDays(thisWeek, 6), start: "18:00", end: "02:00", breakMin: 30, station: "floor", templateId: c.id("hr:tpl:late"), published: true, publishedAt: c.created, note: "حفلة عيد ميلاد كبيرة" });

  /* leave */
  const lr = (k: string, who: string, type: LeaveRequest["type"], f: string, t: string, days: number, status: LeaveRequest["status"], reason: string): LeaveRequest => ({
    ...base(`leave:${k}`, new Date(Date.parse(`${f}T08:00:00Z`) - 5 * 86_400_000).toISOString()), membershipId: c.staffId(who), type, from: f, to: t, days, reason, status,
    decidedBy: status === "pending" ? null : c.staffId("manager"), decidedAt: status === "pending" ? null : c.created, decisionNote: status === "rejected" ? "نهاية الأسبوع زحمة — خليها الأسبوع الجاي" : "",
  });
  const leaveRequests: LeaveRequest[] = [
    lr("1", "waiter2", "annual", addDays(from, 8), addDays(from, 11), 4, "approved", "فرح أخويا في المنيا"),
    lr("2", "kitchen", "sick", addDays(today, -9), addDays(today, -8), 2, "approved", "دور برد — معاه شهادة"),
    lr("3", "cashier1", "casual", addDays(today, 5), addDays(today, 5), 1, "pending", "مشوار في الشهر العقاري"),
    lr("4", "delivery", "annual", addDays(today, 2), addDays(today, 3), 2, "rejected", "إجازة"),
    lr("5", "chef", "annual", addDays(today, 14), addDays(today, 20), 6, "pending", "عمرة إن شاء الله"),
  ];
  const year = Number(today.slice(0, 4));
  const leaveBalances: LeaveBalance[] = people.map((k, i) => ({ ...base(`lbal:${k}:${year}`), membershipId: c.staffId(k), year, type: "annual", carried: [2, 0, 3, 1, 0, 4, 0, 5, 1, 0, 2, 0, 3][i] ?? 0, adjustment: 0, entitlement: null }));

  /* punches */
  const leaveOn = (mid: string, d: string) => leaveRequests.find((l) => l.membershipId === mid && l.status === "approved" && l.from <= d && l.to >= d);
  const attendancePunches: AttendancePunch[] = [];
  const src = (k: string): AttendancePunch["source"] => (PEOPLE[k].station === "delivery" ? "mobile" : PEOPLE[k].station === "office" ? "pin" : "device");
  const addPunch = (k: string, d: string, kind: AttendancePunch["kind"], ms: number, extra: Partial<AttendancePunch> = {}) => {
    const s = extra.source ?? src(k);
    const near = s === "mobile" ? { lat: c.origin.lat + (rnd() - 0.5) * 0.0012, lng: c.origin.lng + (rnd() - 0.5) * 0.0012, accuracyM: Math.round(8 + rnd() * 20) } : null;
    attendancePunches.push({
      ...base(`punch:${k}:${d}:${kind}:${attendancePunches.length}`, new Date(ms).toISOString()), branchId: B, membershipId: c.staffId(k), at: new Date(ms).toISOString(), kind, source: s,
      lat: near?.lat ?? null, lng: near?.lng ?? null, accuracyM: near?.accuracyM ?? null, distanceM: near ? Math.round(Math.hypot((near.lat - c.origin.lat) * 111_000, (near.lng - c.origin.lng) * 96_000)) : null,
      photoUrl: null, deviceSn: s === "device" ? "CQZ7231460021" : null, deviceUserId: s === "device" ? PEOPLE[k].dev : null,
      externalId: s === "device" ? `zk:CQZ7231460021:${PEOPLE[k].dev}:${new Date(ms).toISOString()}` : null, voided: false, correctedBy: null, note: "", ...extra,
    });
  };
  // the "story" of the month: who is often late, who skipped a day
  const lateProne: Record<string, number> = { waiter2: 0.3, delivery2: 0.25, cashier2: 0.15, kitchen: 0.12 };
  for (const sh of rotaShifts) {
    if (!sh.membershipId || !sh.published) continue;
    const k = keyOf.get(sh.membershipId);
    if (!k) continue;
    const startMs = zonedToMs(sh.date, sh.start, TZ);
    if (startMs > nowMs || sh.date > today) continue;
    if (leaveOn(sh.membershipId, sh.date)) continue;
    const r = rnd();
    const isToday = sh.date === today;
    if (!isToday && r < 0.035) continue; // absent
    const lateP = lateProne[k] ?? 0.06;
    const late = rnd() < lateP ? 15 + Math.floor(rnd() * 40) : Math.floor(rnd() * 12) - 6;
    const inMs = startMs + late * 60_000;
    if (inMs > nowMs) continue;
    addPunch(k, sh.date, "in", inMs);
    const endMs = zonedToMs(sh.end <= sh.start ? addDays(sh.date, 1) : sh.date, sh.end, TZ);
    if (endMs > nowMs) continue; // still at work
    // breaks for the kitchen (logged on the terminal)
    if (PEOPLE[k].station === "grill" || PEOPLE[k].station === "hot") {
      const bs = startMs + 4 * 3_600_000 + Math.floor(rnd() * 30) * 60_000;
      addPunch(k, sh.date, "break_start", bs);
      addPunch(k, sh.date, "break_end", bs + (35 + Math.floor(rnd() * 15)) * 60_000);
    }
    const rr = rnd();
    if (!isToday && rr < 0.03) continue; // forgot to clock out
    const busy = weekday(sh.date) === 4 || weekday(sh.date) === 5;
    const stay = rr > 0.86 && busy ? 45 + Math.floor(rnd() * 75) : rr < 0.08 ? -(30 + Math.floor(rnd() * 30)) : Math.floor(rnd() * 15) - 3;
    addPunch(k, sh.date, "out", Math.min(nowMs, endMs + stay * 60_000));
  }
  // a manager correction (audit trail): forgot to clock out → fixed
  const fixDay = addDays(today, -4);
  const fixShift = rotaShifts.find((s) => s.membershipId === c.staffId("waiter1") && s.date === fixDay);
  if (fixShift && !attendancePunches.some((p) => p.membershipId === c.staffId("waiter1") && p.kind === "out" && businessDate(Date.parse(p.at), TZ) === fixDay) && attendancePunches.some((p) => p.membershipId === c.staffId("waiter1") && businessDate(Date.parse(p.at), TZ) === fixDay)) {
    addPunch("waiter1", fixDay, "out", zonedToMs(addDays(fixDay, 1), "00:10", TZ), { source: "manual", correctedBy: c.staffId("manager"), note: "نسي يبصم انصراف — اتأكدت من الكاميرا" });
  }
  // an unmapped fingerprint (new hire enrolled on the terminal, not linked yet)
  addPunch("waiter3", today, "in", Math.min(nowMs, zonedToMs(today, "11:58", TZ)), { membershipId: null, deviceUserId: "21", source: "device", externalId: `zk:CQZ7231460021:21:${today}T11:58` });

  /* swaps */
  const swapShift = rotaShifts.find((s) => s.membershipId === c.staffId("waiter2") && s.date > today && s.published);
  const shiftSwaps: ShiftSwap[] = swapShift
    ? [{ ...base("swap:1"), shiftId: swapShift.id, fromId: c.staffId("waiter2"), toId: c.staffId("waiter3"), reason: "عندي امتحان الصبح", status: "pending", decidedBy: null, decidedAt: null }]
    : [];

  /* advances */
  const advances: Advance[] = [
    {
      ...base("adv:1"), membershipId: c.staffId("waiter2"), branchId: B, kind: "advance", amount: E(3_000), installments: 3, startPeriod: lastPeriod, reason: "مصاريف مدارس", status: "paid",
      requestedAt: `${addDays(from, -5)}T10:00:00.000Z`, approvedBy: c.staffId("owner"), approvedAt: `${addDays(from, -4)}T10:00:00.000Z`, paidVia: "bank", paidAt: `${addDays(from, -4)}T12:00:00.000Z`,
      paidBy: c.staffId("accountant"), cashMovementId: null, recovered: 0,
    },
    {
      ...base("adv:2", new Date(nowMs - 26 * 3_600_000).toISOString()), membershipId: c.staffId("delivery"), branchId: B, kind: "advance", amount: E(1_500), installments: 2, startPeriod: thisPeriod,
      reason: "تصليح الموتوسيكل", status: "requested", requestedAt: new Date(nowMs - 26 * 3_600_000).toISOString(), approvedBy: null, approvedAt: null, paidVia: null, paidAt: null, paidBy: null, cashMovementId: null, recovered: 0,
    },
  ];

  const payrollAdjustments: PayrollAdjustment[] = [
    { ...base("adj:1"), membershipId: c.staffId("waiter1"), period: thisPeriod, kind: "bonus", amount: E(750), reason: "أعلى تقييم من الزباين", createdBy: c.staffId("manager") },
    { ...base("adj:2"), membershipId: c.staffId("kitchen"), period: thisPeriod, kind: "penalty", amount: E(200), reason: "تأخير تحضير الطلبات", createdBy: c.staffId("chef") },
    { ...base("adj:3"), membershipId: c.staffId("chef"), period: lastPeriod, kind: "bonus", amount: E(2_000), reason: "تقييم مطبخ ممتاز", createdBy: c.staffId("owner") },
  ];

  /* last month's payroll — computed with the real rules, approved and paid */
  const lp = periodBounds(lastPeriod);
  const byDay = punchesByDay(attendancePunches, TZ);
  const runNow = zonedToMs(addDays(lp.to, 1), "12:00", TZ);
  const payrollMembers = c.memberships.filter((m) => compBy.get(m.id) && keyOf.has(m.id));
  const sums = new Map(
    payrollMembers.map((m) => {
      const days = dateRange(lp.from, lp.to).map((d) =>
        evaluateDay({ date: d, shifts: rotaShifts.filter((s) => s.membershipId === m.id && s.date === d && s.published), punches: byDay.get(`${m.id}|${d}`) ?? [], leave: leaveOn(m.id, d)?.type ?? null, now: runNow, tz: TZ, rules: hr }),
      );
      return [m.id, summarize(days)] as const;
    }),
  );
  const pools = computePools(
    hr,
    payrollMembers.map((m) => {
      const ec = effectiveComp(compBy.get(m.id), hr);
      return { id: m.id, hours: sums.get(m.id)!.workedMin / 60, points: ec.servicePoints, tipsEligible: ec.tipsEligible, tipsTaken: 0 };
    }),
    E(18_460),
    E(301_250),
  );
  const runId = c.id("hr:run:last");
  const paidAt = `${payDate(lastPeriod, hr.payDay)}T13:00:00.000Z`;
  const drafts = payrollMembers.map((m) => {
    const k = keyOf.get(m.id)!;
    return computePayslip(
      {
        membershipId: m.id, name: m.name, position: PEOPLE[k].pos.ar, branchId: B, nationality: "EG", hireDate: PEOPLE[k].hire, comp: compBy.get(m.id)!, summary: sums.get(m.id)!, unpaidLeaveDays: 0,
        tips: pools.tips[m.id] ?? 0, service: pools.service[m.id] ?? 0, adjustments: payrollAdjustments.filter((a) => a.membershipId === m.id && a.period === lastPeriod),
        advanceDue: m.id === c.staffId("waiter2") ? E(1_000) : 0, periodStart: lp.from,
      },
      hr,
    );
  });
  advances[0].recovered = drafts.find((d) => d.membershipId === c.staffId("waiter2"))?.advanceRecovered ?? 0;
  const payslips: Payslip[] = drafts.map((d) => ({
    ...base(`slip:${keyOf.get(d.membershipId)}`, paidAt), runId, membershipId: d.membershipId, branchId: B, period: lastPeriod, name: d.name, position: d.position, earnings: d.earnings, deductions: d.deductions,
    employer: d.employer, gross: d.gross, totalDeductions: d.totalDeductions, net: d.net, insurableWage: d.insurableWage, employeeInsurance: d.employeeInsurance, employerInsurance: d.employerInsurance,
    incomeTax: d.incomeTax, advanceRecovered: d.advanceRecovered, workedDays: d.workedDays, absentDays: d.absentDays, lateMinutes: d.lateMinutes, overtimeMinutes: d.overtimeMinutes, payMethod: d.payMethod,
    status: "paid", paidAt,
  }));
  const totals = runTotals(drafts);
  const accrual: LedgerEntry = { ...base("je:payroll:last", paidAt), branchId: B, date: payDate(lastPeriod, hr.payDay), sourceType: "payroll", sourceId: runId, memo: `Payroll ${lastPeriod} · الرواتب`, lines: payrollJournalLines(drafts) };
  const byAcc = new Map<string, number>();
  for (const d of drafts) byAcc.set(payoutAccount(d.payMethod), (byAcc.get(payoutAccount(d.payMethod)) ?? 0) + d.net);
  const payment: LedgerEntry = {
    ...base("je:payroll:last:paid", paidAt), branchId: B, date: payDate(lastPeriod, hr.payDay), sourceType: "payroll.payment", sourceId: runId, memo: `Salaries paid ${lastPeriod} · صرف الرواتب`,
    lines: [{ account: ACC.salariesPayable, debit: totals.net, credit: 0 }, ...[...byAcc].map(([account, v]) => ({ account, debit: 0, credit: v }))],
  };
  const advanceJe: LedgerEntry = {
    ...base("je:advance:1", advances[0].paidAt!), branchId: B, date: advances[0].paidAt!.slice(0, 10), sourceType: "staff.advance", sourceId: advances[0].id, memo: "سلفة يوسف محمود / staff advance",
    lines: [{ account: ACC.staffAdvances, debit: E(3_000), credit: 0, dims: { staff: advances[0].membershipId } }, { account: ACC.bank, debit: 0, credit: E(3_000) }],
  };
  const payrollRuns: PayrollRun[] = [{
    ...base("run:last", paidAt), branchId: null, period: lastPeriod, country: "EG", status: "paid", totals, createdBy: c.staffId("accountant"), approvedBy: c.staffId("owner"), approvedAt: paidAt,
    paidAt, paidBy: c.staffId("accountant"), ledgerEntryIds: [accrual.id, payment.id], snapshot: { pools: { tips: pools.tipsPool, service: pools.servicePool, serviceCollected: E(301_250) } }, note: "",
  }];

  const attendanceDevices: AttendanceDevice[] = [{
    ...base("device:zk1"), branchId: B, name: "بصمة باب العاملين", serial: "CQZ7231460021", model: "ZKTeco SpeedFace-V5L", secretHash: sha256("demo-device-secret"), timezone: TZ, active: true,
    lastSeenAt: new Date(nowMs - 3 * 60_000).toISOString(), lastStamp: "9999", allowedIps: [],
  }];

  return {
    rows: { staffProfiles, shiftTemplates, rotaShifts, shiftSwaps, attendancePunches, attendanceDevices, leaveRequests, leaveBalances, advances, payrollAdjustments, payrollRuns, payslips },
    ledgerEntries: [advanceJe, accrual, payment],
  };
}

import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "@/data/local/LocalAdapter";
import { makeDb } from "@/data/hooks";
import { buildSeed, DEMO_BRANCH_ID, DEMO_RESTAURANT_ID, staffId } from "@/data/seed";
import { major } from "@/lib/money";
import { homeFor, visibleModules } from "@/modules/registry";
import { approveRun, buildRun, createStaff, decideAdvance, decideLeave, documentAlerts, HrError, importPunches, markRunPaid, payAdvance, punch, requestAdvance, requestLeave, saveRun, voidPunch } from "./ops";
import { businessDate } from "./lib/tz";
import { parseAttendanceCsv } from "./lib/zkteco";

let n = 0;
const open: LocalAdapter[] = [];
afterEach(() => {
  while (open.length) open.pop()!.close();
});
async function setup(actor = "owner") {
  const repo = new LocalAdapter({ name: `hr${++n}`, sessionKey: `hr${n}.s`, memory: true });
  open.push(repo);
  await repo.ready();
  return { repo, db: makeDb(repo, DEMO_RESTAURANT_ID, DEMO_BRANCH_ID, staffId(actor)) };
}
const sumLines = (lines: { debit: number; credit: number }[]) => [lines.reduce((a, l) => a + l.debit, 0), lines.reduce((a, l) => a + l.credit, 0)];

describe("HR seed", () => {
  const { data } = buildSeed(new Date("2026-10-23T20:00:00+03:00"));
  it("has files, a published week, 30 days of attendance with lates and absences, leave, 2 advances and last month paid", () => {
    expect(data.staffProfiles.length).toBeGreaterThanOrEqual(13);
    expect(data.rotaShifts.some((s) => s.published) && data.rotaShifts.some((s) => !s.published)).toBe(true);
    const days = new Set(data.attendancePunches.map((p) => businessDate(Date.parse(p.at), "Africa/Cairo")));
    expect(days.size).toBeGreaterThanOrEqual(28);
    expect(data.advances).toHaveLength(2);
    expect(data.leaveRequests.some((l) => l.status === "pending")).toBe(true);
    const run = data.payrollRuns[0];
    expect(run.status).toBe("paid");
    expect(data.payslips.reduce((a, s) => a + s.net, 0)).toBe(run.totals.net);
    for (const s of data.payslips) expect(s.net).toBe(s.gross - s.totalDeductions);
    const je = data.ledgerEntries.filter((e) => e.sourceId === run.id);
    expect(je).toHaveLength(2);
    for (const e of je) {
      const [dr, cr] = sumLines(e.lines);
      expect(dr).toBe(cr);
    }
    expect(data.settings[0].hr?.geofences[DEMO_BRANCH_ID]).toBeTruthy();
    // a food handler with no health certificate and one expiring soon
    const alerts = data.staffProfiles.flatMap((p) => documentAlerts(p, "2026-10-23"));
    expect(alerts.some((a) => a.state === "missing")).toBe(true);
    expect(alerts.some((a) => a.state === "soon")).toBe(true);
  });
});

describe("HR ops (local backend)", () => {
  it("payroll: build → save → approve posts a balanced journal and recovers advances → paid posts the payout", async () => {
    const { db } = await setup("accountant");
    const period = new Date().toISOString().slice(0, 7);
    const draft = await buildRun(db, period, null);
    expect(draft.slips.length).toBeGreaterThan(5);
    const [dr, cr] = sumLines(draft.journal);
    expect(dr).toBe(cr);
    const run = await saveRun(db, draft);
    // saving again replaces the draft (no duplicates)
    await saveRun(db, await buildRun(db, period, null));
    expect((await db.list("payrollRuns", { where: { period } })).length).toBe(1);
    const fresh = (await db.list("payrollRuns", { where: { period } }))[0];
    const approved = await approveRun(db, fresh);
    expect(approved.status).toBe("approved");
    const je = (await db.list("ledgerEntries", { where: { sourceType: "payroll", sourceId: run.id } }))[0];
    const [d2, c2] = sumLines(je.lines);
    expect(d2).toBe(c2);
    expect(je.lines.find((l) => l.account === "2401")?.credit).toBe(approved.totals.net);
    await expect(saveRun(db, draft)).rejects.toBeInstanceOf(HrError);
    const paid = await markRunPaid(db, approved, "by_person");
    expect(paid.status).toBe("paid");
    const pay = (await db.list("ledgerEntries", { where: { sourceType: "payroll.payment", sourceId: run.id } }))[0];
    expect(pay.lines.find((l) => l.account === "2401")?.debit).toBe(approved.totals.net);
    expect((await db.list("payslips", { where: { runId: run.id } })).every((s) => s.status === "paid")).toBe(true);
  });

  it("advance: request → approve → cash from the open drawer (cash movement + journal)", async () => {
    const { db } = await setup("manager");
    const a = await requestAdvance(db, { membershipId: staffId("kitchen"), amount: major(2_000), installments: 2, startPeriod: "2026-12", reason: "test" });
    await expect(payAdvance(db, a, "cash", null)).rejects.toBeInstanceOf(HrError);
    await decideAdvance(db, a, true);
    const shift = await db.insert("shifts", { branchId: DEMO_BRANCH_ID, device: "POS1", openedBy: staffId("cashier1"), closedBy: null, status: "open", openingFloat: major(1_000), openedAt: new Date().toISOString(), closedAt: null, countedCash: null, expectedCash: null, difference: null, zNumber: null, zReport: null });
    await expect(payAdvance(db, (await db.get("advances", a.id))!, "cash", null)).rejects.toBeInstanceOf(HrError);
    await payAdvance(db, (await db.get("advances", a.id))!, "cash", shift);
    const moves = await db.list("cashMovements", { where: { shiftId: shift.id } });
    expect(moves[0]).toMatchObject({ kind: "out", amount: major(2_000) });
    const je = (await db.list("ledgerEntries", { where: { sourceType: "staff.advance", sourceId: a.id } }))[0];
    expect(je.lines).toEqual([expect.objectContaining({ account: "1202", debit: major(2_000) }), expect.objectContaining({ account: "1101", credit: major(2_000) })]);
    expect((await db.get("advances", a.id))?.status).toBe("paid");
  });

  it("mobile check-in is refused outside the geofence; voids are audited", async () => {
    const { db } = await setup("waiter1");
    await expect(punch(db, { membershipId: staffId("waiter1"), kind: "in", source: "mobile", fix: { lat: 30.0444, lng: 31.2357, accuracyM: 15 } })).rejects.toMatchObject({ code: "outside" });
    await expect(punch(db, { membershipId: staffId("waiter1"), kind: "in", source: "mobile", fix: null })).rejects.toMatchObject({ code: "no_location" });
    const p = await punch(db, { membershipId: staffId("waiter1"), kind: "in", source: "mobile", fix: { lat: 30.0627, lng: 31.218, accuracyM: 10 } });
    expect(p.distanceM).toBeLessThan(50);
    await voidPunch(db, p, "test");
    expect((await db.get("attendancePunches", p.id))?.voided).toBe(true);
    expect((await db.list("auditLog", { where: { action: "attendance.correct.void" } })).length).toBe(1);
  });

  it("leave request → approve; CSV import is idempotent and maps device users", async () => {
    const { db } = await setup("manager");
    const r = await requestLeave(db, { membershipId: staffId("waiter3"), type: "casual", from: "2026-12-05", to: "2026-12-06", reason: "x" });
    expect(r.days).toBe(2);
    await decideLeave(db, r, true);
    expect((await db.get("leaveRequests", r.id))?.status).toBe("approved");
    const csv = parseAttendanceCsv("No.,Name,Time,State\n6,أحمد سمير,01/12/2026 15:58,C/In\n6,أحمد سمير,01/12/2026 23:59,C/Out\n99,؟,01/12/2026 16:00,C/In\n");
    const map = { "6": staffId("waiter1") };
    const one = await importPunches(db, csv.punches, { serial: "CSV", source: "csv", branchId: DEMO_BRANCH_ID, tz: "Africa/Cairo", map });
    const two = await importPunches(db, csv.punches, { serial: "CSV", source: "csv", branchId: DEMO_BRANCH_ID, tz: "Africa/Cairo", map });
    expect(one).toEqual({ added: 3, duplicates: 0, unmapped: 1 });
    expect(two).toEqual({ added: 0, duplicates: 3, unmapped: 0 });
  });

  it("create staff with a PIN; /me is visible to every role, homes unchanged", async () => {
    const { db, repo } = await setup("owner");
    const m = await createStaff(db, { name: "حسن الجديد", role: "waiter", phone: "01005550999", email: null, branchIds: [], pin: "5555", color: "#0d5a53", profile: { foodHandler: true }, comp: { monthlySalary: major(9_000), hourlyRate: 0 } });
    expect(await repo.auth.verifyPin(DEMO_RESTAURANT_ID, m.id, "5555")).toBeTruthy();
    expect((await db.list("staffProfiles", { where: { membershipId: m.id } }))[0].foodHandler).toBe(true);
    for (const r of ["owner", "manager", "cashier", "waiter", "chef", "kitchen", "delivery", "accountant"] as const) expect(visibleModules(r).map((x) => x.id)).toContain("me");
    expect(visibleModules("platform_admin").map((x) => x.id)).not.toContain("me");
    expect(homeFor("waiter")).toBe("/waiter");
    expect(homeFor("cashier")).toBe("/pos");
  });
});

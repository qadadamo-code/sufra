import { afterEach, describe, expect, it } from "vitest";
import { Ledger } from "@finance/ledger";
import { postPurchase, postSale, settleVat, vatReturn as finVatReturn } from "@finance/posting";
import { ACCOUNTS } from "@finance/ledger";
import { priceBill } from "@finance/tax";
import { egp } from "@finance/money";
import { LocalAdapter } from "@/data/local/LocalAdapter";
import { makeDb } from "@/data/hooks";
import { buildSeed, DEMO_BRANCH_ID, DEMO_RESTAURANT_ID, staffId } from "@/data/seed";
import type { LedgerEntry } from "@/data/types";
import { fromAmount, major } from "@/lib/money";
import { ACC, DEFAULT_CHART, SYSTEM_CODES } from "./chart";
import { addDays, balanceSheet, businessDay, cashFlow, JournalError, mergeChart, profitAndLoss, reverseLines, trialBalance, validateJournal, vatReturn, vatSettlementLines } from "./core";
import { closePeriod, jl, postJournal, postPayroll, postPurchaseInvoice, reverseJournal, SOURCE } from "./api";
import { autoMatch, bankCandidates, parseAmount, parseBankCsv, parseDate } from "./bank";
import { cashForecast, weekdayTakings } from "./forecast";
import { cashAlerts, cashPosition, transferLines } from "./treasury";
import { approveDraft, approveExpense, approveTransfer, bookLine, createExpense, fileVatReturn, importBankCsv, requestReversal, requestTransfer, runAutoMatch, submitManualJournal } from "./ops";

const chart = mergeChart();
const NOW = new Date("2026-11-03T15:00:00+02:00");
const seed = buildSeed(NOW);
const entries = seed.data.ledgerEntries;
const today = businessDay(NOW);

describe("chart of accounts", () => {
  it("contains every sufra-finance account with its code and type", () => {
    for (const a of Object.values(ACCOUNTS)) {
      const c = DEFAULT_CHART.find((x) => x.code === a.code);
      expect(c, a.code).toBeTruthy();
      expect(c!.type).toBe(a.type);
    }
    expect(new Set(DEFAULT_CHART.map((a) => a.code)).size).toBe(DEFAULT_CHART.length);
    for (const code of Object.values(ACC)) expect(chart.has(code), code).toBe(true);
    expect(SYSTEM_CODES.has(ACC.salaries)).toBe(true);
  });
});

describe("journal rules", () => {
  const ok = { date: "2026-10-01", lines: [jl(ACC.rent, 100, 0), jl(ACC.bank, 0, 100)] as never };
  it("accepts a balanced entry and rejects the rest", () => {
    expect(() => validateJournal(ok, chart)).not.toThrow();
    const bad = (lines: unknown, code: string) => {
      try {
        validateJournal({ date: "2026-10-01", lines: lines as never }, chart);
        throw new Error("should throw");
      } catch (e) {
        expect((e as JournalError).code).toBe(code);
      }
    };
    bad([jl(ACC.rent, 100, 0)], "lines");
    bad([jl(ACC.rent, 100, 0), jl(ACC.bank, 0, 99)], "balance");
    bad([jl(ACC.rent, 100, 100), jl(ACC.bank, 0, 0)], "side");
    bad([jl(ACC.rent, -100, 0), jl(ACC.bank, 0, -100)], "side");
    bad([jl("9999", 100, 0), jl(ACC.bank, 0, 100)], "account");
    bad([jl(ACC.rent, 0.5, 0), jl(ACC.bank, 0, 0.5)], "side");
  });
  it("respects the period lock (closeThrough)", () => {
    expect(() => validateJournal(ok, chart, "2026-10-01")).toThrow(/closed/);
    expect(() => validateJournal({ ...ok, date: "2026-10-02" }, chart, "2026-10-01")).not.toThrow();
  });
  it("reversal mirrors every line and nets to zero", () => {
    const e = entries.find((x) => x.sourceType === "z-summary")!;
    const rev = reverseLines(e.lines);
    const tb = trialBalance([e, { ...e, lines: rev }], chart);
    expect(tb.rows.every((r) => r.balance === 0)).toBe(true);
  });
});

describe("seeded books", () => {
  it("every entry balances; the trial balance sums to zero", () => {
    for (const e of entries) expect(() => validateJournal(e, chart), `${e.sourceType} ${e.sourceId}`).not.toThrow();
    const tb = trialBalance(entries, chart);
    expect(tb.totals.balance).toBe(0);
    expect(tb.totals.debit).toBe(tb.totals.credit);
  });
  it("balance sheet balances and current earnings equal cumulative P&L", () => {
    for (const to of [addDays(today, -60), addDays(today, -30), today]) {
      const bs = balanceSheet(entries, chart, to);
      expect(bs.totals.difference).toBe(0);
      const pl = profitAndLoss(entries, chart, { to });
      expect(bs.totals.currentEarnings).toBe(pl.totals.netProfit);
    }
  });
  it("P&L: gross profit, prime cost, plausible restaurant ratios", () => {
    const from = addDays(today, -30);
    const pl = profitAndLoss(entries, chart, { from, to: addDays(today, -1) });
    const t = pl.totals;
    expect(t.grossProfit).toBe(t.revenue - t.cogs);
    expect(t.primeCost).toBe(t.cogs + t.labour);
    expect(t.netProfit).toBe(t.revenue - t.cogs - t.expenses);
    expect(t.foodCostBp).toBeGreaterThan(2500);
    expect(t.foodCostBp).toBeLessThan(4200);
    expect(t.primeCostBp).toBeLessThan(7000);
    expect(t.netProfit).toBeGreaterThan(0);
  });
  it("cash flow statement: opening + net = closing = cash on the balance sheet", () => {
    const from = addDays(today, -30);
    const to = addDays(today, -1);
    const cf = cashFlow(entries, chart, { from, to });
    expect(cf.closing).toBe(cf.opening + cf.net);
    const bs = balanceSheet(entries, chart, to);
    const cashCodes = [...chart.values()].filter((a) => a.group === "cash" || a.group === "bank").map((a) => a.code);
    expect(cf.closing).toBe(bs.assets.filter((a) => cashCodes.includes(a.code)).reduce((s, a) => s + a.amount, 0));
  });
  it("closed months carry a VAT settlement and the lock sits on the last settled month", () => {
    const s = seed.data.accountingSettings[0];
    expect(s.closedThrough).toBeTruthy();
    expect(entries.filter((e) => e.date <= s.closedThrough! && e.sourceType === "vat-return").length).toBeGreaterThan(0);
    const vr = entries.filter((e) => e.sourceType === "vat-return");
    for (const e of vr) {
      const [from, to] = e.sourceId.split("..");
      const r = vatReturn(entries, from, to);
      expect(e.lines.find((l) => l.account === ACC.vatSettlement)!.credit).toBe(r.net);
    }
  });
  it("stays a reasonable size", () => {
    const size = ["glAccounts", "costCentres", "journalDrafts", "accountingSettings", "cashAccounts", "cashTransfers", "expenses", "recurringExpenses", "bankLines", "ledgerEntries"]
      .reduce((a, k) => a + JSON.stringify(seed.data[k as keyof typeof seed.data]).length, 0);
    expect(size).toBeLessThan(1_000_000);
  });
});

describe("VAT return matches sufra-finance", () => {
  it("vatReturn / settleVat on POS-style postings", () => {
    const ledger = new Ledger(() => new Date("2026-10-05T12:00:00Z"));
    const bill = priceBill({ mode: "dine-in", lines: [{ id: "a", category: "food", unitPrice: egp(200), qty: 2 }, { id: "b", category: "beverage", unitPrice: egp(45), qty: 3 }] } as never);
    postSale(ledger, bill, [{ method: "cash", amount: bill.payable }], { date: "2026-10-05", receiptId: "R1", branch: "b" });
    postPurchase(ledger, { date: "2026-10-06", invoiceId: "P1", supplier: "S", branch: "b", lines: [{ account: ACCOUNTS.inventoryFood, net: egp(1000), vat: egp(140) }] });
    const rows: LedgerEntry[] = ledger.all().map((e) => ({
      id: e.id, restaurantId: "r", createdAt: e.at, updatedAt: e.at, branchId: "b", date: e.date, sourceType: e.source.type, sourceId: e.source.id, memo: e.memo,
      lines: e.lines.map((l) => ({ account: l.account, debit: fromAmount(l.debit), credit: fromAmount(l.credit) })),
    }));
    const fin = finVatReturn(ledger, "2026-10-01", "2026-10-31");
    const ours = vatReturn(rows, "2026-10-01", "2026-10-31");
    expect(ours.outputVat).toBe(fromAmount(fin.outputVat));
    expect(ours.inputVat).toBe(fromAmount(fin.inputVat));
    expect(ours.net).toBe(fromAmount(fin.net));
    const settle = settleVat(ledger, fin, "2026-11-10");
    const mine = vatSettlementLines(ours);
    for (const l of settle.lines) {
      const m = mine.find((x) => x.account === l.account)!;
      expect([m.debit, m.credit]).toEqual([fromAmount(l.debit), fromAmount(l.credit)]);
    }
  });
});

describe("cash position, forecast and alerts", () => {
  const position = cashPosition(seed.data.cashAccounts, entries);
  it("splits the drawer cash by device and adds up to the GL", () => {
    const sumCash = [...chart.values()].filter((a) => a.group === "cash" || a.group === "bank").reduce((s, a) => s + entries.reduce((x, e) => x + e.lines.filter((l) => l.account === a.code).reduce((y, l) => y + l.debit - l.credit, 0), 0), 0);
    const wallet = position.byKind.wallet;
    expect(position.onHand - wallet).toBe(sumCash);
    expect(position.rows.find((r) => r.account.kind === "drawer")!.balance).toBe(major(2000)); // the float stays in the till
    expect(position.pending).toBeGreaterThan(0);
  });
  it("forecast: takings by weekday, payroll on payday, balance rolls forward", () => {
    const s = seed.data.accountingSettings[0];
    const f = cashForecast({ today, entries, onHand: position.onHand, settings: s, recurring: seed.data.recurringExpenses, days: 30 });
    expect(f.days).toHaveLength(30);
    const wd = weekdayTakings(entries, today);
    expect(wd[5]).toBeGreaterThan(wd[1]); // Fridays beat Mondays
    let bal = f.start;
    for (const d of f.days) {
      bal += d.inflow - d.outflow;
      expect(d.balance).toBe(bal);
    }
    const pay = f.days.find((d) => d.date.endsWith("-28"))!;
    expect(pay.flows.some((x) => x.kind === "payroll")).toBe(true);
    expect(f.paydays[0].date).toBe(pay.date);
    expect(f.days.some((d) => d.flows.some((x) => x.kind === "vat"))).toBe(true);
    expect(f.days.some((d) => d.flows.some((x) => x.label.includes("إيجار")))).toBe(true);
    // a thin bank account triggers the payday alert
    const thin = cashForecast({ today, entries, onHand: -position.onHand + major(1000), settings: s, recurring: [], days: 30 });
    const alerts = cashAlerts({ today, position, settings: s, forecast: thin, entries });
    expect(alerts.some((a) => a.kind === "low_cash_payday")).toBe(true);
  });
  it("transfer lines post count differences to over/short", () => {
    const [drawer, safe] = seed.data.cashAccounts;
    const lines = transferLines({ amount: major(1000), counted: major(990) }, drawer, safe, "b");
    expect(() => validateJournal({ date: "2026-11-01", lines }, chart)).not.toThrow();
    expect(lines.find((l) => l.account === ACC.cashOverShort)!.debit).toBe(major(10));
    expect(lines.find((l) => l.account === ACC.cash)!.dims?.drawer).toBe("POS1");
  });
  it("flags a large over/short", () => {
    const s = seed.data.accountingSettings[0];
    const e = { date: today, sourceType: "drawer-count", sourceId: "x", lines: [jl(ACC.cash, 0, major(500)), jl(ACC.cashOverShort, major(500), 0)] } as never;
    expect(cashAlerts({ today, position, settings: s, entries: [e] }).some((a) => a.kind === "over_short")).toBe(true);
  });
});

describe("bank statement", () => {
  it("parses Arabic/English CSVs with debit/credit or signed amounts", () => {
    expect(parseAmount("1,234.50")).toBe(major("1234.50"));
    expect(parseAmount("(75.00)")).toBe(-major(75));
    expect(parseAmount("75.00-")).toBe(-major(75));
    expect(parseAmount("١٢٣٫٥")).toBe(major("123.5"));
    expect(parseDate("21/10/2026")).toBe("2026-10-21");
    expect(parseDate("2026-10-21")).toBe("2026-10-21");
    const en = parseBankCsv('Date,Description,Reference,Debit,Credit,Balance\n21/10/2026,"POS SETTLEMENT, MID 1",S1,,"5,000.00","105,000.00"\n22/10/2026,RENT,R1,120000.00,,-15000.00\n');
    expect(en).toHaveLength(2);
    expect(en[0]).toMatchObject({ date: "2026-10-21", amount: major(5000), reference: "S1", description: "POS SETTLEMENT, MID 1" });
    expect(en[1].amount).toBe(-major(120000));
    const ar = parseBankCsv("التاريخ;البيان;المبلغ;الرصيد\n2026-10-21;إيداع نقدي;12000;50000\n");
    expect(ar[0]).toMatchObject({ amount: major(12000), balance: major(50000) });
  });
  it("auto-matches exact amounts within 3 days, one to one, closest first", () => {
    const cands = [
      { id: "e1", date: "2026-10-20", amount: major(5000), memo: "Card settlement", sourceId: "CARD" },
      { id: "e2", date: "2026-10-21", amount: major(5000), memo: "Card settlement", sourceId: "CARD2" },
      { id: "e3", date: "2026-10-10", amount: -major(75), memo: "fee", sourceId: "x" },
    ];
    const lines = [
      { id: "l1", date: "2026-10-21", amount: major(5000), description: "POS", reference: "", status: "unmatched" as const },
      { id: "l2", date: "2026-10-22", amount: major(5000), description: "POS", reference: "", status: "unmatched" as const },
      { id: "l3", date: "2026-10-25", amount: -major(75), description: "FEE", reference: "", status: "unmatched" as const },
    ];
    const m = autoMatch(lines, cands, new Set());
    expect(m.find((x) => x.lineId === "l1")?.entryId).toBe("e2");
    expect(m.find((x) => x.lineId === "l2")?.entryId).toBe("e1");
    expect(m.find((x) => x.lineId === "l3")).toBeUndefined(); // 15 days apart
  });
  it("seeded statement: auto-match clears the recent lines except the ones the books don't know", () => {
    const bank = seed.data.cashAccounts.find((a) => a.kind === "bank")!;
    const lines = seed.data.bankLines;
    const used = new Set(lines.map((l) => l.matchedEntryId).filter(Boolean) as string[]);
    const m = autoMatch(lines, bankCandidates(entries, bank.glCode), used);
    const left = lines.filter((l) => l.status === "unmatched" && !m.some((x) => x.lineId === l.id));
    expect(m.length).toBeGreaterThan(10);
    expect(left.every((l) => /FEE|INSTAPAY/.test(l.description))).toBe(true);
  });
});

/* ───────── on the local backend ───────── */

let n = 0;
const open: LocalAdapter[] = [];
afterEach(() => {
  while (open.length) open.pop()!.close();
});
async function setup() {
  const repo = new LocalAdapter({ name: `acct${++n}`, memory: true });
  open.push(repo);
  await repo.ready();
  return {
    repo,
    accountant: makeDb(repo, DEMO_RESTAURANT_ID, DEMO_BRANCH_ID, staffId("accountant")),
    owner: makeDb(repo, DEMO_RESTAURANT_ID, DEMO_BRANCH_ID, staffId("owner")),
    manager: makeDb(repo, DEMO_RESTAURANT_ID, DEMO_BRANCH_ID, staffId("manager")),
  };
}

describe("accounting ops (local backend)", () => {
  it("postJournal validates, is idempotent per source, and reversal never edits", async () => {
    const { accountant: db } = await setup();
    const d = businessDay();
    const e = await postPayroll(db, { id: "run-1", date: d, period: d.slice(0, 7), gross: major(100_000), employerSi: major(11_625), employeeSi: major(6_820), payrollTax: major(3_000) });
    const again = await postPayroll(db, { id: "run-1", date: d, period: d.slice(0, 7), gross: major(100_000) });
    expect(again.id).toBe(e.id);
    await expect(postJournal(db, { date: d, sourceType: "x", sourceId: "1", memo: "bad", lines: [jl(ACC.rent, 10, 0), jl(ACC.bank, 0, 9)] })).rejects.toThrow(/balance/);
    const rev = await reverseJournal(db, e.id, { memo: "wrong month" });
    expect(rev.lines.find((l) => l.account === ACC.salaries)!.credit).toBe(major(100_000));
    expect((await db.get("ledgerEntries", e.id))!.lines).toEqual(e.lines);
    await expect(reverseJournal(db, e.id)).rejects.toThrow(/already/);
    // after a reversal the same source may post again (corrected payroll)
    const fixed = await postPayroll(db, { id: "run-1", date: d, period: d.slice(0, 7), gross: major(101_000) });
    expect(fixed.id).not.toBe(e.id);
    const p = await postPurchaseInvoice(db, { id: "inv-9", date: d, supplier: "S", invoiceNo: "9", lines: [{ account: ACC.inventoryFood, net: major(1000), vat: major(140) }] });
    expect(p.lines.find((l) => l.account === ACC.payables)!.credit).toBe(major(1140));
  });

  it("period close locks posting and cannot be reopened", async () => {
    const { accountant: db } = await setup();
    const s = (await db.list("accountingSettings"))[0];
    const through = addDays(businessDay(), -1);
    // pending manual journal in the period blocks the close
    await expect(closePeriod(db, through)).rejects.toThrow(/pending/);
    const draft = (await db.list("journalDrafts", { where: { status: "pending" } }))[0];
    const { owner } = { owner: makeDb(db.repo, DEMO_RESTAURANT_ID, DEMO_BRANCH_ID, staffId("owner")) };
    await approveDraft(owner, draft, { id: staffId("owner"), role: "owner" });
    await closePeriod(db, through, "month end");
    await expect(postJournal(db, { date: through, sourceType: "x", sourceId: "2", memo: "late", lines: [jl(ACC.rent, 1000, 0), jl(ACC.bank, 0, 1000)] })).rejects.toThrow(/closed/);
    await expect(closePeriod(db, s.closedThrough!)).rejects.toThrow(/reopen/);
  });

  it("manual journal needs a second person; transfers and expenses post on approval", async () => {
    const { accountant, owner, manager } = await setup();
    const d = businessDay();
    const draft = await submitManualJournal(accountant, { date: d, memo: "accrual", lines: [{ account: ACC.gas, debit: major(500), credit: 0 }, { account: ACC.accrued, debit: 0, credit: major(500) }] });
    await expect(approveDraft(accountant, draft, { id: staffId("accountant"), role: "accountant" })).rejects.toThrow(/second/);
    const e = await approveDraft(owner, draft, { id: staffId("owner"), role: "owner" });
    expect(e.sourceType).toBe(SOURCE.manual);

    const [safe] = await manager.list("cashAccounts", { where: { kind: "safe" } });
    const [bank] = await manager.list("cashAccounts", { where: { kind: "bank" } });
    const t = await requestTransfer(manager, { fromId: safe.id, toId: bank.id, amount: major(10_000), note: "deposit" });
    await expect(approveTransfer(manager, t, { id: staffId("manager"), role: "manager" })).rejects.toThrow(/second/);
    const te = await approveTransfer(accountant, t, { id: staffId("accountant"), role: "accountant" }, major(10_000));
    expect(te.lines.find((l) => l.account === ACC.bank)!.debit).toBe(major(10_000));

    const ex = await createExpense(manager, { date: d, category: "gas", vendor: "Town Gas", description: "cylinder", net: major(300), vat: 0, paidFromId: safe.id, receiptPhoto: "data:image/png;base64,AA" });
    const ee = await approveExpense(accountant, ex, { id: staffId("accountant"), role: "accountant" });
    expect(ee.lines.find((l) => l.account === ACC.safe)!.credit).toBe(major(300));

    // reversal request → approval
    const rr = await requestReversal(accountant, ee.id, "duplicate receipt");
    await approveDraft(owner, rr, { id: staffId("owner"), role: "owner" });
    expect((await owner.list("ledgerEntries", { where: { sourceType: SOURCE.reversal, sourceId: ee.id } })).length).toBe(1);
  });

  it("bank: import, dedupe, auto-match, book an unknown line", async () => {
    const { accountant: db } = await setup();
    const [bank] = await db.list("cashAccounts", { where: { kind: "bank" } });
    const n1 = await runAutoMatch(db, bank.id);
    expect(n1).toBeGreaterThan(5);
    const csv = `Date,Description,Reference,Amount\n${addDays(businessDay(), -1)},INTEREST CREDIT,INT1,12.50\n`;
    expect((await importBankCsv(db, bank.id, csv)).added).toBe(1);
    expect((await importBankCsv(db, bank.id, csv)).added).toBe(0);
    const line = (await db.list("bankLines", { where: { reference: "INT1" } }))[0];
    const e = await bookLine(db, line, ACC.otherIncome, "Bank interest");
    expect(e.lines.find((l) => l.account === ACC.bank)!.debit).toBe(major("12.50"));
    expect((await db.get("bankLines", line.id))!.status).toBe("matched");
  });

  it("files the VAT return: settlement entry + lock", async () => {
    const { accountant: db } = await setup();
    const s = (await db.list("accountingSettings"))[0];
    const from = addDays(s.closedThrough!, 1);
    const to = addDays(from, 20);
    // approve the pending draft first (it sits in the period)
    const draft = (await db.list("journalDrafts", { where: { status: "pending" } }))[0];
    if (draft && draft.date <= to) await approveDraft(makeDb(db.repo, DEMO_RESTAURANT_ID, DEMO_BRANCH_ID, staffId("owner")), draft, { id: staffId("owner"), role: "owner" });
    const { entry, ret } = await fileVatReturn(db, from, to, addDays(to, 1));
    expect(ret.net).toBe(ret.outputVat - ret.inputVat);
    expect(entry.lines.find((l) => l.account === ACC.outputVat)!.debit).toBe(ret.outputVat);
    expect((await db.list("accountingSettings"))[0].closedThrough).toBe(to);
  });
});

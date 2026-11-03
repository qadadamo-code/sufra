/**
 * Public accounting API — the one place other modules (POS, payments, delivery, HR/payroll, inventory/purchasing, ops)
 * post journals. Everything lands in `ledgerEntries` (append-only); corrections are reversals, never edits.
 *
 *   import { postJournal, ACC, SOURCE, jl } from "@/modules/accounting/api";
 *   await postJournal(db, {
 *     date: "2026-10-31", branchId, sourceType: SOURCE.payroll, sourceId: payrun.id, memo: "Payroll October 2026",
 *     lines: [jl(ACC.salaries, gross, 0), jl(ACC.socialInsurance, employerSi, 0), jl(ACC.salariesPayable, 0, net),
 *             jl(ACC.socialInsurancePayable, 0, employeeSi + employerSi), jl(ACC.payrollTaxPayable, 0, tax)],
 *   });
 *
 * Rules: lines must balance (Units, debit xor credit per line), accounts must exist in the chart (DEFAULT_CHART +
 * tenant `glAccounts`), the date must be after the closed period (`accountingSettings.closedThrough`).
 * Posting is idempotent per (sourceType, sourceId) unless `allowDuplicate` — re-running a payroll or a purchase
 * returns the existing entry instead of double-counting.
 */
import type { Db } from "@/data/hooks";
import type { AccountingSettings, JournalLineRow } from "@/data/accountingTypes";
import type { LedgerEntry } from "@/data/types";
import type { Units } from "@/lib/money";
import { nowIso } from "@/lib/time";
import { ACC } from "./chart";
import { businessDay, JournalError, mergeChart, reverseLines, signedLines, validateJournal } from "./core";

export { ACC, DEFAULT_CHART, SYSTEM_CODES, type AccKey } from "./chart";
export { JournalError, businessDay, signedLines } from "./core";

/** Source types used across modules (drill-down + duplicate guard). Add your own freely — strings are fine. */
export const SOURCE = {
  receipt: "receipt", // POS sale (sale.ts)
  returnReceipt: "return-receipt",
  cashMove: "cash-move",
  drawerCount: "drawer-count",
  payroll: "payroll", // HR: monthly payroll accrual
  payrollPayment: "payroll.payment", // HR: salaries paid out
  staffAdvance: "staff.advance",
  purchase: "purchase-invoice", // inventory: supplier invoice
  supplierPayment: "supplier.payment",
  cogs: "cogs", // inventory: consumption at cost
  waste: "waste",
  stockCount: "stock-count",
  expense: "expense",
  transfer: "cash-transfer",
  payout: "payout", // gateway / aggregator settlement into the bank
  bankLine: "bank-line",
  vatReturn: "vat-return",
  manual: "manual",
  reversal: "reversal",
  opening: "opening-balance",
} as const;

export interface JournalLineInput {
  account: string;
  debit?: Units;
  credit?: Units;
  dims?: Record<string, string>;
}

export interface JournalInput {
  /** business day YYYY-MM-DD (default: today's business day, 05:00 cut-off) */
  date?: string;
  branchId?: string | null;
  sourceType: string;
  sourceId: string;
  memo: string;
  lines: JournalLineInput[];
}

/** jl(code, debit, credit, dims?) — line helper. */
export const jl = (account: string, debit: Units, credit: Units, dims?: Record<string, string>): JournalLineInput => ({ account, debit, credit, ...(dims ? { dims } : {}) });

const normalize = (lines: JournalLineInput[]): JournalLineRow[] =>
  lines
    .map((l) => ({ account: l.account, debit: Math.round(l.debit ?? 0), credit: Math.round(l.credit ?? 0), ...(l.dims ? { dims: l.dims } : {}) }))
    .filter((l) => l.debit !== 0 || l.credit !== 0);

export async function accountingSettings(db: Db): Promise<AccountingSettings | null> {
  const [s] = await db.list("accountingSettings");
  return s ?? null;
}

export async function closedThrough(db: Db): Promise<string | null> {
  return (await accountingSettings(db))?.closedThrough ?? null;
}

export async function loadChart(db: Db) {
  return mergeChart(await db.list("glAccounts"));
}

/** Validates without posting (forms can show the error before saving). */
export async function checkJournal(db: Db, input: JournalInput) {
  const lines = normalize(input.lines);
  validateJournal({ date: input.date ?? businessDay(), lines }, await loadChart(db), await closedThrough(db));
  return lines;
}

/** Posts a balanced journal entry. Throws JournalError (code: lines | account | side | balance | locked | date | inactive). */
export async function postJournal(db: Db, input: JournalInput, opts: { allowDuplicate?: boolean } = {}): Promise<LedgerEntry> {
  const date = input.date ?? businessDay();
  const lines = normalize(input.lines);
  validateJournal({ date, lines }, await loadChart(db), await closedThrough(db));
  if (!opts.allowDuplicate) {
    const dup = (await db.list("ledgerEntries", { where: { sourceType: input.sourceType, sourceId: input.sourceId } }))[0];
    if (dup) {
      const reversed = (await db.list("ledgerEntries", { where: { sourceType: SOURCE.reversal, sourceId: dup.id } }))[0];
      if (!reversed) return dup;
    }
  }
  const branch = input.branchId === undefined ? db.branchId : input.branchId;
  const row = await db.insert("ledgerEntries", { branchId: branch, date, sourceType: input.sourceType, sourceId: input.sourceId, memo: input.memo.slice(0, 500), lines });
  return row;
}

/** Posts the mirror image of an entry (never edits it). Throws if already reversed or the reversal date is locked. */
export async function reverseJournal(db: Db, entryId: string, opts: { date?: string; memo?: string } = {}): Promise<LedgerEntry> {
  const orig = await db.get("ledgerEntries", entryId);
  if (!orig) throw new JournalError("not_found", `no entry ${entryId}`);
  if (orig.sourceType === SOURCE.reversal) throw new JournalError("reversed", "a reversal cannot be reversed — post a new entry");
  const already = (await db.list("ledgerEntries", { where: { sourceType: SOURCE.reversal, sourceId: entryId } }))[0];
  if (already) throw new JournalError("reversed", `${entryId} is already reversed`);
  const e = await postJournal(
    db,
    { date: opts.date ?? businessDay(), branchId: orig.branchId, sourceType: SOURCE.reversal, sourceId: entryId, memo: opts.memo?.trim() || `Reversal of ${orig.memo}`, lines: reverseLines(orig.lines) },
    { allowDuplicate: true },
  );
  await db.audit("journal.reverse", "ledgerEntries", entryId, { reversal: e.id });
  return e;
}

/** Locks every day on or before `through` (finance Ledger.closeThrough). Periods are never reopened. */
export async function closePeriod(db: Db, through: string, note = ""): Promise<AccountingSettings> {
  const s = await ensureSettings(db);
  if (s.closedThrough && through < s.closedThrough) throw new JournalError("locked", "cannot reopen a closed period");
  const pending = await db.list("journalDrafts", { where: { status: "pending" } });
  if (pending.some((d) => d.date <= through)) throw new JournalError("locked", "approve or reject pending manual journals in that period first");
  const next = await db.update("accountingSettings", s.id, {
    closedThrough: through,
    closeHistory: [...(s.closeHistory ?? []), { through, by: db.actorId, at: nowIso(), note }],
  });
  await db.audit("period.close", "accountingSettings", s.id, { through, note });
  return next;
}

export const DEFAULT_ACCOUNTING_SETTINGS = {
  closedThrough: null,
  closeHistory: [],
  payrollDay: 28,
  payrollEstimate: 0,
  vatDueDay: 31,
  lowCashThreshold: 50_000 * 100_000,
  overShortAlert: 200 * 100_000,
  journalApprovalLimit: 5_000 * 100_000,
  defaultFoodCostBp: 3200,
  supplierTermsDays: 30,
} satisfies Omit<AccountingSettings, "id" | "createdAt" | "updatedAt" | "restaurantId">;

export async function ensureSettings(db: Db): Promise<AccountingSettings> {
  const s = await accountingSettings(db);
  if (s) return s;
  return db.insert("accountingSettings", { ...DEFAULT_ACCOUNTING_SETTINGS });
}

/* ───────── conveniences for other modules (thin wrappers over postJournal) ───────── */

/** HR: monthly payroll accrual. All amounts Units; net = gross − employee SI − payroll tax − advances deducted. */
export function postPayroll(
  db: Db,
  p: { id: string; date: string; period: string; branchId?: string | null; gross: Units; bonuses?: Units; employerSi?: Units; employeeSi?: Units; payrollTax?: Units; advancesDeducted?: Units },
) {
  const bonuses = p.bonuses ?? 0;
  const erSi = p.employerSi ?? 0;
  const eeSi = p.employeeSi ?? 0;
  const tax = p.payrollTax ?? 0;
  const adv = p.advancesDeducted ?? 0;
  const net = p.gross + bonuses - eeSi - tax - adv;
  return postJournal(db, {
    date: p.date, branchId: p.branchId, sourceType: SOURCE.payroll, sourceId: p.id, memo: `Payroll ${p.period}`,
    lines: signedLines([
      [ACC.salaries, p.gross],
      [ACC.bonuses, bonuses],
      [ACC.socialInsurance, erSi],
      [ACC.salariesPayable, -net],
      [ACC.socialInsurancePayable, -(eeSi + erSi)],
      [ACC.payrollTaxPayable, -tax],
      [ACC.staffAdvances, -adv],
    ]),
  });
}

/** HR: salaries paid out from a cash/bank GL account (default bank). */
export function postPayrollPayment(db: Db, p: { id: string; date: string; amount: Units; fromCode?: string; branchId?: string | null; memo?: string }) {
  return postJournal(db, {
    date: p.date, branchId: p.branchId, sourceType: SOURCE.payrollPayment, sourceId: p.id, memo: p.memo ?? "Salaries paid",
    lines: [jl(ACC.salariesPayable, p.amount, 0), jl(p.fromCode ?? ACC.bank, 0, p.amount)],
  });
}

/** Inventory: supplier invoice. Each line goes to an inventory or expense account at net; VAT to input VAT; total to payables (or paid now). */
export function postPurchaseInvoice(
  db: Db,
  p: { id: string; date: string; supplier: string; invoiceNo: string; branchId?: string | null; lines: { account: string; net: Units; vat: Units }[]; paidFromCode?: string | null },
) {
  const total = p.lines.reduce((a, l) => a + l.net + l.vat, 0);
  const vat = p.lines.reduce((a, l) => a + l.vat, 0);
  const byAcc = new Map<string, Units>();
  for (const l of p.lines) byAcc.set(l.account, (byAcc.get(l.account) ?? 0) + l.net);
  return postJournal(db, {
    date: p.date, branchId: p.branchId, sourceType: SOURCE.purchase, sourceId: p.id, memo: `Purchase ${p.invoiceNo} · ${p.supplier}`,
    lines: signedLines([
      ...[...byAcc.entries()].map(([a, v]) => [a, v] as [string, Units]),
      [ACC.inputVat, vat],
      [p.paidFromCode ?? ACC.payables, -total, p.paidFromCode ? undefined : { supplier: p.supplier }],
    ]),
  });
}

export function postSupplierPayment(db: Db, p: { id: string; date: string; supplier: string; amount: Units; fromCode?: string; branchId?: string | null }) {
  return postJournal(db, {
    date: p.date, branchId: p.branchId, sourceType: SOURCE.supplierPayment, sourceId: p.id, memo: `Payment to ${p.supplier}`,
    lines: [jl(ACC.payables, p.amount, 0, { supplier: p.supplier }), jl(p.fromCode ?? ACC.bank, 0, p.amount)],
  });
}

/** Inventory: cost of what was consumed (sales at recipe cost / period count) moved from stock to cost of sales. */
export function postCogs(db: Db, p: { id: string; date: string; branchId?: string | null; food?: Units; beverage?: Units; packaging?: Units; memo?: string }) {
  const food = p.food ?? 0;
  const bev = p.beverage ?? 0;
  const pack = p.packaging ?? 0;
  return postJournal(db, {
    date: p.date, branchId: p.branchId, sourceType: SOURCE.cogs, sourceId: p.id, memo: p.memo ?? "Cost of sales",
    lines: signedLines([
      [ACC.cogsFood, food],
      [ACC.cogsBeverage, bev],
      [ACC.cogsPackaging, pack],
      [ACC.inventoryFood, -food],
      [ACC.inventoryBeverage, -bev],
      [ACC.inventoryPackaging, -pack],
    ]),
  });
}

/** Inventory: waste / spoilage at cost. */
export function postWaste(db: Db, p: { id: string; date: string; branchId?: string | null; amount: Units; stockCode?: string; reason: string }) {
  return postJournal(db, {
    date: p.date, branchId: p.branchId, sourceType: SOURCE.waste, sourceId: p.id, memo: `Waste · ${p.reason}`,
    lines: [jl(ACC.waste, p.amount, 0), jl(p.stockCode ?? ACC.inventoryFood, 0, p.amount)],
  });
}

/** Gateway / card-machine / aggregator payout landing in the bank: Dr bank net, Dr fees, Cr clearing gross. */
export function postPayout(db: Db, p: { id: string; date: string; gross: Units; fees: Units; clearingCode?: string; bankCode?: string; feeCode?: string; memo: string; branchId?: string | null }) {
  return postJournal(db, {
    date: p.date, branchId: p.branchId, sourceType: SOURCE.payout, sourceId: p.id, memo: p.memo,
    lines: signedLines([
      [p.bankCode ?? ACC.bank, p.gross - p.fees],
      [p.feeCode ?? ACC.cardFees, p.fees],
      [p.clearingCode ?? ACC.cardClearing, -p.gross],
    ]),
  });
}

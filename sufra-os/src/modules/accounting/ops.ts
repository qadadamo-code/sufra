/**
 * Accounting operations against the data layer: chart edits, manual journals (maker / checker), reversals,
 * treasury transfers, expenses (+ recurring), bank statement import / matching, VAT filing, gateway payouts.
 * Every money effect goes through `postJournal` (api.ts).
 */
import type { Db } from "@/data/hooks";
import type { BankStatementLine, CashAccount, CashTransfer, Expense, ExpenseCategory, GlAccount, JournalDraft, JournalLineRow, RecurringExpense } from "@/data/accountingTypes";
import type { PaymentPayout } from "@/data/types";
import type { Units } from "@/lib/money";
import { nowIso } from "@/lib/time";
import { closePeriod, ensureSettings, jl, loadChart, postJournal, postPayout, reverseJournal, SOURCE, checkJournal } from "./api";
import { ACC, SYSTEM_CODES } from "./chart";
import { autoMatch, bankCandidates, lineKey, parseBankCsv } from "./bank";
import { businessDay, JournalError, monthEnd, signedLines, vatReturn, vatSettlementLines } from "./core";
import { transferLines } from "./treasury";

export class AccountingError extends Error {
  constructor(public code: "self_approval" | "not_pending" | "system_account" | "duplicate_code" | "bad_amount" | "same_account" | "not_found" | "csv", msg: string) {
    super(msg);
  }
}

/* ───────── chart ───────── */

export async function saveGlAccount(db: Db, row: Pick<GlAccount, "code" | "name" | "type" | "group" | "parentCode" | "note" | "active"> & { id?: string }) {
  if (!/^\d{1,8}$/.test(row.code)) throw new AccountingError("duplicate_code", "account code must be digits");
  const all = await db.list("glAccounts");
  const same = all.find((a) => a.code === row.code && a.id !== row.id);
  if (same) throw new AccountingError("duplicate_code", `code ${row.code} exists`);
  if (row.id) {
    const cur = all.find((a) => a.id === row.id);
    if (!cur) throw new AccountingError("not_found", "no such account");
    if (cur.system && (!row.active || row.code !== cur.code || row.type !== cur.type)) throw new AccountingError("system_account", "system accounts can be renamed only");
    const next = await db.update("glAccounts", row.id, { name: row.name, group: row.group, parentCode: row.parentCode, note: row.note, active: row.active, code: row.code, type: row.type });
    await db.audit("gl.edit", "glAccounts", row.id, { code: row.code });
    return next;
  }
  const created = await db.insert("glAccounts", { ...row, system: SYSTEM_CODES.has(row.code) });
  await db.audit("gl.create", "glAccounts", created.id, { code: row.code });
  return created;
}

/* ───────── manual journals & reversals (maker / checker) ───────── */

export async function submitManualJournal(db: Db, x: { date: string; memo: string; lines: JournalLineRow[]; branchId?: string | null }) {
  const lines = await checkJournal(db, { date: x.date, sourceType: SOURCE.manual, sourceId: "draft", memo: x.memo, lines: x.lines });
  if (!x.memo.trim()) throw new JournalError("lines", "a memo is required");
  const d = await db.insert("journalDrafts", {
    branchId: x.branchId === undefined ? db.branchId : x.branchId, date: x.date, memo: x.memo.trim(), lines, status: "pending", requestedBy: db.actorId, approvedBy: null, decidedAt: null, reason: "",
    ledgerEntryId: null, kind: "manual", reverses: null,
  });
  await db.audit("journal.submit", "journalDrafts", d.id, { total: lines.reduce((a, l) => a + l.debit, 0) });
  return d;
}

export async function requestReversal(db: Db, entryId: string, reason: string, date = businessDay()) {
  const e = await db.get("ledgerEntries", entryId);
  if (!e) throw new AccountingError("not_found", "no such entry");
  if (!reason.trim()) throw new JournalError("lines", "a reason is required");
  const done = await db.list("ledgerEntries", { where: { sourceType: SOURCE.reversal, sourceId: entryId } });
  if (done.length) throw new JournalError("reversed", "already reversed");
  const open = (await db.list("journalDrafts", { where: { status: "pending", kind: "reversal" } })).find((d) => d.reverses === entryId);
  if (open) return open;
  return db.insert("journalDrafts", {
    branchId: e.branchId, date, memo: reason.trim(), lines: e.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })), status: "pending", requestedBy: db.actorId, approvedBy: null, decidedAt: null,
    reason: "", ledgerEntryId: null, kind: "reversal", reverses: entryId,
  });
}

/** A different person approves (the owner may approve their own). */
export async function approveDraft(db: Db, draft: JournalDraft, approver: { id: string | null; role: string | null }) {
  if (draft.status !== "pending") throw new AccountingError("not_pending", "already decided");
  if (draft.requestedBy && draft.requestedBy === approver.id && approver.role !== "owner") throw new AccountingError("self_approval", "a second person must approve");
  const e = draft.kind === "reversal" && draft.reverses
    ? await reverseJournal(db, draft.reverses, { date: draft.date, memo: draft.memo })
    : await postJournal(db, { date: draft.date, branchId: draft.branchId, sourceType: SOURCE.manual, sourceId: draft.id, memo: draft.memo, lines: draft.lines });
  await db.update("journalDrafts", draft.id, { status: "posted", approvedBy: approver.id, decidedAt: nowIso(), ledgerEntryId: e.id });
  await db.audit("journal.approve", "journalDrafts", draft.id, { entry: e.id }, approver.id);
  return e;
}

export async function rejectDraft(db: Db, draft: JournalDraft, reason: string) {
  if (draft.status !== "pending") throw new AccountingError("not_pending", "already decided");
  await db.update("journalDrafts", draft.id, { status: "rejected", approvedBy: db.actorId, decidedAt: nowIso(), reason });
  await db.audit("journal.reject", "journalDrafts", draft.id, { reason });
}

/* ───────── treasury ───────── */

export async function requestTransfer(db: Db, x: { fromId: string; toId: string; amount: Units; date?: string; note?: string; reference?: string; denominations?: Record<string, number> | null }) {
  if (!(x.amount > 0)) throw new AccountingError("bad_amount", "amount must be positive");
  if (x.fromId === x.toId) throw new AccountingError("same_account", "pick two different places");
  const t = await db.insert("cashTransfers", {
    branchId: db.branchId, date: x.date ?? businessDay(), fromId: x.fromId, toId: x.toId, amount: Math.round(x.amount / 1000) * 1000, counted: null, denominations: x.denominations ?? null, status: "pending",
    requestedBy: db.actorId, approvedBy: null, reference: x.reference ?? "", note: x.note ?? "", ledgerEntryId: null,
  });
  await db.audit("cash.transfer.request", "cashTransfers", t.id, { amount: t.amount });
  return t;
}

/** Receiving side counts; the count posts (difference → 6901 over/short). */
export async function approveTransfer(db: Db, t: CashTransfer, approver: { id: string | null; role: string | null }, counted?: Units | null) {
  if (t.status !== "pending") throw new AccountingError("not_pending", "already decided");
  if (t.requestedBy && t.requestedBy === approver.id && approver.role !== "owner") throw new AccountingError("self_approval", "a second person must approve");
  const [from, to] = await Promise.all([db.get("cashAccounts", t.fromId), db.get("cashAccounts", t.toId)]);
  if (!from || !to) throw new AccountingError("not_found", "cash account missing");
  const c = counted == null ? t.amount : Math.round(counted / 1000) * 1000;
  const e = await postJournal(db, {
    date: t.date, branchId: t.branchId, sourceType: SOURCE.transfer, sourceId: t.id, memo: `${from.name.ar} → ${to.name.ar}${t.note ? ` · ${t.note}` : ""}`,
    lines: transferLines({ amount: t.amount, counted: c }, from, to, t.branchId),
  });
  await db.update("cashTransfers", t.id, { status: "posted", counted: c, approvedBy: approver.id, ledgerEntryId: e.id });
  await db.audit("cash.transfer.approve", "cashTransfers", t.id, { amount: t.amount, counted: c }, approver.id);
  return e;
}

export async function rejectTransfer(db: Db, t: CashTransfer, reason: string) {
  if (t.status !== "pending") throw new AccountingError("not_pending", "already decided");
  await db.update("cashTransfers", t.id, { status: "rejected", approvedBy: db.actorId, note: [t.note, reason].filter(Boolean).join(" · ") });
}

export async function saveCashAccount(db: Db, row: Omit<CashAccount, "id" | "createdAt" | "updatedAt" | "restaurantId"> & { id?: string }) {
  if (row.last4 && !/^\d{4}$/.test(row.last4)) throw new AccountingError("bad_amount", "last 4 digits only");
  const { id, ...rest } = row;
  return id ? db.update("cashAccounts", id, rest) : db.insert("cashAccounts", rest);
}

/* ───────── expenses ───────── */

export const EXPENSE_GL: Record<ExpenseCategory, string> = {
  rent: ACC.rent, electricity: ACC.electricity, water: ACC.water, gas: ACC.gas, internet: ACC.internet, maintenance: ACC.maintenance, cleaning: ACC.cleaning, marketing: ACC.marketing,
  licenses: ACC.licenses, professional: ACC.professional, software: ACC.software, transport: ACC.transport, bank: ACC.bankCharges, supplies: ACC.pettyExpenses, staff_meals: ACC.staffMeals, other: ACC.misc,
};

export interface ExpenseInput {
  date: string;
  category: ExpenseCategory;
  glCode?: string;
  vendor: string;
  description: string;
  invoiceNo?: string;
  net: Units;
  vat: Units;
  paidFromId: string | null;
  dueDate?: string | null;
  receiptPhoto?: string | null;
  recurringId?: string | null;
}

export async function createExpense(db: Db, x: ExpenseInput) {
  const net = Math.round(x.net / 1000) * 1000;
  const vat = Math.round(x.vat / 1000) * 1000;
  if (!(net > 0) || vat < 0) throw new AccountingError("bad_amount", "amount must be positive");
  const e = await db.insert("expenses", {
    branchId: db.branchId, date: x.date, category: x.category, glCode: x.glCode ?? EXPENSE_GL[x.category], vendor: x.vendor.trim(), description: x.description.trim(), invoiceNo: x.invoiceNo ?? "", net, vat, total: net + vat,
    paidFromId: x.paidFromId, dueDate: x.dueDate ?? null, status: "pending", receiptPhoto: x.receiptPhoto ?? null, recurringId: x.recurringId ?? null, createdBy: db.actorId, approvedBy: null, ledgerEntryId: null,
  });
  await db.audit("expense.create", "expenses", e.id, { total: e.total, category: e.category });
  return e;
}

export async function expenseLines(db: Db, e: Pick<Expense, "glCode" | "net" | "vat" | "total" | "paidFromId" | "branchId">) {
  const from = e.paidFromId ? await db.get("cashAccounts", e.paidFromId) : null;
  const dims = e.branchId ? { branch: e.branchId } : undefined;
  const credit = from?.glCode ?? ACC.accrued;
  return signedLines([
    [e.glCode, e.net, dims],
    [ACC.inputVat, e.vat, dims],
    [credit, -e.total, from?.kind === "drawer" ? { ...(dims ?? {}), drawer: from.institution } : dims],
  ]);
}

export async function approveExpense(db: Db, e: Expense, approver: { id: string | null; role: string | null }) {
  if (e.status !== "pending") throw new AccountingError("not_pending", "already decided");
  if (e.createdBy && e.createdBy === approver.id && approver.role !== "owner" && approver.role !== "accountant") throw new AccountingError("self_approval", "a second person must approve");
  const entry = await postJournal(db, { date: e.date, branchId: e.branchId, sourceType: SOURCE.expense, sourceId: e.id, memo: `${e.description} · ${e.vendor}`, lines: await expenseLines(db, e) });
  await db.update("expenses", e.id, { status: "posted", approvedBy: approver.id, ledgerEntryId: entry.id });
  await db.audit("expense.approve", "expenses", e.id, { total: e.total }, approver.id);
  return entry;
}

export async function rejectExpense(db: Db, e: Expense) {
  if (e.status !== "pending") throw new AccountingError("not_pending", "already decided");
  await db.update("expenses", e.id, { status: "rejected", approvedBy: db.actorId });
}

/** Pays an expense recorded on credit (accrued): Dr 2102, Cr the cash account. */
export async function payAccruedExpense(db: Db, e: Expense, fromId: string, date = businessDay()) {
  const from = await db.get("cashAccounts", fromId);
  if (!from) throw new AccountingError("not_found", "cash account missing");
  const entry = await postJournal(db, {
    date, branchId: e.branchId, sourceType: "expense.payment", sourceId: e.id, memo: `سداد ${e.description} · ${e.vendor}`,
    lines: [jl(ACC.accrued, e.total, 0), jl(from.glCode, 0, e.total, from.kind === "drawer" ? { drawer: from.institution } : undefined)],
  });
  await db.update("expenses", e.id, { paidFromId: fromId });
  return entry;
}

/** Raises this month's recurring expenses whose day has come (pending, for approval). */
export async function raiseRecurring(db: Db, today = businessDay()) {
  const month = today.slice(0, 7);
  const out: Expense[] = [];
  for (const r of await db.list("recurringExpenses", { where: { active: true } })) {
    if (r.lastRaisedFor && r.lastRaisedFor >= month) continue;
    const day = `${month}-${String(Math.min(r.dayOfMonth, Number(monthEnd(today).slice(8)))).padStart(2, "0")}`;
    if (day > today) continue;
    const already = (await db.list("expenses", { where: { recurringId: r.id } })).some((e) => e.date.slice(0, 7) === month);
    if (!already) out.push(await createExpense(db, { date: day, category: r.category, glCode: r.glCode, vendor: r.vendor, description: r.description, net: r.net, vat: r.vat, paidFromId: r.paidFromId, recurringId: r.id, invoiceNo: "" }));
    await db.update("recurringExpenses", r.id, { lastRaisedFor: month });
  }
  return out;
}

export async function saveRecurring(db: Db, row: Omit<RecurringExpense, "id" | "createdAt" | "updatedAt" | "restaurantId"> & { id?: string }) {
  const { id, ...rest } = row;
  return id ? db.update("recurringExpenses", id, rest) : db.insert("recurringExpenses", rest);
}

/* ───────── bank reconciliation ───────── */

export async function importBankCsv(db: Db, cashAccountId: string, text: string) {
  let parsed;
  try {
    parsed = parseBankCsv(text);
  } catch (e) {
    throw new AccountingError("csv", String((e as Error).message));
  }
  const existing = new Set((await db.list("bankLines", { where: { cashAccountId } })).map(lineKey));
  const batchId = `IMP-${nowIso().slice(0, 16)}`;
  let added = 0;
  for (const l of parsed) {
    const k = lineKey(l);
    if (existing.has(k)) continue;
    existing.add(k);
    await db.insert("bankLines", { cashAccountId, ...l, batchId, status: "unmatched", matchKind: null, matchedEntryId: null, matchedBy: null, matchedAt: null });
    added++;
  }
  await db.audit("bank.import", "bankLines", null, { cashAccountId, read: parsed.length, added });
  return { read: parsed.length, added, skipped: parsed.length - added };
}

export async function runAutoMatch(db: Db, cashAccountId: string, days = 3) {
  const account = await db.get("cashAccounts", cashAccountId);
  if (!account) throw new AccountingError("not_found", "no bank account");
  const lines = await db.list("bankLines", { where: { cashAccountId } });
  const entries = await db.list("ledgerEntries");
  const used = new Set(lines.map((l) => l.matchedEntryId).filter((x): x is string => !!x));
  const pairs = autoMatch(lines, bankCandidates(entries, account.glCode), used, days);
  const at = nowIso();
  for (const p of pairs) await db.update("bankLines", p.lineId, { status: "matched", matchKind: "auto", matchedEntryId: p.entryId, matchedBy: db.actorId, matchedAt: at });
  return pairs.length;
}

export async function matchLine(db: Db, line: BankStatementLine, entryId: string) {
  await db.update("bankLines", line.id, { status: "matched", matchKind: "manual", matchedEntryId: entryId, matchedBy: db.actorId, matchedAt: nowIso() });
}
export async function unmatchLine(db: Db, line: BankStatementLine) {
  await db.update("bankLines", line.id, { status: "unmatched", matchKind: null, matchedEntryId: null, matchedBy: null, matchedAt: null });
}
export async function ignoreLine(db: Db, line: BankStatementLine) {
  await db.update("bankLines", line.id, { status: "ignored", matchKind: null, matchedEntryId: null, matchedBy: db.actorId, matchedAt: nowIso() });
}

/** Books a line the journal doesn't have yet (bank fee, interest, unknown deposit) against `account`, then matches it. */
export async function bookLine(db: Db, line: BankStatementLine, account: string, memo: string) {
  const bank = await db.get("cashAccounts", line.cashAccountId);
  if (!bank) throw new AccountingError("not_found", "no bank account");
  const amt = Math.abs(line.amount);
  const lines = line.amount > 0 ? [jl(bank.glCode, amt, 0), jl(account, 0, amt)] : [jl(account, amt, 0), jl(bank.glCode, 0, amt)];
  const e = await postJournal(db, { date: line.date, branchId: null, sourceType: SOURCE.bankLine, sourceId: line.id, memo: memo || line.description, lines });
  await db.update("bankLines", line.id, { status: "matched", matchKind: "created", matchedEntryId: e.id, matchedBy: db.actorId, matchedAt: nowIso() });
  return e;
}

/* ───────── VAT ───────── */

/** Files the VAT return: settlement journal (finance settleVat) dated after the period, then locks the period. */
export async function fileVatReturn(db: Db, from: string, to: string, settleDate = businessDay()) {
  if (settleDate <= to) throw new JournalError("date", "settle after the period ends");
  const entries = await db.list("ledgerEntries");
  const r = vatReturn(entries, from, to);
  const e = await postJournal(db, { date: settleDate, branchId: null, sourceType: SOURCE.vatReturn, sourceId: `${from}..${to}`, memo: `إقرار ضريبة القيمة المضافة ${from} – ${to} / VAT return`, lines: vatSettlementLines(r) });
  await closePeriod(db, to, "VAT return filed");
  return { entry: e, ret: r };
}

/* ───────── gateway / aggregator payouts ───────── */

export async function postPaymentPayout(db: Db, p: PaymentPayout, bankCode: string = ACC.bank) {
  return postPayout(db, { id: p.id, date: (p.paidAt ?? nowIso()).slice(0, 10), gross: p.gross, fees: p.fees, bankCode, memo: `تسوية ${p.provider} ${p.periodStart.slice(0, 10)} – ${p.periodEnd.slice(0, 10)}` });
}

export { ensureSettings, loadChart };

/**
 * Accounting, cash & liquidity rows (supabase/migrations/0011_accounting.sql; src/modules/accounting).
 * Money is Units (0.00001 EGP), dates are business days "YYYY-MM-DD".
 * The journal itself stays in `ledgerEntries` (append-only — a mistake is corrected by a reversal entry).
 */
import type { Units } from "@/lib/money";

interface Row {
  id: string;
  createdAt: string;
  updatedAt: string;
  restaurantId: string;
}
interface Loc {
  ar: string;
  en: string;
}

export type GlAccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
/** reporting group: drives P&L lines, prime cost and the cash position */
export type GlGroup =
  | "cash" | "bank" | "clearing" | "receivable" | "inventory" | "tax_asset" | "prepaid" | "fixed_asset"
  | "payable" | "tax" | "staff_liability" | "deposit" | "accrued"
  | "equity"
  | "revenue" | "other_income"
  | "cogs" | "labour" | "occupancy" | "fees" | "opex" | "other_expense";

/** Chart of accounts (tenant-editable; system accounts are the codes posting rules rely on). */
export interface GlAccount extends Row {
  code: string;
  name: Loc;
  type: GlAccountType;
  group: GlGroup;
  parentCode: string | null;
  /** used by posting rules — can be renamed but not deactivated */
  system: boolean;
  active: boolean;
  note: string;
}

export interface CostCentre extends Row {
  code: string;
  name: Loc;
  /** null = head office / shared */
  branchId: string | null;
  active: boolean;
}

export type JournalLineRow = { account: string; debit: Units; credit: Units; dims?: Record<string, string> };

/** Manual journal waiting for approval (the approved one is posted into ledgerEntries). */
export interface JournalDraft extends Row {
  branchId: string | null;
  date: string;
  memo: string;
  lines: JournalLineRow[];
  status: "pending" | "posted" | "rejected";
  requestedBy: string | null;
  approvedBy: string | null;
  decidedAt: string | null;
  reason: string;
  ledgerEntryId: string | null;
  /** "manual" or "reversal" (reversal of ledgerEntryId-to-reverse) */
  kind: "manual" | "reversal";
  reverses: string | null;
}

export interface PeriodClose {
  through: string;
  by: string | null;
  at: string;
  note: string;
}

/** One row per restaurant. */
export interface AccountingSettings extends Row {
  /** no postings on or before this day (finance Ledger.closeThrough) */
  closedThrough: string | null;
  closeHistory: PeriodClose[];
  /** day of month salaries are paid (forecast + alerts) */
  payrollDay: number;
  /** monthly net payroll estimate when HR has no figure yet */
  payrollEstimate: Units;
  /** VAT return + payment due day of the following month (Egypt: end of next month) */
  vatDueDay: number;
  /** warn when cash + bank falls below this before an obligation */
  lowCashThreshold: Units;
  /** drawer over/short above this raises an alert */
  overShortAlert: Units;
  /** manual journals above this need a second person to approve */
  journalApprovalLimit: Units;
  /** menu engineering fallback when an item has no inventory cost: basis points of price */
  defaultFoodCostBp: number;
  /** supplier terms used to date payables in the cash forecast */
  supplierTermsDays: number;
}

export type CashAccountKind = "drawer" | "safe" | "petty" | "bank" | "wallet" | "provider";

/** Places money sits: drawers, the safe, petty cash, bank accounts, wallets, payment providers. */
export interface CashAccount extends Row {
  kind: CashAccountKind;
  name: Loc;
  /** GL account the balance lives in */
  glCode: string;
  branchId: string | null;
  /** bank / wallet / provider name */
  institution: string;
  /** last 4 digits only — never full account numbers */
  last4: string | null;
  /** petty cash imprest or safe limit */
  limit: Units | null;
  active: boolean;
  sort: number;
}

/** drawer → safe → bank deposit, petty cash top-up, wallet sweep … (approved transfers post a journal) */
export interface CashTransfer extends Row {
  branchId: string | null;
  date: string;
  fromId: string;
  toId: string;
  amount: Units;
  /** what was counted at the receiving end (safe count) */
  counted: Units | null;
  denominations: Record<string, number> | null;
  status: "pending" | "posted" | "rejected";
  requestedBy: string | null;
  approvedBy: string | null;
  reference: string;
  note: string;
  ledgerEntryId: string | null;
}

export type ExpenseCategory =
  | "rent" | "electricity" | "water" | "gas" | "internet" | "maintenance" | "cleaning" | "marketing" | "licenses"
  | "professional" | "software" | "transport" | "bank" | "supplies" | "staff_meals" | "other";

export interface Expense extends Row {
  branchId: string | null;
  date: string;
  category: ExpenseCategory;
  glCode: string;
  vendor: string;
  description: string;
  invoiceNo: string;
  net: Units;
  /** input VAT on a valid tax invoice (recoverable) */
  vat: Units;
  total: Units;
  /** cash account it was paid from; null = on credit (accrued, paid later) */
  paidFromId: string | null;
  dueDate: string | null;
  status: "pending" | "posted" | "rejected";
  /** small JPEG data URL (local) or storage path (cloud) */
  receiptPhoto: string | null;
  recurringId: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  ledgerEntryId: string | null;
}

export interface RecurringExpense extends Row {
  branchId: string | null;
  category: ExpenseCategory;
  glCode: string;
  vendor: string;
  description: string;
  net: Units;
  vat: Units;
  dayOfMonth: number;
  paidFromId: string | null;
  active: boolean;
  /** "YYYY-MM" of the last month it was raised */
  lastRaisedFor: string | null;
}

export interface BankStatementLine extends Row {
  cashAccountId: string;
  date: string;
  description: string;
  reference: string;
  /** + money in, − money out */
  amount: Units;
  balance: Units | null;
  batchId: string;
  status: "unmatched" | "matched" | "ignored";
  matchKind: "auto" | "manual" | "created" | null;
  matchedEntryId: string | null;
  matchedBy: string | null;
  matchedAt: string | null;
}

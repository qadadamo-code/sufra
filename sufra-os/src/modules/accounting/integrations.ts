/**
 * Journal export: one generic CSV (one row per journal line) + per-package mappings (Odoo, QuickBooks Online,
 * Zoho Books). Design notes: src/modules/accounting/INTEGRATIONS.md. Nothing is pushed to a third party yet.
 */
import type { LedgerEntry } from "@/data/types";
import type { ChartInfo } from "./core";

export type ExportTarget = "generic" | "odoo" | "quickbooks" | "zoho";
const dec = (u: number) => (u / 100_000).toFixed(2);
const no = (e: Pick<LedgerEntry, "id">) => `JE-${e.id.slice(0, 6).toUpperCase()}`;

export function journalExport(target: ExportTarget, entries: LedgerEntry[], chart: Map<string, ChartInfo>, opts: { currency?: string; branchName?: (id: string | null) => string; journalCode?: string } = {}) {
  const cur = opts.currency ?? "EGP";
  const br = opts.branchName ?? ((id: string | null) => id ?? "");
  const nm = (code: string, lang: "ar" | "en" = "en") => chart.get(code)?.name[lang] ?? code;
  switch (target) {
    case "odoo":
      // Accounting ▸ Journal Entries ▸ Import: one row per line; move fields repeat only on the first line
      return {
        header: ["id", "date", "ref", "journal_id", "line_ids/account_id", "line_ids/name", "line_ids/debit", "line_ids/credit", "line_ids/analytic_distribution", "line_ids/partner_id"],
        rows: entries.flatMap((e) => e.lines.map((l, i) => [i === 0 ? `sufra_${e.id}` : "", i === 0 ? e.date : "", i === 0 ? `${no(e)} ${e.memo}` : "", i === 0 ? (opts.journalCode ?? "MISC") : "", `${l.account} ${nm(l.account)}`, e.memo, dec(l.debit), dec(l.credit), br(l.dims?.branch ?? e.branchId), l.dims?.supplier ?? ""])),
      };
    case "quickbooks":
      // QuickBooks Online ▸ Import journal entries (CSV): JournalNo groups lines
      return {
        header: ["JournalNo", "JournalDate", "Currency", "Memo", "AccountName", "Debits", "Credits", "Description", "Name", "Location", "Class"],
        rows: entries.flatMap((e) => e.lines.map((l) => [no(e), e.date.split("-").reverse().join("/"), cur, e.memo, `${l.account} ${nm(l.account)}`, l.debit ? dec(l.debit) : "", l.credit ? dec(l.credit) : "", e.sourceType, l.dims?.supplier ?? "", br(l.dims?.branch ?? e.branchId), e.sourceType])),
      };
    case "zoho":
      // Zoho Books ▸ Accountant ▸ Manual Journals ▸ Import
      return {
        header: ["Journal Date", "Reference Number", "Journal Number Prefix", "Journal Number Suffix", "Notes", "Journal Type", "Currency", "Account", "Description", "Debit", "Credit", "Reporting Tag (Branch)"],
        rows: entries.flatMap((e) => e.lines.map((l) => [e.date, e.sourceId, "SUFRA-", e.id.slice(0, 6).toUpperCase(), e.memo, "both", cur, nm(l.account), `${l.account} · ${e.sourceType}`, l.debit ? dec(l.debit) : "", l.credit ? dec(l.credit) : "", br(l.dims?.branch ?? e.branchId)])),
      };
    default:
      return {
        header: ["entry_no", "entry_id", "date", "source_type", "source_id", "memo", "line", "account_code", "account_name_ar", "account_name_en", "account_type", "debit", "credit", "currency", "branch", "drawer", "supplier"],
        rows: entries.flatMap((e) => e.lines.map((l, i) => [no(e), e.id, e.date, e.sourceType, e.sourceId, e.memo, i + 1, l.account, nm(l.account, "ar"), nm(l.account), chart.get(l.account)?.type ?? "", dec(l.debit), dec(l.credit), cur, br(l.dims?.branch ?? e.branchId), l.dims?.drawer ?? "", l.dims?.supplier ?? ""])),
      };
  }
}

/** Suggested target accounts per Sufra code (the owner's accountant confirms them once). */
export const ACCOUNT_MAP: { code: string; odoo: string; quickbooks: string; zoho: string }[] = [
  { code: "1101", odoo: "101501 Cash", quickbooks: "Cash on hand (Bank)", zoho: "Petty Cash (Cash)" },
  { code: "1102", odoo: "101402 Outstanding Receipts", quickbooks: "Undeposited Funds", zoho: "Undeposited Funds" },
  { code: "1105", odoo: "101401 Bank", quickbooks: "Checking (Bank)", zoho: "Bank account" },
  { code: "1301", odoo: "110100 Stock Valuation", quickbooks: "Inventory Asset", zoho: "Inventory Asset" },
  { code: "1401", odoo: "131000 Tax Paid", quickbooks: "VAT Suspense / Input VAT", zoho: "Input Tax" },
  { code: "2101", odoo: "211000 Account Payable", quickbooks: "Accounts Payable (A/P)", zoho: "Accounts Payable" },
  { code: "2201", odoo: "251000 Tax Received", quickbooks: "VAT Payable", zoho: "Output Tax" },
  { code: "2202", odoo: "Service charge payable (new)", quickbooks: "Other Current Liabilities: Service charge", zoho: "Other Current Liability" },
  { code: "4101", odoo: "400000 Product Sales", quickbooks: "Sales of Product Income: Food", zoho: "Sales" },
  { code: "4102", odoo: "400000 Product Sales (beverage tag)", quickbooks: "Sales of Product Income: Beverage", zoho: "Sales" },
  { code: "5101", odoo: "500000 Cost of Goods Sold", quickbooks: "Cost of Goods Sold: Food", zoho: "Cost of Goods Sold" },
  { code: "6301", odoo: "620000 Salary Expenses", quickbooks: "Payroll Expenses: Wages", zoho: "Salaries and Employee Wages" },
  { code: "6401", odoo: "613000 Rent", quickbooks: "Rent or Lease", zoho: "Rent Expense" },
  { code: "6101", odoo: "626000 Bank Fees", quickbooks: "Bank Charges & Fees", zoho: "Bank Fees and Charges" },
];

/** Collapses per-receipt sales / returns into one entry per business day and branch (accounts summed, net per side). */
export function summariseSales(entries: LedgerEntry[]): LedgerEntry[] {
  const keep: LedgerEntry[] = [];
  const days = new Map<string, LedgerEntry>();
  for (const e of entries) {
    if (e.sourceType !== "receipt" && e.sourceType !== "return-receipt") {
      keep.push(e);
      continue;
    }
    const k = `${e.date}|${e.branchId ?? ""}`;
    const d = days.get(k) ?? { ...e, id: `${e.date.replace(/-/g, "")}${(e.branchId ?? "000000").slice(0, 6)}`, sourceType: "sales-summary", sourceId: `SALES-${e.date}`, memo: `Sales summary ${e.date}`, lines: [] };
    const acc = new Map(d.lines.map((l) => [`${l.account}|${l.dims?.drawer ?? ""}`, l.debit - l.credit]));
    for (const l of e.lines) acc.set(`${l.account}|${l.dims?.drawer ?? ""}`, (acc.get(`${l.account}|${l.dims?.drawer ?? ""}`) ?? 0) + l.debit - l.credit);
    d.lines = [...acc.entries()].filter(([, v]) => v !== 0).map(([k2, v]) => {
      const [account, drawer] = k2.split("|");
      return { account, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0, ...(drawer ? { dims: { drawer } } : {}) };
    });
    days.set(k, d);
  }
  return [...keep, ...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

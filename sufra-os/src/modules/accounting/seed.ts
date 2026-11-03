/** Demo accounting history (filled in below). */
import type { Collections } from "@/data/types";

type Rows = { [C in "glAccounts" | "costCentres" | "journalDrafts" | "accountingSettings" | "cashAccounts" | "cashTransfers" | "expenses" | "recurringExpenses" | "bankLines" | "ledgerEntries"]: Collections[C][] };

export function demoAccountingRows(): Rows {
  return { glAccounts: [], costCentres: [], journalDrafts: [], accountingSettings: [], cashAccounts: [], cashTransfers: [], expenses: [], recurringExpenses: [], bankLines: [], ledgerEntries: [] };
}

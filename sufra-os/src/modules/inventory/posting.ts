/**
 * Inventory → general ledger, through the accounting module's public API (`postJournal` & friends): one balanced
 * entry per business event, idempotent per (sourceType, sourceId). Bookkeeping never blocks the kitchen: a failed
 * posting is written to the audit log for the accountant instead of throwing.
 *
 *   sale (at send)     Dr 5101/5102/5103 cost of sales        Cr 1301/1302/1303 inventory      (recipe × average cost)
 *   waste              Dr 5201 waste (5301 staff meals)       Cr inventory
 *   count adjustment   Dr/Cr 5401 inventory variance          Cr/Dr inventory
 *   supplier invoice   Dr inventory (net) + 1401 input VAT    Cr 2101 payables                 (sufra-finance postPurchase)
 *   supplier payment   Dr 2101 payables                       Cr 1105 bank / 1101 cash
 *   transfers & production move value between locations of the same account → no entry.
 */
import type { Db } from "@/data/hooks";
import type { StockAccount } from "@/data/types";
import type { Units } from "@/lib/money";
import { ACC, SOURCE, businessDay, postCogs, postJournal, postPurchaseInvoice, postSupplierPayment, signedLines } from "@/modules/accounting/api";

export const STOCK_CODE: Record<StockAccount, string> = { food: ACC.inventoryFood, beverage: ACC.inventoryBeverage, packaging: ACC.inventoryPackaging };
export const COGS_CODE: Record<StockAccount, string> = { food: ACC.cogsFood, beverage: ACC.cogsBeverage, packaging: ACC.cogsPackaging };

export type ByAccount = Partial<Record<StockAccount, Units>>;
export const addTo = (m: ByAccount, a: StockAccount, v: Units) => {
  m[a] = (m[a] ?? 0) + v;
};
const total = (m: ByAccount) => (m.food ?? 0) + (m.beverage ?? 0) + (m.packaging ?? 0);

async function safe(db: Db, what: string, fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    await db.audit("ledger.error", "ledgerEntries", null, { what, error: msg }).catch(() => undefined);
    return msg;
  }
}

export function postSaleCost(db: Db, p: { id: string; branchId: string | null; cost: ByAccount; memo: string; date?: string }) {
  if (!total(p.cost)) return Promise.resolve(null);
  return safe(db, "cogs", () => postCogs(db, { id: p.id, date: p.date ?? businessDay(), branchId: p.branchId, food: p.cost.food, beverage: p.cost.beverage, packaging: p.cost.packaging, memo: p.memo }));
}

/** Waste and staff meals: expense at cost against each stock account. */
export function postWasteCost(db: Db, p: { id: string; branchId: string | null; cost: ByAccount; staffMeal?: boolean; reason: string; date?: string }) {
  const t = total(p.cost);
  if (!t) return Promise.resolve(null);
  const exp = p.staffMeal ? ACC.staffMeals : ACC.waste;
  return safe(db, "waste", () =>
    postJournal(db, {
      date: p.date ?? businessDay(), branchId: p.branchId, sourceType: p.staffMeal ? "staff-meal" : SOURCE.waste, sourceId: p.id, memo: `${p.staffMeal ? "Staff meal" : "Waste"} · ${p.reason}`,
      lines: signedLines([[exp, t], ...(Object.entries(p.cost) as [StockAccount, Units][]).map(([a, v]) => [STOCK_CODE[a], -v] as [string, Units])]),
    }),
  );
}

/** Count approved: gains credit, losses debit inventory variance (5401). `value` per account is signed (+ found, − missing). */
export function postCountVariance(db: Db, p: { id: string; branchId: string | null; value: ByAccount; date?: string }) {
  const t = total(p.value);
  const rows = (Object.entries(p.value) as [StockAccount, Units][]).filter(([, v]) => v !== 0);
  if (!rows.length) return Promise.resolve(null);
  return safe(db, "count", () =>
    postJournal(db, {
      date: p.date ?? businessDay(), branchId: p.branchId, sourceType: SOURCE.stockCount, sourceId: p.id, memo: "Stock count adjustment",
      lines: signedLines([...rows.map(([a, v]) => [STOCK_CODE[a], v] as [string, Units]), [ACC.inventoryVariance, -t]]),
    }),
  );
}

export function postSupplierInvoice(db: Db, p: { id: string; branchId: string | null; supplier: string; invoiceNo: string; date: string; lines: { account: StockAccount | "expense"; net: Units; vat: Units }[] }) {
  return postPurchaseInvoice(db, {
    id: p.id, date: p.date, supplier: p.supplier, invoiceNo: p.invoiceNo, branchId: p.branchId,
    lines: p.lines.map((l) => ({ account: l.account === "expense" ? ACC.misc : STOCK_CODE[l.account], net: l.net, vat: l.vat })),
  });
}

export function postPaymentToSupplier(db: Db, p: { id: string; branchId: string | null; supplier: string; amount: Units; method: "cash" | "bank" | "instapay" | "cheque"; date: string }) {
  return postSupplierPayment(db, { id: p.id, date: p.date, supplier: p.supplier, amount: p.amount, branchId: p.branchId, fromCode: p.method === "cash" ? ACC.cash : ACC.bank });
}

export { safe as safePost };

/**
 * Cash & liquidity (pure): where the money is right now, and what should raise a flag.
 * Balances come from the journal: each CashAccount points at a GL code; drawers share 1101 and are told apart by
 * the `drawer` dimension (= POS device code) that sale / cash-move / drawer-count postings carry.
 */
import type { AccountingSettings, BankStatementLine, CashAccount, CashTransfer, Expense, JournalDraft } from "@/data/accountingTypes";
import type { LedgerEntry, Shift } from "@/data/types";
import type { Units } from "@/lib/money";
import { ACC } from "./chart";
import { addDays } from "./core";

export interface PositionRow {
  account: CashAccount;
  balance: Units;
}
export interface CashPosition {
  rows: PositionRow[];
  /** cash in 1101 not attributed to a known drawer (old postings without a device) */
  unassignedDrawerCash: Units;
  byKind: Record<CashAccount["kind"], Units>;
  /** drawers + safe + petty + bank + wallets: spendable today */
  onHand: Units;
  /** card machines, gateways and delivery apps: earned, not yet in the bank */
  pending: Units;
  total: Units;
}

type E = Pick<LedgerEntry, "date" | "lines">;

export function cashPosition(accounts: CashAccount[], entries: E[], asOf = "9999-12-31"): CashPosition {
  const byCode = new Map<string, Units>();
  const byDrawer = new Map<string, Units>();
  for (const e of entries) {
    if (e.date > asOf) continue;
    for (const l of e.lines) {
      const v = l.debit - l.credit;
      byCode.set(l.account, (byCode.get(l.account) ?? 0) + v);
      if (l.account === ACC.cash) {
        const d = l.dims?.drawer ?? "";
        byDrawer.set(d, (byDrawer.get(d) ?? 0) + v);
      }
    }
  }
  const active = accounts.filter((a) => a.active).sort((a, b) => a.sort - b.sort);
  const drawerCodes = new Set(active.filter((a) => a.kind === "drawer").map((a) => a.institution));
  const rows: PositionRow[] = [];
  const seenCodes = new Set<string>();
  for (const a of active) {
    if (a.kind === "drawer") rows.push({ account: a, balance: byDrawer.get(a.institution) ?? 0 });
    else {
      // two cash accounts on one GL code would double count: only the first one carries the balance
      rows.push({ account: a, balance: seenCodes.has(a.glCode) ? 0 : (byCode.get(a.glCode) ?? 0) });
      seenCodes.add(a.glCode);
    }
  }
  let unassigned = 0;
  for (const [d, v] of byDrawer) if (!drawerCodes.has(d)) unassigned += v;
  const byKind = { drawer: unassigned, safe: 0, petty: 0, bank: 0, wallet: 0, provider: 0 } as Record<CashAccount["kind"], Units>;
  for (const r of rows) byKind[r.account.kind] += r.balance;
  const onHand = byKind.drawer + byKind.safe + byKind.petty + byKind.bank + byKind.wallet;
  const pending = byKind.provider;
  return { rows, unassignedDrawerCash: unassigned, byKind, onHand, pending, total: onHand + pending };
}

/** Journal lines for an approved transfer; a counted amount different from what left posts the gap to over/short. */
export function transferLines(t: Pick<CashTransfer, "amount" | "counted">, from: CashAccount, to: CashAccount, branchId: string | null) {
  const dims = (a: CashAccount) => ({ ...(branchId ? { branch: branchId } : {}), ...(a.kind === "drawer" ? { drawer: a.institution } : {}) });
  const received = t.counted ?? t.amount;
  const diff = received - t.amount;
  const lines = [
    { account: to.glCode, debit: received, credit: 0, dims: dims(to) },
    { account: from.glCode, debit: 0, credit: t.amount, dims: dims(from) },
  ];
  if (diff > 0) lines.push({ account: ACC.cashOverShort, debit: 0, credit: diff, dims: dims(to) });
  if (diff < 0) lines.push({ account: ACC.cashOverShort, debit: -diff, credit: 0, dims: dims(to) });
  return lines.filter((l) => l.debit || l.credit);
}

/* ───────── alerts ───────── */

export type AlertKind = "low_cash_payday" | "low_cash" | "over_short" | "shift_over_short" | "safe_over_limit" | "petty_low" | "vat_due" | "approvals" | "bank_unmatched" | "negative_balance";
export interface CashAlert {
  kind: AlertKind;
  tone: "danger" | "warn" | "info";
  amount?: Units;
  date?: string;
  count?: number;
  ref?: string;
}

export function cashAlerts(x: {
  today: string;
  position: CashPosition;
  settings: Pick<AccountingSettings, "lowCashThreshold" | "overShortAlert">;
  forecast?: { minBalance: Units; minDate: string; paydays: { date: string; amount: Units; balanceAfter: Units }[] } | null;
  entries: Pick<LedgerEntry, "date" | "lines" | "sourceType" | "sourceId">[];
  shifts?: Pick<Shift, "id" | "device" | "difference" | "closedAt">[];
  transfers?: CashTransfer[];
  expenses?: Expense[];
  drafts?: JournalDraft[];
  bankLines?: BankStatementLine[];
  vatDue?: { date: string; amount: Units } | null;
}): CashAlert[] {
  const out: CashAlert[] = [];
  const { position: p, settings: s } = x;
  const liquid = p.onHand;
  for (const pd of x.forecast?.paydays ?? []) {
    if (pd.balanceAfter < s.lowCashThreshold) {
      out.push({ kind: "low_cash_payday", tone: pd.balanceAfter < 0 ? "danger" : "warn", amount: pd.balanceAfter, date: pd.date });
      break;
    }
  }
  if (!out.length && x.forecast && x.forecast.minBalance < s.lowCashThreshold) out.push({ kind: "low_cash", tone: x.forecast.minBalance < 0 ? "danger" : "warn", amount: x.forecast.minBalance, date: x.forecast.minDate });
  else if (!x.forecast && liquid < s.lowCashThreshold) out.push({ kind: "low_cash", tone: "warn", amount: liquid });
  for (const r of p.rows) {
    if (r.balance < 0 && r.account.kind !== "provider") out.push({ kind: "negative_balance", tone: "danger", amount: r.balance, ref: r.account.id });
    if (r.account.kind === "safe" && r.account.limit && r.balance > r.account.limit) out.push({ kind: "safe_over_limit", tone: "warn", amount: r.balance - r.account.limit, ref: r.account.id });
    if (r.account.kind === "petty" && r.account.limit && r.balance < r.account.limit * 0.2) out.push({ kind: "petty_low", tone: "info", amount: r.balance, ref: r.account.id });
  }
  // large over/short in the last 7 days (drawer counts, cash-ups, rider settlements)
  const since = addDays(x.today, -7);
  for (const e of x.entries) {
    if (e.date < since) continue;
    const os = e.lines.filter((l) => l.account === ACC.cashOverShort).reduce((a, l) => a + l.debit - l.credit, 0);
    if (Math.abs(os) >= s.overShortAlert && os !== 0) out.push({ kind: "over_short", tone: os > 0 ? "danger" : "warn", amount: -os, date: e.date, ref: e.sourceId });
  }
  for (const sh of x.shifts ?? []) {
    if (sh.difference != null && Math.abs(sh.difference) >= s.overShortAlert && sh.closedAt && sh.closedAt.slice(0, 10) >= since) out.push({ kind: "shift_over_short", tone: sh.difference < 0 ? "danger" : "warn", amount: sh.difference, ref: sh.device });
  }
  if (x.vatDue && x.vatDue.amount > 0 && x.vatDue.date <= addDays(x.today, 10)) out.push({ kind: "vat_due", tone: "warn", amount: x.vatDue.amount, date: x.vatDue.date });
  const approvals = (x.transfers ?? []).filter((t) => t.status === "pending").length + (x.expenses ?? []).filter((e) => e.status === "pending").length + (x.drafts ?? []).filter((d) => d.status === "pending").length;
  if (approvals) out.push({ kind: "approvals", tone: "info", count: approvals });
  const stale = (x.bankLines ?? []).filter((l) => l.status === "unmatched" && l.date <= addDays(x.today, -7)).length;
  if (stale) out.push({ kind: "bank_unmatched", tone: "info", count: stale });
  return out;
}

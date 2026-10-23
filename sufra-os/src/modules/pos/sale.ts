/**
 * Money side of the POS: tenders, closing a check (receipt + ETA e-receipt + ledger), returns, shifts and the drawer.
 *
 *  - Each paid check gets one receipt (SC) with a continuous number per POS device and the ETA uuid chained to the
 *    device's previous receipt (previousUUID). Returns are RC receipts in the same chain, referencing the sale.
 *  - Journal entries follow sufra-finance's posting rules (postSale / postReturn / postCashMove / postDrawerCount) and are
 *    stored in `ledgerEntries` (Units).
 *  - Z/X reports are sufra-finance `zReport` over the shift's receipts and cash movements.
 */
import { Ledger, type JournalEntry } from "@finance/ledger";
import { ACCOUNTS } from "@finance/ledger";
import { postCashMove, postDrawerCount, postReturn, postSale } from "@finance/posting";
import { priceBill, type Bill } from "@finance/tax";
import { zReport, type ShiftDoc, type ZReport } from "@finance/shift";
import type { Db } from "@/data/hooks";
import { setTableStatus } from "@/data/ops";
import { priceItems, toTaxProfile } from "@/data/pricing";
import type { CashMoveKind, Check, LedgerEntry, Payment, PaymentMethod, Receipt, ReceiptBill, Settings, Shift } from "@/data/types";
import { fromAmount, toAmount, type Units } from "@/lib/money";
import { loadRaw, saveRaw } from "@/lib/storage";
import { nowIso } from "@/lib/time";
import { freezeBill, toFinanceBill, toFinancePayments } from "@/lib/receipt/bill";
import { etaConfig, etaSettingsOf, issueEtaReceipt, EtaValidationError } from "@/lib/receipt/eta";
import { loadTicket } from "./ops";
import { remaining, toPiastre } from "./math";

/* ───────── device ───────── */

const DEVICE_KEY = "sufra-os.pos.device";
/** This tablet's POS code (receipt prefix, shift owner). Set once per device. */
export const deviceCode = () => loadRaw(DEVICE_KEY) || "POS1";
export const setDeviceCode = (c: string) => saveRaw(DEVICE_KEY, c.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8) || "POS1");
export const receiptNumber = (device: string, seq: number) => `${device}-${String(seq).padStart(6, "0")}`;

/* ───────── tenders ───────── */

export async function takePayment(db: Db, check: Check, p: { method: PaymentMethod; amount: Units; tip: Units; tendered: Units | null; reference?: string | null; splitLabel?: string | null }) {
  const amount = toPiastre(p.amount);
  if (amount <= 0) throw new Error("amount must be positive");
  if (p.tip && p.method === "cash") throw new Error("cash tips go to the tip jar, not through the till");
  const branchId = check.branchId;
  const row = await db.insert("payments", {
    branchId, checkId: check.id, method: p.method, amount, tip: toPiastre(p.tip), tendered: p.method === "cash" ? (p.tendered ?? amount) : null,
    change: p.method === "cash" ? Math.max(0, (p.tendered ?? amount) - amount) : null, reference: p.reference ?? null, splitLabel: p.splitLabel ?? null,
    status: "captured", takenBy: db.actorId, refundOf: null,
  });
  const paid = (await db.list("payments", { where: { checkId: check.id, status: "captured" } })).reduce((a, x) => a + x.amount, 0);
  await db.update("checks", check.id, { paid });
  return row;
}

/** Undo a tender before the check is closed. */
export async function voidPayment(db: Db, p: Payment) {
  await db.update("payments", p.id, { status: "void" });
  const paid = (await db.list("payments", { where: { checkId: p.checkId, status: "captured" } })).reduce((a, x) => a + x.amount, 0);
  await db.update("checks", p.checkId, { paid });
  await db.audit("payment.void", "payments", p.id, { amount: p.amount, method: p.method });
}

/* ───────── receipts & ETA ───────── */

async function lastReceipt(db: Db, branchId: string, device: string) {
  const [r] = await db.list("receipts", { where: { branchId, device }, orderBy: [{ field: "seq", dir: "desc" }], limit: 1 });
  return r ?? null;
}

async function context(db: Db, branchId: string) {
  const [settings] = await db.list("settings");
  const [restaurant] = await db.list("restaurants");
  const branch = await db.get("branches", branchId);
  if (!settings || !restaurant) throw new Error("restaurant settings missing");
  return { settings, restaurant, branch };
}

interface IssueOut {
  receipt: Receipt;
  etaError: string | null;
}

async function issueDocument(
  db: Db,
  x: { kind: "SC" | "RC"; checkId: string; branchId: string; shiftId: string | null; device: string; bill: Bill; frozen: ReceiptBill; payments: { method: PaymentMethod; amount: Units; tip: Units }[]; refundOf: Receipt | null; orderRef: string | null },
): Promise<IssueOut> {
  const { settings, restaurant, branch } = await context(db, x.branchId);
  const prev = await lastReceipt(db, x.branchId, x.device);
  const seq = (prev?.seq ?? 0) + 1;
  const receiptNo = receiptNumber(x.device, seq);
  const issuedAt = new Date();
  issuedAt.setMilliseconds(0);
  const eta = etaSettingsOf(settings);
  let etaOut: { uuid: string; json: string; qr: string } | null = null;
  let etaError: string | null = null;
  if (eta.enabled) {
    const lines = x.frozen.lines.map((l) => ({ description: `${l.name.ar} / ${l.name.en}`.slice(0, 500), internalCode: internalCode(l.itemId, l.id) }));
    try {
      const cfg = etaConfig({ settings, restaurant, branch, internalCodes: lines.map((l) => l.internalCode) });
      const r = await issueEtaReceipt(cfg, {
        kind: x.kind, bill: x.bill, profile: toTaxProfile(settings.tax), lines, payments: toFinancePayments(x.payments), receiptNumber: receiptNo, issuedAt,
        previousUUID: prev?.etaUuid ?? "", ...(x.kind === "RC" ? { referenceUUID: x.refundOf?.etaUuid ?? "" } : {}), ...(x.orderRef ? { orderRef: x.orderRef } : {}),
      });
      etaOut = { uuid: r.uuid, json: r.json, qr: r.qr };
    } catch (e) {
      etaError = e instanceof EtaValidationError ? e.message : String((e as Error).message ?? e);
    }
  }
  const receipt = await db.insert("receipts", {
    branchId: x.branchId, checkId: x.checkId, shiftId: x.shiftId, device: x.device, kind: x.kind, seq, receiptNo, issuedAt: issuedAt.toISOString(), issuedBy: db.actorId,
    bill: x.frozen, payments: x.payments, refundOf: x.refundOf?.id ?? null, etaUuid: etaOut?.uuid ?? null, etaPreviousUuid: etaOut ? (prev?.etaUuid ?? "") : null,
    etaJson: etaOut?.json ?? null, etaQr: etaOut?.qr ?? null, etaStatus: !eta.enabled ? "not_required" : etaOut ? "pending" : "invalid", etaSubmissionUuid: null,
    etaErrors: etaError ? [etaError] : [],
  });
  return { receipt, etaError };
}

/** Menu sku (or item id) — the ETA internalCode a line is reported under. */
const internalCode = (itemId: string | null, lineId: string) => (itemId ? `ITEM-${itemId.slice(0, 8).toUpperCase()}` : `LINE-${lineId.slice(0, 8)}`);

/* ───────── ledger ───────── */

const toRow = (e: JournalEntry, branchId: string | null): Omit<LedgerEntry, "id" | "createdAt" | "updatedAt" | "restaurantId"> => ({
  branchId,
  date: e.date,
  sourceType: e.source.type,
  sourceId: e.source.id,
  memo: e.memo,
  lines: e.lines.map((l) => ({ account: l.account, debit: fromAmount(l.debit), credit: fromAmount(l.credit), ...(l.dims ? { dims: l.dims } : {}) })),
});

async function post(db: Db, branchId: string | null, fn: (l: Ledger) => JournalEntry | null) {
  try {
    const e = fn(new Ledger());
    if (e) await db.insert("ledgerEntries", toRow(e, branchId));
    return null;
  } catch (err) {
    // never block the guest on bookkeeping: log it for the accountant
    await db.audit("ledger.error", "ledgerEntries", null, { error: String((err as Error).message ?? err) });
    return String((err as Error).message ?? err);
  }
}

export const businessDate = (d = new Date()) => {
  // restaurants open past midnight: before 05:00 still belongs to yesterday's business day
  const x = new Date(d.getTime() - 5 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};

/* ───────── closing a check ───────── */

export interface CloseResult {
  receipt: Receipt;
  etaError: string | null;
  ledgerError: string | null;
}

/** Called once the tenders cover the total: freezes the bill, issues the receipt + e-receipt, posts the sale, frees the table. */
export async function closeCheck(db: Db, checkId: string, opts: { shift: Shift | null; device: string }): Promise<CloseResult> {
  const t = await loadTicket(db, checkId);
  if (!t) throw new Error("check not found");
  if (t.check.status === "paid") {
    const [r] = await db.list("receipts", { where: { checkId, kind: "SC" } });
    if (r) return { receipt: r, etaError: null, ledgerError: null };
  }
  const [settings] = await db.list("settings");
  const order = t.orders[0];
  const vatExempt = new Set((await db.list("menuItems", { where: { vatExempt: true } })).map((m) => m.id));
  const { bill } = priceItems(t.items, { mode: order?.mode ?? "dine_in", tax: settings.tax, discount: t.check.discount, deliveryFee: order?.deliveryFee, vatExemptItemIds: vatExempt });
  if (!bill) throw new Error("empty check");
  const pays = await db.list("payments", { where: { checkId, status: "captured" } });
  const due = remaining(fromAmount(bill.payable), pays);
  if (due > 0) throw new Error("check is not fully paid");
  const live = t.items.filter((i) => i.status !== "void");
  const frozen = freezeBill(bill, live);
  const tenders = pays.map((p) => ({ method: p.method, amount: p.amount, tip: p.tip }));
  // overpayment by card/wallet (cash change is handled at the till) is not allowed to slip into revenue
  const over = tenders.reduce((a, p) => a + p.amount, 0) - frozen.payable;
  if (over > 0) {
    const last = [...tenders].reverse().find((p) => p.amount > over);
    if (last) last.amount -= over;
  }
  const { receipt, etaError } = await issueDocument(db, {
    kind: "SC", checkId, branchId: t.check.branchId, shiftId: opts.shift?.id ?? null, device: opts.device, bill, frozen, payments: tenders, refundOf: null,
    orderRef: order ? `#${order.number}` : null,
  });
  const now = nowIso();
  await db.update("checks", checkId, { status: "paid", closedAt: now, receiptNo: receipt.receiptNo, etaUuid: receipt.etaUuid, paid: frozen.payable });
  for (const o of t.orders) {
    const open = t.items.some((i) => i.orderId === o.id && ["new", "sent", "preparing"].includes(i.status));
    if (o.mode === "dine_in" || !open) await db.update("orders", o.id, { status: "closed", closedAt: now });
  }
  for (const tid of t.check.tableIds) {
    const others = (await db.list("checks", { where: { status: ["open", "bill_requested"] }, contains: { tableIds: tid } })).filter((c) => c.id !== checkId);
    if (!others.length) await setTableStatus(db, tid, "dirty");
  }
  if (t.check.customerId) {
    const c = await db.get("customers", t.check.customerId);
    if (c) await db.update("customers", c.id, { visits: c.visits + 1, lastVisitAt: now, totalSpent: c.totalSpent + frozen.payable, loyaltyPoints: c.loyaltyPoints + Math.floor(frozen.payable / 2_000_000) });
  }
  const ledgerError = await post(db, t.check.branchId, (l) =>
    postSale(l, bill, toFinancePayments(tenders), { date: businessDate(), receiptId: receipt.receiptNo, branch: t.check.branchId, drawer: opts.device }),
  );
  await db.audit("check.close", "checks", checkId, { receiptNo: receipt.receiptNo, total: frozen.payable, eta: receipt.etaUuid });
  return { receipt, etaError, ledgerError };
}

/* ───────── returns ───────── */

/**
 * Return (refund) some or all lines of a sale. Priced as its own bill at the original prices (each line keeps its share of
 * the original discount), issued as an RC receipt referencing the sale, posted with `postReturn`.
 */
export function returnBill(sale: ReceiptBill, settings: Settings, picks: { lineId: string; qty: number }[]): Bill {
  const lines = picks
    .map((p) => {
      const l = sale.lines.find((x) => x.id === p.lineId);
      if (!l || p.qty <= 0) return null;
      const q = Math.min(p.qty, l.qty);
      const disc = toPiastre(Math.round((l.discountTotal * q) / l.qty));
      return { id: l.id, qty: q, unitPrice: toAmount(l.unitPrice), category: l.category, vatExempt: l.vatExempt, ...(disc ? { discount: toAmount(disc) } : {}) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (!lines.length) throw new Error("nothing to return");
  const all = sale.lines.every((l) => picks.find((p) => p.lineId === l.id && p.qty >= l.qty));
  return priceBill({ mode: sale.mode, lines, ...(all && sale.deliveryFee ? { deliveryFee: toAmount(sale.deliveryFee) } : {}) }, toTaxProfile(settings.tax));
}

export async function refundSale(db: Db, sale: Receipt, picks: { lineId: string; qty: number }[], method: PaymentMethod, opts: { shift: Shift | null; device: string; approvedBy: string | null; reason: string }) {
  const [settings] = await db.list("settings");
  const bill = returnBill(sale.bill, settings, picks);
  const lineMeta = sale.bill.lines.map((l) => ({ id: l.id, itemId: l.itemId, name: l.name, modifiers: l.modifiers.map((n) => ({ groupId: "", modifierId: "", name: n, price: 0 })), notes: l.notes }));
  const frozen = freezeBill(bill, lineMeta);
  const tenders = [{ method, amount: frozen.payable, tip: 0 }];
  const { receipt, etaError } = await issueDocument(db, {
    kind: "RC", checkId: sale.checkId, branchId: sale.branchId, shiftId: opts.shift?.id ?? null, device: opts.device, bill, frozen, payments: tenders, refundOf: sale, orderRef: null,
  });
  const [orig] = await db.list("payments", { where: { checkId: sale.checkId, status: "captured" }, limit: 1 });
  await db.insert("payments", {
    branchId: sale.branchId, checkId: sale.checkId, method, amount: -frozen.payable, tip: 0, tendered: null, change: null, reference: receipt.receiptNo, splitLabel: null,
    status: "refunded", takenBy: db.actorId, refundOf: orig?.id ?? null,
  });
  const ledgerError = await post(db, sale.branchId, (l) =>
    postReturn(l, bill, toFinancePayments(tenders), { date: businessDate(), receiptId: receipt.receiptNo, originalReceiptId: sale.receiptNo, branch: sale.branchId, drawer: opts.device }),
  );
  await db.audit("payment.refund", "receipts", receipt.id, { of: sale.receiptNo, total: frozen.payable, method, reason: opts.reason, lines: picks }, opts.approvedBy);
  return { receipt, etaError, ledgerError };
}

/** What is still returnable on a sale (qty per line, after earlier returns). */
export function returnable(sale: Receipt, returns: Receipt[]): Map<string, number> {
  const m = new Map(sale.bill.lines.map((l) => [l.id, l.qty]));
  for (const r of returns) for (const l of r.bill.lines) m.set(l.id, Math.max(0, (m.get(l.id) ?? 0) - l.qty));
  return m;
}

/* ───────── shifts & drawer ───────── */

export async function openShift(db: Db, device: string, openingFloat: Units) {
  const branchId = db.branchId ?? (await db.list("branches", { where: { isDefault: true } }))[0]?.id;
  if (!branchId) throw new Error("no branch");
  const [cur] = await db.list("shifts", { where: { branchId, device, status: "open" } });
  if (cur) return cur;
  const s = await db.insert("shifts", {
    branchId, device, openedBy: db.actorId, closedBy: null, status: "open", openingFloat: toPiastre(openingFloat), openedAt: nowIso(), closedAt: null,
    countedCash: null, expectedCash: null, difference: null, zNumber: null, zReport: null,
  });
  await db.audit("shift.open", "shifts", s.id, { device, float: s.openingFloat });
  return s;
}

const MOVE_ACCOUNT = { in: ACCOUNTS.capital, out: ACCOUNTS.pettyExpenses };

export async function cashMove(db: Db, shift: Shift, kind: CashMoveKind, amount: Units, reason: string, approvedBy: string | null) {
  const m = await db.insert("cashMovements", { branchId: shift.branchId, shiftId: shift.id, kind, amount: kind === "no_sale" ? 0 : toPiastre(amount), reason: reason.trim(), actorId: db.actorId, approvedBy });
  if (kind !== "no_sale")
    await post(db, shift.branchId, (l) =>
      postCashMove(l, { kind, amount: toAmount(m.amount), reason: m.reason, account: MOVE_ACCOUNT[kind] }, { date: businessDate(), id: m.id, branch: shift.branchId, drawer: shift.device }),
    );
  await db.audit(kind === "no_sale" ? "drawer.open" : `drawer.${kind}`, "cashMovements", m.id, { amount: m.amount, reason: m.reason }, approvedBy);
  return m;
}

/** Z report in Units (JSON-safe) — what is frozen on the shift row and printed. */
export interface ZReportU {
  shiftId: string;
  device: string;
  openedAt: string;
  closedAt: string;
  firstNumber: number | null;
  lastNumber: number | null;
  sales: { count: number; net: Units; service: Units; vat: Units; delivery: Units; discount: Units; total: Units };
  returns: { count: number; net: Units; vat: Units; total: Units };
  byCategory: Record<string, Units>;
  byMethod: Record<string, Units>;
  tips: Units;
  rounding: Units;
  cash: { opening: Units; sales: Units; refunds: Units; moveIn: Units; moveOut: Units; expected: Units; counted: Units | null; difference: Units | null };
  vatDue: Units;
}

export function zToUnits(z: ZReport): ZReportU {
  const conv = (v: unknown): unknown => (typeof v === "bigint" ? fromAmount(v) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)])) : v);
  return conv(z) as ZReportU;
}

export function buildZ(shift: Shift, receipts: Receipt[], moves: { kind: CashMoveKind; amount: Units; reason: string }[], counted: Units | null, closedAt = nowIso()): ZReport {
  const docs: ShiftDoc[] = receipts
    .filter((r) => r.shiftId === shift.id)
    .sort((a, b) => a.seq - b.seq)
    .map((r) => ({ number: r.seq, kind: r.kind === "SC" ? "sale" : "return", bill: toFinanceBill(r.bill), payments: toFinancePayments(r.payments), at: r.issuedAt }));
  return zReport({
    shiftId: shift.id,
    device: shift.device,
    openedAt: shift.openedAt,
    closedAt,
    openingFloat: toAmount(shift.openingFloat),
    docs,
    moves: moves.filter((m) => m.kind !== "no_sale").map((m) => ({ kind: m.kind as "in" | "out", amount: toAmount(m.amount), reason: m.reason })),
    counted: counted == null ? null : toAmount(counted),
  });
}

export async function closeShift(db: Db, shift: Shift, counted: Units) {
  const receipts = await db.list("receipts", { where: { shiftId: shift.id } });
  const moves = await db.list("cashMovements", { where: { shiftId: shift.id } });
  const closedAt = nowIso();
  const z = buildZ(shift, receipts, moves, toPiastre(counted), closedAt);
  const prev = await db.list("shifts", { where: { branchId: shift.branchId, device: shift.device, status: "closed" }, orderBy: [{ field: "zNumber", dir: "desc" }], limit: 1 });
  const zNumber = (prev[0]?.zNumber ?? 0) + 1;
  const zu = zToUnits(z);
  const row = await db.update("shifts", shift.id, {
    status: "closed", closedAt, closedBy: db.actorId, countedCash: toPiastre(counted), expectedCash: zu.cash.expected, difference: zu.cash.difference, zNumber, zReport: zu as unknown as Record<string, unknown>,
  });
  await post(db, shift.branchId, (l) => postDrawerCount(l, z.cash.expected, z.cash.counted ?? z.cash.expected, { date: businessDate(), id: shift.id, branch: shift.branchId, drawer: shift.device }));
  await db.audit("shift.close", "shifts", shift.id, { zNumber, expected: zu.cash.expected, counted: toPiastre(counted), difference: zu.cash.difference });
  return { shift: row, z: zu, zNumber };
}

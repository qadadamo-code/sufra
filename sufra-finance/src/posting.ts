import { ACCOUNTS as A, lines, LedgerError, type Account, type Ledger } from './ledger'
import { sum, type Amount } from './money'
import type { Bill } from './tax'

export type PaymentMethod = 'cash' | 'card' | 'wallet' | 'instapay' | 'aggregator' | 'house'

export interface Payment {
  method: PaymentMethod
  amount: Amount
  /** Part of `amount` that is a tip for staff (card/wallet only). */
  tip?: Amount
  ref?: string
}

export interface PostingPolicy {
  /** Where the service charge goes: kept as revenue or owed to staff. */
  service: 'revenue' | 'staff'
  /** Revenue account per menu category; unknown categories fall back to food. */
  revenueByCategory: Record<string, Account>
}

export const DEFAULT_POLICY: PostingPolicy = {
  service: 'staff',
  revenueByCategory: { food: A.salesFood, beverage: A.salesBeverage },
}

const paymentAccount: Record<PaymentMethod, Account> = {
  cash: A.cash,
  card: A.cardClearing,
  wallet: A.walletClearing,
  instapay: A.walletClearing,
  aggregator: A.aggregatorReceivable,
  house: A.receivables,
}

export interface SaleContext {
  date: string
  receiptId: string
  branch: string
  drawer?: string
}

function saleLines(bill: Bill, payments: Payment[], ctx: SaleContext, policy: PostingPolicy) {
  const tips = sum(payments.map((p) => p.tip ?? 0n))
  const paid = sum(payments.map((p) => p.amount))
  if (paid !== bill.payable + tips) throw new LedgerError(`payments ${paid} do not settle the bill ${bill.payable} + tips ${tips}`)
  if (payments.some((p) => p.tip && p.method === 'cash')) throw new LedgerError('cash tips are not recorded through the till')
  const dims = { branch: ctx.branch, ...(ctx.drawer ? { drawer: ctx.drawer } : {}) }
  const b = { branch: ctx.branch }
  const byRevenue = new Map<Account, Amount>()
  for (const l of bill.lines) {
    const acc = policy.revenueByCategory[l.category] ?? A.salesFood
    byRevenue.set(acc, (byRevenue.get(acc) ?? 0n) + l.net)
  }
  type Row = [Account, Amount, Record<string, string>]
  return lines(
    ...payments.map((p): Row => [paymentAccount[p.method], p.amount, p.method === 'cash' ? dims : b]),
    ...[...byRevenue.entries()].map(([acc, v]): Row => [acc, -v, b]),
    [policy.service === 'staff' ? A.servicePayable : A.serviceRevenue, -bill.service, b],
    [A.outputVat, -bill.vat, b],
    [A.deliveryRevenue, -bill.deliveryFee, b],
    [A.tipsPayable, -tips, b],
    [A.rounding, -bill.rounding, b],
  )
}

/**
 * Journal for a settled bill:
 *   Dr payments (cash / card clearing / wallets / app receivable / house account)
 *   Cr revenue by category (at the taxable base), service, VAT, delivery fee,
 *   tips payable; the piastre rounding goes to its own account.
 */
export function postSale(ledger: Ledger, bill: Bill, payments: Payment[], ctx: SaleContext, policy = DEFAULT_POLICY) {
  return ledger.post({
    date: ctx.date,
    source: { type: 'receipt', id: ctx.receiptId },
    memo: `Sale ${ctx.receiptId}`,
    lines: saleLines(bill, payments, ctx, policy),
  })
}

/**
 * A return is priced as its own bill (the returned lines at the original
 * prices) and posted as the mirror image of a sale, refunded through `refunds`.
 * The original sale is never touched.
 */
export function postReturn(ledger: Ledger, returned: Bill, refunds: Payment[], ctx: SaleContext & { originalReceiptId: string }, policy = DEFAULT_POLICY) {
  return ledger.post({
    date: ctx.date,
    source: { type: 'return-receipt', id: ctx.receiptId },
    memo: `Return ${ctx.receiptId} of ${ctx.originalReceiptId}`,
    lines: saleLines(returned, refunds, ctx, policy).map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
  })
}

// ---------------------------------------------------------------------------
// Cash drawer

export interface CashMove {
  kind: 'in' | 'out'
  amount: Amount
  reason: string
  /** Counter-account, e.g. petty expenses for "bought ice", capital for owner top-up. */
  account: Account
}

export function postCashMove(ledger: Ledger, m: CashMove, ctx: { date: string; id: string; branch: string; drawer: string }) {
  if (m.amount <= 0n) throw new LedgerError('amount must be positive')
  if (!m.reason.trim()) throw new LedgerError('a reason is required for every cash movement')
  const sign = m.kind === 'in' ? 1n : -1n
  return ledger.post({
    date: ctx.date,
    source: { type: 'cash-move', id: ctx.id },
    memo: m.reason,
    lines: lines([A.cash, sign * m.amount, { branch: ctx.branch, drawer: ctx.drawer }], [m.account, -sign * m.amount, { branch: ctx.branch }]),
  })
}

/** Posts the difference between counted and expected cash when a shift closes. */
export function postDrawerCount(ledger: Ledger, expected: Amount, counted: Amount, ctx: { date: string; id: string; branch: string; drawer: string }) {
  const diff = counted - expected
  if (diff === 0n) return null
  return ledger.post({
    date: ctx.date,
    source: { type: 'drawer-count', id: ctx.id },
    memo: diff > 0n ? 'Cash over at close' : 'Cash short at close',
    lines: lines([A.cash, diff, { branch: ctx.branch, drawer: ctx.drawer }], [A.cashOverShort, -diff, { branch: ctx.branch }]),
  })
}

// ---------------------------------------------------------------------------
// Purchases (supplier e-invoices) and VAT

export interface PurchaseLine {
  account: Account // an inventory or expense account
  net: Amount
  vat: Amount
}

export function postPurchase(ledger: Ledger, p: { date: string; invoiceId: string; supplier: string; lines: PurchaseLine[]; branch: string }) {
  const total = sum(p.lines.map((l) => l.net + l.vat))
  return ledger.post({
    date: p.date,
    source: { type: 'purchase-invoice', id: p.invoiceId },
    memo: `Purchase ${p.invoiceId} from ${p.supplier}`,
    lines: lines(
      ...p.lines.map((l) => [l.account, l.net, { branch: p.branch }] as [Account, Amount, Record<string, string>]),
      [A.inputVat, sum(p.lines.map((l) => l.vat)), { branch: p.branch }],
      [A.payables, -total, { supplier: p.supplier }],
    ),
  })
}

export interface VatReturn {
  from: string
  to: string
  outputVat: Amount
  inputVat: Amount
  /** Positive = payable to ETA, negative = credit carried forward. */
  net: Amount
}

export function vatReturn(ledger: Ledger, from: string, to: string): VatReturn {
  const outputVat = -ledger.balance(A.outputVat.code, from, to)
  const inputVat = ledger.balance(A.inputVat.code, from, to)
  return { from, to, outputVat, inputVat, net: outputVat - inputVat }
}

/** Moves the period's VAT into the settlement account and locks the period. */
export function settleVat(ledger: Ledger, r: VatReturn, date: string) {
  if (date <= r.to) throw new LedgerError('settle after the period ends')
  const e = ledger.post({
    date,
    source: { type: 'vat-return', id: `${r.from}..${r.to}` },
    memo: `VAT return ${r.from} – ${r.to}`,
    lines: lines([A.outputVat, r.outputVat], [A.inputVat, -r.inputVat], [A.vatSettlement, -r.net]),
  })
  ledger.closeThrough(r.to)
  return e
}

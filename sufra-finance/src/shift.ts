import { sum, ZERO, type Amount } from './money'
import type { Payment, PaymentMethod } from './posting'
import type { Bill } from './tax'

/** One issued document, as the shift sees it. */
export interface ShiftDoc {
  number: number // receipt sequence number within the device
  kind: 'sale' | 'return'
  bill: Bill
  payments: Payment[]
  at: string
}

export interface CashMoveRecord {
  kind: 'in' | 'out'
  amount: Amount
  reason: string
}

export interface ZReport {
  shiftId: string
  device: string
  openedAt: string
  closedAt: string
  firstNumber: number | null
  lastNumber: number | null
  sales: { count: number; net: Amount; service: Amount; vat: Amount; delivery: Amount; discount: Amount; total: Amount }
  returns: { count: number; net: Amount; vat: Amount; total: Amount }
  byCategory: Record<string, Amount>
  byMethod: Record<PaymentMethod, Amount>
  tips: Amount
  rounding: Amount
  cash: { opening: Amount; sales: Amount; refunds: Amount; moveIn: Amount; moveOut: Amount; expected: Amount; counted: Amount | null; difference: Amount | null }
  /** Net VAT due from this shift (sales VAT − returns VAT). */
  vatDue: Amount
}

const METHODS: PaymentMethod[] = ['cash', 'card', 'wallet', 'instapay', 'aggregator', 'house']

/**
 * End-of-shift (Z) report. Pure: everything comes from the documents and cash
 * movements of the shift, so it can be recomputed and audited at any time.
 */
export function zReport(input: {
  shiftId: string
  device: string
  openedAt: string
  closedAt: string
  openingFloat: Amount
  docs: ShiftDoc[]
  moves: CashMoveRecord[]
  counted: Amount | null
}): ZReport {
  const sales = input.docs.filter((d) => d.kind === 'sale')
  const returns = input.docs.filter((d) => d.kind === 'return')
  const nums = input.docs.map((d) => d.number).sort((a, b) => a - b)

  // Receipt numbers must be continuous: a gap means a document went missing.
  for (let i = 1; i < nums.length; i++) if (nums[i] !== nums[i - 1] + 1) throw new Error(`receipt numbers jump from ${nums[i - 1]} to ${nums[i]}`)

  const byMethod = Object.fromEntries(METHODS.map((m) => [m, ZERO])) as Record<PaymentMethod, Amount>
  let cashSales = ZERO
  let cashRefunds = ZERO
  for (const d of input.docs) {
    for (const p of d.payments) {
      const net = p.amount - (p.tip ?? 0n)
      byMethod[p.method] += d.kind === 'sale' ? net : -net
      if (p.method === 'cash') {
        if (d.kind === 'sale') cashSales += p.amount
        else cashRefunds += p.amount
      }
    }
  }
  const byCategory: Record<string, Amount> = {}
  for (const d of input.docs)
    for (const l of d.bill.lines) byCategory[l.category] = (byCategory[l.category] ?? 0n) + (d.kind === 'sale' ? l.net : -l.net)

  const moveIn = sum(input.moves.filter((m) => m.kind === 'in').map((m) => m.amount))
  const moveOut = sum(input.moves.filter((m) => m.kind === 'out').map((m) => m.amount))
  const expected = input.openingFloat + cashSales - cashRefunds + moveIn - moveOut
  const s = (k: keyof Pick<Bill, 'net' | 'service' | 'vat' | 'deliveryFee' | 'discount' | 'payable'>, list: ShiftDoc[]) => sum(list.map((d) => d.bill[k]))

  return {
    shiftId: input.shiftId,
    device: input.device,
    openedAt: input.openedAt,
    closedAt: input.closedAt,
    firstNumber: nums[0] ?? null,
    lastNumber: nums[nums.length - 1] ?? null,
    sales: { count: sales.length, net: s('net', sales), service: s('service', sales), vat: s('vat', sales), delivery: s('deliveryFee', sales), discount: s('discount', sales), total: s('payable', sales) },
    returns: { count: returns.length, net: s('net', returns), vat: s('vat', returns), total: s('payable', returns) },
    byCategory,
    byMethod,
    tips: sum(input.docs.flatMap((d) => d.payments.map((p) => (d.kind === 'sale' ? 1n : -1n) * (p.tip ?? 0n)))),
    rounding: sum(input.docs.map((d) => (d.kind === 'sale' ? 1n : -1n) * d.bill.rounding)),
    cash: {
      opening: input.openingFloat,
      sales: cashSales,
      refunds: cashRefunds,
      moveIn,
      moveOut,
      expected,
      counted: input.counted,
      difference: input.counted === null ? null : input.counted - expected,
    },
    vatDue: s('vat', sales) - s('vat', returns),
  }
}

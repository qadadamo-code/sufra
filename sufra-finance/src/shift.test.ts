import { egp, format } from './money'
import { priceBill } from './tax'
import { zReport, type ShiftDoc } from './shift'
import { applyMove, averageCost, portionCost, type StockItem } from './inventory'

const sale = (n: number, qty: number, method: 'cash' | 'card', tip = 0n): ShiftDoc => {
  const bill = priceBill({ mode: 'dine-in', lines: [{ id: 'k', qty, unitPrice: egp('100'), category: 'food' }] })
  return { number: n, kind: 'sale', bill, payments: [{ method, amount: bill.payable + tip, ...(tip ? { tip } : {}) }], at: '' }
}

describe('Z report', () => {
  it('adds up a shift and finds the drawer difference', () => {
    const ret = priceBill({ mode: 'dine-in', lines: [{ id: 'k', qty: 1, unitPrice: egp('100'), category: 'food' }] })
    const docs: ShiftDoc[] = [
      sale(101, 2, 'cash'),
      sale(102, 1, 'card', egp('20')),
      { number: 103, kind: 'return', bill: ret, payments: [{ method: 'cash', amount: ret.payable }], at: '' },
    ]
    const z = zReport({ shiftId: 's1', device: 'POS-1', openedAt: '', closedAt: '', openingFloat: egp('500'), docs, moves: [{ kind: 'out', amount: egp('50'), reason: 'gas' }], counted: egp('575') })
    expect(z.firstNumber).toBe(101)
    expect(z.lastNumber).toBe(103)
    expect(z.sales.count).toBe(2)
    expect(format(z.sales.net, 2)).toBe('300.00')
    expect(z.tips).toBe(egp('20'))
    // 500 + 255.36 (2×100 +12% +14%) − 127.68 − 50
    expect(format(z.cash.expected, 2)).toBe('577.68')
    expect(format(z.cash.difference!, 2)).toBe('-2.68')
    expect(z.vatDue).toBe(z.sales.vat - z.returns.vat)
    expect(format(z.byMethod.card, 2)).toBe('127.68')
  })

  it('refuses a shift with a missing receipt number', () => {
    expect(() =>
      zReport({ shiftId: 's', device: 'd', openedAt: '', closedAt: '', openingFloat: 0n, docs: [sale(1, 1, 'cash'), sale(3, 1, 'cash')], moves: [], counted: null }),
    ).toThrow(/jump/)
  })
})

describe('inventory at weighted average cost', () => {
  const rice: StockItem = { id: 'rice', name: 'Rice', unit: 'g', qty: 0, value: 0n }

  it('averages receipts and costs consumption', () => {
    let r = applyMove(rice, { kind: 'receive', itemId: 'rice', qty: 10_000, cost: egp('400') }).item // 40/kg
    r = applyMove(r, { kind: 'receive', itemId: 'rice', qty: 10_000, cost: egp('500') }).item // 50/kg
    expect(format(averageCost(r) * 1000n, 2)).toBe('45.00')
    const used = applyMove(r, { kind: 'consume', itemId: 'rice', qty: 3_000, reason: 'sale' })
    expect(format(used.value, 2)).toBe('135.00')
    const all = applyMove(used.item, { kind: 'consume', itemId: 'rice', qty: 17_000, reason: 'sale' })
    expect(all.item.value).toBe(0n)
    expect(all.item.qty).toBe(0)
  })

  it('values count differences and portion costs', () => {
    const r = applyMove(rice, { kind: 'receive', itemId: 'rice', qty: 1_000, cost: egp('45') }).item
    const counted = applyMove(r, { kind: 'count', itemId: 'rice', counted: 900 })
    expect(format(counted.value, 2)).toBe('-4.50')
    expect(format(portionCost([{ itemId: 'rice', qty: 150 }], new Map([['rice', r]])), 2)).toBe('6.75')
  })
})

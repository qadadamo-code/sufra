import { allocate, applyRate, display, divRound, egp, format, removeRate, round } from './money'
import { DEFAULT_PROFILE, priceBill, type TaxProfile } from './tax'
import { ACCOUNTS as A, Ledger, LedgerError } from './ledger'
import { postCashMove, postDrawerCount, postPurchase, postReturn, postSale, settleVat, vatReturn } from './posting'

const fixedNow = () => new Date('2026-10-12T20:00:00Z')

describe('money', () => {
  it('parses and formats EGP at five decimals', () => {
    expect(egp('185')).toBe(18_500_000n)
    expect(egp('0.00001')).toBe(1n)
    expect(format(egp('12.5'), 2)).toBe('12.50')
    expect(format(egp('-3.333335'.slice(0, 8)), 5)).toBe('-3.33333')
    expect(() => egp('1.234567')).toThrow()
    expect(display(egp('1234.5'))).toBe('1,234.50 ج.م')
  })

  it('rounds half away from zero', () => {
    expect(divRound(5n, 2n)).toBe(3n)
    expect(divRound(-5n, 2n)).toBe(-3n)
    expect(round(egp('2.345'), 2)).toBe(egp('2.35'))
    expect(round(egp('-2.345'), 2)).toBe(egp('-2.35'))
  })

  it('applies and removes rates', () => {
    expect(applyRate(egp('100'), 1400)).toBe(egp('14'))
    expect(removeRate(egp('114'), 1400)).toBe(egp('100'))
  })

  it('allocates without losing a piastre', () => {
    const parts = allocate(egp('100'), [1n, 1n, 1n])
    expect(parts.map((p) => format(p, 2))).toEqual(['33.34', '33.33', '33.33'])
    expect(parts.reduce((a, b) => a + b)).toBe(egp('100'))
  })
})

describe('pricing a bill', () => {
  const kofta = { id: 'k', qty: 2, unitPrice: egp('185'), category: 'food' }
  const tea = { id: 't', qty: 3, unitPrice: egp('25'), category: 'beverage' }

  it('dine-in: 12% service then 14% VAT on top of service', () => {
    const b = priceBill({ mode: 'dine-in', lines: [kofta, tea] })
    expect(format(b.net, 2)).toBe('445.00')
    expect(format(b.service, 2)).toBe('53.40')
    expect(format(b.vat, 2)).toBe('69.78') // 14% of 498.40 = 69.776
    expect(format(b.payable, 2)).toBe('568.18')
    expect(b.payable - b.total).toBe(b.rounding)
  })

  it('delivery: no service, VAT on the delivery fee', () => {
    const b = priceBill({ mode: 'delivery', lines: [kofta], deliveryFee: egp('20') })
    expect(b.service).toBe(0n)
    expect(format(b.deliveryVat, 2)).toBe('2.80')
    expect(format(b.payable, 2)).toBe('444.60') // 370 + 51.8 + 20 + 2.8
  })

  it('spreads a bill discount over lines before tax', () => {
    const b = priceBill({ mode: 'takeaway', lines: [kofta, tea], discount: { kind: 'percent', rate: 1000 } })
    expect(format(b.discount, 2)).toBe('44.50')
    expect(format(b.net, 2)).toBe('400.50')
    expect(format(b.vat, 2)).toBe('56.07')
  })

  it('inclusive menus: the guest pays exactly the printed price', () => {
    const incl: TaxProfile = { ...DEFAULT_PROFILE, priceMode: 'inclusive' }
    const b = priceBill({ mode: 'dine-in', lines: [{ id: 'x', qty: 1, unitPrice: egp('99.99'), category: 'food' }] }, incl)
    expect(b.total).toBe(egp('99.99'))
    expect(b.lines[0].net + b.lines[0].service + b.lines[0].vat).toBe(egp('99.99'))
  })

  it('handles fractional quantities (fish by the kilo)', () => {
    const b = priceBill({ mode: 'takeaway', lines: [{ id: 'f', qty: 0.75, unitPrice: egp('280'), category: 'food' }] })
    expect(format(b.net, 2)).toBe('210.00')
  })

  it('rejects nonsense', () => {
    expect(() => priceBill({ mode: 'dine-in', lines: [] })).toThrow()
    expect(() => priceBill({ mode: 'dine-in', lines: [{ ...kofta, qty: 0 }] })).toThrow()
    expect(() => priceBill({ mode: 'dine-in', lines: [{ ...kofta, discount: egp('9999') }] })).toThrow()
  })
})

describe('ledger', () => {
  const ctx = { date: '2026-10-12', receiptId: 'R-1', branch: 'zamalek', drawer: 'D1' }

  it('posts a split-payment sale that balances and books VAT, service and tips', () => {
    const L = new Ledger(fixedNow)
    const b = priceBill({ mode: 'dine-in', lines: [{ id: 'k', qty: 2, unitPrice: egp('185'), category: 'food' }] })
    postSale(L, b, [
      { method: 'cash', amount: egp('200') },
      { method: 'card', amount: b.payable - egp('200') + egp('30'), tip: egp('30') },
    ], ctx)
    expect(-L.balance(A.outputVat.code)).toBe(b.vat)
    expect(-L.balance(A.servicePayable.code)).toBe(b.service)
    expect(-L.balance(A.tipsPayable.code)).toBe(egp('30'))
    expect(L.balance(A.cash.code, '', '9999', { drawer: 'D1' })).toBe(egp('200'))
    const tb = L.trialBalance()
    expect(tb.reduce((s, r) => s + r.balance, 0n)).toBe(0n)
  })

  it('refuses unbalanced or underpaid postings', () => {
    const L = new Ledger(fixedNow)
    const b = priceBill({ mode: 'takeaway', lines: [{ id: 't', qty: 1, unitPrice: egp('25'), category: 'beverage' }] })
    expect(() => postSale(L, b, [{ method: 'cash', amount: egp('20') }], ctx)).toThrow(LedgerError)
    expect(() => L.post({ date: '2026-10-12', source: { type: 'x', id: '1' }, memo: '', lines: [{ account: '1101', debit: 1n, credit: 0n }, { account: '4101', debit: 0n, credit: 2n }] })).toThrow(LedgerError)
  })

  it('reverses instead of editing, and returns mirror the sale', () => {
    const L = new Ledger(fixedNow)
    const b = priceBill({ mode: 'takeaway', lines: [{ id: 't', qty: 2, unitPrice: egp('25'), category: 'beverage' }] })
    const sale = postSale(L, b, [{ method: 'cash', amount: b.payable }], ctx)
    const ret = priceBill({ mode: 'takeaway', lines: [{ id: 't', qty: 1, unitPrice: egp('25'), category: 'beverage' }] })
    postReturn(L, ret, [{ method: 'cash', amount: ret.payable }], { ...ctx, receiptId: 'RR-1', originalReceiptId: 'R-1' })
    expect(-L.balance(A.outputVat.code)).toBe(b.vat - ret.vat)
    L.reverse(sale.id, '2026-10-12', 'wrong table')
    expect(() => L.reverse(sale.id, '2026-10-12', 'again')).toThrow()
    expect(L.trialBalance().reduce((s, r) => s + r.balance, 0n)).toBe(0n)
  })

  it('tracks the drawer, petty cash and over/short', () => {
    const L = new Ledger(fixedNow)
    const d = { date: '2026-10-12', branch: 'zamalek', drawer: 'D1' }
    postCashMove(L, { kind: 'in', amount: egp('500'), reason: 'Opening float', account: A.capital }, { ...d, id: 'm1' })
    postCashMove(L, { kind: 'out', amount: egp('40'), reason: 'Ice', account: A.pettyExpenses }, { ...d, id: 'm2' })
    expect(() => postCashMove(L, { kind: 'out', amount: egp('10'), reason: ' ', account: A.pettyExpenses }, { ...d, id: 'm3' })).toThrow()
    const expected = L.balance(A.cash.code, '', '9999', { drawer: 'D1' })
    postDrawerCount(L, expected, egp('455'), { ...d, id: 'z1' })
    expect(L.balance(A.cashOverShort.code)).toBe(egp('5'))
  })

  it('computes and settles the VAT return, then locks the period', () => {
    const L = new Ledger(fixedNow)
    const b = priceBill({ mode: 'takeaway', lines: [{ id: 'k', qty: 10, unitPrice: egp('100'), category: 'food' }] })
    postSale(L, b, [{ method: 'card', amount: b.payable }], { ...ctx, date: '2026-09-15' })
    postPurchase(L, { date: '2026-09-10', invoiceId: 'INV-9', supplier: 'S1', branch: 'zamalek', lines: [{ account: A.inventoryFood, net: egp('300'), vat: egp('42') }] })
    const r = vatReturn(L, '2026-09-01', '2026-09-30')
    expect(r.outputVat).toBe(egp('140'))
    expect(r.inputVat).toBe(egp('42'))
    expect(r.net).toBe(egp('98'))
    settleVat(L, r, '2026-10-05')
    expect(-L.balance(A.vatSettlement.code)).toBe(egp('98'))
    expect(() => postSale(L, b, [{ method: 'card', amount: b.payable }], { ...ctx, date: '2026-09-20' })).toThrow(/closed/)
  })
})

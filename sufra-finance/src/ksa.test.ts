import { egp as sar, format } from './money'
import { DEFAULT_PROFILE, KSA_PROFILE, documentVat, priceBill } from './tax'

// egp() just parses a 5-decimal amount; for SAR the scale is identical (1 SAR = 100 halalas = 100 000 units).
describe('KSA tax profile (ZATCA)', () => {
  it('is VAT 15% inclusive with no service charge and no ETA service code', () => {
    expect(KSA_PROFILE.vatRate).toBe(1500)
    expect(KSA_PROFILE.priceMode).toBe('inclusive')
    expect(KSA_PROFILE.serviceRate).toBe(0)
    expect(KSA_PROFILE.serviceCode).toBeNull()
    expect(DEFAULT_PROFILE.vatRate).toBe(1400) // Egypt untouched
  })

  it('backs 15% out of an inclusive price in halalas, guest pays the printed price', () => {
    const b = priceBill({ mode: 'dine-in', lines: [{ id: 'kabsa', qty: 1, unitPrice: sar('23'), category: 'food' }] }, KSA_PROFILE)
    expect(format(b.net, 2)).toBe('20.00')
    expect(format(b.vat, 2)).toBe('3.00')
    expect(b.service).toBe(0n)
    expect(b.payable).toBe(sar('23'))
  })

  it('awkward prices: line rounding keeps net + VAT = printed, every amount whole halalas', () => {
    const b = priceBill(
      { mode: 'takeaway', lines: [{ id: 'tea', qty: 3, unitPrice: sar('10'), category: 'bev' }, { id: 'x', qty: 1, unitPrice: sar('18.5'), category: 'food' }] },
      KSA_PROFILE,
    )
    for (const l of b.lines) {
      expect(l.net + l.vat).toBe(l.total)
      expect(l.net % 1000n).toBe(0n)
      expect(l.vat % 1000n).toBe(0n)
    }
    expect(format(b.lines[0].net, 2)).toBe('26.09') // 30 / 1.15 = 26.0869…, VAT 3.91
    expect(format(b.lines[0].vat, 2)).toBe('3.91')
    expect(b.total).toBe(sar('48.5'))
    expect(b.rounding).toBe(0n)
  })

  it('document-level VAT (ZATCA) can differ from the sum of line VATs by a halala', () => {
    const b = priceBill({ mode: 'takeaway', lines: [{ id: 'w', qty: 1, unitPrice: sar('10'), category: 'bev' }] }, KSA_PROFILE)
    // line: VAT on the exact base 8.69565 → 1.30, net = 10.00 − 1.30 = 8.70
    expect(format(b.net, 2)).toBe('8.70')
    expect(format(b.vat, 2)).toBe('1.30')
    // document: 8.70 × 15% = 1.305 → 1.31 (half-up) — the e-invoice declares 1.31 and a −0.01 payable rounding
    expect(format(documentVat(b.net, 1500), 2)).toBe('1.31')
  })

  it('delivery fee: VAT on top of the fee', () => {
    const b = priceBill({ mode: 'delivery', lines: [{ id: 'k', qty: 1, unitPrice: sar('46'), category: 'food' }], deliveryFee: sar('10') }, KSA_PROFILE)
    expect(format(b.deliveryVat, 2)).toBe('1.50')
    expect(format(b.payable, 2)).toBe('57.50')
  })
})

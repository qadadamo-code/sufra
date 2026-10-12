import { egp, format } from './money'
import { DEFAULT_PROFILE, priceBill } from './tax'
import {
  DEFAULT_DELIVERY_MODE, EtaValidationError, PosChain, etaSerialize, issueReceipt, parseExact, qrContent, sha256Hex, verifyReceiptUuid, type EtaConfig,
} from './eta-receipt'

const cfg: EtaConfig = {
  seller: {
    rin: '123456789',
    companyTradeName: 'Sufra Demo Restaurant',
    branchCode: '1',
    branchAddress: { country: 'EG', governate: 'Cairo', regionCity: 'Zamalek', street: '26th of July St', buildingNumber: '10' },
    deviceSerialNumber: 'SUFRA-POS-0002',
    activityCode: '5610',
  },
  portalUrl: 'https://preprod.invoicing.eta.gov.eg',
  itemCodes: {
    'MENU-0012': { itemType: 'EGS', itemCode: 'EG-123456789-MENU0012', unitType: 'EA' },
    'MENU-0040': { itemType: 'EGS', itemCode: 'EG-123456789-MENU0040', unitType: 'EA' },
    DELIVERY: { itemType: 'EGS', itemCode: 'EG-123456789-DLV', unitType: 'EA' },
  },
  deliveryMode: DEFAULT_DELIVERY_MODE,
  splitTender: 'dominant',
}
const at = new Date('2026-10-12T18:45:00Z')
const NOW = new Date('2026-10-12T19:00:00Z')
const lines = [
  { description: 'Koshary large', internalCode: 'MENU-0012' },
  { description: 'Fresh lemon juice', internalCode: 'MENU-0040' },
]
const bill = priceBill({
  mode: 'dine-in',
  lines: [
    { id: 'a', qty: 2, unitPrice: egp('50'), category: 'food' },
    { id: 'b', qty: 1, unitPrice: egp('25'), category: 'beverage' },
  ],
})

describe('ETA serialization', () => {
  it('matches the documented illustration', () => {
    expect(etaSerialize(parseExact('{"header":{"a":"1"},"items":[{"x":"2"},{"x":"3"}]}'))).toBe('"HEADER""A""1""ITEMS""ITEMS""X""2""ITEMS""X""3"')
  })
  it('keeps number text exactly', () => {
    expect(etaSerialize(parseExact('{"a":100.00,"b":0.0}'))).toBe('"A""100.00""B""0.0"')
  })
})

describe('Coffee & Restaurant receipt (SC v1.2)', () => {
  it('reproduces the spec example amounts', () => {
    const r = issueReceipt(cfg, { kind: 'SC', bill, profile: DEFAULT_PROFILE, lines, payments: [{ method: 'cash', amount: bill.payable }], receiptNumber: 'BR1-POS2-000154', issuedAt: at, previousUUID: '' }, NOW)
    const o = JSON.parse(r.json)
    expect(o.documentType).toEqual({ receiptType: 'SC', typeVersion: '1.2' })
    expect(o.header.orderdeliveryMode).toBe('FC')
    expect(o.itemData[0].taxableItems).toEqual([
      { taxType: 'T9', subType: 'SC01', rate: 12, amount: 12 },
      { taxType: 'T1', subType: 'V009', rate: 14, amount: 15.68 },
    ])
    expect(r.json).toContain('"totalAmount":159.60')
    expect(o.taxTotals).toEqual([{ taxType: 'T9', amount: 15 }, { taxType: 'T1', amount: 19.6 }])
    expect(o.paymentMethod).toBe('C')
    expect(r.uuid).toMatch(/^[0-9a-f]{64}$/)
    expect(verifyReceiptUuid(r.json).matches).toBe(true)
    expect(r.qr).toBe(`https://preprod.invoicing.eta.gov.eg/receipts/search/${r.uuid}/share/2026-10-12T18:45Z#Total:159.600,IssuerRIN:123456789`)
  })

  it('uuid is the hash of the receipt with an empty uuid', () => {
    const r = issueReceipt(cfg, { kind: 'SC', bill, profile: DEFAULT_PROFILE, lines, payments: [{ method: 'card', amount: bill.payable }], receiptNumber: 'X-1', issuedAt: at, previousUUID: '' }, NOW)
    const o = parseExact(r.json) as any
    o.header.uuid = ''
    expect(sha256Hex(etaSerialize(o))).toBe(r.uuid)
    // Tampering with any value breaks verification.
    expect(verifyReceiptUuid(r.json.replace('"Koshary large"', '"Koshary small"')).matches).toBe(false)
  })

  it('chains receipts and returns per POS', () => {
    const chain = new PosChain(cfg, { prefix: 'Z1-P2', next: 1, lastUUID: '', issued: [] }, () => NOW)
    const s1 = chain.issue({ kind: 'SC', bill, profile: DEFAULT_PROFILE, lines, payments: [{ method: 'cash', amount: bill.payable }], issuedAt: at })
    const back = priceBill({ mode: 'dine-in', lines: [{ id: 'b', qty: 1, unitPrice: egp('25'), category: 'beverage' }] })
    const r1 = chain.issue({ kind: 'RC', bill: back, profile: DEFAULT_PROFILE, lines: [lines[1]], payments: [{ method: 'cash', amount: back.payable }], issuedAt: at, referenceUUID: s1.uuid })
    expect(JSON.parse(s1.json).header.previousUUID).toBe('')
    const h = JSON.parse(r1.json).header
    expect(h.previousUUID).toBe(s1.uuid)
    expect(h.referenceUUID).toBe(s1.uuid)
    expect(r1.receiptNumber).toBe('Z1-P2-000002')
    expect(() => chain.issue({ kind: 'RC', bill: back, profile: DEFAULT_PROFILE, lines: [lines[1]], payments: [], issuedAt: at })).toThrow(EtaValidationError)
    const batches = chain.batches(chain.state.issued, 1)
    expect(batches).toHaveLength(2)
    expect(JSON.parse(batches[0]).receipts[0].header.uuid).toBe(s1.uuid)
  })

  it('puts the delivery fee on its own line with VAT, and maps aggregators to TO', () => {
    const d = priceBill({ mode: 'delivery', lines: [{ id: 'a', qty: 1, unitPrice: egp('50'), category: 'food' }], deliveryFee: egp('20') })
    const r = issueReceipt(cfg, { kind: 'SC', bill: d, profile: DEFAULT_PROFILE, lines: [lines[0]], payments: [{ method: 'aggregator', amount: d.payable }], receiptNumber: 'D-1', issuedAt: at, previousUUID: '', aggregator: true }, NOW)
    const o = JSON.parse(r.json)
    expect(o.itemData).toHaveLength(2)
    expect(o.itemData[1].internalCode).toBe('DELIVERY')
    expect(o.itemData[1].total).toBe(22.8)
    expect(o.header.orderdeliveryMode).toBe('TO')
    expect(o.paymentMethod).toBe('O')
    expect(format(r.totalAmount, 2)).toBe('79.80') // 50 + 7 VAT + 20 + 2.80 VAT
  })

  it('reports discounts as commercial discounts before tax', () => {
    const b = priceBill({ mode: 'takeaway', lines: [{ id: 'a', qty: 2, unitPrice: egp('50'), category: 'food' }], discount: { kind: 'percent', rate: 1000 } })
    const o = JSON.parse(issueReceipt(cfg, { kind: 'SC', bill: b, profile: DEFAULT_PROFILE, lines: [lines[0]], payments: [{ method: 'cash', amount: b.payable }], receiptNumber: 'Q-1', issuedAt: at, previousUUID: '' }, NOW).json)
    expect(o.itemData[0].totalSale).toBe(100)
    expect(o.itemData[0].commercialDiscountData[0].amount).toBe(10)
    expect(o.itemData[0].netSale).toBe(90)
    expect(o.totalCommercialDiscount).toBe(10)
  })

  it('enforces offline-checkable rules', () => {
    const big = priceBill({ mode: 'takeaway', lines: [{ id: 'a', qty: 1, unitPrice: egp('140000'), category: 'food' }] })
    expect(() => issueReceipt(cfg, { kind: 'SC', bill: big, profile: DEFAULT_PROFILE, lines: [lines[0]], payments: [], receiptNumber: 'B', issuedAt: at, previousUUID: '' }, NOW)).toThrow(/national ID/)
    expect(() => issueReceipt({ ...cfg, itemCodes: {} }, { kind: 'SC', bill, profile: DEFAULT_PROFILE, lines, payments: [], receiptNumber: 'B', issuedAt: at, previousUUID: '' }, NOW)).toThrow(/item code/)
    expect(() => issueReceipt(cfg, { kind: 'SC', bill, profile: DEFAULT_PROFILE, lines, payments: [], receiptNumber: 'B', issuedAt: new Date(NOW.getTime() + 3600e3), previousUUID: '' }, NOW)).toThrow(/future/)
  })

  it('QR follows the documented format', () => {
    expect(qrContent('http://invoicing.eta.gov.eg', 'abc', new Date('2022-02-19T02:00:00Z'), egp('1000'), '674859545')).toBe(
      'http://invoicing.eta.gov.eg/receipts/search/abc/share/2022-02-19T02:00Z#Total:1000.000,IssuerRIN:674859545',
    )
  })
})

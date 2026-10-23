import { divRound, format, PIASTRE, sum, type Amount } from './money'
import type { Payment } from './posting'
import type { Bill, OrderMode, TaxProfile } from './tax'

/**
 * ETA e-receipt core — everything except the hash, so it runs in Node and in the browser.
 * `eta-receipt.ts` adds the synchronous node:crypto SHA-256 (issueReceipt, PosChain, verifyReceiptUuid);
 * browsers use `issueReceiptAsync` / `verifyReceiptUuidAsync` with WebCrypto (crypto.subtle.digest).
 *
 * ETA e-receipt ("Coffee & Restaurant Receipt" v1.2: SC sale / RC return).
 * Field names, order, rules and the uuid algorithm follow docs/eta-spec.md
 * (sections 1.4–1.9), which cites the official SDK. Items marked UNCONFIRMED
 * there are configurable here and must be validated against ETA preprod.
 */

export interface EtaSeller {
  rin: string
  companyTradeName: string
  branchCode: string
  branchAddress: {
    country: 'EG'
    governate: string
    regionCity: string
    street: string
    buildingNumber: string
    postalCode?: string
    floor?: string
    room?: string
    landmark?: string
    additionalInformation?: string
  }
  deviceSerialNumber: string
  activityCode: string // 5610 restaurants, 5630 cafés
}

export interface EtaItemCode {
  itemType: 'EGS' | 'GS1'
  itemCode: string
  unitType: string // e.g. EA
}

export interface EtaBuyer {
  type: 'P' | 'B' | 'F'
  id?: string
  name?: string
  mobileNumber?: string
  paymentNumber?: string
}

export interface ReceiptLineMeta {
  description: string
  internalCode: string
}

export interface EtaConfig {
  seller: EtaSeller
  portalUrl: string // https://invoicing.eta.gov.eg | https://preprod.invoicing.eta.gov.eg
  /** Item code per internal menu code; DELIVERY is used for the delivery fee line. */
  itemCodes: Record<string, EtaItemCode>
  /** Order mode → orderdeliveryMode. Aggregator deliveries should map to TO. */
  deliveryMode: Record<OrderMode | 'aggregator', 'FC' | 'TC' | 'TO'>
  /** How split tender is reported (only one paymentMethod per receipt). UNCONFIRMED with ETA. */
  splitTender: 'dominant' | 'others'
}

export const DEFAULT_DELIVERY_MODE: EtaConfig['deliveryMode'] = { 'dine-in': 'FC', takeaway: 'FC', delivery: 'TC', aggregator: 'TO' }

/** Amount that must be shown with a buyer national ID for individuals (v1.2). */
export const BUYER_ID_THRESHOLD = 150_000n * 100_000n

// ---------------------------------------------------------------------------
// A tiny JSON model whose numbers keep their exact text, so the submitted
// JSON and the uuid serialization see the very same characters.

export class Num {
  constructor(readonly raw: string) {}
}
export type Json = string | Num | Json[] | { [k: string]: Json }

const money = (a: Amount) => new Num(format(a, a % PIASTRE === 0n ? 2 : 5))
const qtyNum = (q: number) => new Num(trimQty(q))
const rateNum = (bp: number) => new Num(trimNumber(bp / 100))

function trimQty(q: number) {
  const s = q.toFixed(5).replace(/0+$/, '').replace(/\.$/, '')
  return s
}
function trimNumber(n: number) {
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function toJsonText(v: Json): string {
  if (v instanceof Num) return v.raw
  if (typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(toJsonText).join(',') + ']'
  return '{' + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ':' + toJsonText(x)).join(',') + '}'
}

/** ETA "Document Serialization Approach" (eta-spec §1.5). */
export function etaSerialize(v: Json): string {
  if (v instanceof Num) return `"${v.raw}"`
  if (typeof v === 'string') return `"${v}"`
  if (Array.isArray(v)) throw new Error('arrays are serialized through their property')
  let s = ''
  for (const [k, x] of Object.entries(v)) {
    const name = k.toUpperCase()
    if (Array.isArray(x)) {
      s += `"${name}"`
      for (const item of x) s += `"${name}"` + etaSerialize(item)
    } else s += `"${name}"` + etaSerialize(x)
  }
  return s
}


// ---------------------------------------------------------------------------

export interface IssueInput {
  kind: 'SC' | 'RC'
  bill: Bill
  profile: TaxProfile
  lines: ReceiptLineMeta[] // same order as bill.lines
  payments: Payment[]
  receiptNumber: string
  issuedAt: Date
  previousUUID: string
  /** RC only: uuid of the original sale. */
  referenceUUID?: string
  /** When re-issuing a corrected Invalid receipt. */
  referenceOldUUID?: string
  orderRef?: string
  aggregator?: boolean
  buyer?: EtaBuyer
}

export interface IssuedReceipt {
  uuid: string
  /** The exact JSON text to submit (inside {"receipts":[...]}). Store it verbatim. */
  json: string
  totalAmount: Amount
  qr: string
  receiptNumber: string
  issuedAt: string
}

export class EtaValidationError extends Error {}

function paymentCode(payments: Payment[], mode: EtaConfig['splitTender']): string {
  const code = (m: Payment['method']) => (m === 'cash' ? 'C' : m === 'card' ? 'V' : 'O')
  const net = payments.map((p) => ({ c: code(p.method), v: p.amount - (p.tip ?? 0n) })).filter((p) => p.v > 0n)
  if (!net.length) return 'C'
  const codes = new Set(net.map((p) => p.c))
  if (codes.size === 1) return net[0].c
  if (mode === 'others') return 'O'
  return net.reduce((a, b) => (b.v > a.v ? b : a)).c
}

const utcSeconds = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

export function qrContent(portalUrl: string, uuid: string, issuedAt: Date, total: Amount, rin: string) {
  const t = issuedAt.toISOString().slice(0, 16) + 'Z' // yyyy-MM-ddTHH:mmZ as in the official example
  return `${portalUrl.replace(/\/$/, '')}/receipts/search/${uuid}/share/${t}#Total:${format(total, 3)},IssuerRIN:${rin}`
}

/**
 * Builds one receipt, computes its uuid and returns the frozen JSON text.
 * Throws EtaValidationError for anything ETA would reject that we can know
 * offline (structure, buyer id threshold, line limits, negative lines…).
 */
export interface BuiltReceipt {
  /** the receipt document with an empty header.uuid — serialize it with etaSerialize() and hash it */
  receipt: { [k: string]: Json }
  /** sets the uuid and freezes the JSON text */
  finish(uuid: string): IssuedReceipt
}

export function buildReceipt(cfg: EtaConfig, x: IssueInput, now: Date = new Date()): BuiltReceipt {
  const { bill, profile } = x
  if (x.lines.length !== bill.lines.length) throw new EtaValidationError('line metadata does not match the bill')
  if (x.kind === 'RC' && !x.referenceUUID) throw new EtaValidationError('a return must reference the original sale uuid')
  if (x.referenceOldUUID && x.referenceOldUUID === x.previousUUID) throw new EtaValidationError('referenceOldUUID cannot equal previousUUID')
  if (x.issuedAt.getTime() > now.getTime() + 60_000) throw new EtaValidationError('dateTimeIssued cannot be in the future')

  const items: Json[] = []
  const taxTotals = new Map<string, Amount>()
  const addTax = (t: string, v: Amount) => taxTotals.set(t, (taxTotals.get(t) ?? 0n) + v)
  let totalCommercial = 0n
  let totalSales = 0n
  let netAmount = 0n
  let totalAmount = 0n

  bill.lines.forEach((l, i) => {
    const meta = x.lines[i]
    const code = cfg.itemCodes[meta.internalCode]
    if (!code) throw new EtaValidationError(`no ETA item code for ${meta.internalCode}`)
    if (l.net < 0n || l.service < 0n || l.vat < 0n) throw new EtaValidationError('negative lines are not allowed; issue a return instead')
    // unitPrice must exclude VAT and service. In inclusive mode it is backed out of the line.
    const commercial = profile.priceMode === 'exclusive' ? l.discountTotal : 0n
    const lineTotalSale = l.net + commercial
    const unitPrice = profile.priceMode === 'exclusive' ? l.unitPrice : divRound(lineTotalSale * 1000n, BigInt(Math.round(l.qty * 1000)))
    const taxes: Json[] = []
    if (l.service > 0n && profile.serviceCode) {
      taxes.push({ taxType: profile.serviceCode.type, subType: profile.serviceCode.subType, rate: rateNum(profile.serviceRate), amount: money(l.service) })
      addTax(profile.serviceCode.type, l.service)
    }
    if (!l.vatExempt && profile.vatRegistered) {
      taxes.push({ taxType: profile.vatCode.type, subType: profile.vatCode.subType, rate: rateNum(profile.vatRate), amount: money(l.vat) })
      addTax(profile.vatCode.type, l.vat)
    }
    const item: { [k: string]: Json } = {
      internalCode: meta.internalCode,
      description: meta.description.slice(0, 500),
      itemType: code.itemType,
      itemCode: code.itemCode,
      unitType: code.unitType,
      quantity: qtyNum(l.qty),
      unitPrice: money(unitPrice),
      totalSale: money(lineTotalSale),
      netSale: money(l.net),
      total: money(l.total),
    }
    if (commercial > 0n) item.commercialDiscountData = [{ amount: money(commercial), description: 'Discount' }]
    if (taxes.length) item.taxableItems = taxes
    items.push(item)
    totalCommercial += commercial
    totalSales += lineTotalSale
    netAmount += l.net
    totalAmount += l.total
  })

  // Delivery fee: a normal line item, never a T12 fee (eta-spec §1.4.6).
  if (bill.deliveryFee > 0n) {
    const code = cfg.itemCodes.DELIVERY
    if (!code) throw new EtaValidationError('no ETA item code for DELIVERY')
    const taxes: Json[] = bill.deliveryVat > 0n ? [{ taxType: profile.vatCode.type, subType: profile.vatCode.subType, rate: rateNum(profile.vatRate), amount: money(bill.deliveryVat) }] : []
    if (bill.deliveryVat > 0n) addTax(profile.vatCode.type, bill.deliveryVat)
    items.push({
      internalCode: 'DELIVERY',
      description: 'Delivery fee',
      itemType: code.itemType,
      itemCode: code.itemCode,
      unitType: code.unitType,
      quantity: qtyNum(1),
      unitPrice: money(bill.deliveryFee),
      totalSale: money(bill.deliveryFee),
      netSale: money(bill.deliveryFee),
      total: money(bill.deliveryFee + bill.deliveryVat),
      ...(taxes.length ? { taxableItems: taxes } : {}),
    })
    totalSales += bill.deliveryFee
    netAmount += bill.deliveryFee
    totalAmount += bill.deliveryFee + bill.deliveryVat
  }
  if (items.length > 300) throw new EtaValidationError('a receipt can carry at most 300 lines')
  if (totalAmount !== bill.total) throw new EtaValidationError(`receipt total ${totalAmount} does not match the bill ${bill.total}`)

  const buyer = x.buyer ?? { type: 'P' }
  if (buyer.type === 'B' && !buyer.id) throw new EtaValidationError('a business buyer needs its RIN (better: issue an e-invoice)')
  if (buyer.type === 'P' && totalAmount >= BUYER_ID_THRESHOLD && !(buyer.id && buyer.name))
    throw new EtaValidationError('national ID and name are required for receipts of 150,000 EGP or more')

  const header: { [k: string]: Json } = {
    dateTimeIssued: utcSeconds(x.issuedAt),
    receiptNumber: x.receiptNumber,
    uuid: '',
    previousUUID: x.previousUUID,
  }
  if (x.referenceOldUUID) header.referenceOldUUID = x.referenceOldUUID
  if (x.kind === 'RC') header.referenceUUID = x.referenceUUID!
  header.currency = 'EGP'
  header.exchangeRate = new Num('0')
  if (x.orderRef) header.sOrderNameCode = x.orderRef.slice(0, 30)
  header.orderdeliveryMode = x.aggregator ? cfg.deliveryMode.aggregator : cfg.deliveryMode[bill.mode]

  const seller = { ...cfg.seller, branchAddress: { ...cfg.seller.branchAddress } } as unknown as { [k: string]: Json }
  const buyerJson: { [k: string]: Json } = { type: buyer.type, id: buyer.id ?? '', name: (buyer.name ?? '').slice(0, 100) }
  if (buyer.mobileNumber) buyerJson.mobileNumber = buyer.mobileNumber
  if (buyer.paymentNumber) buyerJson.paymentNumber = buyer.paymentNumber

  const receipt: { [k: string]: Json } = {
    header,
    documentType: { receiptType: x.kind, typeVersion: '1.2' },
    seller,
    buyer: buyerJson,
    itemData: items,
    totalSales: money(totalSales),
    totalCommercialDiscount: money(totalCommercial),
    totalItemsDiscount: money(0n),
    netAmount: money(netAmount),
    feesAmount: money(0n),
    totalAmount: money(totalAmount),
    taxTotals: [...taxTotals.entries()].map(([taxType, amount]) => ({ taxType, amount: money(amount) })),
    paymentMethod: paymentCode(x.payments, cfg.splitTender),
    adjustment: money(0n),
  }

  return {
    receipt,
    finish(uuid: string): IssuedReceipt {
      header.uuid = uuid
      return {
        uuid,
        json: toJsonText(receipt),
        totalAmount,
        qr: qrContent(cfg.portalUrl, uuid, x.issuedAt, totalAmount, cfg.seller.rin),
        receiptNumber: x.receiptNumber,
        issuedAt: utcSeconds(x.issuedAt),
      }
    },
  }
}

/** Hex SHA-256 of a UTF-8 string, async (WebCrypto in browsers: see sufra-os src/lib/receipt/eta.ts). */
export type AsyncDigest = (s: string) => Promise<string>

/** issueReceipt with an injected async SHA-256 — same uuid and JSON as the node version. */
export async function issueReceiptAsync(cfg: EtaConfig, x: IssueInput, digest: AsyncDigest, now: Date = new Date()): Promise<IssuedReceipt> {
  const b = buildReceipt(cfg, x, now)
  return b.finish(await digest(etaSerialize(b.receipt)))
}

// ---------------------------------------------------------------------------

/** Receipts must reach ETA within 24h of issue (UTC); older ones need a late-submission request. */
export function submissionDeadline(issuedAt: string) {
  return new Date(new Date(issuedAt).getTime() + 24 * 3600 * 1000)
}

export const totalOf = (rs: IssuedReceipt[]) => sum(rs.map((r) => r.totalAmount))

/**
 * Parses JSON text keeping every number's exact characters, so a stored
 * receipt can be re-serialized and its uuid re-checked (audit / support tool).
 */
export function parseExact(text: string): Json {
  let i = 0
  const ws = () => {
    while (/\s/.test(text[i])) i++
  }
  const value = (): Json => {
    ws()
    const c = text[i]
    if (c === '{') {
      i++
      const o: { [k: string]: Json } = {}
      ws()
      if (text[i] === '}') return i++, o
      for (;;) {
        ws()
        const k = str()
        ws()
        if (text[i++] !== ':') throw new Error('expected :')
        o[k] = value()
        ws()
        if (text[i] === ',') { i++; continue }
        if (text[i++] === '}') return o
        throw new Error('expected , or }')
      }
    }
    if (c === '[') {
      i++
      const a: Json[] = []
      ws()
      if (text[i] === ']') return i++, a
      for (;;) {
        a.push(value())
        ws()
        if (text[i] === ',') { i++; continue }
        if (text[i++] === ']') return a
        throw new Error('expected , or ]')
      }
    }
    if (c === '"') return str()
    const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i))
    if (!m) throw new Error(`unexpected token at ${i}`)
    i += m[0].length
    return new Num(m[0])
  }
  const str = (): string => {
    if (text[i] !== '"') throw new Error('expected string')
    let j = i + 1
    while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1
    const s = JSON.parse(text.slice(i, j + 1)) as string
    i = j + 1
    return s
  }
  const v = value()
  ws()
  if (i !== text.length) throw new Error('trailing characters')
  return v
}

/** The serialization a stored receipt's uuid is computed from, plus the uuid it claims. */
export function uuidPreimage(json: string): { preimage: string; claimed: string } {
  const r = parseExact(json) as { [k: string]: Json }
  const header = r.header as { [k: string]: Json }
  const claimed = header.uuid as string
  header.uuid = ''
  return { preimage: etaSerialize(r), claimed }
}

/** Recomputes a stored receipt's uuid from its JSON text (async hash). */
export async function verifyReceiptUuidAsync(json: string, digest: AsyncDigest): Promise<{ uuid: string; matches: boolean }> {
  const { preimage, claimed } = uuidPreimage(json)
  const uuid = await digest(preimage)
  return { uuid, matches: uuid === claimed }
}

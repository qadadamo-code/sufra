import { allocate, applyRate, divRound, removeRate, round, sum, type Amount, type Rate } from './money'

/**
 * How a restaurant charges tax. Every number here is a setting the tenant (and
 * their accountant) controls; the defaults follow common Egyptian practice and
 * must be confirmed per restaurant before going live.
 */
export interface TaxProfile {
  /** VAT in basis points. Egypt standard rate: 14% = 1400. */
  vatRate: Rate
  /** ETA tax type / subtype used on receipts for VAT. */
  vatCode: { type: string; subType: string }
  /** Service charge in basis points (commonly 12%). 0 disables it. */
  serviceRate: Rate
  /** Order modes the service charge applies to. */
  serviceModes: OrderMode[]
  /** Whether VAT is charged on top of the service charge. */
  vatOnService: boolean
  /** ETA code for the service charge line, if it is reported as a separate tax/fee. */
  serviceCode: { type: string; subType: string } | null
  /** Menu prices already include service and VAT ("inclusive") or not ("exclusive"). */
  priceMode: 'exclusive' | 'inclusive'
  /** VAT on the delivery fee. */
  vatOnDelivery: boolean
  /** Decimals tax amounts are rounded to, per line (ETA: 2). */
  taxDecimals: number
}

export type OrderMode = 'dine-in' | 'takeaway' | 'delivery'

export const DEFAULT_PROFILE: TaxProfile = {
  vatRate: 1400,
  vatCode: { type: 'T1', subType: 'V009' },
  serviceRate: 1200,
  serviceModes: ['dine-in'],
  vatOnService: true,
  // ETA FAQ: service charge is sent as T9 / SC01 and sits inside the VAT base (eta-spec §3.2).
  serviceCode: { type: 'T9', subType: 'SC01' },
  priceMode: 'exclusive',
  vatOnDelivery: true,
  taxDecimals: 2,
}

export interface BillLineInput {
  id: string
  qty: number // up to 3 decimals (e.g. 0.5 kg of fish)
  /** Price per unit as printed on the menu. */
  unitPrice: Amount
  /** Revenue category, used for the ledger and reports. */
  category: string
  /** Discount on this line only (amount, before tax). */
  discount?: Amount
  /** Line is outside VAT (e.g. exempt goods). */
  vatExempt?: boolean
}

export type BillDiscount = { kind: 'percent'; rate: Rate } | { kind: 'amount'; value: Amount }

export interface BillInput {
  mode: OrderMode
  lines: BillLineInput[]
  discount?: BillDiscount
  deliveryFee?: Amount
}

export interface BillLine extends BillLineInput {
  /** qty × unit price, net of tax in exclusive mode. */
  gross: Amount
  /** Line + share of bill discount. */
  discountTotal: Amount
  /** Taxable base. */
  net: Amount
  service: Amount
  vat: Amount
  total: Amount
}

export interface Bill {
  mode: OrderMode
  lines: BillLine[]
  gross: Amount
  discount: Amount
  net: Amount
  service: Amount
  vat: Amount
  deliveryFee: Amount
  deliveryVat: Amount
  /** Sum of everything at full (5-decimal) precision. */
  total: Amount
  /** What the guest pays: total rounded to piastres. */
  payable: Amount
  /** payable − total, posted to a rounding account. */
  rounding: Amount
}

const QTY_DP = 3

function lineGross(l: BillLineInput): Amount {
  const q = Math.round(l.qty * 10 ** QTY_DP)
  if (Math.abs(q / 10 ** QTY_DP - l.qty) > 1e-9) throw new Error(`quantity ${l.qty} has more than ${QTY_DP} decimals`)
  if (q <= 0) throw new Error('quantity must be positive')
  return divRound(l.unitPrice * BigInt(q), 10n ** BigInt(QTY_DP))
}

/**
 * Prices one bill. Order of operations:
 *   gross → minus discounts (line, then bill discount spread by line value)
 *   → service on the discounted base (only for the configured modes)
 *   → VAT on base (+ service when vatOnService) → line total.
 * In inclusive mode the printed price is the line total and the base is
 * backed out of it, with any rounding left in the base so the guest pays
 * exactly the printed price.
 */
export function priceBill(input: BillInput, p: TaxProfile = DEFAULT_PROFILE): Bill {
  if (!input.lines.length) throw new Error('empty bill')
  const serviceOn = p.serviceRate > 0 && p.serviceModes.includes(input.mode)

  const grossPrinted = input.lines.map(lineGross)
  const afterLineDiscount = input.lines.map((l, i) => {
    const d = l.discount ?? 0n
    if (d < 0n || d > grossPrinted[i]) throw new Error(`invalid discount on ${l.id}`)
    return grossPrinted[i] - d
  })

  // Bill-level discount, spread over lines in proportion to their value.
  const base = sum(afterLineDiscount)
  let billDisc = 0n
  if (input.discount?.kind === 'percent') billDisc = applyRate(base, input.discount.rate, 2)
  if (input.discount?.kind === 'amount') billDisc = input.discount.value
  if (billDisc < 0n || billDisc > base) throw new Error('invalid bill discount')
  const shares = billDisc ? allocate(round(billDisc, 2), afterLineDiscount, 2) : afterLineDiscount.map(() => 0n)

  const lines: BillLine[] = input.lines.map((l, i) => {
    const printedAfter = afterLineDiscount[i] - shares[i]
    const sRate = serviceOn ? p.serviceRate : 0
    const vRate = l.vatExempt ? 0 : p.vatRate
    let net: Amount
    let service: Amount
    let vat: Amount
    if (p.priceMode === 'exclusive') {
      net = printedAfter
      service = applyRate(net, sRate, p.taxDecimals)
      vat = applyRate(p.vatOnService ? net + service : net, vRate, p.taxDecimals)
    } else {
      // printedAfter = net + service + vat
      net = p.vatOnService ? removeRate(removeRate(printedAfter, vRate), sRate) : removeRate(printedAfter, sRate + vRate)
      service = applyRate(net, sRate, p.taxDecimals)
      vat = applyRate(p.vatOnService ? net + service : net, vRate, p.taxDecimals)
      net += printedAfter - (net + service + vat) // keep the printed price exact
    }
    return {
      ...l,
      gross: grossPrinted[i],
      discountTotal: (l.discount ?? 0n) + shares[i],
      net,
      service,
      vat,
      total: net + service + vat,
    }
  })

  const deliveryFee = input.mode === 'delivery' ? (input.deliveryFee ?? 0n) : 0n
  const deliveryVat = p.vatOnDelivery ? applyRate(deliveryFee, p.vatRate, p.taxDecimals) : 0n
  const total = sum(lines.map((l) => l.total)) + deliveryFee + deliveryVat
  const payable = round(total, 2)
  return {
    mode: input.mode,
    lines,
    gross: sum(lines.map((l) => l.gross)),
    discount: sum(lines.map((l) => l.discountTotal)),
    net: sum(lines.map((l) => l.net)),
    service: sum(lines.map((l) => l.service)),
    vat: sum(lines.map((l) => l.vat)) + deliveryVat,
    deliveryFee,
    deliveryVat,
    total,
    payable,
    rounding: payable - total,
  }
}

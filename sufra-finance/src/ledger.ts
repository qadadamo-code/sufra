import { sum, type Amount } from './money'

/**
 * Chart of accounts for a restaurant, laid out the way Egyptian accountants
 * usually number them (1 assets, 2 liabilities, 3 equity, 4 revenue,
 * 5 cost of sales, 6 expenses). Tenants can add accounts; these codes are the
 * ones the posting rules rely on.
 */
export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

export interface Account {
  code: string
  type: AccountType
  ar: string
  en: string
}

export const ACCOUNTS = {
  cash: { code: '1101', type: 'asset', ar: 'الخزينة - نقدية', en: 'Cash on hand' },
  cardClearing: { code: '1102', type: 'asset', ar: 'مستحقات ماكينات الدفع', en: 'Card clearing' },
  walletClearing: { code: '1103', type: 'asset', ar: 'محافظ إلكترونية وإنستاباي', en: 'Wallets & InstaPay clearing' },
  aggregatorReceivable: { code: '1104', type: 'asset', ar: 'مستحقات تطبيقات التوصيل', en: 'Delivery apps receivable' },
  bank: { code: '1105', type: 'asset', ar: 'البنك', en: 'Bank' },
  receivables: { code: '1201', type: 'asset', ar: 'العملاء - حسابات آجلة', en: 'Accounts receivable' },
  inventoryFood: { code: '1301', type: 'asset', ar: 'مخزون مواد غذائية', en: 'Food inventory' },
  inventoryBeverage: { code: '1302', type: 'asset', ar: 'مخزون مشروبات', en: 'Beverage inventory' },
  inventoryPackaging: { code: '1303', type: 'asset', ar: 'مخزون مواد تغليف', en: 'Packaging inventory' },
  inputVat: { code: '1401', type: 'asset', ar: 'ضريبة القيمة المضافة على المشتريات', en: 'Input VAT' },
  payables: { code: '2101', type: 'liability', ar: 'الموردين', en: 'Accounts payable' },
  outputVat: { code: '2201', type: 'liability', ar: 'ضريبة القيمة المضافة على المبيعات', en: 'Output VAT' },
  servicePayable: { code: '2202', type: 'liability', ar: 'خدمة مستحقة للعاملين', en: 'Service charge payable to staff' },
  tipsPayable: { code: '2203', type: 'liability', ar: 'إكراميات مستحقة للعاملين', en: 'Tips payable' },
  customerDeposits: { code: '2204', type: 'liability', ar: 'عرابين حجز وكروت هدايا', en: 'Deposits & gift cards' },
  vatSettlement: { code: '2301', type: 'liability', ar: 'مصلحة الضرائب - تسوية القيمة المضافة', en: 'VAT payable to ETA' },
  capital: { code: '3101', type: 'equity', ar: 'رأس المال', en: 'Capital' },
  retained: { code: '3201', type: 'equity', ar: 'أرباح مرحلة', en: 'Retained earnings' },
  salesFood: { code: '4101', type: 'revenue', ar: 'مبيعات طعام', en: 'Food sales' },
  salesBeverage: { code: '4102', type: 'revenue', ar: 'مبيعات مشروبات', en: 'Beverage sales' },
  deliveryRevenue: { code: '4103', type: 'revenue', ar: 'إيراد التوصيل', en: 'Delivery fee revenue' },
  serviceRevenue: { code: '4104', type: 'revenue', ar: 'إيراد الخدمة', en: 'Service charge revenue' },
  cogsFood: { code: '5101', type: 'expense', ar: 'تكلفة الطعام المباع', en: 'Food cost' },
  cogsBeverage: { code: '5102', type: 'expense', ar: 'تكلفة المشروبات المباعة', en: 'Beverage cost' },
  waste: { code: '5201', type: 'expense', ar: 'هالك ومفقود', en: 'Waste' },
  cardFees: { code: '6101', type: 'expense', ar: 'عمولات الدفع الإلكتروني', en: 'Payment fees' },
  aggregatorFees: { code: '6102', type: 'expense', ar: 'عمولات تطبيقات التوصيل', en: 'Delivery app commissions' },
  pettyExpenses: { code: '6201', type: 'expense', ar: 'مصروفات نثرية', en: 'Petty expenses' },
  cashOverShort: { code: '6901', type: 'expense', ar: 'عجز وزيادة الخزينة', en: 'Cash over/short' },
  rounding: { code: '6902', type: 'expense', ar: 'فروق تقريب', en: 'Rounding differences' },
} as const satisfies Record<string, Account>

export type AccountKey = keyof typeof ACCOUNTS
export const accountByCode = new Map<string, Account>(Object.values(ACCOUNTS).map((a) => [a.code, a]))

export interface JournalLine {
  account: string // account code
  debit: Amount
  credit: Amount
  /** Optional analysis tags: branch, drawer, staff… */
  dims?: Record<string, string>
}

export interface JournalEntry {
  id: string
  date: string // YYYY-MM-DD (business day)
  at: string // ISO timestamp when posted
  source: { type: string; id: string }
  memo: string
  lines: JournalLine[]
  /** Set on the original when a reversal was posted, and on the reversal itself. */
  reverses?: string
  reversedBy?: string
}

export class LedgerError extends Error {}

export function validateEntry(e: Pick<JournalEntry, 'lines'>) {
  if (e.lines.length < 2) throw new LedgerError('an entry needs at least two lines')
  for (const l of e.lines) {
    if (!accountByCode.has(l.account)) throw new LedgerError(`unknown account ${l.account}`)
    if (l.debit < 0n || l.credit < 0n) throw new LedgerError('negative amounts are not allowed; swap the side instead')
    if ((l.debit === 0n) === (l.credit === 0n)) throw new LedgerError('each line is either a debit or a credit')
  }
  const dr = sum(e.lines.map((l) => l.debit))
  const cr = sum(e.lines.map((l) => l.credit))
  if (dr !== cr) throw new LedgerError(`entry does not balance: debit ${dr} ≠ credit ${cr}`)
}

/** Builds lines from signed amounts (+ debit, − credit), dropping zeros. */
export function lines(...items: Array<[account: Account, signed: Amount, dims?: Record<string, string>]>): JournalLine[] {
  return items
    .filter(([, v]) => v !== 0n)
    .map(([a, v, dims]) => ({ account: a.code, debit: v > 0n ? v : 0n, credit: v < 0n ? -v : 0n, ...(dims ? { dims } : {}) }))
}

/**
 * Append-only journal. Posted entries are never edited or deleted; a mistake
 * is corrected by posting a reversal, so the audit trail stays complete.
 */
export class Ledger {
  private entries: JournalEntry[] = []
  private seq = 0
  private closedThrough = '' // YYYY-MM-DD; no postings on or before this date

  constructor(private now: () => Date = () => new Date()) {}

  post(e: Omit<JournalEntry, 'id' | 'at'>): JournalEntry {
    validateEntry(e)
    if (this.closedThrough && e.date <= this.closedThrough) throw new LedgerError(`period closed through ${this.closedThrough}`)
    const entry: JournalEntry = { ...e, id: `JE-${String(++this.seq).padStart(6, '0')}`, at: this.now().toISOString() }
    this.entries.push(entry)
    return entry
  }

  reverse(id: string, date: string, memo: string): JournalEntry {
    const orig = this.entries.find((x) => x.id === id)
    if (!orig) throw new LedgerError(`no entry ${id}`)
    if (orig.reversedBy) throw new LedgerError(`${id} is already reversed`)
    const rev = this.post({
      date,
      source: { type: 'reversal', id },
      memo,
      lines: orig.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
      reverses: id,
    })
    orig.reversedBy = rev.id
    return rev
  }

  /** Locks a period (e.g. after the VAT return is filed). */
  closeThrough(date: string) {
    if (date < this.closedThrough) throw new LedgerError('cannot reopen a closed period')
    this.closedThrough = date
  }

  all(): readonly JournalEntry[] {
    return this.entries
  }

  /** Debit-positive balance of an account over [from, to]. */
  balance(code: string, from = '', to = '9999-12-31', dims?: Record<string, string>): Amount {
    let b = 0n
    for (const e of this.entries) {
      if (e.date < from || e.date > to) continue
      for (const l of e.lines) {
        if (l.account !== code) continue
        if (dims && !Object.entries(dims).every(([k, v]) => l.dims?.[k] === v)) continue
        b += l.debit - l.credit
      }
    }
    return b
  }

  trialBalance(from = '', to = '9999-12-31') {
    const rows = new Map<string, { debit: Amount; credit: Amount }>()
    for (const e of this.entries) {
      if (e.date < from || e.date > to) continue
      for (const l of e.lines) {
        const r = rows.get(l.account) ?? { debit: 0n, credit: 0n }
        r.debit += l.debit
        r.credit += l.credit
        rows.set(l.account, r)
      }
    }
    return [...rows.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, r]) => ({ code, account: accountByCode.get(code)!, ...r, balance: r.debit - r.credit }))
  }
}

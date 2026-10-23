import { createHash } from 'node:crypto'
import { buildReceipt, etaSerialize, uuidPreimage, type IssueInput, type IssuedReceipt } from './eta-receipt-core'
import type { EtaConfig } from './eta-receipt-core'

/**
 * ETA e-receipt for Node (server functions, tests): the core in ./eta-receipt-core plus a
 * synchronous node:crypto SHA-256. Browsers import ./eta-receipt-core and use issueReceiptAsync.
 */
export * from './eta-receipt-core'

export const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

/**
 * Builds one receipt, computes its uuid and returns the frozen JSON text.
 * Throws EtaValidationError for anything ETA would reject that we can know
 * offline (structure, buyer id threshold, line limits, negative lines…).
 */
export function issueReceipt(cfg: EtaConfig, x: IssueInput, now: Date = new Date()): IssuedReceipt {
  const b = buildReceipt(cfg, x, now)
  return b.finish(sha256Hex(etaSerialize(b.receipt)))
}

/**
 * The per-device chain: receipt numbers and previousUUID must follow one
 * strict order per POS, returns included (eta-spec §1.5 "Chaining").
 * Persist `state` after every issue; never issue from two places at once.
 */
export class PosChain {
  constructor(
    private cfg: EtaConfig,
    public state: { prefix: string; next: number; lastUUID: string; issued: IssuedReceipt[] },
    private now: () => Date = () => new Date(),
  ) {}

  issue(x: Omit<IssueInput, 'receiptNumber' | 'previousUUID'>): IssuedReceipt {
    const receiptNumber = `${this.state.prefix}-${String(this.state.next).padStart(6, '0')}`
    const r = issueReceipt(this.cfg, { ...x, receiptNumber, previousUUID: this.state.lastUUID }, this.now())
    this.state = { ...this.state, next: this.state.next + 1, lastUUID: r.uuid, issued: [...this.state.issued, r] }
    return r
  }

  /** Batches of ≤500 receipts and ≤1.5 MB, in chain order, for POST /api/v1/receiptsubmissions. */
  batches(pending: IssuedReceipt[], maxCount = 500, maxBytes = 1_500_000): string[] {
    const out: string[] = []
    let cur: string[] = []
    let size = 30
    for (const r of pending) {
      const b = Buffer.byteLength(r.json) + 1
      if (cur.length && (cur.length >= maxCount || size + b > maxBytes)) {
        out.push(`{"receipts":[${cur.join(',')}],"signatures":[]}`)
        cur = []
        size = 30
      }
      cur.push(r.json)
      size += b
    }
    if (cur.length) out.push(`{"receipts":[${cur.join(',')}],"signatures":[]}`)
    return out
  }
}

/** Recomputes a stored receipt's uuid from its JSON text. */
export function verifyReceiptUuid(json: string): { uuid: string; matches: boolean } {
  const { preimage, claimed } = uuidPreimage(json)
  const uuid = sha256Hex(preimage)
  return { uuid, matches: uuid === claimed }
}

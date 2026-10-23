import type { IssuedReceipt } from './eta-receipt-core'
import { submissionDeadline } from './eta-receipt-core'

/**
 * Talks to ETA for one POS: token, batch submission, status. Network access is
 * injected (`fetch`) so the queue logic is testable and runs on the server or
 * on a device. Rules from docs/eta-spec.md §1.3, §1.6, §1.7.
 */
export interface PosCredentials {
  clientId: string
  clientSecret: string
  posSerial: string
  posOsVersion: string
}

export interface EtaEndpoints {
  identity: string // https://id.eta.gov.eg (prod) | https://id.preprod.eta.gov.eg (preprod)
  api: string // https://api.invoicing.eta.gov.eg | https://api.preprod.invoicing.eta.gov.eg
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; headers: { get(n: string): string | null }; json(): Promise<any> }>

export type QueueStatus = 'pending' | 'submitted' | 'valid' | 'invalid' | 'late'

export interface QueuedReceipt {
  receipt: IssuedReceipt
  status: QueueStatus
  submissionUuid?: string
  errors?: string[]
}

export class EtaClient {
  private token: { value: string; expires: number } | null = null

  constructor(
    private creds: PosCredentials,
    private ep: EtaEndpoints,
    private fetchFn: Fetch,
    private now: () => number = () => Date.now(),
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async authenticate(): Promise<string> {
    if (this.token && this.token.expires - 60_000 > this.now()) return this.token.value
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.creds.clientId, client_secret: this.creds.clientSecret }).toString()
    const res = await this.fetchFn(`${this.ep.identity}/connect/token`, {
      method: 'POST',
      // ETA FAQ: send posserial and pososversion; leave presharedkey and posmodelframework out.
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', posserial: this.creds.posSerial, pososversion: this.creds.posOsVersion },
      body,
    })
    if (res.status !== 200) throw new Error(`ETA authentication failed (${res.status})`)
    const j = await res.json()
    this.token = { value: j.access_token, expires: this.now() + (j.expires_in ?? 3600) * 1000 }
    return this.token.value
  }

  /**
   * Submits one batch (already built in chain order by PosChain.batches).
   * Never resubmits after a 2xx. Honours Retry-After on 422/429 and retries 503.
   */
  async submit(batchJson: string, attempts = 4): Promise<{ submissionUuid: string; accepted: string[]; rejected: Array<{ uuid: string; error: string }> }> {
    for (let a = 0; a < attempts; a++) {
      const token = await this.authenticate()
      const res = await this.fetchFn(`${this.ep.api}/api/v1/receiptsubmissions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: batchJson,
      })
      if (res.status === 202) {
        const j = await res.json()
        return {
          submissionUuid: j.submissionUUID ?? j.submissionUuid,
          accepted: (j.acceptedDocuments ?? []).map((d: any) => d.uuid),
          rejected: (j.rejectedDocuments ?? []).map((d: any) => ({ uuid: d.uuid, error: JSON.stringify(d.error) })),
        }
      }
      if (res.status === 401) {
        this.token = null
        continue
      }
      if (res.status === 422 || res.status === 429 || res.status === 503) {
        const after = Number(res.headers.get('Retry-After') ?? '') || 2 ** a
        await this.sleep((after + 1) * 1000)
        continue
      }
      const j = await res.json().catch(() => ({}))
      throw new Error(`ETA rejected the submission (${res.status}): ${JSON.stringify(j?.error ?? j)}`)
    }
    throw new Error('ETA submission kept failing; receipts stay queued')
  }

  async details(submissionUuid: string): Promise<Array<{ uuid: string; status: string; errors: string[] }>> {
    const token = await this.authenticate()
    const res = await this.fetchFn(`${this.ep.api}/api/v1/receiptsubmissions/${submissionUuid}/details?PageNo=1&PageSize=500`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status !== 200) throw new Error(`status check failed (${res.status})`)
    const j = await res.json()
    return (j.receipts ?? []).map((r: any) => ({
      uuid: r.uuid,
      status: r.status,
      errors: (r.errors ?? r.validationResults?.validationSteps ?? []).map((e: any) => e.errorAr ?? e.error ?? JSON.stringify(e)),
    }))
  }
}

/**
 * Offline-first queue: receipts are printed immediately and uploaded as soon
 * as possible. Anything not accepted within 24h is flagged `late` so the
 * restaurant can file a late-submission request in time (≤30 days old).
 */
export function triage(queue: QueuedReceipt[], now: number) {
  const overdue = queue.filter((q) => q.status === 'pending' && submissionDeadline(q.receipt.issuedAt).getTime() < now)
  const dueSoon = queue.filter((q) => q.status === 'pending' && !overdue.includes(q) && submissionDeadline(q.receipt.issuedAt).getTime() - now < 3 * 3600_000)
  return {
    overdue: overdue.map((q) => q.receipt.receiptNumber),
    dueSoon: dueSoon.map((q) => q.receipt.receiptNumber),
    tooOldForLateRequest: overdue.filter((q) => now - new Date(q.receipt.issuedAt).getTime() > 30 * 86400_000).map((q) => q.receipt.receiptNumber),
  }
}

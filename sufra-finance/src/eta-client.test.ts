import { EtaClient, triage, type QueuedReceipt } from './eta-client'

function fakeFetch(script: Array<{ status: number; body?: any; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; init: any }> = []
  const fn = async (url: string, init: any) => {
    calls.push({ url, init })
    if (url.endsWith('/connect/token')) return { status: 200, headers: { get: () => null }, json: async () => ({ access_token: 'T', expires_in: 3600 }) }
    const r = script.shift()!
    return { status: r.status, headers: { get: (n: string) => r.headers?.[n] ?? null }, json: async () => r.body ?? {} }
  }
  return { fn, calls }
}

const creds = { clientId: 'id', clientSecret: 'sec', posSerial: 'SUFRA-POS-1', posOsVersion: 'android-14' }
const ep = { identity: 'https://id.preprod.eta.gov.eg', api: 'https://api.preprod.invoicing.eta.gov.eg' }

describe('ETA client', () => {
  it('authenticates with POS headers and submits a batch', async () => {
    const f = fakeFetch([{ status: 202, body: { submissionUUID: 'S1', acceptedDocuments: [{ uuid: 'u1' }], rejectedDocuments: [] } }])
    const c = new EtaClient(creds, ep, f.fn, () => 0, async () => {})
    const r = await c.submit('{"receipts":[],"signatures":[]}')
    expect(r).toEqual({ submissionUuid: 'S1', accepted: ['u1'], rejected: [] })
    const auth = f.calls[0]
    expect(auth.init.headers.posserial).toBe('SUFRA-POS-1')
    expect(auth.init.headers.presharedkey).toBeUndefined()
    expect(f.calls[1].init.headers.Authorization).toBe('Bearer T')
  })

  it('waits on Retry-After and retries 503s', async () => {
    const waits: number[] = []
    const f = fakeFetch([{ status: 429, headers: { 'Retry-After': '3' } }, { status: 503 }, { status: 202, body: { submissionUUID: 'S2' } }])
    const c = new EtaClient(creds, ep, f.fn, () => 0, async (ms) => void waits.push(ms))
    await c.submit('{}')
    expect(waits).toEqual([4000, 3000])
  })

  it('reuses the token until it nearly expires', async () => {
    let t = 0
    const f = fakeFetch([{ status: 202, body: {} }, { status: 202, body: {} }, { status: 202, body: {} }])
    const c = new EtaClient(creds, ep, f.fn, () => t, async () => {})
    await c.submit('{}')
    t = 1000_000
    await c.submit('{}')
    t = 3_560_000
    await c.submit('{}')
    expect(f.calls.filter((x) => x.url.endsWith('/connect/token'))).toHaveLength(2)
  })
})

describe('offline queue triage', () => {
  const q = (n: string, issuedAt: string, status: QueuedReceipt['status'] = 'pending'): QueuedReceipt => ({ status, receipt: { uuid: n, json: '', totalAmount: 0n, qr: '', receiptNumber: n, issuedAt } })
  it('flags overdue and soon-due receipts', () => {
    const now = Date.parse('2026-10-12T20:00:00Z')
    const t = triage([q('a', '2026-10-11T19:00:00Z'), q('b', '2026-10-11T22:00:00Z'), q('c', '2026-10-12T19:00:00Z'), q('d', '2026-09-01T10:00:00Z'), q('e', '2026-10-01T10:00:00Z', 'valid')], now)
    expect(t.overdue).toEqual(['a', 'd'])
    expect(t.dueSoon).toEqual(['b'])
    expect(t.tooOldForLateRequest).toEqual(['d'])
  })
})

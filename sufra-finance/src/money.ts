/**
 * Money is an integer number of "units" of 0.00001 EGP (bigint).
 *
 * Five decimals because ETA documents carry amounts with up to five decimal
 * places; keeping that precision internally means a receipt we build adds up
 * exactly the way the tax authority recomputes it. Anything shown to a guest
 * or counted in a drawer is rounded to piastres (2 decimals) explicitly.
 *
 * Never use JS floats for money in this package.
 */
export type Amount = bigint

export const SCALE = 100_000n // units per EGP
export const PIASTRE = 1_000n // units per piastre

export const ZERO: Amount = 0n

/** Parses "185", "185.5", "-0.25" (EGP). Throws on anything else. */
export function egp(value: string | number): Amount {
  const s = typeof value === 'number' ? numberToPlain(value) : value.trim()
  const m = /^(-)?(\d+)(?:\.(\d{1,5}))?$/.exec(s)
  if (!m) throw new Error(`not an EGP amount: ${value}`)
  const frac = (m[3] ?? '').padEnd(5, '0')
  const v = BigInt(m[2]) * SCALE + BigInt(frac)
  return m[1] ? -v : v
}

function numberToPlain(n: number) {
  if (!Number.isFinite(n)) throw new Error('not finite')
  // Accept numbers only when they are exactly representable to 5 decimals.
  const s = n.toFixed(5)
  if (Math.abs(Number(s) - n) > 1e-9) throw new Error(`imprecise amount ${n}`)
  return s.replace(/\.?0+$/, '') || '0'
}

export const fromPiastres = (p: number | bigint): Amount => BigInt(p) * PIASTRE

/** Integer division rounding half away from zero (commercial rounding). */
export function divRound(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error('division by zero')
  const neg = n < 0n !== d < 0n
  const an = n < 0n ? -n : n
  const ad = d < 0n ? -d : d
  const q = (an * 2n + ad) / (ad * 2n)
  return neg ? -q : q
}

/** Rounds to `decimals` (0..5) places, half away from zero. */
export function round(a: Amount, decimals: number): Amount {
  const step = 10n ** BigInt(5 - decimals)
  return divRound(a, step) * step
}

export const toPiastreAmount = (a: Amount) => round(a, 2)

/** Percentages are basis points: 14% = 1400. */
export type Rate = number

/** `a` × rate, rounded once (half away from zero) to `decimals` places. */
export function applyRate(a: Amount, bp: Rate, decimals = 5): Amount {
  const step = 10n ** BigInt(5 - decimals)
  return divRound(a * BigInt(bp), 10_000n * step) * step
}

/** Base amount when `gross` already includes a rate (inclusive pricing). */
export function removeRate(gross: Amount, bp: Rate): Amount {
  return divRound(gross * 10_000n, 10_000n + BigInt(bp))
}

export function mul(a: Amount, qty: number | bigint, qtyDecimals = 0): Amount {
  if (typeof qty === 'number') {
    if (!Number.isInteger(qty * 10 ** qtyDecimals)) throw new Error('quantity precision')
    return divRound(a * BigInt(Math.round(qty * 10 ** qtyDecimals)), 10n ** BigInt(qtyDecimals))
  }
  return a * qty
}

export const sum = (xs: Iterable<Amount>): Amount => {
  let t = 0n
  for (const x of xs) t += x
  return t
}

export const abs = (a: Amount) => (a < 0n ? -a : a)

/** "1234.50000" with exactly `decimals` digits (ETA wants plain decimal strings/numbers). */
export function format(a: Amount, decimals = 5): string {
  const r = round(a, decimals)
  const neg = r < 0n
  const v = neg ? -r : r
  const whole = v / SCALE
  const frac = (v % SCALE).toString().padStart(5, '0').slice(0, decimals)
  return (neg ? '-' : '') + whole.toString() + (decimals ? '.' + frac : '')
}

/** For JSON payloads that expect numbers: exact for 5 decimals within safe range. */
export function toNumber(a: Amount, decimals = 5): number {
  return Number(format(a, decimals))
}

export function display(a: Amount, lang: 'ar' | 'en' = 'ar'): string {
  const s = format(a, 2).replace(/\B(?=(\d{3})+(?!\d))(?=.*\.)/g, ',')
  return lang === 'ar' ? `${s} ج.م` : `EGP ${s}`
}

/**
 * Splits `total` into parts proportional to `weights`, exactly, using the
 * largest-remainder method at `decimals` precision (e.g. splitting a bill
 * discount over its lines, or one bill between friends).
 */
export function allocate(total: Amount, weights: bigint[], decimals = 2): Amount[] {
  const step = 10n ** BigInt(5 - decimals)
  const units = total / step
  if (units * step !== total) throw new Error('total not on the requested precision')
  const W = weights.reduce((a, b) => a + b, 0n)
  if (W === 0n) return weights.map(() => 0n)
  const raw = weights.map((w) => units * w)
  const base = raw.map((r) => r / W)
  let left = units - base.reduce((a, b) => a + b, 0n)
  const order = raw.map((r, i) => [r % W, i] as const).sort((a, b) => (b[0] > a[0] ? 1 : b[0] < a[0] ? -1 : a[1] - b[1]))
  for (const [, i] of order) {
    if (left <= 0n) break
    base[i] += 1n
    left -= 1n
  }
  return base.map((b) => b * step)
}

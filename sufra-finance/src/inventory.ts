import { divRound, type Amount } from './money'

/**
 * Stock valued at moving weighted-average cost (allowed under IAS 2 / EAS 2).
 * Quantities are integers in the item's base unit (grams, millilitres, pieces),
 * so there is no float drift in stock counts.
 */
export interface StockItem {
  id: string
  name: string
  unit: 'g' | 'ml' | 'pc'
  qty: number
  /** Total value of the quantity on hand. */
  value: Amount
}

export interface RecipeLine {
  itemId: string
  qty: number // base units per one portion
}

export type StockMove =
  | { kind: 'receive'; itemId: string; qty: number; cost: Amount } // cost = net purchase value (excl. recoverable VAT)
  | { kind: 'consume'; itemId: string; qty: number; reason: 'sale' | 'waste' | 'staff-meal' }
  | { kind: 'count'; itemId: string; counted: number }

export interface MoveResult {
  item: StockItem
  /** Value that left stock (to cost of sales / waste) or entered it; negative when stock was found short on a count. */
  value: Amount
}

export function averageCost(item: StockItem): Amount {
  return item.qty > 0 ? divRound(item.value, BigInt(item.qty)) : 0n
}

export function applyMove(item: StockItem, m: StockMove): MoveResult {
  if (m.itemId !== item.id) throw new Error('move is for another item')
  if (m.kind === 'receive') {
    if (m.qty <= 0 || m.cost < 0n) throw new Error('invalid receipt')
    return { item: { ...item, qty: item.qty + m.qty, value: item.value + m.cost }, value: m.cost }
  }
  if (m.kind === 'consume') {
    if (m.qty <= 0) throw new Error('invalid quantity')
    // Taking the whole stock takes its whole value, so no residue is left behind by rounding.
    const out = m.qty >= item.qty ? item.value : divRound(item.value * BigInt(m.qty), BigInt(item.qty))
    return { item: { ...item, qty: item.qty - m.qty, value: item.value - out }, value: out }
  }
  // Stock count: the difference is valued at the current average cost.
  const diff = m.counted - item.qty
  if (diff === 0) return { item, value: 0n }
  if (diff < 0) {
    const r = applyMove(item, { kind: 'consume', itemId: item.id, qty: -diff, reason: 'waste' })
    return { item: r.item, value: -r.value }
  }
  const add = averageCost(item) * BigInt(diff)
  return { item: { ...item, qty: m.counted, value: item.value + add }, value: add }
}

/** Theoretical cost of one portion from its recipe at today's average costs. */
export function portionCost(recipe: RecipeLine[], stock: Map<string, StockItem>): Amount {
  let c = 0n
  for (const r of recipe) {
    const it = stock.get(r.itemId)
    if (!it) throw new Error(`recipe uses unknown item ${r.itemId}`)
    c += it.qty > 0 ? divRound(it.value * BigInt(r.qty), BigInt(it.qty)) : 0n
  }
  return c
}

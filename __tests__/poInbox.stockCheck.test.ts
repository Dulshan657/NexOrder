import { describe, it, expect } from 'vitest'

import {
  findStockShortages,
  type StockLine,
  type StockProduct,
} from '../supabase/functions/_shared/poInbox/stockCheck'

function products(...rows: StockProduct[]): Map<number, StockProduct> {
  const m = new Map<number, StockProduct>()
  for (const r of rows) m.set(r.id, r)
  return m
}

describe('findStockShortages', () => {
  it('treats inventory as selling units — pack_size is NOT a multiplier', () => {
    // Regression guard for the false-409-on-approve bug. A PO for 10 cartons
    // of a product (pack_size 12) against inventory of 50 selling units must
    // pass: place-order both checks and decrements inventory by `quantity`
    // alone, so approve-po must agree. The pre-fix logic computed
    // 10 * 12 = 120 > 50 and falsely raised CONFLICT.
    const lines: StockLine[] = [{ product_id: 1, quantity: 10 }]
    const map = products({ id: 1, name: 'Soy Sauce 1L', inventory: 50 })
    expect(findStockShortages(lines, map)).toEqual([])
  })

  it('flags a shortage only when requested quantity exceeds inventory', () => {
    const lines: StockLine[] = [{ product_id: 1, quantity: 51 }]
    const map = products({ id: 1, name: 'Soy Sauce 1L', inventory: 50 })
    expect(findStockShortages(lines, map)).toEqual([
      { product_id: 1, name: 'Soy Sauce 1L', available: 50, requested: 51 },
    ])
  })

  it('passes when requested exactly equals inventory', () => {
    const lines: StockLine[] = [{ product_id: 1, quantity: 50 }]
    const map = products({ id: 1, name: 'Soy Sauce 1L', inventory: 50 })
    expect(findStockShortages(lines, map)).toEqual([])
  })

  it('sums duplicate product lines toward one total', () => {
    const lines: StockLine[] = [
      { product_id: 1, quantity: 30 },
      { product_id: 1, quantity: 25 },
    ]
    const map = products({ id: 1, name: 'Soy Sauce 1L', inventory: 50 })
    expect(findStockShortages(lines, map)).toEqual([
      { product_id: 1, name: 'Soy Sauce 1L', available: 50, requested: 55 },
    ])
  })

  it('reports each short product independently across a multi-line PO', () => {
    const lines: StockLine[] = [
      { product_id: 1, quantity: 5 }, // ok
      { product_id: 2, quantity: 99 }, // short
    ]
    const map = products(
      { id: 1, name: 'In stock', inventory: 10 },
      { id: 2, name: 'Short item', inventory: 20 },
    )
    expect(findStockShortages(lines, map)).toEqual([
      { product_id: 2, name: 'Short item', available: 20, requested: 99 },
    ])
  })

  it('ignores products missing from the map (validated separately upstream)', () => {
    const lines: StockLine[] = [{ product_id: 999, quantity: 1 }]
    expect(findStockShortages(lines, products())).toEqual([])
  })
})

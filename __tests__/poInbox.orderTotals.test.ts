import { describe, it, expect } from 'vitest'

import {
  buildOrderItems,
  type PricedLine,
  type PricedProduct,
} from '../supabase/functions/_shared/poInbox/orderTotals'

function products(...rows: Array<PricedProduct & { id: number }>): Map<number, PricedProduct> {
  const m = new Map<number, PricedProduct>()
  for (const { id, ...p } of rows) m.set(id, p)
  return m
}

describe('buildOrderItems', () => {
  it('prices each line as unit_price * quantity — pack_size is NOT a multiplier', () => {
    // Regression guard for ORD-IN-1BDB57FDE08E456BBB02D28C5172FCAE, whose stored
    // header total read $846 instead of $117 because the old code multiplied the
    // line total by pack_size. These are the exact lines from that order.
    const lines: PricedLine[] = [
      { product_id: 1, quantity: 12, pack_size: 6 }, // Light Soy Sauce — 42.00
      { product_id: 2, quantity: 12, pack_size: 12 }, // Rice Noodles — 24.00
      { product_id: 3, quantity: 6, pack_size: 6 }, // Satay Sauce — 27.00
      { product_id: 4, quantity: 6, pack_size: 6 }, // Thai Red Curry Paste — 24.00
    ]
    const map = products(
      { id: 1, name: 'Light Soy Sauce 210ml', sku: 'AYM-SOY-001', price: 3.5 },
      { id: 2, name: 'Rice Noodles 200g', sku: 'AYM-NOO-001', price: 2 },
      { id: 3, name: 'Satay Sauce 250ml', sku: 'AYM-SAT-001', price: 4.5 },
      { id: 4, name: 'Thai Red Curry Paste 195g', sku: 'AYM-CUR-001', price: 4 },
    )

    const { total } = buildOrderItems(lines, map)
    expect(total).toBe(117) // NOT 846
  })

  it('prices a null-pack_size line as quantity * price', () => {
    const lines: PricedLine[] = [{ product_id: 1, quantity: 5, pack_size: null }]
    const map = products({ id: 1, name: 'Single Unit', sku: 'SKU-1', price: 10 })

    const { total } = buildOrderItems(lines, map)
    expect(total).toBe(50)
  })

  it('writes pack_size = NULL on each row (quantity is already selling units) and excludes it from the total', () => {
    // PO-inbox quantity is the selling-unit count, so order_items rows store
    // pack_size = NULL. This keeps the pack-aware inventory RPCs (mig 00035) at
    // factor 1 for PO lines so they are not over-depleted by the carton size.
    const lines: PricedLine[] = [{ product_id: 1, quantity: 3, pack_size: 24 }]
    const map = products({ id: 1, name: 'Carton Line', sku: 'SKU-C', price: 2 })

    const { items, total } = buildOrderItems(lines, map)
    expect(items).toEqual([
      {
        product_id: 1,
        quantity: 3,
        pack_size: null,
        unit_price: 2,
        product_name: 'Carton Line',
        product_sku: 'SKU-C',
      },
    ])
    expect(total).toBe(6) // 2 * 3, NOT 2 * 3 * 24
  })

  it('sums independent product lines into one order total', () => {
    const lines: PricedLine[] = [
      { product_id: 1, quantity: 2, pack_size: 6 },
      { product_id: 2, quantity: 4, pack_size: null },
    ]
    const map = products(
      { id: 1, name: 'A', sku: 'A', price: 1.25 },
      { id: 2, name: 'B', sku: 'B', price: 3 },
    )

    const { total } = buildOrderItems(lines, map)
    expect(total).toBe(2.5 + 12)
  })
})

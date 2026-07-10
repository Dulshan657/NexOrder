import { describe, it, expect } from 'vitest'
import { buildAggFromBalances, buildAggFromStockRows } from '@/hooks/useScopedStock'
import type { InventoryBalance } from '@/types'
import type { ProductStockRow } from '@/services/supabase/inventoryService'

function balance(overrides: Partial<InventoryBalance>): InventoryBalance {
  return {
    id: 1,
    productId: 1,
    locationId: 1,
    onHand: 0,
    allocated: 0,
    available: 0,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('buildAggFromBalances', () => {
  it('sums multiple rows for the same productId', () => {
    const m = buildAggFromBalances([
      balance({ id: 1, productId: 5, onHand: 10, allocated: 2, available: 8 }),
      balance({ id: 2, productId: 5, onHand: 3, allocated: 1, available: 2 }),
    ])
    expect(m.get(5)).toEqual({ onHand: 13, allocated: 3, available: 10 })
  })

  it('keeps products distinct', () => {
    const m = buildAggFromBalances([
      balance({ id: 1, productId: 1, onHand: 5, allocated: 0, available: 5 }),
      balance({ id: 2, productId: 2, onHand: 7, allocated: 1, available: 6 }),
    ])
    expect(m.size).toBe(2)
    expect(m.get(1)).toEqual({ onHand: 5, allocated: 0, available: 5 })
    expect(m.get(2)).toEqual({ onHand: 7, allocated: 1, available: 6 })
  })

  it('handles empty and nullish input', () => {
    expect(buildAggFromBalances([])).toEqual(new Map())
    expect(buildAggFromBalances(undefined)).toEqual(new Map())
    expect(buildAggFromBalances(null)).toEqual(new Map())
  })

  it('sums onHand/allocated/available independently', () => {
    const m = buildAggFromBalances([
      balance({ id: 1, productId: 9, onHand: 100, allocated: 0, available: 100 }),
      balance({ id: 2, productId: 9, onHand: 0, allocated: 40, available: -40 }),
    ])
    expect(m.get(9)).toEqual({ onHand: 100, allocated: 40, available: 60 })
  })
})

describe('buildAggFromStockRows', () => {
  function row(overrides: Partial<ProductStockRow>): ProductStockRow {
    return { productId: 1, onHand: 0, allocated: 0, available: 0, ...overrides }
  }

  it('maps rows 1:1', () => {
    const m = buildAggFromStockRows([
      row({ productId: 1, onHand: 10, allocated: 2, available: 8 }),
      row({ productId: 2, onHand: 5, allocated: 0, available: 5 }),
    ])
    expect(m.get(1)).toEqual({ onHand: 10, allocated: 2, available: 8 })
    expect(m.get(2)).toEqual({ onHand: 5, allocated: 0, available: 5 })
  })

  it('keeps a zero-onHand row as a present map entry, not dropped', () => {
    const m = buildAggFromStockRows([row({ productId: 3, onHand: 0, allocated: 0, available: 0 })])
    expect(m.has(3)).toBe(true)
    expect(m.get(3)).toEqual({ onHand: 0, allocated: 0, available: 0 })
  })

  it('leaves a product absent from rows absent from the map', () => {
    const m = buildAggFromStockRows([row({ productId: 3, onHand: 0, allocated: 0, available: 0 })])
    expect(m.has(4)).toBe(false)
    expect(m.get(4)).toBeUndefined()
  })

  it('handles empty and nullish input', () => {
    expect(buildAggFromStockRows([])).toEqual(new Map())
    expect(buildAggFromStockRows(undefined)).toEqual(new Map())
    expect(buildAggFromStockRows(null)).toEqual(new Map())
  })
})

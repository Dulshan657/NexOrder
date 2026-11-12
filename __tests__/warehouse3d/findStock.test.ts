// NX-0036 A1/A2/A5: where a product is, from the stock the map already holds.

import { describe, it, expect } from 'vitest'
import type { Product } from '@/types'
import type { BinContentRow } from '@/components/inventory/warehouse/useWarehouseViewerModel'
import { locationsHoldingProduct, productOptionsInWarehouse, stockSummary } from '@/lib/warehouse3d/findStock'

function row(productId: number, onHand: number, allocated = 0): BinContentRow {
  return { productId, productName: `P${productId}`, sizeFactor: 1, onHand, allocated, slots: onHand }
}

// 10, 11, 12 are rack levels; 1 is the warehouse root (received, not put away).
const binContents = new Map<number, BinContentRow[]>([
  [10, [row(7, 40), row(8, 5)]],
  [11, [row(7, 12, 12)]], // fully allocated — still physically there
  [12, [row(7, 0), row(8, 3)]], // a zero row for 7 must not count
  [1, [row(7, 24)]],
])

const product = (id: number, name: string) => ({ id, name, sku: `SKU${id}` }) as Product

describe('locationsHoldingProduct', () => {
  it('returns every location holding on-hand stock of the product, allocated included', () => {
    expect([...locationsHoldingProduct(binContents, 7)].sort()).toEqual([1, 10, 11])
  })

  it('ignores a location whose on-hand for the product is zero', () => {
    expect(locationsHoldingProduct(binContents, 7).has(12)).toBe(false)
    expect(locationsHoldingProduct(binContents, 99).size).toBe(0)
  })
})

describe('productOptionsInWarehouse', () => {
  it('lists only products in stock on this site, by name', () => {
    const products = [product(8, 'Zucchini'), product(9, 'Apples — none here'), product(7, 'Basil')]
    expect(productOptionsInWarehouse(binContents, products).map((p) => p.id)).toEqual([7, 8])
  })
})

describe('stockSummary', () => {
  it('splits placed locations from units not in a rack', () => {
    const placed = new Set([10, 11, 12])
    expect(stockSummary(binContents, 7, placed)).toEqual({ placedLocations: 2, placedUnits: 52, unplacedUnits: 24 })
    expect(stockSummary(binContents, 8, placed)).toEqual({ placedLocations: 2, placedUnits: 8, unplacedUnits: 0 })
  })
})

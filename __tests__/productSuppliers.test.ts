import { describe, it, expect } from 'vitest'

import {
  linksForProduct,
  primaryLink,
  isSuppliedBy,
  productsForSupplier,
  supplierSkuFor,
  costPriceFor,
  matchesProductQuery,
} from '../lib/productSuppliers'
import type { Product, ProductSupplierLink } from '../types'

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1, sku: 'AYM-COC-001', name: 'Coconut Milk 400ml', description: '',
    price: 4.5, category: 'Coconut', inventory: 100, available: 100,
    unit: 'can', cartonSize: 12, supplierId: 1,
    ...overrides,
  } as Product
}

function link(overrides: Partial<ProductSupplierLink> = {}): ProductSupplierLink {
  return { supplierId: 1, isPrimary: false, sortOrder: 0, ...overrides }
}

describe('linksForProduct', () => {
  it('returns the embedded list when the product_suppliers join was read', () => {
    const p = product({
      suppliers: [link({ supplierId: 7, isPrimary: true }), link({ supplierId: 9, sortOrder: 1 })],
    })
    expect(linksForProduct(p).map(l => l.supplierId)).toEqual([7, 9])
  })

  it('synthesises a primary link from supplierId when the join is absent', () => {
    // Rows read without product_suppliers(*) must not look supplier-less, or the
    // product would silently vanish from a supplier-filtered picker.
    expect(linksForProduct(product({ supplierId: 3 }))).toEqual([
      { supplierId: 3, isPrimary: true, sortOrder: 0 },
    ])
  })

  it('falls back for an EMPTY embedded array too', () => {
    expect(linksForProduct(product({ supplierId: 3, suppliers: [] }))).toEqual([
      { supplierId: 3, isPrimary: true, sortOrder: 0 },
    ])
  })
})

describe('primaryLink', () => {
  it('picks the flagged primary regardless of order', () => {
    const p = product({
      suppliers: [link({ supplierId: 9 }), link({ supplierId: 7, isPrimary: true })],
    })
    expect(primaryLink(p)?.supplierId).toBe(7)
  })

  it('falls back to the first link when none is flagged', () => {
    const p = product({ suppliers: [link({ supplierId: 9 }), link({ supplierId: 7 })] })
    expect(primaryLink(p)?.supplierId).toBe(9)
  })
})

describe('isSuppliedBy / productsForSupplier', () => {
  const multi = product({
    id: 1, name: 'Coconut Milk', sku: 'A-1',
    suppliers: [link({ supplierId: 1, isPrimary: true }), link({ supplierId: 2, sortOrder: 1 })],
  })
  const single = product({ id: 2, name: 'Fish Sauce', sku: 'A-2', supplierId: 3, suppliers: undefined })
  const catalogue = [multi, single]

  it('matches any link, not just the primary', () => {
    expect(isSuppliedBy(multi, 2)).toBe(true)
    expect(isSuppliedBy(multi, 99)).toBe(false)
  })

  it('filters the catalogue to one supplier', () => {
    expect(productsForSupplier(catalogue, 2).map(p => p.id)).toEqual([1])
    expect(productsForSupplier(catalogue, 3).map(p => p.id)).toEqual([2])
    expect(productsForSupplier(catalogue, 99)).toEqual([])
  })
})

describe('supplierSkuFor / costPriceFor', () => {
  const p = product({
    suppliers: [
      link({ supplierId: 1, isPrimary: true, supplierSku: 'AF-1001', costPrice: 3.2 }),
      link({ supplierId: 2, sortOrder: 1, supplierSku: '   ' }),
    ],
  })

  it('returns the part number for the matching supplier only', () => {
    expect(supplierSkuFor(p, 1)).toBe('AF-1001')
    expect(supplierSkuFor(p, 99)).toBeUndefined()
  })

  it('treats a blank part number as absent', () => {
    expect(supplierSkuFor(p, 2)).toBeUndefined()
  })

  it('returns undefined when no supplier is in play', () => {
    expect(supplierSkuFor(p, null)).toBeUndefined()
    expect(costPriceFor(p, null)).toBeUndefined()
  })

  it('returns the per-supplier cost', () => {
    expect(costPriceFor(p, 1)).toBe(3.2)
    expect(costPriceFor(p, 2)).toBeUndefined()
  })
})

describe('matchesProductQuery', () => {
  const p = product({
    name: 'Coconut Milk 400ml', sku: 'AYM-COC-001', barcode: '9312345678907',
    suppliers: [link({ supplierId: 1, isPrimary: true, supplierSku: 'AF-1001' })],
  })

  it('matches name, our SKU and barcode', () => {
    expect(matchesProductQuery(p, 'coconut')).toBe(true)
    expect(matchesProductQuery(p, 'aym-coc')).toBe(true)
    expect(matchesProductQuery(p, '93123')).toBe(true)
  })

  it("matches the selected supplier's part number", () => {
    expect(matchesProductQuery(p, 'af-1001', 1)).toBe(true)
  })

  it("does NOT match another supplier's part number", () => {
    // The code belongs to supplier 1; searching as supplier 2 must not find it.
    expect(matchesProductQuery(p, 'af-1001', 2)).toBe(false)
  })

  it('ignores the supplier part number when no supplier is selected', () => {
    expect(matchesProductQuery(p, 'af-1001')).toBe(false)
    expect(matchesProductQuery(p, 'af-1001', null)).toBe(false)
  })

  it('never matches on an empty query', () => {
    expect(matchesProductQuery(p, '')).toBe(false)
  })
})

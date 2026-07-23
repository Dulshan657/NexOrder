import { describe, it, expect } from 'vitest'

import {
  assembleSupplierLinks,
  supplierDraftsFromProduct,
  newSupplierDraft,
} from '../lib/productSupplierForm'
import type { Product } from '../types'
import type { SupplierLinkDraft } from '../components/admin/ProductSuppliersSection'

function draft(overrides: Partial<SupplierLinkDraft> = {}): SupplierLinkDraft {
  return { ...newSupplierDraft(), ...overrides }
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1, sku: 'A-1', name: 'A', description: '', price: 1, category: 'Other',
    inventory: 0, available: 0, unit: 'each', cartonSize: 1, supplierId: 4,
    ...overrides,
  } as Product
}

describe('supplierDraftsFromProduct', () => {
  it('gives a new product one blank row', () => {
    expect(supplierDraftsFromProduct(null)).toEqual([newSupplierDraft()])
  })

  it('seeds from the embedded links, stringifying numerics', () => {
    const p = product({
      suppliers: [
        { supplierId: 4, supplierSku: 'AF-1', costPrice: 3.2, isPrimary: true, sortOrder: 0 },
        { supplierId: 9, isPrimary: false, sortOrder: 1 },
      ],
    })
    expect(supplierDraftsFromProduct(p)).toEqual([
      { supplierId: '4', supplierSku: 'AF-1', costPrice: '3.2', isPrimary: true },
      { supplierId: '9', supplierSku: '', costPrice: '', isPrimary: false },
    ])
  })

  it('seeds a legacy single-supplier product from supplierId', () => {
    expect(supplierDraftsFromProduct(product({ suppliers: undefined }))).toEqual([
      { supplierId: '4', supplierSku: '', costPrice: '', isPrimary: true },
    ])
  })
})

describe('assembleSupplierLinks', () => {
  it('builds links and assigns sortOrder by row position', () => {
    const result = assembleSupplierLinks([
      draft({ supplierId: '4', supplierSku: 'AF-1', costPrice: '3.2', isPrimary: true }),
      draft({ supplierId: '9' }),
    ])
    expect(result.ok).toBe(true)
    if (result.ok === false) throw new Error('expected ok')
    expect(result.links).toEqual([
      { supplierId: 4, supplierSku: 'AF-1', costPrice: 3.2, isPrimary: true, sortOrder: 0 },
      { supplierId: 9, supplierSku: undefined, costPrice: undefined, isPrimary: false, sortOrder: 1 },
    ])
  })

  it('ignores blank rows the operator added but never filled in', () => {
    const result = assembleSupplierLinks([draft({ supplierId: '4', isPrimary: true }), draft()])
    if (result.ok === false) throw new Error('expected ok')
    expect(result.links).toHaveLength(1)
  })

  it('promotes the first row when none is marked primary', () => {
    // products.supplier_id is NOT NULL — something must always be primary.
    const result = assembleSupplierLinks([draft({ supplierId: '9' }), draft({ supplierId: '4' })])
    if (result.ok === false) throw new Error('expected ok')
    expect(result.links.map(l => l.isPrimary)).toEqual([true, false])
  })

  // NOTE: `result.ok === false` (not `!result.ok`) — without strictNullChecks TS
  // won't narrow a discriminated union through a negated boolean-property check.
  it('rejects an empty list', () => {
    const result = assembleSupplierLinks([draft()])
    expect(result.ok).toBe(false)
    if (result.ok === false) expect(result.error).toMatch(/at least one supplier/i)
  })

  it('rejects the same supplier twice', () => {
    const result = assembleSupplierLinks([draft({ supplierId: '4' }), draft({ supplierId: '4' })])
    expect(result.ok).toBe(false)
    if (result.ok === false) expect(result.error).toMatch(/twice/i)
  })

  it('rejects two primaries', () => {
    const result = assembleSupplierLinks([
      draft({ supplierId: '4', isPrimary: true }),
      draft({ supplierId: '9', isPrimary: true }),
    ])
    expect(result.ok).toBe(false)
    if (result.ok === false) expect(result.error).toMatch(/only one supplier/i)
  })

  it('rejects a negative or unparseable cost price', () => {
    expect(assembleSupplierLinks([draft({ supplierId: '4', costPrice: '-1' })]).ok).toBe(false)
    expect(assembleSupplierLinks([draft({ supplierId: '4', costPrice: 'abc' })]).ok).toBe(false)
  })

  it('rounds a cost price to 2dp and treats blanks as absent', () => {
    const result = assembleSupplierLinks([draft({ supplierId: '4', costPrice: '3.456' })])
    if (result.ok === false) throw new Error('expected ok')
    expect(result.links[0].costPrice).toBe(3.46)

    const blank = assembleSupplierLinks([draft({ supplierId: '4', costPrice: '  ' })])
    if (blank.ok === false) throw new Error('expected ok')
    expect(blank.links[0].costPrice).toBeUndefined()
  })
})

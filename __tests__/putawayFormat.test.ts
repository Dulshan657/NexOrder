// The quantity arithmetic behind "48 bottles · 4 cartons" and the partial-
// putaway conversion. Getting the UOM factor wrong here would move the wrong
// amount of stock, so it is pinned separately from the UI.

import { describe, it, expect } from 'vitest'
import {
  baseUnitLabel,
  describeQuantity,
  toBaseQty,
  trimNumber,
  uomsForProduct,
} from '@/components/inventory/putaway/putawayFormat'
import type { Product, ProductUom } from '@/types'

function uom(over: Partial<ProductUom>): ProductUom {
  return {
    id: 1, productId: 1, code: 'each', factorToBase: 1, isBase: true,
    price: 1, isOrderable: true, isReceivable: true, sortOrder: 0, ...over,
  }
}

function product(over: Partial<Product> = {}): Product {
  return {
    id: 1, sku: 'S', name: 'N', description: '', price: 4, category: 'Sauces',
    inventory: 0, available: 0, unit: 'bottle', cartonSize: 12, supplierId: 1, ...over,
  } as Product
}

describe('uomsForProduct', () => {
  it('uses the product\'s own receivable ladder when it has one', () => {
    const uoms = [uom({ id: 1, code: 'jar' }), uom({ id: 2, code: 'case', factorToBase: 6, isBase: false, sortOrder: 1 })]
    expect(uomsForProduct(product({ uoms })).map((u) => u.code)).toEqual(['jar', 'case'])
  })

  it('falls back to base+carton derived from the legacy fields', () => {
    expect(uomsForProduct(product({ uoms: undefined })).map((u) => u.code)).toEqual(['bottle', 'carton'])
  })

  it('excludes non-receivable UOMs', () => {
    const uoms = [uom({ id: 1, code: 'jar' }), uom({ id: 2, code: 'pallet', factorToBase: 480, isBase: false, isReceivable: false, sortOrder: 2 })]
    expect(uomsForProduct(product({ uoms })).map((u) => u.code)).toEqual(['jar'])
  })

  it('returns nothing for a missing product', () => {
    expect(uomsForProduct(null)).toEqual([])
  })
})

describe('baseUnitLabel', () => {
  it('uses the base UOM code', () => {
    expect(baseUnitLabel(product())).toBe('bottle')
  })

  it('says "units" when there is no product at all', () => {
    expect(baseUnitLabel(null)).toBe('units')
  })
})

describe('describeQuantity', () => {
  it('adds a pack breakdown when a larger unit exists', () => {
    const d = describeQuantity(48, product())
    expect(d.primary).toBe('48 bottle')
    expect(d.secondary).toBe('4 carton')
  })

  it('omits the breakdown when only the base tier applies', () => {
    // 5 of a carton-12 product decomposes to 5 base units — repeating it adds nothing.
    expect(describeQuantity(5, product()).secondary).toBeNull()
  })

  it('shows the remainder alongside the packs', () => {
    expect(describeQuantity(50, product()).secondary).toBe('4 carton, 2 bottle')
  })

  it('handles a product with no carton at all', () => {
    const d = describeQuantity(7, product({ cartonSize: 1 }))
    expect(d.primary).toBe('7 bottle')
    expect(d.secondary).toBeNull()
  })
})

describe('toBaseQty', () => {
  it('multiplies by the factor for a non-base UOM', () => {
    expect(toBaseQty(3, uom({ code: 'carton', factorToBase: 12, isBase: false }))).toBe(36)
  })

  it('leaves a base UOM alone even if its factor says otherwise', () => {
    expect(toBaseQty(3, uom({ factorToBase: 12, isBase: true }))).toBe(3)
  })

  it('treats a missing UOM as base units', () => {
    expect(toBaseQty(3, undefined)).toBe(3)
  })

  it('coerces a non-numeric count to zero rather than NaN', () => {
    expect(toBaseQty(Number('abc'), uom({ factorToBase: 12, isBase: false }))).toBe(0)
  })
})

describe('trimNumber', () => {
  it('drops the NUMERIC(14,3) trailing zeros', () => {
    expect(trimNumber(36)).toBe('36')
  })

  it('keeps a genuinely fractional quantity', () => {
    expect(trimNumber(1.5)).toBe('1.5')
  })
})

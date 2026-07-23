import { describe, it, expect } from 'vitest'
import { mergeOptions, uomCodeOptions, categoryOptions, withCurrentValue } from '../lib/productTaxonomy'
import { CATEGORIES, UOM_CODES } from '../constants'
import type { Product } from '../types'

// Minimal product stubs — the helpers only read unit/category/uoms.
function product(partial: Partial<Product>): Product {
  return {
    id: 1, sku: 'X', name: 'X', description: '', price: 1,
    category: 'Coconut', inventory: 0, unit: 'each', cartonSize: 1,
    supplierId: 1, ...partial,
  } as Product
}

describe('mergeOptions', () => {
  it('keeps curated order, then sorts the extras alphabetically', () => {
    expect(mergeOptions(['each', 'carton'], ['zebra', 'apple'])).toEqual(['each', 'carton', 'apple', 'zebra'])
  })

  it('dedupes case-insensitively, keeping the curated spelling', () => {
    expect(mergeOptions(['carton'], ['Carton', 'CARTON'])).toEqual(['carton'])
  })

  it('keeps an off-list value verbatim rather than normalising it', () => {
    // The live catalog has both 'each' and 'EA'; renaming a UOM code would
    // delete/recreate the row and null order_items.uom_id on shipped orders.
    expect(mergeOptions(['each'], ['EA'])).toEqual(['each', 'EA'])
  })

  it('ignores blank and whitespace-only values', () => {
    expect(mergeOptions(['each'], ['', '   ', 'box'])).toEqual(['each', 'box'])
  })

  it('trims what it keeps', () => {
    expect(mergeOptions(['each'], [' drum '])).toEqual(['each', 'drum'])
  })
})

describe('uomCodeOptions', () => {
  it('offers the curated list when the catalog adds nothing new', () => {
    expect(uomCodeOptions([])).toEqual([...UOM_CODES])
  })

  it('picks up both the base unit column and every UOM code in use', () => {
    const products = [
      product({ unit: 'EA' }),
      product({
        unit: 'each',
        uoms: [
          { id: 1, productId: 2, code: 'each', factorToBase: 1, isBase: true, price: 1, isOrderable: true, isReceivable: true, sortOrder: 0 },
          { id: 2, productId: 2, code: 'shipper', factorToBase: 24, isBase: false, price: 20, isOrderable: true, isReceivable: true, sortOrder: 1 },
        ],
      }),
    ]
    const options = uomCodeOptions(products)
    expect(options.slice(0, UOM_CODES.length)).toEqual([...UOM_CODES])
    expect(options).toContain('EA')
    expect(options).toContain('shipper')
  })

  it('tolerates a product with no uoms loaded', () => {
    expect(() => uomCodeOptions([product({ uoms: undefined })])).not.toThrow()
  })
})

describe('categoryOptions', () => {
  it('appends operator-created categories after the built-ins', () => {
    const options = categoryOptions([product({ category: 'Frozen Dumplings' })])
    expect(options.slice(0, CATEGORIES.length)).toEqual([...CATEGORIES])
    expect(options).toContain('Frozen Dumplings')
  })

  it('does not duplicate a built-in already in use', () => {
    const options = categoryOptions([product({ category: 'Coconut' })])
    expect(options.filter(c => c === 'Coconut')).toHaveLength(1)
  })
})

describe('withCurrentValue', () => {
  it('prepends a value that is not in the list', () => {
    expect(withCurrentValue(['each', 'carton'], 'firkin')).toEqual(['firkin', 'each', 'carton'])
  })

  it('leaves the list alone when the value is already present (any casing)', () => {
    expect(withCurrentValue(['each', 'carton'], 'Carton')).toEqual(['each', 'carton'])
  })

  it('leaves the list alone for a blank value', () => {
    expect(withCurrentValue(['each'], '')).toEqual(['each'])
    expect(withCurrentValue(['each'], undefined)).toEqual(['each'])
  })
})

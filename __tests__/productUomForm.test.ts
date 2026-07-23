import { describe, it, expect } from 'vitest'

import { assembleProductUoms, extraUomsFromProduct } from '../lib/productUomForm'
import type { Product, ProductUom } from '../types'

function uom(p: Partial<ProductUom>): ProductUom {
  return {
    id: 1, productId: 1, code: 'each', factorToBase: 1, isBase: true,
    price: 5, isOrderable: true, isReceivable: true, sortOrder: 0, ...p,
  }
}

describe('assembleProductUoms', () => {
  it('builds base + extras with correct flags and sort order', () => {
    const r = assembleProductUoms('can', 2.5, [
      { code: 'carton', factorToBase: '12', price: '28.5', isOrderable: true, isReceivable: true },
      { code: 'pallet', factorToBase: '480', price: '1100', isOrderable: true, isReceivable: false },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.uoms).toHaveLength(3)
    expect(r.uoms[0]).toMatchObject({ code: 'can', factorToBase: 1, isBase: true, price: 2.5, sortOrder: 0 })
    expect(r.uoms[1]).toMatchObject({ code: 'carton', factorToBase: 12, isBase: false, sortOrder: 1 })
    expect(r.uoms[2]).toMatchObject({ code: 'pallet', factorToBase: 480, isReceivable: false, sortOrder: 2 })
  })

  it('rejects a duplicate code (vs base)', () => {
    const r = assembleProductUoms('carton', 3, [
      { code: 'Carton', factorToBase: '12', price: '30', isOrderable: true, isReceivable: true },
    ])
    expect(r.ok).toBe(false)
  })

  it('rejects a factor below 2', () => {
    const r = assembleProductUoms('each', 3, [
      { code: 'inner', factorToBase: '1', price: '3', isOrderable: true, isReceivable: true },
    ])
    expect(r.ok).toBe(false)
  })

  it('rejects a fractional factor', () => {
    const r = assembleProductUoms('each', 3, [
      { code: 'inner', factorToBase: '1.5', price: '4', isOrderable: true, isReceivable: true },
    ])
    expect(r.ok).toBe(false)
  })

  it('rejects a blank code', () => {
    const r = assembleProductUoms('each', 3, [
      { code: '  ', factorToBase: '6', price: '15', isOrderable: true, isReceivable: true },
    ])
    expect(r.ok).toBe(false)
  })

  it('defaults a blank base unit to "each"', () => {
    const r = assembleProductUoms('', 3, [])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.uoms[0].code).toBe('each')
  })
})

describe('extraUomsFromProduct', () => {
  it('returns non-base rows sorted, as string drafts', () => {
    const product = {
      uoms: [
        uom({ id: 2, code: 'carton', factorToBase: 12, isBase: false, price: 28.5, sortOrder: 1 }),
        uom({ id: 1, code: 'can', factorToBase: 1, isBase: true, price: 2.5, sortOrder: 0 }),
      ],
    } as Product
    const drafts = extraUomsFromProduct(product)
    expect(drafts).toEqual([
      { code: 'carton', factorToBase: '12', price: '28.5', isOrderable: true, isReceivable: true },
    ])
  })

  it('returns empty when a product has no UOMs', () => {
    expect(extraUomsFromProduct({ } as Product)).toEqual([])
    expect(extraUomsFromProduct(null)).toEqual([])
  })
})

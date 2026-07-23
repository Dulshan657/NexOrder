import { describe, it, expect } from 'vitest'

import { decomposeToUoms, formatBreakdown } from '../lib/uomDecompose'
import type { ProductUom } from '../types'

function uom(partial: Partial<ProductUom>): ProductUom {
  return {
    id: 1, productId: 10, code: 'each', factorToBase: 1, isBase: true,
    price: 1, isOrderable: true, isReceivable: true, sortOrder: 0, ...partial,
  }
}

const each = uom({ id: 1, code: 'each', factorToBase: 1, isBase: true, sortOrder: 0 })
const carton = uom({ id: 2, code: 'carton', factorToBase: 12, isBase: false, sortOrder: 1 })
const pallet = uom({ id: 3, code: 'pallet', factorToBase: 480, isBase: false, sortOrder: 2 })

describe('decomposeToUoms', () => {
  it('splits 500 into 1 pallet, 1 carton, 8 each', () => {
    const b = decomposeToUoms(500, [each, carton, pallet])
    expect(b).toEqual([
      { code: 'pallet', count: 1, factorToBase: 480 },
      { code: 'carton', count: 1, factorToBase: 12 },
      { code: 'each', count: 8, factorToBase: 1 },
    ])
    expect(formatBreakdown(b)).toBe('1 pallet, 1 carton, 8 each')
  })

  it('omits zero-count tiers on an exact multiple', () => {
    expect(decomposeToUoms(480, [each, carton, pallet])).toEqual([
      { code: 'pallet', count: 1, factorToBase: 480 },
    ])
  })

  it('returns just the base tier when qty < smallest pack', () => {
    expect(decomposeToUoms(7, [each, carton, pallet])).toEqual([
      { code: 'each', count: 7, factorToBase: 1 },
    ])
  })

  it('handles a single-UOM (base only) product', () => {
    expect(decomposeToUoms(9, [each])).toEqual([{ code: 'each', count: 9, factorToBase: 1 }])
  })

  it('is order-independent (unsorted input)', () => {
    expect(decomposeToUoms(500, [pallet, each, carton])).toEqual(
      decomposeToUoms(500, [each, carton, pallet]),
    )
  })

  it('surfaces a remainder as base "each" when no factor-1 UOM exists', () => {
    // only carton(12): 25 → 2 carton + 1 remainder
    expect(decomposeToUoms(25, [carton])).toEqual([
      { code: 'carton', count: 2, factorToBase: 12 },
      { code: 'each', count: 1, factorToBase: 1 },
    ])
  })

  it('returns empty for non-positive quantities', () => {
    expect(decomposeToUoms(0, [each, carton])).toEqual([])
    expect(decomposeToUoms(-5, [each, carton])).toEqual([])
  })
})

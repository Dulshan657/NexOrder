import { describe, it, expect } from 'vitest'

import {
  baseUom,
  sortUoms,
  orderableUoms,
  receivableUoms,
  findUomById,
  findUomByFactor,
  deriveDefaultUoms,
} from '../lib/uom'
import type { ProductUom } from '../types'

function uom(partial: Partial<ProductUom>): ProductUom {
  return {
    id: 1,
    productId: 10,
    code: 'each',
    factorToBase: 1,
    isBase: true,
    price: 5,
    isOrderable: true,
    isReceivable: true,
    sortOrder: 0,
    ...partial,
  }
}

const each = uom({ id: 1, code: 'each', factorToBase: 1, isBase: true, sortOrder: 0, price: 5 })
const carton = uom({ id: 2, code: 'carton', factorToBase: 12, isBase: false, sortOrder: 1, price: 55 })
const pallet = uom({ id: 3, code: 'pallet', factorToBase: 480, isBase: false, sortOrder: 2, price: 2000 })

describe('baseUom', () => {
  it('returns the base UOM', () => {
    expect(baseUom([carton, each, pallet])?.id).toBe(1)
  })
  it('returns undefined for empty/undefined', () => {
    expect(baseUom(undefined)).toBeUndefined()
    expect(baseUom([])).toBeUndefined()
  })
})

describe('sortUoms', () => {
  it('sorts ascending by sortOrder without mutating input', () => {
    const input = [pallet, each, carton]
    const sorted = sortUoms(input)
    expect(sorted.map(u => u.id)).toEqual([1, 2, 3])
    expect(input.map(u => u.id)).toEqual([3, 1, 2]) // original untouched
  })
})

describe('orderable / receivable filters', () => {
  it('keeps only orderable, sorted', () => {
    const noOrder = uom({ id: 4, code: 'drum', factorToBase: 200, isBase: false, isOrderable: false, sortOrder: 3 })
    expect(orderableUoms([pallet, noOrder, each]).map(u => u.id)).toEqual([1, 3])
  })
  it('keeps only receivable', () => {
    const noRecv = uom({ id: 5, code: 'inner', factorToBase: 6, isBase: false, isReceivable: false, sortOrder: 1 })
    expect(receivableUoms([each, noRecv]).map(u => u.id)).toEqual([1])
  })
})

describe('findUomById', () => {
  it('finds by id, tolerates null', () => {
    expect(findUomById([each, carton], 2)?.code).toBe('carton')
    expect(findUomById([each, carton], null)).toBeUndefined()
    expect(findUomById(undefined, 2)).toBeUndefined()
  })
})

describe('findUomByFactor (legacy fallback)', () => {
  it('maps factor 1 / null to the base UOM', () => {
    expect(findUomByFactor([each, carton], 1)?.id).toBe(1)
    expect(findUomByFactor([each, carton], null)?.id).toBe(1)
    expect(findUomByFactor([each, carton], undefined)?.id).toBe(1)
  })
  it('maps a non-1 factor to the matching UOM', () => {
    expect(findUomByFactor([each, carton, pallet], 480)?.id).toBe(3)
  })
  it('returns undefined when no factor matches', () => {
    expect(findUomByFactor([each, carton], 7)).toBeUndefined()
  })
})

describe('deriveDefaultUoms', () => {
  it('produces base only when cartonSize <= 1', () => {
    const uoms = deriveDefaultUoms('can', 4.9, 1)
    expect(uoms).toHaveLength(1)
    expect(uoms[0]).toMatchObject({ code: 'can', factorToBase: 1, isBase: true, price: 4.9 })
  })
  it('adds a carton priced with the derived formula', () => {
    const uoms = deriveDefaultUoms('can', 4.9, 12, 5)
    expect(uoms).toHaveLength(2)
    // 4.9 * 12 * 0.95 = 55.86
    expect(uoms[1]).toMatchObject({ code: 'carton', factorToBase: 12, isBase: false, price: 55.86 })
  })
  it('defaults a blank unit label to "each"', () => {
    expect(deriveDefaultUoms('', 3, 1)[0].code).toBe('each')
  })
})

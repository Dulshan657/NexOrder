import { describe, it, expect } from 'vitest'
import { resolveUomVolume, resolveLineUnitVolume, totalLineVolume } from '../lib/uomVolume'
import type { ProductUom } from '../types'

function uom(partial: Partial<ProductUom>): ProductUom {
  return {
    id: 1, productId: 1, code: 'each', factorToBase: 1, isBase: true,
    price: 1, isOrderable: true, isReceivable: true, sortOrder: 0, ...partial,
  }
}

const BASE = uom({ id: 1, code: 'each', factorToBase: 1, isBase: true })
const CARTON = uom({ id: 2, code: 'carton', factorToBase: 12, isBase: false, sortOrder: 1 })
const PALLET = uom({ id: 3, code: 'pallet', factorToBase: 480, isBase: false, sortOrder: 2 })

describe('resolveUomVolume', () => {
  it('prefers the UOM\'s own volume', () => {
    expect(resolveUomVolume({ cubicMetersUnit: 0.001 }, uom({ ...CARTON, cubicMeters: 0.02 }))).toBe(0.02)
  })

  it('inherits factor × the per-unit volume when the UOM has none', () => {
    expect(resolveUomVolume({ cubicMetersUnit: 0.001 }, CARTON)).toBeCloseTo(0.012, 10)
  })

  it('returns undefined — not zero — when nothing is known', () => {
    expect(resolveUomVolume({}, CARTON)).toBeUndefined()
    expect(resolveUomVolume({ cubicMetersUnit: null }, CARTON)).toBeUndefined()
  })

  it('treats an explicit zero as a real answer', () => {
    expect(resolveUomVolume({ cubicMetersUnit: 0.001 }, uom({ ...CARTON, cubicMeters: 0 }))).toBe(0)
  })
})

describe('resolveLineUnitVolume', () => {
  const uoms = [BASE, uom({ ...CARTON, cubicMeters: 0.02 }), PALLET]

  it('resolves the chosen UOM by id', () => {
    expect(resolveLineUnitVolume({ uoms, uomId: 2, packSize: 12, cubicMetersUnit: 0.001 })).toBe(0.02)
  })

  it('falls back to the pack factor for legacy lines with no uomId', () => {
    expect(resolveLineUnitVolume({ uoms, packSize: 12, cubicMetersUnit: 0.001 })).toBe(0.02)
  })

  it('inherits for a UOM tier with no explicit volume', () => {
    // A pallet of 480 base units at 0.001 m³ each.
    expect(resolveLineUnitVolume({ uoms, uomId: 3, packSize: 480, cubicMetersUnit: 0.001 })).toBeCloseTo(0.48, 10)
  })

  it('uses the per-unit volume for a base-unit line', () => {
    expect(resolveLineUnitVolume({ uoms, uomId: 1, cubicMetersUnit: 0.001 })).toBe(0.001)
  })

  it('still honours the legacy per-carton column when the UOM carries no volume', () => {
    // Pre-00069 product: carton_size 12 with cubic_meters_carton set, and a
    // carton UOM the backfill did not reach.
    expect(resolveLineUnitVolume({
      uoms: [BASE, CARTON], uomId: 2, packSize: 12,
      cartonSize: 12, cubicMetersCarton: 0.019, cubicMetersUnit: 0.001,
    })).toBe(0.019)
  })

  it('works with no UOM list at all (pre-migration read)', () => {
    expect(resolveLineUnitVolume({ packSize: 6, cubicMetersUnit: 0.002 })).toBeCloseTo(0.012, 10)
    expect(resolveLineUnitVolume({ cubicMetersUnit: 0.002 })).toBe(0.002)
  })

  it('returns undefined when the product has no volume data', () => {
    expect(resolveLineUnitVolume({ uoms, uomId: 3, packSize: 480 })).toBeUndefined()
  })
})

describe('totalLineVolume', () => {
  const uoms = [BASE, uom({ ...CARTON, cubicMeters: 0.02 })]

  it('sums each line at its own UOM volume', () => {
    const total = totalLineVolume([
      { uoms, uomId: 2, packSize: 12, quantity: 3, cubicMetersUnit: 0.001 },
      { uoms, uomId: 1, quantity: 5, cubicMetersUnit: 0.001 },
    ])
    expect(total).toBeCloseTo(0.065, 10)
  })

  it('skips lines with unknown volume instead of counting them as zero-length', () => {
    const total = totalLineVolume([
      { uoms, uomId: 2, packSize: 12, quantity: 2, cubicMetersUnit: 0.001 },
      { quantity: 100 },
    ])
    expect(total).toBeCloseTo(0.04, 10)
  })
})

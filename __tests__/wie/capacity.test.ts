import { describe, it, expect } from 'vitest'
import {
  capacityUnitLabel,
  isUnitLoad,
  positionsRequired,
  positionsUsed,
} from '../../supabase/functions/_shared/wie/capacity'
import type { OccupancyRow } from '../../supabase/functions/_shared/wie/capacity'

function row(o: Partial<OccupancyRow> = {}): OccupancyRow {
  return { onHand: 10, sizeFactor: 1, huId: 1, huType: 'pallet', ...o }
}

describe('isUnitLoad', () => {
  it('is true only for a pallet plate in a pallet-denominated bin', () => {
    expect(isUnitLoad('pallet', 'pallet')).toBe(true)
    expect(isUnitLoad('pallet', 'carton')).toBe(false)
    expect(isUnitLoad('carton', 'pallet')).toBe(false)
    expect(isUnitLoad('carton', 'carton')).toBe(false)
    expect(isUnitLoad('pallet', null)).toBe(false)
    expect(isUnitLoad(null, 'pallet')).toBe(false)
  })
})

describe('positionsUsed', () => {
  it('counts one position per pallet however much is on it', () => {
    // The WIE-DEMO bug: 130 units on one pallet read as 130 slots of 10.
    expect(positionsUsed('pallet', [row({ onHand: 130 })])).toBe(1)
  })

  it('counts a mixed-SKU pallet once, not once per line', () => {
    const mixed = [
      row({ huId: 7, onHand: 40 }),
      row({ huId: 7, onHand: 25, sizeFactor: 2 }),
      row({ huId: 7, onHand: 5 }),
    ]
    expect(positionsUsed('pallet', mixed)).toBe(1)
  })

  it('counts distinct pallets separately', () => {
    expect(positionsUsed('pallet', [row({ huId: 1 }), row({ huId: 2 }), row({ huId: 3 })])).toBe(3)
  })

  it('leaves a carton-denominated bin on the old arithmetic', () => {
    // MAIN is entirely carton — this is the no-regression case.
    const rows = [row({ huType: 'carton', onHand: 46 }), row({ huId: 2, huType: 'carton', onHand: 12 })]
    expect(positionsUsed('carton', rows)).toBe(58)
  })

  it('falls back to unit maths for loose stock in a pallet bin', () => {
    expect(positionsUsed('pallet', [row({ huId: null, huType: null, onHand: 20 })])).toBe(20)
  })

  it('falls back to unit maths for a pallet flagged without a plate id', () => {
    // No id ⇒ two rows cannot be proven to be the same physical object.
    expect(positionsUsed('pallet', [row({ huId: null, onHand: 3 }), row({ huId: null, onHand: 4 })])).toBe(7)
  })

  it('counts a carton plate sitting in a pallet bin by its units', () => {
    expect(positionsUsed('pallet', [row({ huType: 'carton', onHand: 6, sizeFactor: 2 })])).toBe(12)
  })

  it('mixes unit loads and loose stock in the same bin', () => {
    const rows = [row({ huId: 1, onHand: 130 }), row({ huId: null, huType: null, onHand: 4 })]
    expect(positionsUsed('pallet', rows)).toBe(5)
  })

  it('applies size_factor and treats a missing one as 1', () => {
    expect(positionsUsed('carton', [row({ huType: 'carton', onHand: 5, sizeFactor: 3 })])).toBe(15)
    expect(positionsUsed(null, [row({ huType: null, huId: null, onHand: 5, sizeFactor: 0 })])).toBe(5)
  })

  it('is 0 for an empty bin', () => {
    expect(positionsUsed('pallet', [])).toBe(0)
  })
})

describe('positionsRequired', () => {
  it('charges one position for a pallet into a pallet bin', () => {
    expect(positionsRequired('pallet', 200, 1, 'pallet')).toBe(1)
    expect(positionsRequired('pallet', 1, 4, 'pallet')).toBe(1)
  })

  it('charges quantity × size_factor everywhere else', () => {
    expect(positionsRequired('carton', 20, 1, 'pallet')).toBe(20)
    expect(positionsRequired('carton', 20, 2, 'carton')).toBe(40)
    expect(positionsRequired('pallet', 20, 1, null)).toBe(20)
    expect(positionsRequired(null, 20, 1, 'pallet')).toBe(20)
  })
})

describe('capacityUnitLabel', () => {
  it('names pallet bins in positions and everything else in slots', () => {
    expect(capacityUnitLabel('pallet')).toBe('positions')
    expect(capacityUnitLabel('pallet', false)).toBe('position')
    expect(capacityUnitLabel('carton')).toBe('slots')
    expect(capacityUnitLabel(null, false)).toBe('slot')
  })
})

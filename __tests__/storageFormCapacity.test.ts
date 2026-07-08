import { describe, it, expect } from 'vitest'
import { deriveCapacitySlots, capacityModeOf } from '../lib/storageFormCapacity'

describe('deriveCapacitySlots', () => {
  it('structured: multiplies levels × positions', () => {
    expect(deriveCapacitySlots({ mode: 'structured', levels: 5, positionsPerLevel: 2 })).toBe(10)
  })

  it('structured: null unless BOTH levels and positions are positive', () => {
    expect(deriveCapacitySlots({ mode: 'structured', levels: 5, positionsPerLevel: 0 })).toBeNull()
    expect(deriveCapacitySlots({ mode: 'structured', levels: null, positionsPerLevel: 2 })).toBeNull()
    expect(deriveCapacitySlots({ mode: 'structured' })).toBeNull()
  })

  it('flat: returns the manual count', () => {
    expect(deriveCapacitySlots({ mode: 'flat', flatSlots: 40 })).toBe(40)
    expect(deriveCapacitySlots({ mode: 'flat', flatSlots: 0 })).toBe(0)
  })

  it('flat: null when unset', () => {
    expect(deriveCapacitySlots({ mode: 'flat' })).toBeNull()
    expect(deriveCapacitySlots({ mode: 'flat', flatSlots: null })).toBeNull()
  })

  it('flat mode ignores levels/positions', () => {
    expect(deriveCapacitySlots({ mode: 'flat', levels: 5, positionsPerLevel: 2, flatSlots: 7 })).toBe(7)
  })
})

describe('capacityModeOf', () => {
  it('is structured when the form has levels & positions', () => {
    expect(capacityModeOf({ levels: 5, positionsPerLevel: 2 })).toBe('structured')
  })

  it('is flat when either is missing', () => {
    expect(capacityModeOf({ levels: null, positionsPerLevel: null })).toBe('flat')
    expect(capacityModeOf({ levels: 5, positionsPerLevel: null })).toBe('flat')
    expect(capacityModeOf({})).toBe('flat')
  })
})

import { describe, it, expect } from 'vitest'
import {
  locationMixRefusal,
  type LocationMixInput,
  type LocationOccupant,
} from '../../supabase/functions/_shared/wie/locationMix'

// Made-up products only. Product 1 (TST-CHL-200, brand TESTCO) is being put
// away; its home is location 20 (TST-A-01-2).
const occ = (o: Partial<LocationOccupant> = {}): LocationOccupant => ({
  productId: 2, sku: 'TST-GRK-100', name: 'Test Goraka 100g', brand: 'TESTCO', handlingUnitId: null, ...o,
})

const input = (o: Partial<LocationMixInput> = {}): LocationMixInput => ({
  product: { productId: 1, brand: 'TESTCO', homeLocationId: 20, homeCode: 'TST-A-01-2' },
  location: { locationId: 30, code: 'TST-B-02-1', isHold: false },
  occupants: [],
  homedAtLocation: new Set<number>(),
  ownHandlingUnitId: null,
  ...o,
})

describe('locationMixRefusal', () => {
  it('refuses a bin holding another product', () => {
    expect(locationMixRefusal(input({ occupants: [occ()] }))).toBe(
      'TST-B-02-1 already holds TST-GRK-100 (Test Goraka 100g). Put this in an empty location or its home TST-A-01-2.',
    )
    // A product with no home is only pointed at an empty location.
    expect(locationMixRefusal(input({
      product: { productId: 1, brand: 'TESTCO', homeLocationId: null, homeCode: null },
      occupants: [occ()],
    }))).toBe('TST-B-02-1 already holds TST-GRK-100 (Test Goraka 100g). Put this in an empty location.')
    // Its own home is refused too when a stray product sits in it.
    expect(locationMixRefusal(input({
      location: { locationId: 20, code: 'TST-A-01-2', isHold: false },
      occupants: [occ({ productId: 9, sku: 'TST-OTHER', name: 'Other', brand: 'OTHERCO' })],
    }))).toContain('TST-A-01-2 already holds TST-OTHER')
  })

  it('allows an empty bin and a bin holding only this product', () => {
    expect(locationMixRefusal(input())).toBeNull()
    expect(locationMixRefusal(input({ occupants: [occ({ productId: 1, sku: 'TST-CHL-200' })] }))).toBeNull()
  })

  it('allows a shared home of same-brand homed products', () => {
    const shared = input({
      location: { locationId: 20, code: 'TST-A-01-2', isHold: false },
      occupants: [occ(), occ({ productId: 3, sku: 'TST-CHL-500', name: 'Test Chilli 500g', brand: ' testco ' })],
      homedAtLocation: new Set([1, 2, 3]),
    })
    expect(locationMixRefusal(shared)).toBeNull()
    // Not homed there: refused, even though the brand matches.
    expect(locationMixRefusal({ ...shared, homedAtLocation: new Set([1, 2]) })).toContain('already holds TST-CHL-500')
    // Homed there but not this product's home: refused.
    expect(locationMixRefusal({
      ...shared,
      product: { ...shared.product, homeLocationId: 99, homeCode: 'TST-Z-09-1' },
    })).toContain('already holds TST-GRK-100')
    // Another brand homed there: refused.
    expect(locationMixRefusal({
      ...shared,
      occupants: [occ({ brand: 'OTHERCO' })],
    })).toContain('already holds TST-GRK-100')
  })

  it('a blank brand never matches', () => {
    const base = input({
      location: { locationId: 20, code: 'TST-A-01-2', isHold: false },
      homedAtLocation: new Set([1, 2]),
    })
    expect(locationMixRefusal({ ...base, occupants: [occ({ brand: null })] })).toContain('already holds')
    expect(locationMixRefusal({ ...base, occupants: [occ({ brand: '  ' })] })).toContain('already holds')
    expect(locationMixRefusal({
      ...base,
      product: { ...base.product, brand: null },
      occupants: [occ({ brand: null })],
    })).toContain('already holds')
  })

  it("another product's open line assigned to the bin counts, the plate's own lines do not", () => {
    // An open line of another product already headed for the bin is an occupant
    // (the caller passes it in like stock). One on THIS line's own plate is the
    // same mixed pallet going to the same place, so it does not block.
    expect(locationMixRefusal(input({ occupants: [occ({ handlingUnitId: 500 })] }))).toContain('already holds')
    expect(locationMixRefusal(input({
      occupants: [occ({ handlingUnitId: 500 })],
      ownHandlingUnitId: 500,
    }))).toBeNull()
  })

  it('a hold location is never refused', () => {
    expect(locationMixRefusal(input({
      location: { locationId: 40, code: 'TST-HOLD-1', isHold: true },
      occupants: [occ({ brand: 'OTHERCO' })],
    }))).toBeNull()
  })

  it('names the lowest product id first, so the words are stable', () => {
    expect(locationMixRefusal(input({
      occupants: [occ({ productId: 8, sku: 'TST-H' }), occ({ productId: 4, sku: 'TST-D' })],
    }))).toContain('already holds TST-D')
  })
})

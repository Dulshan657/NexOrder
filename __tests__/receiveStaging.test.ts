// Scan-to-count at the dock (NX-0005). A delivery of twenty cartons of one SKU
// used to be twenty rows with empty quantities; it is now one row reading 20.
// These rules live in a pure module so the reducer, the scan path and the
// search pick all agree on what "the same product again" means.

import { describe, expect, it } from 'vitest'
import {
  emptyStaging,
  scanUomFor,
  stageProduct,
  type StagingState,
} from '@/components/inventory/receive/stageProduct'
import { newMixedPlate } from '@/components/inventory/receive/receiveDraft'
import type { Product, ProductUom } from '@/types'

function uom(overrides: Partial<ProductUom>): ProductUom {
  return {
    id: 1, productId: 1, code: 'each', factorToBase: 1, isBase: true, price: 1,
    isOrderable: true, isReceivable: true, sortOrder: 0,
    ...overrides,
  }
}

function product(id: number, uoms?: ProductUom[]): Product {
  return {
    id, sku: `SKU-${id}`, name: `Product ${id}`, description: '', price: 1,
    category: 'Other', inventory: 0, available: 0, unit: 'each', cartonSize: 1,
    supplierId: 1, uoms,
  } as Product
}

const withCarton = product(1, [
  uom({ id: 11, productId: 1, code: 'each', isBase: true }),
  uom({ id: 12, productId: 1, code: 'carton', factorToBase: 12, isBase: false, sortOrder: 1 }),
  uom({ id: 13, productId: 1, code: 'pallet', factorToBase: 480, isBase: false, sortOrder: 2 }),
])
const plain = product(2)

const scan = (state: StagingState, p: Product, quarantine = false) =>
  stageProduct(state, p, { quarantine }).state

describe('stageProduct', () => {
  it('a repeat scan of the same product adds one to its line', () => {
    let state = scan(emptyStaging(), withCarton)
    state = scan(state, withCarton)
    state = scan(state, withCarton)

    expect(state.lines).toHaveLength(1)
    expect(state.lines[0].quantity).toBe('3')
    expect(state.plates).toHaveLength(1)
  })

  it('a first scan stages one carton on a carton plate', () => {
    const state = scan(emptyStaging(), withCarton)

    expect(state.lines).toHaveLength(1)
    expect(state.lines[0].quantity).toBe('1')
    expect(state.lines[0].uomId).toBe(12)
    expect(state.plates[0].huType).toBe('carton')
    expect(state.lines[0].plateKey).toBe(state.plates[0].key)
  })

  it('falls back to the base unit when the product has no carton unit', () => {
    const state = scan(emptyStaging(), plain)
    expect(state.lines[0].uomId).toBeNull()
    expect(state.lines[0].quantity).toBe('1')
  })

  it('after New pallet the next scan starts its own pallet and repeats count on it', () => {
    let state = scan(emptyStaging(), withCarton)
    state = scan(state, withCarton)
    state = { ...state, forceNewPallet: true }
    state = scan(state, withCarton)
    state = scan(state, withCarton)
    state = scan(state, withCarton)

    expect(state.lines).toHaveLength(2)
    expect(state.lines.map((l) => l.quantity)).toEqual(['2', '3'])
    expect(state.plates.map((p) => p.huType)).toEqual(['carton', 'pallet'])
    expect(state.lines[1].plateKey).toBe(state.plates[1].key)
    // The flag is consumed by the scan it was pressed for.
    expect(state.forceNewPallet).toBe(false)
  })

  it('an open mixed pallet captures scans and counts repeats', () => {
    const mixed = newMixedPlate()
    let state: StagingState = { ...emptyStaging(), plates: [mixed], activeGroupKey: mixed.key }
    state = scan(state, withCarton)
    state = scan(state, plain)
    state = scan(state, withCarton)

    expect(state.plates).toHaveLength(1)
    expect(state.lines).toHaveLength(2)
    expect(state.lines.every((l) => l.plateKey === mixed.key)).toBe(true)
    expect(state.lines.find((l) => l.productId === withCarton.id)!.quantity).toBe('2')
  })

  it('a loose line does not absorb a scan meant for an open mixed pallet', () => {
    let state = scan(emptyStaging(), withCarton)
    const mixed = newMixedPlate()
    state = { ...state, plates: [...state.plates, mixed], activeGroupKey: mixed.key }
    state = scan(state, withCarton)

    expect(state.lines).toHaveLength(2)
    expect(state.lines[0].quantity).toBe('1')
    expect(state.lines[1].plateKey).toBe(mixed.key)
  })

  it('counts on from whatever the operator typed', () => {
    let state = scan(emptyStaging(), plain)
    state = { ...state, lines: state.lines.map((l) => ({ ...l, quantity: '10' })) }
    state = scan(state, plain)
    expect(state.lines[0].quantity).toBe('11')
  })

  it('inherits the delivery quarantine flag on a new line', () => {
    const state = scan(emptyStaging(), plain, true)
    expect(state.lines[0].quarantine).toBe(true)
  })

  it('never mutates the state it was given', () => {
    const before = scan(emptyStaging(), plain)
    const frozenLines = JSON.stringify(before.lines)
    const frozenPlates = JSON.stringify(before.plates)
    scan(before, plain)
    scan(before, withCarton)
    expect(JSON.stringify(before.lines)).toBe(frozenLines)
    expect(JSON.stringify(before.plates)).toBe(frozenPlates)
  })

  it('reports which line it touched, so the screen can flash it', () => {
    const first = stageProduct(emptyStaging(), plain, { quarantine: false })
    const second = stageProduct(first.state, plain, { quarantine: false })
    expect(second.touchedLineKey).toBe(first.state.lines[0].key)
  })
})

describe('scanUomFor', () => {
  it('prefers a carton-like unit and ignores the derived, id-less defaults', () => {
    expect(scanUomFor(withCarton)?.id).toBe(12)
    // cartonSize 12 but no unit rows: the derived carton has id 0 and cannot be
    // submitted as a uom_id, so a scan counts the base unit.
    expect(scanUomFor({ ...plain, cartonSize: 12 } as Product)).toBeNull()
  })

  it('does not treat a pallet as the unit a single scan counts', () => {
    const palletOnly = product(3, [
      uom({ id: 31, productId: 3, code: 'each', isBase: true }),
      uom({ id: 32, productId: 3, code: 'pallet', factorToBase: 480, isBase: false, sortOrder: 1 }),
    ])
    expect(scanUomFor(palletOnly)).toBeNull()
  })
})

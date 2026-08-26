/**
 * Pallet break-down at putaway — the allocation rules.
 *
 * Covers the shared planner (supabase/functions/_shared/palletBreakdown.ts),
 * which `break-down-putaway` executes and PalletBreakdownSheet previews, plus
 * the browser-only entry helpers in lib/palletBreakdown.ts. Same split, and the
 * same reason, as binCount: the sheet's live totals and refusals ARE the
 * server's decision, evaluated early, so they are tested once.
 */
import { describe, it, expect } from 'vitest'
import {
  huTypeForUnit,
  planBreakdown,
  COUNTED_UNITS,
  type BreakdownPortionInput,
} from '@/supabase/functions/_shared/palletBreakdown'
import {
  layerBaseQty,
  parsePortionCount,
  unitLabel,
} from '@/lib/palletBreakdown'

const portion = (over: Partial<BreakdownPortionInput> = {}): BreakdownPortionInput => ({
  baseQty: 12,
  countedUnit: 'carton',
  locationId: 501,
  ...over,
})

describe('huTypeForUnit', () => {
  it('maps a pallet or a layer onto a pallet plate', () => {
    expect(huTypeForUnit('pallet')).toBe('pallet')
    expect(huTypeForUnit('layer')).toBe('pallet')
  })

  it('maps cartons and loose units onto a carton plate', () => {
    expect(huTypeForUnit('carton')).toBe('carton')
    expect(huTypeForUnit('base')).toBe('carton')
  })

  it('covers every unit the UI can offer', () => {
    for (const unit of COUNTED_UNITS) {
      expect(['pallet', 'carton']).toContain(huTypeForUnit(unit))
    }
  })
})

describe('planBreakdown', () => {
  it('allocates portions and leaves the rest on the parent', () => {
    const plan = planBreakdown({
      parentQty: 480,
      portions: [portion({ baseQty: 72 }), portion({ baseQty: 120, locationId: 502 })],
    })
    expect(plan.ok).toBe(true)
    expect(plan.allocated).toBe(192)
    expect(plan.remainder).toBe(288)
    expect(plan.parentEmptied).toBe(false)
    expect(plan.portions.map((p) => p.huType)).toEqual(['carton', 'carton'])
  })

  it('derives the plate type per portion from the unit it was counted in', () => {
    const plan = planBreakdown({
      parentQty: 480,
      portions: [
        portion({ baseQty: 240, countedUnit: 'layer' }),
        portion({ baseQty: 24, countedUnit: 'base', locationId: 502 }),
      ],
    })
    expect(plan.portions.map((p) => p.huType)).toEqual(['pallet', 'carton'])
  })

  it('allows the whole pallet to be allocated away', () => {
    const plan = planBreakdown({
      parentQty: 480,
      portions: [portion({ baseQty: 240 }), portion({ baseQty: 240, locationId: 502 })],
    })
    expect(plan.ok).toBe(true)
    expect(plan.remainder).toBe(0)
    expect(plan.parentEmptied).toBe(true)
  })

  it('refuses more than the pallet holds, and says by how much', () => {
    const plan = planBreakdown({
      parentQty: 480,
      portions: [portion({ baseQty: 300 }), portion({ baseQty: 300, locationId: 502 })],
    })
    expect(plan.ok).toBe(false)
    expect(plan.reason).toBe('over_allocated')
    expect(plan.remainder).toBe(-120)
    // Never clamped to zero: the operator has to see the overshoot to fix it.
    expect(plan.message).toContain('120')
  })

  it('refuses a portion with no destination', () => {
    const plan = planBreakdown({
      parentQty: 480,
      portions: [portion({ locationId: null })],
    })
    expect(plan.ok).toBe(false)
    expect(plan.reason).toBe('portion_invalid')
    expect(plan.portions[0].refusal).toBe('no_destination')
  })

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])('refuses a quantity of %s', (baseQty) => {
    const plan = planBreakdown({ parentQty: 480, portions: [portion({ baseQty })] })
    expect(plan.ok).toBe(false)
    expect(plan.portions[0].refusal).toBeTruthy()
  })

  it('refuses an empty sheet rather than committing nothing', () => {
    const plan = planBreakdown({ parentQty: 480, portions: [] })
    expect(plan.ok).toBe(false)
    expect(plan.reason).toBe('nothing_allocated')
  })

  it('reports every offending portion, not just the first', () => {
    const plan = planBreakdown({
      parentQty: 480,
      portions: [portion({ baseQty: 0 }), portion({ locationId: null }), portion({ baseQty: 12 })],
    })
    expect(plan.portions.map((p) => p.refusal)).toEqual(['non_positive', 'no_destination', null])
  })

  it('is exact on the ledger scale rather than trusting float subtraction', () => {
    // NUMERIC(14,3): three decimals is the finest the ledger stores.
    const plan = planBreakdown({
      parentQty: 10,
      portions: [portion({ baseQty: 0.1 }), portion({ baseQty: 0.2, locationId: 502 })],
    })
    expect(plan.allocated).toBe(0.3)
    expect(plan.remainder).toBe(9.7)
  })
})

describe('lib/palletBreakdown entry helpers', () => {
  it('treats a blank count as nothing typed, never as zero', () => {
    expect(parsePortionCount('')).toBeNull()
    expect(parsePortionCount('   ')).toBeNull()
  })

  it('rejects text that is present but unusable', () => {
    expect(parsePortionCount('two')).toBeUndefined()
    expect(parsePortionCount('-3')).toBeUndefined()
  })

  it('accepts whole and fractional counts', () => {
    expect(parsePortionCount('4')).toBe(4)
    expect(parsePortionCount('1.5')).toBe(1.5)
  })

  it('converts layers through cartons-per-layer', () => {
    expect(layerBaseQty(2, { perLayer: 5, unitsPerCarton: 12 })).toBe(120)
  })

  it('has no layer quantity without a pallet fit', () => {
    expect(layerBaseQty(2, null)).toBeNull()
  })

  it('names each unit for the picker', () => {
    expect(unitLabel('layer')).toBe('layers')
    expect(unitLabel('base', 'jar')).toBe('jars')
  })
})

import { describe, expect, it } from 'vitest'
import { homeTargetCopy, isOverflowConfirmStop, overflowConfirmCopy, walkBinId } from '@/components/inventory/putaway/walkStops'

// NX-0033: a Walk stop is either an assigned line or a loose overflow line (its
// home was full) still waiting for someone to confirm the bin. These two pure
// readings are shared by the Walk list, the collapsed badge and the stop card,
// and they restate the SQL predicate of wie_putaway_stops / getWalkPutaways.

const overflow = { status: 'suggested', suggestionSource: 'overflow', recommendedLocationId: 5002 } as const

describe('isOverflowConfirmStop', () => {
  it('is true only for a suggested overflow line with a bin', () => {
    expect(isOverflowConfirmStop(overflow)).toBe(true)
  })

  it('is false once the line is assigned, even if it began as overflow', () => {
    expect(isOverflowConfirmStop({ ...overflow, status: 'assigned' })).toBe(false)
  })

  it('is false for a suggested line that is not overflow', () => {
    for (const suggestionSource of ['home', 'engine', 'desk', null, undefined] as const) {
      expect(isOverflowConfirmStop({ ...overflow, suggestionSource })).toBe(false)
    }
  })

  it('is false for a suggested overflow line with no bin to confirm', () => {
    expect(isOverflowConfirmStop({ ...overflow, recommendedLocationId: null })).toBe(false)
  })

  it('is false for a single-product pallet: a unit load never waits for confirmation (C5)', () => {
    // A pallet of a homed product is tagged overflow by the planner and can come
    // back to 'suggested' when the walker puts it back on the queue.
    expect(isOverflowConfirmStop({ ...overflow, unitLoad: true })).toBe(false)
    expect(isOverflowConfirmStop({ ...overflow, unitLoad: false })).toBe(true)
  })
})

describe('walkBinId', () => {
  it('is the assigned bin, else the suggested one', () => {
    expect(walkBinId({ assignedLocationId: 205, recommendedLocationId: 100 })).toBe(205)
    expect(walkBinId({ assignedLocationId: null, recommendedLocationId: 5002 })).toBe(5002)
  })

  it('is null when the line has neither', () => {
    expect(walkBinId({ assignedLocationId: null, recommendedLocationId: null })).toBeNull()
  })
})

describe('overflowConfirmCopy', () => {
  it('is the plan copy table, verbatim, with the bin code filled in', () => {
    expect(overflowConfirmCopy('TST-WALK-O1')).toEqual({
      heading: 'Home full — put in TST-WALK-O1?',
      scanLabel: 'Scan TST-WALK-O1 to confirm',
      helper: 'Scanning this bin confirms it. The desk can choose another bin instead.',
      wrongBin: 'Scan TST-WALK-O1 to confirm this overflow bin, or leave it for the desk to choose another.',
      confirmed: 'Confirmed — put it in TST-WALK-O1',
    })
  })
})

describe('homeTargetCopy', () => {
  it('is the plan copy table, verbatim, with the bin and the product filled in', () => {
    const copy = homeTargetCopy('TST-WALK-N1', 'TST-WALK-200')
    expect(copy.scanLabel).toBe('Scan TST-WALK-N1 — it becomes the home bin')
    expect(copy.wrongBin).toBe('Scan TST-WALK-N1, the bin you chose as its home.')
    expect(copy.placedAndSet('TST-WALK-N1')).toBe("Placed in TST-WALK-N1 — it is now TST-WALK-200's home bin")
    expect(copy.placedNotSet('TST-WALK-N1')).toBe('Placed in TST-WALK-N1 — someone set a home for TST-WALK-200 meanwhile')
  })
})

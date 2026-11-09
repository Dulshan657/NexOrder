import { describe, expect, it } from 'vitest'
import { isOverflowConfirmStop, walkBinId } from '@/components/inventory/putaway/walkStops'

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

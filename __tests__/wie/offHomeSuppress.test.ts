import { describe, it, expect } from 'vitest'
import {
  binKey,
  dismissalHighWater,
  shouldRaise,
} from '../../supabase/functions/_shared/wie/offHomeSuppress'

// The off-home queue's dismissal rule. Both bugs fixed on this feature so far
// were found by driving the lifecycle in a browser rather than by reading the
// code, and the second one was the suppression failing to stick. These pin the
// decision itself so the next change to it has to say so out loud.

describe('binKey', () => {
  it('is the (product, bin) pair and tolerates string ids from PostgREST', () => {
    expect(binKey(68, 518)).toBe('68:518')
    expect(binKey('68', '518')).toBe(binKey(68, 518))
  })
})

describe('dismissalHighWater', () => {
  it('is empty when nothing has been dismissed', () => {
    expect(dismissalHighWater([]).size).toBe(0)
  })

  it('keeps the LARGEST quantity refused for a bin, not the latest', () => {
    // The operator declined 120 units, then later declined 40. The pile they
    // actually refused is 120; taking the latest would re-raise the other 80.
    const map = dismissalHighWater([
      { product_id: 68, from_location_id: 518, quantity: 120 },
      { product_id: 68, from_location_id: 518, quantity: 40 },
    ])
    expect(map.get('68:518')).toBe(120)
  })

  it('keeps bins and products apart', () => {
    const map = dismissalHighWater([
      { product_id: 68, from_location_id: 518, quantity: 120 },
      { product_id: 68, from_location_id: 520, quantity: 5 },
      { product_id: 71, from_location_id: 518, quantity: 9 },
    ])
    expect(map.get('68:518')).toBe(120)
    expect(map.get('68:520')).toBe(5)
    expect(map.get('71:518')).toBe(9)
  })

  it('reads numeric columns that arrive as strings', () => {
    // quantity is NUMERIC(14,3); PostgREST hands it over as a string.
    const map = dismissalHighWater([
      { product_id: '68', from_location_id: '518', quantity: '120.000' },
    ])
    expect(map.get('68:518')).toBe(120)
  })

  it('ignores an unparseable quantity rather than poisoning the bin with NaN', () => {
    const map = dismissalHighWater([
      { product_id: 68, from_location_id: 518, quantity: 120 },
      { product_id: 68, from_location_id: 518, quantity: 'not a number' },
    ])
    expect(map.get('68:518')).toBe(120)
  })
})

describe('shouldRaise', () => {
  it('raises when nothing has been dismissed for the bin', () => {
    expect(shouldRaise(120, undefined)).toBe(true)
  })

  it('stays silent at the same quantity — that is the situation already refused', () => {
    expect(shouldRaise(120, 120)).toBe(false)
  })

  it('stays silent below it: some of the pile left, the rest is still refused', () => {
    expect(shouldRaise(80, 120)).toBe(false)
  })

  it('raises on one more unit — more stock is a NEW situation', () => {
    expect(shouldRaise(121, 120)).toBe(true)
  })

  it('raises again once a restore has expired the dismissal', () => {
    // A restore does not rewrite this rule; it moves the rows to `expired`, so
    // they fall out of the `status = 'dismissed'` query that feeds the fold and
    // the bin is simply undismissed again. This is the escape hatch, asserted
    // end to end at the level the pure module can see it.
    const before = dismissalHighWater([
      { product_id: 68, from_location_id: 518, quantity: 120 },
    ])
    expect(shouldRaise(120, before.get(binKey(68, 518)))).toBe(false)

    const after = dismissalHighWater([]) // the rows are now 'expired'
    expect(shouldRaise(120, after.get(binKey(68, 518)))).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'

import { eligibleForOrderValue } from '../supabase/functions/_shared/promotionMinimum'

describe('eligibleForOrderValue', () => {
  it('keeps a promotion with no minimum and one that is met, and drops one that is not', () => {
    const none = { id: 'none' }
    const empty = { id: 'empty', minOrderValue: null }
    const zero = { id: 'zero', minOrderValue: 0 }
    const met = { id: 'met', minOrderValue: 100 }
    const missed = { id: 'missed', minOrderValue: 100.01 }

    expect(eligibleForOrderValue<{ id: string; minOrderValue?: number | null }>([none, empty, zero, met, missed], 100)).toEqual([none, empty, zero, met])
  })

  it('measures in cents, so floating point cannot miss a minimum that was met', () => {
    expect(0.1 + 0.2 < 0.3).toBe(false)
    expect(eligibleForOrderValue([{ minOrderValue: 0.3 }], 0.1 + 0.2)).toHaveLength(1)
    expect(eligibleForOrderValue([{ minOrderValue: 200 }], 199.999999)).toHaveLength(1)
    expect(eligibleForOrderValue([{ minOrderValue: 200 }], 199.99)).toHaveLength(0)
  })
})

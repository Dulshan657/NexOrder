import { describe, expect, it } from 'vitest'

import { canSeeProductPricing } from '../lib/canSeeProductPricing'
import { canSeeOrderValue } from '../lib/canSeeOrderValue'
import { UserRole } from '../types'

describe('canSeeProductPricing', () => {
  it('withholds sell price and supplier cost from warehouse staff', () => {
    expect(canSeeProductPricing(UserRole.WAREHOUSE)).toBe(false)
  })

  it('shows them to every other role', () => {
    for (const role of Object.values(UserRole)) {
      if (role === UserRole.WAREHOUSE) continue
      expect(canSeeProductPricing(role), role).toBe(true)
    }
  })

  it('defaults to showing when the role is unknown', () => {
    // A display rule that failed closed would hide data from any role nobody
    // has classified yet, which is a worse default than showing a figure to
    // someone who was going to be allowed it anyway.
    expect(canSeeProductPricing(undefined)).toBe(true)
    expect(canSeeProductPricing(null)).toBe(true)
    expect(canSeeProductPricing('Something New')).toBe(true)
  })

  it('is a separate decision from order value, not an alias of it', () => {
    // They agree today because there is one role to withhold from, which is a
    // coincidence rather than a shared rule — the two answer different
    // questions about different objects. This test exists to fail loudly if
    // someone folds one into the other and a later change to "let Warehouse
    // reconcile goods-in against cost" silently moves every order screen too.
    expect(canSeeProductPricing).not.toBe(canSeeOrderValue)
  })
})

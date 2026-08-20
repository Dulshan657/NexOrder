import { describe, expect, it } from 'vitest'

import { canSeeOrderValue } from '../lib/canSeeOrderValue'
import { UserRole } from '../types'

describe('canSeeOrderValue', () => {
  it('withholds order value from warehouse staff', () => {
    expect(canSeeOrderValue(UserRole.WAREHOUSE)).toBe(false)
  })

  it('shows it to every other role', () => {
    for (const role of Object.values(UserRole)) {
      if (role === UserRole.WAREHOUSE) continue
      expect(canSeeOrderValue(role), role).toBe(true)
    }
  })

  it('defaults to showing when the role is unknown', () => {
    // An unknown role reaching a money column is a bug elsewhere; blanking the
    // figure would hide that bug behind something that looks intentional.
    expect(canSeeOrderValue(undefined)).toBe(true)
    expect(canSeeOrderValue(null)).toBe(true)
    expect(canSeeOrderValue('Something New')).toBe(true)
  })
})

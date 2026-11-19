// NX-0041 A3. A dashboard link is clickable only when the role can open the tab
// in this build; AdminView renders a blank page for anything else.

import { describe, expect, it, vi } from 'vitest'
import { dashNavFor } from '@/hooks/useDashNav'

describe('useDashNav', () => {
  it('withholds a tab the role cannot open', () => {
    const navigate = vi.fn()
    // Managers have no Users tab; reps have no admin tabs at all.
    expect(dashNavFor('Manager', navigate)('Users')).toBeUndefined()
    expect(dashNavFor('Field Sales Rep', navigate)('Products')).toBeUndefined()
  })

  it('returns a handler that navigates to a tab the role can open', () => {
    const navigate = vi.fn()
    const handler = dashNavFor('Admin', navigate)('Products')
    expect(handler).toBeTypeOf('function')
    handler!()
    expect(navigate).toHaveBeenCalledWith('Products')
  })

  it('withholds everything when there is no navigate callback', () => {
    expect(dashNavFor('Admin', undefined)('Products')).toBeUndefined()
  })
})

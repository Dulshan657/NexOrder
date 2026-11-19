// NX-0043 A4. A Rep dashboard link exists only for a view the sidebar would
// show that rep; AppShell renders nothing for any other.

import { describe, expect, it, vi } from 'vitest'
import { repNavFor } from '@/lib/repDashNav'

describe('repDashNav', () => {
  it('withholds a view the rep cannot open', () => {
    const navigate = vi.fn()
    const officeRep = repNavFor({ isFieldRep: false, canSeeStock: true, isQrStaff: false }, navigate)
    expect(officeRep('scheduled_visits')).toBeUndefined()

    const noStock = repNavFor({ isFieldRep: true, canSeeStock: false, isQrStaff: false }, navigate)
    expect(noStock('stock')).toBeUndefined()
  })

  it('returns a handler for a view the rep can open', () => {
    const navigate = vi.fn()
    const fieldRep = repNavFor({ isFieldRep: true, canSeeStock: true, isQrStaff: false }, navigate)
    fieldRep('scheduled_visits')!()
    fieldRep('orders')!()
    expect(navigate).toHaveBeenNthCalledWith(1, 'scheduled_visits')
    expect(navigate).toHaveBeenNthCalledWith(2, 'orders')
  })

  it('withholds everything without a navigate callback', () => {
    expect(repNavFor({ isFieldRep: true, canSeeStock: true, isQrStaff: false }, undefined)('orders')).toBeUndefined()
  })
})

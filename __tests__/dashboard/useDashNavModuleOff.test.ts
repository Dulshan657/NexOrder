// NX-0041 A3, the module half: a tab whose module is off in this build is
// withheld even from an Admin.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/modules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/modules')>()),
  MODULE_FIELD_OPS: false,
}))

const { dashNavFor } = await import('@/hooks/useDashNav')

describe('useDashNav with field_ops off', () => {
  it('withholds a tab whose module is off', () => {
    const go = dashNavFor('Admin', vi.fn())
    expect(go('HoReCa Insights')).toBeUndefined()
    expect(go('Products')).toBeTypeOf('function')
  })
})

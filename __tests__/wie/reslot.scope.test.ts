import { describe, it, expect } from 'vitest'
import { warehouseStockScope } from '../../supabase/functions/_shared/wie/reslot'

describe('warehouseStockScope', () => {
  it('always includes the warehouse root id', () => {
    // Regression: bulk / not-yet-racked stock lives on the root location, so the
    // re-slot planner must scan the root or it drops every unit ("nothing to put away").
    expect(warehouseStockScope(7, [10, 11, 12])).toContain(7)
  })

  it('includes the root even when there are no descendant bins', () => {
    expect(warehouseStockScope(7, [])).toEqual([7])
  })

  it('de-duplicates when the root is also present among descendants', () => {
    const scope = warehouseStockScope(7, [7, 10])
    expect(scope).toEqual([7, 10])
  })

  it('preserves descendant ids alongside the root', () => {
    expect(warehouseStockScope(1, [2, 3])).toEqual([1, 2, 3])
  })
})

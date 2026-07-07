import { describe, it, expect } from 'vitest'

import { resolveDefaultWarehouse } from '../components/inventory/warehouse/WarehousePage'
import type { Warehouse } from '../types'

function wh(partial: Partial<Warehouse> & { id: number }): Warehouse {
  return {
    id: partial.id,
    code: partial.code ?? `WH${partial.id}`,
    name: partial.name ?? `Warehouse ${partial.id}`,
    locationType: partial.locationType ?? 'bulk',
    activeLayoutId: partial.activeLayoutId,
    isActive: partial.isActive ?? true,
  }
}

const bulk = (id: number) => wh({ id, locationType: 'bulk' })
const racked = (id: number) => wh({ id, locationType: 'racked', activeLayoutId: id * 10 })
const rackedUnpublished = (id: number) => wh({ id, locationType: 'racked', activeLayoutId: undefined })

describe('resolveDefaultWarehouse', () => {
  it('returns null when there are no warehouses', () => {
    expect(resolveDefaultWarehouse([], null, undefined)).toBeNull()
  })

  it('honours the ?wh= deep link even when it points at a bulk site', () => {
    const list = [racked(1), bulk(2)]
    expect(resolveDefaultWarehouse(list, 2, undefined)).toBe(2)
  })

  it('ignores a ?wh= id that is not an active warehouse', () => {
    const list = [racked(1), bulk(2)]
    // 99 does not exist → falls through to first racked+published
    expect(resolveDefaultWarehouse(list, 99, undefined)).toBe(1)
  })

  it('prefers the home warehouse when it is racked+published', () => {
    const list = [bulk(1), racked(2), racked(3)]
    expect(resolveDefaultWarehouse(list, null, 2)).toBe(2)
  })

  it('skips a bulk home warehouse in favour of the first racked+published site', () => {
    const list = [bulk(1), racked(2)]
    expect(resolveDefaultWarehouse(list, null, 1)).toBe(2)
  })

  it('skips a racked-but-unpublished home warehouse in favour of a published one', () => {
    const list = [rackedUnpublished(1), racked(2)]
    expect(resolveDefaultWarehouse(list, null, 1)).toBe(2)
  })

  it('falls back to the (bulk) home warehouse when no site is racked+published', () => {
    const list = [bulk(1), bulk(2)]
    expect(resolveDefaultWarehouse(list, null, 2)).toBe(2)
  })

  it('falls back to the first active warehouse when nothing else matches', () => {
    const list = [bulk(1), bulk(2)]
    expect(resolveDefaultWarehouse(list, null, undefined)).toBe(1)
  })

  it('never returns an inactive warehouse', () => {
    const list = [wh({ id: 1, isActive: false, locationType: 'racked', activeLayoutId: 10 }), bulk(2)]
    // The racked one is inactive → resolver ignores it, first active (bulk 2) wins
    expect(resolveDefaultWarehouse(list, null, undefined)).toBe(2)
    // Even a deep link to the inactive site is rejected
    expect(resolveDefaultWarehouse(list, 1, undefined)).toBe(2)
  })
})

import { describe, it, expect } from 'vitest'

import { resolvePutawayWarehouse } from '../components/inventory/putawayWarehouse'

const wh = (id: number) => ({ id })

describe('resolvePutawayWarehouse', () => {
  it('returns null when there are no active warehouses', () => {
    expect(
      resolvePutawayWarehouse({ deepLinkId: null, homeWarehouseId: undefined, counts: {}, activeWarehouses: [] }),
    ).toBeNull()
  })

  it('the ?wh= deep link wins over the home warehouse and pending counts', () => {
    const active = [wh(1), wh(2)]
    expect(
      resolvePutawayWarehouse({ deepLinkId: 2, homeWarehouseId: 1, counts: { 1: 5 }, activeWarehouses: active }),
    ).toBe(2)
  })

  it('ignores a deep-link id that is not an active warehouse, falling through', () => {
    const active = [wh(1), wh(2)]
    expect(
      resolvePutawayWarehouse({ deepLinkId: 99, homeWarehouseId: 1, counts: {}, activeWarehouses: active }),
    ).toBe(1)
  })

  it('the home warehouse beats a pending count sitting at another site', () => {
    const active = [wh(1), wh(2)]
    expect(
      resolvePutawayWarehouse({ deepLinkId: null, homeWarehouseId: 1, counts: { 2: 5 }, activeWarehouses: active }),
    ).toBe(1)
  })

  it('falls back to the first warehouse with a pending count when there is no home site', () => {
    const active = [wh(1), wh(2), wh(3)]
    expect(
      resolvePutawayWarehouse({ deepLinkId: null, homeWarehouseId: undefined, counts: { 3: 2 }, activeWarehouses: active }),
    ).toBe(3)
  })

  it('an inactive home warehouse is ignored, falling through to pending count', () => {
    const active = [wh(1), wh(2)]
    expect(
      resolvePutawayWarehouse({ deepLinkId: null, homeWarehouseId: 99, counts: { 2: 1 }, activeWarehouses: active }),
    ).toBe(2)
  })

  it('all-zero counts fall back to the first active warehouse', () => {
    const active = [wh(1), wh(2)]
    expect(
      resolvePutawayWarehouse({ deepLinkId: null, homeWarehouseId: undefined, counts: { 1: 0, 2: 0 }, activeWarehouses: active }),
    ).toBe(1)
  })

  it('falls back to the first active warehouse when there is no home site and no pending work', () => {
    const active = [wh(5), wh(6)]
    expect(
      resolvePutawayWarehouse({ deepLinkId: null, homeWarehouseId: undefined, counts: {}, activeWarehouses: active }),
    ).toBe(5)
  })

  it('never returns an inactive warehouse, even via a deep link', () => {
    const active = [wh(2)]
    expect(
      resolvePutawayWarehouse({ deepLinkId: 1, homeWarehouseId: undefined, counts: {}, activeWarehouses: active }),
    ).toBe(2)
  })
})

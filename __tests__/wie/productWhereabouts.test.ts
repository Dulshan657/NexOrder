import { describe, it, expect } from 'vitest'
import {
  productWhereabouts,
  newDeliveryReason,
  pickWalkStops,
  walkSummary,
} from '../../supabase/functions/_shared/wie/productWhereabouts'

const ROOT = 1 // the warehouse location itself: stock not yet put away
const HOME = 10
const OTHER = 11
const ALLOCATED = 12

describe('productWhereabouts', () => {
  it('marks stock in the home bin as home, other bins as off home and the warehouse root as at the dock', () => {
    const r = productWhereabouts({
      warehouseId: ROOT,
      homeBinId: HOME,
      balances: [
        { locationId: OTHER, code: 'B-11-04', onHand: 6, available: 6 },
        { locationId: ROOT, code: 'MAIN', onHand: 10, available: 10 },
        { locationId: HOME, code: 'A-03-02', onHand: 12, available: 9 },
      ],
    })
    expect(r.stock.map((s) => [s.locationId, s.badge])).toEqual([
      [HOME, 'home'],
      [OTHER, 'off_home'],
      [ROOT, 'at_dock'],
    ])
    expect(r.homeQty).toBe(12)
    expect(r.offHomeQty).toBe(6)
    expect(r.atDockQty).toBe(10)
  })

  it('leaves out a location holding none of the product', () => {
    const r = productWhereabouts({
      warehouseId: ROOT,
      homeBinId: HOME,
      balances: [
        { locationId: HOME, code: 'A-03-02', onHand: 0, available: 0 },
        { locationId: OTHER, code: 'B-11-04', onHand: 4, available: 4 },
        // Two batch rows in one bin fold into one row.
        { locationId: OTHER, code: 'B-11-04', onHand: 1, available: 0 },
      ],
    })
    expect(r.stock).toHaveLength(1)
    expect(r.stock[0]).toMatchObject({ locationId: OTHER, onHand: 5, available: 4, badge: 'off_home' })
    expect(r.homeQty).toBe(0)
  })
})

describe('newDeliveryReason', () => {
  it('says home when the home has room, overflow with the headroom when it is full, and no home bin set without one', () => {
    const home = newDeliveryReason(
      [{ locationId: HOME, code: 'A-03-02', quantity: 12, source: 'home' }],
      { locationId: HOME, code: 'A-03-02' },
    )
    expect(home).toMatchObject({ source: 'home', locationId: HOME, homeQty: 12, overflowQty: 0 })
    expect(home.reason).toMatch(/home/i)
    expect(home.reason).toContain('A-03-02')

    const split = newDeliveryReason(
      [
        { locationId: HOME, code: 'A-03-02', quantity: 4, source: 'home' },
        { locationId: OTHER, code: 'B-11-04', quantity: 8, source: 'overflow' },
      ],
      { locationId: HOME, code: 'A-03-02' },
    )
    expect(split).toMatchObject({ source: 'overflow', homeQty: 4, overflowQty: 8 })
    expect(split.reason).toContain('room for 4')
    expect(split.reason).toContain('B-11-04')

    const full = newDeliveryReason(
      [{ locationId: OTHER, code: 'B-11-04', quantity: 12, source: 'overflow' }],
      { locationId: HOME, code: 'A-03-02' },
    )
    expect(full).toMatchObject({ source: 'overflow', locationId: OTHER, homeQty: 0 })
    expect(full.reason).toMatch(/full/i)

    const homeless = newDeliveryReason(
      [{ locationId: OTHER, code: 'B-11-04', quantity: 12, source: 'engine' }],
      null,
    )
    expect(homeless).toMatchObject({ source: 'engine', locationId: OTHER })
    expect(homeless.reason).toMatch(/no home bin set/i)

    const partly = newDeliveryReason(
      [
        { locationId: HOME, code: 'A-03-02', quantity: 4, source: 'home' },
        { locationId: null, code: null, quantity: 2, source: 'overflow' },
      ],
      { locationId: HOME, code: 'A-03-02' },
    )
    expect(partly.source).toBe('home')
    expect(partly.reason).toContain('2 more have no bin')

    const nowhere = newDeliveryReason([{ locationId: null, code: null, quantity: 12, source: 'engine' }], null)
    expect(nowhere.locationId).toBeNull()
    expect(nowhere.reason).toMatch(/dock/i)
  })
})

describe('pickWalkStops', () => {
  it('visits every bin with available stock and never the dock root or a fully allocated bin', () => {
    const { stock } = productWhereabouts({
      warehouseId: ROOT,
      homeBinId: HOME,
      balances: [
        { locationId: HOME, code: 'A-03-02', onHand: 12, available: 9 },
        { locationId: OTHER, code: 'B-11-04', onHand: 6, available: 6 },
        { locationId: ALLOCATED, code: 'C-01-01', onHand: 5, available: 0 },
        { locationId: ROOT, code: 'MAIN', onHand: 10, available: 10 },
      ],
    })
    const placements = new Map([
      [HOME, { graphNodeId: 100, accessOffsetM: 1 }],
      [OTHER, { graphNodeId: 101, accessOffsetM: 0.5 }],
      [ALLOCATED, { graphNodeId: 102, accessOffsetM: 0 }],
      [ROOT, { graphNodeId: 103, accessOffsetM: 0 }],
    ])
    const stops = pickWalkStops(stock, placements)
    expect(stops.map((s) => s.locationId).sort()).toEqual([HOME, OTHER].sort())
    const home = stops.find((s) => s.locationId === HOME)!
    expect(home).toMatchObject({ graphNodeId: 100, accessOffsetM: 1 })
    expect(home.meta).toMatchObject({ code: 'A-03-02', qtyBase: 9 })

    // A bin with no placement is still a stop — unreachable, which the
    // sequencer reports rather than silently dropping.
    const unplaced = pickWalkStops(stock, new Map())
    expect(unplaced.map((s) => s.graphNodeId)).toEqual([null, null])
  })
})

describe('walkSummary', () => {
  it('numbers the stops, sums the legs and writes one step line per stop', () => {
    const w = walkSummary([
      { sequence: 1, code: 'A-03-02', legDistanceM: 13.6 },
      { sequence: 2, code: 'B-11-04', legDistanceM: 7.2 },
    ])
    expect(w.totalDistanceM).toBeCloseTo(20.8)
    expect(w.steps).toEqual(['1. A-03-02 — 14 m', '2. B-11-04 — 7 m'])
    expect(walkSummary([]).steps).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'
import {
  productWhereabouts,
  newDeliveryReason,
  pickWalkStops,
  walkSummary,
  describePlace,
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
      [{ locationId: HOME, place: 'A-03-02', quantity: 12, source: 'home' }],
      { locationId: HOME, place: 'A-03-02' },
    )
    expect(home).toMatchObject({ source: 'home', locationId: HOME, homeQty: 12, overflowQty: 0 })
    expect(home.reason).toMatch(/home/i)
    expect(home.reason).toContain('A-03-02')

    const split = newDeliveryReason(
      [
        { locationId: HOME, place: 'A-03-02', quantity: 4, source: 'home' },
        { locationId: OTHER, place: 'B-11-04', quantity: 8, source: 'overflow' },
      ],
      { locationId: HOME, place: 'A-03-02' },
    )
    expect(split).toMatchObject({ source: 'overflow', homeQty: 4, overflowQty: 8 })
    expect(split.reason).toContain('room for 4')
    expect(split.reason).toContain('B-11-04')

    const full = newDeliveryReason(
      [{ locationId: OTHER, place: 'B-11-04', quantity: 12, source: 'overflow' }],
      { locationId: HOME, place: 'A-03-02' },
    )
    expect(full).toMatchObject({ source: 'overflow', locationId: OTHER, homeQty: 0 })
    expect(full.reason).toMatch(/full/i)

    const homeless = newDeliveryReason(
      [{ locationId: OTHER, place: 'B-11-04', quantity: 12, source: 'engine' }],
      null,
    )
    expect(homeless).toMatchObject({ source: 'engine', locationId: OTHER })
    expect(homeless.reason).toMatch(/no home location set/i)

    const partly = newDeliveryReason(
      [
        { locationId: HOME, place: 'A-03-02', quantity: 4, source: 'home' },
        { locationId: null, place: null, quantity: 2, source: 'overflow' },
      ],
      { locationId: HOME, place: 'A-03-02' },
    )
    expect(partly.source).toBe('home')
    expect(partly.reason).toContain('2 more have nowhere to go')

    const nowhere = newDeliveryReason([{ locationId: null, place: null, quantity: 12, source: 'engine' }], null)
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
      { sequence: 1, place: 'Rack 7 · Level 2', legDistanceM: 13.6 },
      { sequence: 2, place: 'Fast Moving · F01 right bay 10', legDistanceM: 7.2 },
    ])
    expect(w.totalDistanceM).toBeCloseTo(20.8)
    expect(w.steps).toEqual(['1. Rack 7 · Level 2 — 14 m', '2. Fast Moving · F01 right bay 10 — 7 m'])
    expect(walkSummary([]).steps).toEqual([])
  })
})

describe('describePlace', () => {
  it('names a rack level by its rack and level, a bay by its name and zone, and the root as the dock', () => {
    const rack = { kind: 'RACK' as const, code: 'NEXG-B-9', name: 'Rack 7' }
    // A level named by the legacy generator: the level number still comes through.
    expect(describePlace({ isRoot: false, kind: 'SHELF', code: 'NEXG-B-9-4-L4', name: 'Level 4', parent: rack, zoneName: 'Chiller' }))
      .toBe('Chiller · Rack 7 · Level 4')
    // A composed name (mig 00094) and an uninformative rack: Rack + its code, level from the name.
    expect(describePlace({
      isRoot: false, kind: 'SHELF', code: 'X-L2', name: 'Chiller · Rack 7 · L2',
      parent: { kind: 'RACK', code: 'NEXG-B-9', name: 'NEXG-B-9' }, zoneName: null,
    })).toBe('Rack NEXG-B-9 · Level 2')
    // A zone already in the rack's own name is not said twice.
    expect(describePlace({
      isRoot: false, kind: 'SHELF', code: 'NEXG-B-9-1-L1', name: 'Level 1',
      parent: { kind: 'RACK', code: 'NEXG-B-9', name: 'Chiller · Rack 7' }, zoneName: 'Chiller',
    })).toBe('Chiller · Rack 7 · Level 1')
    // A rack with no levels.
    expect(describePlace({ isRoot: false, kind: 'RACK', code: 'NEXG-B-9', name: 'NEXG-B-9', parent: null, zoneName: null }))
      .toBe('Rack NEXG-B-9')
    // A floor bay: its own name, after its zone.
    expect(describePlace({ isRoot: false, kind: 'BIN', code: 'MAIN-F01-R10', name: 'F01 right bay 10', parent: null, zoneName: 'Fast Moving' }))
      .toBe('Fast Moving · F01 right bay 10')
    // A legacy-named spot falls back to its code — and is never called a bin.
    const legacy = describePlace({ isRoot: false, kind: 'BIN', code: 'MAIN-9-4', name: 'Bin 9,4', parent: null, zoneName: null })
    expect(legacy).toBe('MAIN-9-4')
    expect(describePlace({ isRoot: false, kind: 'STAGING', code: 'STG-1', name: 'Outbound', parent: null, zoneName: null }))
      .toBe('Staging · Outbound')
    expect(describePlace({ isRoot: true, kind: 'WAREHOUSE', code: 'MAIN', name: 'Main Warehouse', parent: null, zoneName: null }))
      .toBe('Dock — awaiting putaway')
  })
})

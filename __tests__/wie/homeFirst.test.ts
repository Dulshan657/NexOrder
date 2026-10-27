import { describe, it, expect } from 'vitest'
import { planHomeFirst, type HomeSlot } from '../../supabase/functions/_shared/wie/homeFirst'

const home = (o: Partial<HomeSlot> = {}): HomeSlot => ({
  locationId: 20, maxQty: null, onHand: 0, pendingQty: 0,
  capacitySlots: 100, usedSlots: 0, ...o,
})

describe('planHomeFirst', () => {
  it('puts the whole line in the home bin when it has room', () => {
    const plan = planHomeFirst({ quantity: 30, sizeFactor: 1, unitLoad: false, home: home(), candidates: [] })
    expect(plan).toMatchObject({ homeLocationId: 20, homeQty: 30, remainder: 0, suggestMakeHome: false })
  })

  it('fills the home bin only up to max_qty', () => {
    // max 50, 20 on the shelf, 5 already on their way: room for 25 of the 40.
    const plan = planHomeFirst({
      quantity: 40, sizeFactor: 1, unitLoad: false,
      home: home({ maxQty: 50, onHand: 20, pendingQty: 5 }), candidates: [],
    })
    expect(plan.homeQty).toBe(25)
    expect(plan.remainder).toBe(15)
    expect(plan.remainderSource).toBe('overflow')
  })

  it('takes whole units only when the bin fills on slots', () => {
    // 10 free slots at size factor 2 = 5 units; never a half carton.
    const plan = planHomeFirst({
      quantity: 8, sizeFactor: 2, unitLoad: false,
      home: home({ capacitySlots: 100, usedSlots: 90 }), candidates: [],
    })
    expect(plan.homeQty).toBe(5)
    expect(plan.remainder).toBe(3)
  })

  it('sends the remainder to overflow, same rack first then nearest', () => {
    const plan = planHomeFirst({
      quantity: 40, sizeFactor: 1, unitLoad: false,
      home: home({ capacitySlots: 10 }),
      candidates: [
        { locationId: 5, sameRack: false, anchorDistanceM: 3 },
        { locationId: 6, sameRack: true, anchorDistanceM: 10 },
        { locationId: 20, sameRack: true, anchorDistanceM: 0 },
        { locationId: 8, sameRack: false, anchorDistanceM: null },
        { locationId: 7, sameRack: true, anchorDistanceM: 4 },
      ],
    })
    expect(plan.homeQty).toBe(10)
    // The home bin itself is never an overflow target, even when max_qty
    // rather than capacity is what stopped it.
    expect(plan.overflowOrder).toEqual([7, 6, 5, 8])
  })

  it('never puts a unit load in the home bin', () => {
    const plan = planHomeFirst({
      quantity: 48, sizeFactor: 1, unitLoad: true, home: home(),
      candidates: [
        { locationId: 31, sameRack: false, anchorDistanceM: 12 },
        { locationId: 32, sameRack: true, anchorDistanceM: 2 },
      ],
    })
    expect(plan.homeQty).toBe(0)
    expect(plan.remainder).toBe(48)
    expect(plan.overflowOrder).toEqual([32, 31])
    expect(plan.remainderSource).toBe('overflow')
  })

  it('suggests making a home when the product has none', () => {
    const plan = planHomeFirst({
      quantity: 12, sizeFactor: 1, unitLoad: false, home: null,
      candidates: [{ locationId: 5, sameRack: false, anchorDistanceM: null }],
    })
    expect(plan).toMatchObject({
      homeLocationId: null, homeQty: 0, remainder: 12,
      remainderSource: 'engine', suggestMakeHome: true, overflowOrder: [],
    })
  })

  it('a home already at max takes nothing', () => {
    const plan = planHomeFirst({
      quantity: 10, sizeFactor: 1, unitLoad: false,
      home: home({ maxQty: 50, onHand: 55 }), candidates: [],
    })
    expect(plan.homeQty).toBe(0)
    expect(plan.remainder).toBe(10)
  })
})

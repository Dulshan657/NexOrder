import { describe, expect, it } from 'vitest'

import { toAppliedPromotions } from '../lib/adapters'
import { getPromotionROI } from '../services/promotionROIService'
import type { Order, Promotion } from '../types'

const promo = (id: string): Promotion => ({ id, name: `Promo ${id}`, type: 'percentage' }) as Promotion

const order = (total: number, appliedPromotions?: Order['appliedPromotions'], status = 'processing'): Order =>
  ({ total, appliedPromotions, status }) as Order

const used = (promotionId: string, discount: number): Order['appliedPromotions'] => [
  { promotionId, promotionName: `Promo ${promotionId}`, type: 'percentage', discount },
]

describe('getPromotionROI', () => {
  it('counts orders and discount, including the older promoId key', () => {
    const older = toAppliedPromotions([{ promoId: 'A', promoName: 'Promo A', discount: 5, productIds: [1, 2] }])
    expect(older).toEqual([{ promotionId: 'A', promotionName: 'Promo A', type: 'bundle', discount: 5, productIds: [1, 2] }])

    expect(toAppliedPromotions(null)).toBeUndefined()
    expect(toAppliedPromotions([])).toEqual([])
    expect(toAppliedPromotions([null, 'x'])).toEqual([])

    const [roi] = getPromotionROI([promo('A')], [order(100, older), order(50, used('A', 10))], [])
    expect(roi.ordersUsing).toBe(2)
    expect(roi.totalDiscountGiven).toBe(15)
    expect(roi.revenueFromPromoOrders).toBe(150)
  })

  it('leaves out cancelled orders', () => {
    const [roi] = getPromotionROI(
      [promo('A')],
      [order(100, used('A', 10)), order(900, used('A', 90), 'cancelled'), order(50, []), order(5000, [], 'cancelled')],
      [],
    )
    expect(roi.ordersUsing).toBe(1)
    expect(roi.totalDiscountGiven).toBe(10)
    expect(roi.avgOrderValueWithout).toBe(50)
  })

  it('the baseline uses only orders recorded as having no promotion', () => {
    // The 1000 is from before recording: it says nothing about having no promotion.
    const [roi] = getPromotionROI([promo('A')], [order(100, used('A', 10)), order(50, []), order(1000, undefined)], [])
    expect(roi.avgOrderValueWithout).toBe(50)
    expect(roi.estimatedUplift).toBe(100)
  })

  it('uplift is null with no promotion orders or no baseline', () => {
    const [unused] = getPromotionROI([promo('A')], [order(50, [])], [])
    expect(unused.estimatedUplift).toBeNull()

    const [noBaseline] = getPromotionROI([promo('A')], [order(100, used('A', 10)), order(1000, undefined)], [])
    expect(noBaseline.estimatedUplift).toBeNull()
  })
})

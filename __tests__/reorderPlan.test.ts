import { describe, it, expect } from 'vitest'
import { buildReorderPlan, MAY_BE_SHORT_REASON, pickKitchenOrders } from '@/lib/kitchen/reorderPlan'
import { mkBogoPromo, mkCartItem, mkHoReCa, mkPercentPromo, mkProduct, mkUser } from './fixtures'
import { UserRole } from '@/types'
import type { Order, ProductUom } from '@/types'

const kitchen = mkUser({ id: 7, name: 'Sam', role: UserRole.QR_STAFF, hoReCaId: 10 })
const venue = mkHoReCa({ id: 10 })

const uom = (over: Partial<ProductUom>): ProductUom => ({
  id: 0,
  productId: 1,
  code: 'jar',
  factorToBase: 1,
  isBase: true,
  price: 4,
  isOrderable: true,
  isReceivable: true,
  sortOrder: 0,
  ...over,
})

const plan = (items: ReturnType<typeof mkCartItem>[], over: Partial<Parameters<typeof buildReorderPlan>[0]> = {}) =>
  buildReorderPlan({
    order: { items },
    products: [mkProduct({ id: 1, price: 4, available: 100 })],
    hoReCa: venue,
    promotions: [],
    currentUser: kitchen,
    cartonDiscountPercent: 5,
    ...over,
  })

describe('buildReorderPlan — what can be ordered today', () => {
  it('prices a base-unit line at today\'s price and totals it', () => {
    const p = plan([mkCartItem(mkProduct({ id: 1, price: 3 }), 5)])
    expect(p.included).toHaveLength(1)
    expect(p.items[0].price).toBe(4)
    expect(p.items[0].quantity).toBe(5)
    expect(p.subtotal).toBe(20)
    expect(p.estimatedTotal).toBe(20)
  })

  it('uses the venue price, not list', () => {
    const p = plan([mkCartItem(mkProduct({ id: 1 }), 2)], { hoReCa: mkHoReCa({ id: 10, pricing: { 1: 2.5 } }) })
    expect(p.items[0].price).toBe(2.5)
    expect(p.subtotal).toBe(5)
  })

  it('applies a live promotion (promotion-aware, not the bare venue price)', () => {
    const p = plan([mkCartItem(mkProduct({ id: 1 }), 1)], { promotions: [mkPercentPromo({ percentOff: 50 })] })
    expect(p.items[0].price).toBe(2)
  })

  it('prices a carton line with the derived carton formula and keeps it a carton', () => {
    const p = plan([mkCartItem(mkProduct({ id: 1 }), 2, 6)])
    // 4 x 6 x (1 - 5%) = 22.80
    expect(p.items[0].price).toBe(22.8)
    expect(p.items[0].packSize).toBe(6)
    expect(p.items[0].unit).toBe('carton')
    expect(p.lines[0].unitLabel).toBe('carton of 6')
    expect(p.subtotal).toBe(45.6)
  })

  it('finds a line\'s unit of measure by id before pack factor', () => {
    const product = mkProduct({
      id: 1,
      uoms: [
        uom({ id: 11, code: 'jar', price: 4 }),
        uom({ id: 12, code: 'tray', factorToBase: 12, isBase: false, price: 40, sortOrder: 1 }),
        uom({ id: 13, code: 'box', factorToBase: 12, isBase: false, price: 44, sortOrder: 2 }),
      ],
    })
    const line = { ...mkCartItem(product, 1, 12), uomId: 13 }
    const p = plan([line], { products: [product] })
    expect(p.items[0].unit).toBe('box')
    expect(p.items[0].uomId).toBe(13)
    expect(p.items[0].price).toBe(44)
  })

  it('leaves out a product that is gone, with a reason', () => {
    const p = plan([mkCartItem(mkProduct({ id: 99, name: 'Ghost' }), 1)])
    expect(p.included).toHaveLength(0)
    expect(p.excluded[0].reason).toBe('No longer sold')
    expect(p.items).toEqual([])
    expect(p.estimatedTotal).toBe(0)
  })

  it('leaves out an inactive product the same way', () => {
    const p = plan([mkCartItem(mkProduct({ id: 1 }), 1)], { products: [mkProduct({ id: 1, isActive: false })] })
    expect(p.excluded[0].reason).toBe('No longer sold')
  })

  it('leaves out something with nothing available', () => {
    const p = plan([mkCartItem(mkProduct({ id: 1 }), 1)], { products: [mkProduct({ id: 1, available: 0 })] })
    expect(p.excluded).toHaveLength(1)
    expect(p.excluded[0].reason).toBe('Out of stock')
    expect(p.excluded[0].status).toBe('unavailable')
  })

  it('KEEPS a line asking for more than is available and flags it', () => {
    const p = plan([mkCartItem(mkProduct({ id: 1 }), 5)], { products: [mkProduct({ id: 1, available: 3 })] })
    expect(p.included).toHaveLength(1)
    expect(p.included[0].status).toBe('low')
    expect(p.included[0].reason).toBe('Only 3 in stock')
  })

  it('words the shortage without a number when the reader must not see stock', () => {
    // A kitchen (QR Staff) has no Stock tab; "Only 3 in stock" would hand them one.
    const p = plan([mkCartItem(mkProduct({ id: 1 }), 5)], {
      products: [mkProduct({ id: 1, available: 3 })],
      hideStockCounts: true,
    })
    expect(p.included[0].status).toBe('low')
    expect(p.included[0].reason).toBe(MAY_BE_SHORT_REASON)
    expect(p.included[0].reason).not.toMatch(/\d/)
  })

  it('judges stock the same way whether or not the counts are hidden', () => {
    const items = [mkCartItem(mkProduct({ id: 1 }), 2, 6)]
    const products = [mkProduct({ id: 1, available: 10 })]
    const shown = plan(items, { products })
    const hidden = plan(items, { products, hideStockCounts: true })
    expect(hidden.included.map((l) => l.status)).toEqual(shown.included.map((l) => l.status))
    expect(hidden.included[0].status).toBe('low')
  })

  it('has no shortage wording for a line that is in stock, hidden or not', () => {
    const p = plan([mkCartItem(mkProduct({ id: 1 }), 1)], { hideStockCounts: true })
    expect(p.included[0].status).toBe('ok')
    expect(p.included[0].reason).toBeUndefined()
  })

  it('counts a carton in base units when judging stock', () => {
    // 2 cartons of 6 = 12 units against 10 available.
    const p = plan([mkCartItem(mkProduct({ id: 1 }), 2, 6)], { products: [mkProduct({ id: 1, available: 10 })] })
    expect(p.included[0].status).toBe('low')
  })

  it('holds back a carton line whose pack size no longer exists, rather than reading it as units', () => {
    // Ordered as a carton of 12; the product now has cartons of 6.
    const p = plan([mkCartItem(mkProduct({ id: 1 }), 2, 12)])
    expect(p.included).toHaveLength(0)
    expect(p.excluded[0].reason).toBe('Pack size changed')
  })

  it('subtracts cart-level promotion savings from the estimate', () => {
    const product = mkProduct({ id: 1, price: 10 })
    // Buy 2 get 1 free: the free unit is worth a unit of the same product.
    const p = plan([mkCartItem(product, 2)], {
      products: [product],
      promotions: [mkBogoPromo({ bogoConfig: { buyProductId: 1, buyQuantity: 2, getProductId: 1, getQuantity: 1 } })],
    })
    expect(p.subtotal).toBe(20)
    expect(p.promoDiscount).toBeGreaterThanOrEqual(0)
    expect(p.estimatedTotal).toBe(Math.round((p.subtotal - p.promoDiscount) * 100) / 100)
  })

  it('does not mutate the order it was given', () => {
    const items = [mkCartItem(mkProduct({ id: 1, price: 3 }), 5)]
    const before = JSON.stringify(items)
    plan(items)
    expect(JSON.stringify(items)).toBe(before)
  })
})

describe('pickKitchenOrders', () => {
  const order = (id: string, day: number, status: Order['status'], horecaId = 10) =>
    ({ id, orderDate: `2026-10-${String(day).padStart(2, '0')}T08:00:00Z`, status, hoReCa: { id: horecaId } }) as Pick<
      Order,
      'orderDate' | 'status' | 'hoReCa'
    > & { id: string }

  it('offers the newest order that was not cancelled, and lists the newest three', () => {
    const orders = [order('a', 1, 'delivered'), order('d', 4, 'cancelled'), order('c', 3, 'processing'), order('b', 2, 'delivered')]
    const { hero, recent } = pickKitchenOrders(orders, 10)
    expect(hero?.id).toBe('c')
    expect(recent.map((o) => o.id)).toEqual(['d', 'c', 'b'])
  })

  it('only looks at this venue', () => {
    const orders = [order('x', 9, 'delivered', 99), order('a', 1, 'delivered')]
    expect(pickKitchenOrders(orders, 10).recent.map((o) => o.id)).toEqual(['a'])
  })

  it('has no hero when everything was cancelled or there is nothing', () => {
    expect(pickKitchenOrders([order('a', 1, 'cancelled')], 10).hero).toBeNull()
    expect(pickKitchenOrders([], 10)).toEqual({ hero: null, recent: [] })
    expect(pickKitchenOrders([order('a', 1, 'delivered')], undefined)).toEqual({ hero: null, recent: [] })
  })

  it('does not reorder the array it was given', () => {
    const orders = [order('a', 1, 'delivered'), order('b', 2, 'delivered')]
    pickKitchenOrders(orders, 10)
    expect(orders.map((o) => o.id)).toEqual(['a', 'b'])
  })
})

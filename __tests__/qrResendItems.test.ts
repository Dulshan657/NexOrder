import { describe, expect, it } from 'vitest'
import {
  qrRequestToCartDetails,
  qrRequestToCartItems,
  unavailableItemsMessage,
  type ResendContext,
} from '@/lib/qr/resendItems'
import { mkHoReCa, mkProduct, mkUser } from './fixtures'
import { mkQrRequest } from './support/qrRequestFixture'

// "Edit and resend": a request the approver turned down becomes cart lines again.
// Each line is priced the way the Shop prices the same pick (priceReorderLine), so
// the cart cannot disagree with the Reorder tab. A product that is gone is left
// out and COUNTED, so the person can be told.

const tomato = mkProduct({ id: 1, name: 'Tomato Paste', price: 4, cartonSize: 6, available: 50 })
const chilli = mkProduct({ id: 2, sku: 'SKU-2', name: 'Chilli Oil', price: 10, cartonSize: 1, available: 20 })

const ctx = (over: Partial<ResendContext> = {}): ResendContext => ({
  products: [tomato, chilli],
  hoReCa: mkHoReCa({ id: 7 }),
  promotions: [],
  currentUser: mkUser({ id: 7 }),
  cartonDiscountPercent: 5,
  ...over,
})

describe('qrRequestToCartItems', () => {
  it('turns each line into a cart line at today\'s price, keeping the quantity', () => {
    const { items, skipped } = qrRequestToCartItems(mkQrRequest(), ctx())

    expect(skipped).toBe(0)
    expect(items.map((i) => [i.id, i.quantity, i.price])).toEqual([
      [1, 3, 4],
      [2, 1, 10],
    ])
    // A full product, not a stub: the cart renders name, unit and stock from it.
    expect(items[0].name).toBe('Tomato Paste')
  })

  it('keeps a carton line a carton, priced as one', () => {
    const request = mkQrRequest({
      items: [{ productId: 1, quantity: 2, packSize: 6, uomId: null, productName: 'Tomato Paste' }],
    })
    const { items } = qrRequestToCartItems(request, ctx())

    expect(items).toHaveLength(1)
    expect(items[0].packSize).toBe(6)
    expect(items[0].unit).toBe('carton')
    // 4 x 6 less the 5% carton discount.
    expect(items[0].price).toBeCloseTo(22.8, 2)
  })

  it('leaves out a product that is no longer in the catalogue, and counts it', () => {
    const { items, skipped } = qrRequestToCartItems(mkQrRequest(), ctx({ products: [chilli] }))

    expect(items.map((i) => i.id)).toEqual([2])
    expect(skipped).toBe(1)
  })

  it('leaves out an inactive product', () => {
    const { items, skipped } = qrRequestToCartItems(mkQrRequest(), ctx({ products: [{ ...tomato, isActive: false }, chilli] }))

    expect(items.map((i) => i.id)).toEqual([2])
    expect(skipped).toBe(1)
  })

  it('leaves out a carton line whose pack no longer exists, rather than reading it as units', () => {
    const request = mkQrRequest({
      items: [
        { productId: 1, quantity: 2, packSize: 12, uomId: null },
        { productId: 2, quantity: 1, packSize: null, uomId: null },
      ],
    })
    const { items, skipped } = qrRequestToCartItems(request, ctx())

    expect(items.map((i) => i.id)).toEqual([2])
    expect(skipped).toBe(1)
  })

  it('keeps a product that is out of stock: the short-stock check at send time is where that is said', () => {
    const { items, skipped } = qrRequestToCartItems(mkQrRequest(), ctx({ products: [{ ...tomato, available: 0 }, chilli] }))

    expect(items.map((i) => i.id)).toEqual([1, 2])
    expect(skipped).toBe(0)
  })

  it('returns nothing, and counts everything, when no line can be ordered', () => {
    const { items, skipped } = qrRequestToCartItems(mkQrRequest(), ctx({ products: [] }))

    expect(items).toEqual([])
    expect(skipped).toBe(2)
  })

  it('works without a venue record (still loading): list price', () => {
    const { items } = qrRequestToCartItems(mkQrRequest(), ctx({ hoReCa: undefined }))
    expect(items.map((i) => i.price)).toEqual([4, 10])
  })

  it('does not mutate the request or the catalogue', () => {
    const request = mkQrRequest()
    const products = [tomato, chilli]
    const before = JSON.stringify([request, products])
    qrRequestToCartItems(request, ctx({ products }))
    expect(JSON.stringify([request, products])).toBe(before)
  })
})

describe('unavailableItemsMessage', () => {
  it('is singular for one and plural for several', () => {
    expect(unavailableItemsMessage(1)).toBe('1 item is no longer available')
    expect(unavailableItemsMessage(3)).toBe('3 items are no longer available')
  })
})

describe('qrRequestToCartDetails', () => {
  const NOW = new Date(2026, 9, 13, 9, 30) // 13 Oct 2026, local

  it('carries the notes, delivery date and slot the order was sent with', () => {
    const details = qrRequestToCartDetails(
      mkQrRequest({ notes: 'Back door please', deliveryDate: '2026-10-14', deliveryTimeSlot: 'Morning (8am-12pm)' }),
      NOW,
    )
    expect(details).toEqual({
      notes: 'Back door please',
      deliveryDate: '2026-10-14',
      deliveryTimeSlot: 'Morning (8am-12pm)',
    })
  })

  it('is empty strings, not null, for what the order did not have -- so the cart is CLEARED of stale values', () => {
    const details = qrRequestToCartDetails(mkQrRequest({ notes: null, deliveryDate: null, deliveryTimeSlot: null }), NOW)
    expect(details).toEqual({ notes: '', deliveryDate: '', deliveryTimeSlot: '' })
  })

  it('keeps a delivery date of today, and any later one', () => {
    expect(qrRequestToCartDetails(mkQrRequest({ deliveryDate: '2026-10-13' }), NOW).deliveryDate).toBe('2026-10-13')
    expect(qrRequestToCartDetails(mkQrRequest({ deliveryDate: '2026-12-31' }), NOW).deliveryDate).toBe('2026-12-31')
  })

  it('drops a delivery date that has since passed: the server would refuse it, over a field nobody just chose', () => {
    expect(qrRequestToCartDetails(mkQrRequest({ deliveryDate: '2026-10-12' }), NOW).deliveryDate).toBe('')
  })

  it('reads a date that arrives with a time on it', () => {
    expect(qrRequestToCartDetails(mkQrRequest({ deliveryDate: '2026-10-20T00:00:00+00:00' }), NOW).deliveryDate).toBe(
      '2026-10-20',
    )
  })
})

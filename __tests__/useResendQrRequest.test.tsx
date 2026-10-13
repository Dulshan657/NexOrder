import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useResendQrRequest } from '@/hooks/useResendQrRequest'
import { mkHoReCa, mkProduct, mkUser } from './fixtures'
import { mkQrRequest } from './support/qrRequestFixture'

// The glue behind every "Edit and resend" button: map the lines, say what was left
// out, hand the rest to the cart. It answers whether the cart was loaded so the
// caller can decide to put the card away -- a resend that went nowhere must not.

const tomato = mkProduct({ id: 1, name: 'Tomato Paste', price: 4, available: 50 })
const chilli = mkProduct({ id: 2, sku: 'SKU-2', name: 'Chilli Oil', price: 10, available: 20 })

function setup(products = [tomato, chilli]) {
  const onEditItems = vi.fn()
  const addToast = vi.fn()
  const { result } = renderHook(() =>
    useResendQrRequest({
      products,
      hoReCa: mkHoReCa({ id: 7 }),
      promotions: [],
      currentUser: mkUser({ id: 7 }),
      cartonDiscountPercent: 5,
      onEditItems,
      addToast,
    }),
  )
  return { resend: result.current, onEditItems, addToast }
}

describe('useResendQrRequest', () => {
  it('hands the mapped lines to the cart and says it loaded them', () => {
    const { resend, onEditItems, addToast } = setup()

    expect(resend(mkQrRequest())).toBe(true)

    expect(onEditItems).toHaveBeenCalledTimes(1)
    const items = onEditItems.mock.calls[0][0]
    expect(items.map((i: { id: number; quantity: number; price: number }) => [i.id, i.quantity, i.price])).toEqual([
      [1, 3, 4],
      [2, 1, 10],
    ])
    expect(addToast).not.toHaveBeenCalled()
  })

  it('loads what it can and says how many it left out', () => {
    const { resend, onEditItems, addToast } = setup([chilli])

    expect(resend(mkQrRequest())).toBe(true)

    expect(onEditItems.mock.calls[0][0].map((i: { id: number }) => i.id)).toEqual([2])
    expect(addToast).toHaveBeenCalledWith('1 item is no longer available', 'info')
  })

  it('loads nothing, says why, and reports false when no line can be ordered', () => {
    // A catalogue that has loaded, and has none of these products.
    const { resend, onEditItems, addToast } = setup([mkProduct({ id: 99, name: 'Something else' })])

    expect(resend(mkQrRequest())).toBe(false)

    expect(onEditItems).not.toHaveBeenCalled()
    expect(addToast).toHaveBeenCalledWith('2 items are no longer available', 'error')
  })

  it('says the catalogue is still loading, not "no longer available", when there are no products yet', () => {
    const { resend, onEditItems, addToast } = setup([])

    expect(resend(mkQrRequest())).toBe(false)

    expect(onEditItems).not.toHaveBeenCalled()
    expect(addToast).toHaveBeenCalledTimes(1)
    expect(addToast).toHaveBeenCalledWith('Still loading the catalogue — try again in a moment', 'info')
  })

  it('hands the notes and delivery of the order to the cart with its lines, so none left by an abandoned cart survive', () => {
    const { resend, onEditItems } = setup()
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    resend(mkQrRequest({ notes: 'Back door please', deliveryDate: future, deliveryTimeSlot: 'Morning (8am-12pm)' }))

    expect(onEditItems).toHaveBeenCalledTimes(1)
    expect(onEditItems.mock.calls[0][1]).toEqual({
      notes: 'Back door please',
      deliveryDate: future,
      deliveryTimeSlot: 'Morning (8am-12pm)',
    })
  })

  it('hands over EMPTY details for an order that had none, which clears the cart', () => {
    const { resend, onEditItems } = setup()

    resend(mkQrRequest({ notes: null, deliveryDate: null, deliveryTimeSlot: null }))

    expect(onEditItems.mock.calls[0][1]).toEqual({ notes: '', deliveryDate: '', deliveryTimeSlot: '' })
  })
})

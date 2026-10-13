import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { QrApiError } from '@/lib/qr/qrApiError'
import { UserRole } from '@/types'
import { mkCartItem, mkHoReCa, mkProduct, mkUser } from './fixtures'

// The checkout fork. A kitchen (QR Staff) login must NEVER reach place-order: it
// files a request that waits for approval. Everyone else is unchanged.

const submitQrRequest = vi.fn()
vi.mock('@/services/supabase/qrService', () => ({
  submitQrRequest: (...a: unknown[]) => submitQrRequest(...a),
  cancelQrRequest: vi.fn(),
  listQrRequests: vi.fn(),
  previewQrRequest: vi.fn(),
  approveQrRequest: vi.fn(),
  rejectQrRequest: vi.fn(),
}))

const handleQrSessionEnded = vi.fn()
vi.mock('@/lib/qr/qrSessionEnd', () => ({
  handleQrSessionEnded: (...a: unknown[]) => handleQrSessionEnded(...a),
}))

const { OrderProvider, useOrderContext } = await import('@/context/OrderContext')
type Api = ReturnType<typeof useOrderContext>
type ProviderProps = Parameters<typeof OrderProvider>[0]

const product = mkProduct({ id: 1, price: 4, available: 100 })
const venue = mkHoReCa({ id: 10, name: 'Harbour Bistro' })
const kitchen = mkUser({ id: 7, name: 'Sam', role: UserRole.QR_STAFF, hoReCaId: 10 })
const customer = mkUser({ id: 8, name: 'Dee', role: UserRole.CUSTOMER, hoReCaId: 10 })
const rep = mkUser({ id: 9, name: 'Rex', role: UserRole.FIELD_REP })

const SETTINGS = { orderIdPrefix: 'ORD', minimumOrderValue: 50, cartonDiscountPercent: 5 }

function mount(over: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const holder: { api: Api | null } = { api: null }
  const Probe = () => {
    holder.api = useOrderContext()
    return null
  }
  const placeMutate = vi.fn()
  const props = {
    currentUser: kitchen,
    products: [product],
    hoReCas: [venue],
    promotions: [],
    invoices: [],
    appSettings: SETTINGS,
    addToast: vi.fn(),
    placeOrderMutation: { mutate: placeMutate },
    onResetView: vi.fn(),
    onQrSubmitted: vi.fn(),
    ...over,
  }
  render(
    <QueryClientProvider client={qc}>
      <OrderProvider {...(props as unknown as ProviderProps)}>
        <Probe />
      </OrderProvider>
    </QueryClientProvider>,
  )
  return { holder, props, placeMutate, api: () => holder.api as Api }
}

const addToCart = (api: Api, qty = 3) =>
  act(() => api.handleAddItem(product, { price: 4, unit: 'jar' }, qty))

beforeEach(() => {
  submitQrRequest.mockReset().mockResolvedValue({ requestId: 'r1', quotedTotal: 12, status: 'pending', createdAt: 'x' })
  handleQrSessionEnded.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('OrderContext — QR Staff checkout', () => {
  it('fixes the cart to the login\'s own venue', () => {
    const { api } = mount()
    expect(api().selectedHoReCa?.id).toBe(10)
    expect(api().holdsForApproval).toBe(true)
  })

  it('files a request from the cart and NEVER calls place-order', async () => {
    const { api, placeMutate, props } = mount()
    addToCart(api())

    act(() => api().handleSubmitOrder())

    await waitFor(() => expect(submitQrRequest).toHaveBeenCalledTimes(1))
    expect(submitQrRequest).toHaveBeenCalledWith({
      items: [{ productId: 1, quantity: 3, packSize: null, uomId: null }],
      notes: null,
      deliveryDate: null,
      deliveryTimeSlot: null,
    })
    expect(placeMutate).not.toHaveBeenCalled()
    await waitFor(() => expect(props.onQrSubmitted).toHaveBeenCalledTimes(1))
  })

  it('empties the cart and says it was sent for approval', async () => {
    const { api, props } = mount()
    addToCart(api())
    act(() => api().handleSubmitOrder())

    await waitFor(() => expect(api().orderItems).toHaveLength(0))
    expect(props.addToast).toHaveBeenCalledWith('Sent for approval', 'success')
    expect(api().isLoading).toBe(false)
    // It must NOT take the place-order route to a confirmation screen.
    expect(api().confirmation).toBeNull()
    // And it navigates via onQrSubmitted, not onResetView (which would open the Shop).
    expect(props.onResetView).not.toHaveBeenCalled()
  })

  it('carries the notes and delivery choices into the request', async () => {
    const { api } = mount()
    addToCart(api(), 2)
    act(() => {
      api().setNotes('Back door please')
      api().setDeliveryDate('2026-10-14')
      api().setDeliveryTimeSlot('Morning (8am-12pm)')
    })
    act(() => api().handleSubmitOrder())

    await waitFor(() => expect(submitQrRequest).toHaveBeenCalled())
    expect(submitQrRequest.mock.calls[0][0]).toMatchObject({
      notes: 'Back door please',
      deliveryDate: '2026-10-14',
      deliveryTimeSlot: 'Morning (8am-12pm)',
    })
  })

  it('does not enforce the minimum order: that is the approver\'s call', async () => {
    const { api } = mount() // minimum is $50, this cart is $12
    addToCart(api())
    act(() => api().handleSubmitOrder())
    await waitFor(() => expect(submitQrRequest).toHaveBeenCalled())
    expect(api().errors.api).toBeUndefined()
  })

  // The soft "may be short" warning is the Submit button's (OrderSummary) and the
  // Kitchen screen's, not the context's: by the time the context is asked, the
  // person has already chosen to send. It must file what it is handed and never
  // quietly trim, hold back or refuse on stock -- that is the approver's call.
  it('files a short cart as it is: stock is for the approver to judge, not this layer', async () => {
    const scarce = mkProduct({ id: 1, price: 4, available: 1 })
    const { api, placeMutate } = mount({ products: [scarce] })
    act(() => api().handleAddItem(scarce, { price: 4, unit: 'jar' }, 5))
    act(() => api().handleSubmitOrder())

    await waitFor(() => expect(submitQrRequest).toHaveBeenCalledTimes(1))
    expect(submitQrRequest.mock.calls[0][0].items).toEqual([{ productId: 1, quantity: 5, packSize: null, uomId: null }])
    expect(placeMutate).not.toHaveBeenCalled()
  })

  it('refuses an empty cart', () => {
    const { api } = mount()
    act(() => api().handleSubmitOrder())
    expect(submitQrRequest).not.toHaveBeenCalled()
    expect(api().errors.emptyOrder).toBe('Cannot submit an empty order.')
  })

  it('opens no verification modal', () => {
    const { api } = mount()
    addToCart(api())
    act(() => api().handleSubmitOrder())
    expect(api().showVerificationModal).toBe(false)
  })

  it('routes even a direct placeOrder() call to a request, never to place-order', async () => {
    const { api, placeMutate } = mount()
    addToCart(api())
    act(() => api().placeOrder())
    await waitFor(() => expect(submitQrRequest).toHaveBeenCalledTimes(1))
    expect(placeMutate).not.toHaveBeenCalled()
  })

  it('sends the phone back to the PIN pad when the unlock has ended, without an error toast', async () => {
    submitQrRequest.mockRejectedValue(new QrApiError({ code: 'QR_SESSION_EXPIRED', message: 'Session ended' }))
    const { api, props } = mount()
    addToCart(api())
    act(() => api().handleSubmitOrder())

    await waitFor(() => expect(handleQrSessionEnded).toHaveBeenCalledTimes(1))
    expect(props.addToast).not.toHaveBeenCalledWith('Session ended', 'error')
    // The cart survives: nothing was sent.
    expect(api().orderItems).toHaveLength(1)
    expect(props.onQrSubmitted).not.toHaveBeenCalled()
  })

  it('treats UNAUTHORIZED the same way (the login itself is gone)', async () => {
    submitQrRequest.mockRejectedValue(new QrApiError({ code: 'UNAUTHORIZED', message: 'x' }))
    const { api } = mount()
    addToCart(api())
    act(() => api().handleSubmitOrder())
    await waitFor(() => expect(handleQrSessionEnded).toHaveBeenCalled())
  })

  it('keeps the cart and shows the reason when a product is gone', async () => {
    submitQrRequest.mockRejectedValue(new QrApiError({ code: 'PRODUCT_NOT_FOUND', message: 'Chilli Oil is no longer available.' }))
    const { api, props } = mount()
    addToCart(api())
    act(() => api().handleSubmitOrder())

    await waitFor(() => expect(api().errors.api).toBe('Chilli Oil is no longer available.'))
    expect(props.addToast).toHaveBeenCalledWith('Chilli Oil is no longer available.', 'error')
    expect(api().orderItems).toHaveLength(1)
    expect(api().isLoading).toBe(false)
    expect(handleQrSessionEnded).not.toHaveBeenCalled()
  })
})

describe('OrderContext — orderItemsNow (Order same again)', () => {
  const lines = [mkCartItem(product, 2)]

  it('files a held request for QR Staff WITHOUT touching the cart', async () => {
    const { api, props, placeMutate } = mount()
    addToCart(api(), 5)

    let result: Awaited<ReturnType<Api['orderItemsNow']>> | undefined
    await act(async () => {
      result = await api().orderItemsNow(lines, { notes: 'same as last time' })
    })

    expect(result).toEqual({ ok: true })
    expect(submitQrRequest).toHaveBeenCalledWith({
      items: [{ productId: 1, quantity: 2, packSize: null, uomId: null }],
      notes: 'same as last time',
      deliveryDate: null,
      deliveryTimeSlot: null,
    })
    expect(placeMutate).not.toHaveBeenCalled()
    // The cart in progress is someone's work: "same again" must not empty it.
    expect(api().orderItems).toHaveLength(1)
    expect(api().orderItems[0].quantity).toBe(5)
    expect(props.onQrSubmitted).toHaveBeenCalledTimes(1)
  })

  it('files short lines as they are handed in: the Kitchen screen asks before it calls this', async () => {
    const scarce = mkProduct({ id: 1, price: 4, available: 1 })
    const { api } = mount({ products: [scarce] })
    let result: Awaited<ReturnType<Api['orderItemsNow']>> | undefined
    await act(async () => {
      result = await api().orderItemsNow([mkCartItem(scarce, 5)])
    })
    expect(result).toEqual({ ok: true })
    expect(submitQrRequest.mock.calls[0][0].items).toEqual([{ productId: 1, quantity: 5, packSize: null, uomId: null }])
  })

  it('reports the failure to the caller, who shows it', async () => {
    submitQrRequest.mockRejectedValue(new QrApiError({ code: 'PRODUCT_NOT_FOUND', message: 'Gone.' }))
    const { api } = mount()
    let result: Awaited<ReturnType<Api['orderItemsNow']>> | undefined
    await act(async () => {
      result = await api().orderItemsNow(lines)
    })
    expect(result).toEqual({ ok: false, error: 'Gone.' })
  })

  it('PLACES the order for a Customer login, by the existing path, and never files a request', async () => {
    const placeMutate = vi.fn((_vars: unknown, opts: { onSuccess: (r: { orderId: string; total: number }) => void }) =>
      opts.onSuccess({ orderId: 'ORD-9', total: 8 }),
    )
    const { api } = mount({
      currentUser: customer,
      placeOrderMutation: { mutate: placeMutate },
      appSettings: { ...SETTINGS, minimumOrderValue: 0 },
    })
    expect(api().holdsForApproval).toBe(false)

    let result: Awaited<ReturnType<Api['orderItemsNow']>> | undefined
    await act(async () => {
      result = await api().orderItemsNow(lines, { notes: 'x' })
    })

    expect(result).toEqual({ ok: true })
    expect(submitQrRequest).not.toHaveBeenCalled()
    expect(placeMutate).toHaveBeenCalledTimes(1)
    expect(placeMutate.mock.calls[0][0]).toMatchObject({
      hoReCaId: 10,
      items: [{ productId: 1, quantity: 2, packSize: null, uomId: null }],
      notes: 'x',
    })
    expect(api().confirmation?.order.id).toBe('ORD-9')
  })

  it('holds a Customer to the minimum order, as the cart does', async () => {
    const { api, placeMutate } = mount({ currentUser: customer }) // minimum $50, lines worth $8
    let result: Awaited<ReturnType<Api['orderItemsNow']>> | undefined
    await act(async () => {
      result = await api().orderItemsNow(lines)
    })
    expect(result).toEqual({ ok: false, error: 'Minimum order value is $50.00.' })
    expect(placeMutate).not.toHaveBeenCalled()
  })

  it('is for venue logins only', async () => {
    const { api, placeMutate } = mount({ currentUser: rep })
    let result: Awaited<ReturnType<Api['orderItemsNow']>> | undefined
    await act(async () => {
      result = await api().orderItemsNow(lines)
    })
    expect(result?.ok).toBe(false)
    expect(placeMutate).not.toHaveBeenCalled()
    expect(submitQrRequest).not.toHaveBeenCalled()
  })
})

describe('OrderContext — Customer checkout is unchanged', () => {
  it('places the order straight from the cart (no verification step) and never files a request', () => {
    const placeMutate = vi.fn()
    const { api } = mount({
      currentUser: customer,
      placeOrderMutation: { mutate: placeMutate },
      appSettings: { ...SETTINGS, minimumOrderValue: 0 },
    })
    addToCart(api())
    act(() => api().handleSubmitOrder())

    expect(placeMutate).toHaveBeenCalledTimes(1)
    expect(placeMutate.mock.calls[0][0]).toMatchObject({ hoReCaId: 10, items: [{ productId: 1, quantity: 3 }] })
    expect(submitQrRequest).not.toHaveBeenCalled()
    expect(api().showVerificationModal).toBe(false)
  })

  it('still enforces the minimum order on the cart', () => {
    const { api, placeMutate } = mount({ currentUser: customer })
    addToCart(api(), 1)
    act(() => api().handleSubmitOrder())
    expect(placeMutate).not.toHaveBeenCalled()
    expect(api().errors.api).toBe('Minimum order value is $50.00.')
  })

  it('still opens the verification step for a rep', () => {
    const { api, placeMutate } = mount({ currentUser: rep, appSettings: { ...SETTINGS, minimumOrderValue: 0 } })
    act(() => api().setSelectedHoReCaId(10))
    addToCart(api())
    act(() => api().handleSubmitOrder())
    expect(api().showVerificationModal).toBe(true)
    expect(placeMutate).not.toHaveBeenCalled()
  })
})

describe('OrderContext — merging reorder lines', () => {
  it('adds quantities without mutating the line already in the cart', () => {
    const { api } = mount()
    addToCart(api(), 2)
    const before = api().orderItems[0]

    act(() => api().handleReorderItems([mkCartItem(product, 3)], 'merge'))

    expect(api().orderItems).toHaveLength(1)
    expect(api().orderItems[0].quantity).toBe(5)
    // The earlier render's object is untouched: state is replaced, never edited.
    expect(before.quantity).toBe(2)
  })
})

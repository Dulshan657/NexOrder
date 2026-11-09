import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UserRole } from '@/types'
import { mkHoReCa, mkPercentPromo, mkProduct, mkUser } from './fixtures'

// Cart prices are set when a line is added. A promotion with a minimum depends on the whole cart,
// so without repricing the cart would disagree with what place-order charges.

vi.mock('@/services/supabase/qrService', () => ({
  submitQrRequest: vi.fn(),
  cancelQrRequest: vi.fn(),
  listQrRequests: vi.fn(),
  previewQrRequest: vi.fn(),
  approveQrRequest: vi.fn(),
  rejectQrRequest: vi.fn(),
}))
vi.mock('@/lib/qr/qrSessionEnd', () => ({ handleQrSessionEnded: vi.fn() }))

const { OrderProvider, useOrderContext } = await import('@/context/OrderContext')
type Api = ReturnType<typeof useOrderContext>
type ProviderProps = Parameters<typeof OrderProvider>[0]

const product = mkProduct({ id: 1, price: 100, available: 100 })
const venue = mkHoReCa({ id: 10 })
const customer = mkUser({ id: 8, role: UserRole.CUSTOMER, hoReCaId: 10 })

function mount(promotions: unknown[]) {
  const qc = new QueryClient()
  const holder: { api: Api | null } = { api: null }
  const Probe = () => {
    holder.api = useOrderContext()
    return null
  }
  const props = {
    currentUser: customer,
    products: [product],
    hoReCas: [venue],
    promotions,
    invoices: [],
    appSettings: { orderIdPrefix: 'ORD', minimumOrderValue: 0, cartonDiscountPercent: 5 },
    addToast: vi.fn(),
    placeOrderMutation: { mutate: vi.fn() },
    onResetView: vi.fn(),
    onQrSubmitted: vi.fn(),
  }
  render(
    <QueryClientProvider client={qc}>
      <OrderProvider {...(props as unknown as ProviderProps)}>
        <Probe />
      </OrderProvider>
    </QueryClientProvider>,
  )
  return () => holder.api as Api
}

afterEach(cleanup)

describe('OrderContext promotion minimum', () => {
  it('lines already in the cart reprice when it reaches the minimum, and go back when it falls under', () => {
    const promo = mkPercentPromo({ id: 'MIN', percentOff: 50, minOrderValue: 200 })
    const api = mount([promo])

    act(() => api().handleAddItem(product, { price: 100, unit: 'jar' }, 1))
    expect(api().orderItems[0].price).toBe(100)
    expect(api().total).toBe(100)
    expect(api().eligiblePromotions).toEqual([])

    act(() => api().handleUpdateQuantity(1, 2))
    expect(api().orderItems[0].price).toBe(50)
    expect(api().total).toBe(100)
    expect(api().eligiblePromotions).toEqual([promo])

    act(() => api().handleUpdateQuantity(1, 1))
    expect(api().orderItems[0].price).toBe(100)
    expect(api().eligiblePromotions).toEqual([])
  })

  it('with no minimum on any live promotion a line keeps the price it was added at', () => {
    const promo = mkPercentPromo({ id: 'PLAIN', percentOff: 50 })
    const expired = mkPercentPromo({ id: 'OLD', percentOff: 50, minOrderValue: 200, endDate: '2000-01-01' })
    const api = mount([promo, expired])

    act(() => api().handleAddItem(product, { price: 77, unit: 'jar' }, 1))

    expect(api().orderItems[0].price).toBe(77)
    expect(api().eligiblePromotions).toEqual([promo, expired])
  })
})

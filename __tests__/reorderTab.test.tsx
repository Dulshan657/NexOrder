import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { resolveHoReCaPrice, resolvePromotionPrice, resolveUomLinePrice } from '@/pricing'
import { deriveDefaultUoms } from '@/lib/uom'
import { UserRole } from '@/types'
import type { Order, OrderItem, Product, Promotion } from '@/types'
import { mkCartItem, mkHoReCa, mkPercentPromo, mkProduct, mkUser } from './fixtures'

vi.mock('@/hooks/queries/useSettings', () => ({
  // ReorderTab reads only the low-stock threshold; the real hook needs a
  // QueryClientProvider these tests deliberately do without.
  useSettings: () => ({ data: null }),
}))

const { default: ReorderTab } = await import('@/components/ReorderTab')

const CARTON_DISCOUNT = 5
const venue = mkHoReCa({ id: 10, name: 'Seaside Bistro' })
const customer = mkUser({ id: 8, name: 'Dee', role: UserRole.CUSTOMER, hoReCaId: 10 })
const halfOff: Promotion = mkPercentPromo({ percentOff: 50 })

const jar = mkProduct({ id: 1, name: 'Chilli Oil', price: 10, available: 100 })

const orderOf = (items: OrderItem[]): Order => ({
  id: 'ORD-9',
  hoReCa: venue,
  items,
  total: items.reduce((s, i) => s + i.price * i.quantity, 0),
  orderDate: '2026-10-01T08:00:00Z',
  submittedBy: customer,
  status: 'delivered',
  statusHistory: [],
})

const renderTab = (over: Partial<React.ComponentProps<typeof ReorderTab>> = {}) => {
  const onAddItems = vi.fn()
  const props: React.ComponentProps<typeof ReorderTab> = {
    lastOrder: orderOf([mkCartItem(jar, 2)]),
    products: [jar] as Product[],
    selectedHoReCa: venue,
    promotions: [],
    currentUser: customer,
    cartonDiscountPercent: CARTON_DISCOUNT,
    cartItemCount: 0,
    onAddItems,
    ...over,
  }
  render(<ReorderTab {...props} />)
  return { onAddItems }
}

const reorderAll = () => fireEvent.click(screen.getByRole('button', { name: /Reorder All/ }))

afterEach(cleanup)

describe('ReorderTab pricing — the same resolution the cart and the server quote use', () => {
  it('prices a promoted line with resolvePromotionPrice, not the bare venue price', () => {
    const { onAddItems } = renderTab({ promotions: [halfOff] })

    const expected = resolvePromotionPrice(jar, venue, customer, [halfOff]).finalPrice
    expect(expected).toBe(5)
    // The regression: resolveHoReCaPrice knows nothing about promotions.
    expect(resolveHoReCaPrice(jar, venue)).toBe(10)

    // 2 x $5.00 — not 2 x $10.00.
    expect(screen.getByRole('button', { name: /Reorder All \(\$10\.00\)/ })).toBeTruthy()
    reorderAll()
    const [items, mode] = onAddItems.mock.calls[0]
    expect(mode).toBe('replace')
    expect(items[0].price).toBe(expected)
  })

  it('shows the promoted unit price on the line itself', () => {
    renderTab({ promotions: [halfOff] })
    // Unit price "$5.00 / jar" and the line total "$10.00".
    expect(screen.getByText('$5.00')).toBeTruthy()
    expect(screen.getByText('$10.00', { selector: 'span.text-stone-700' })).toBeTruthy()
  })

  it('prices a carton line with the carton unit of measure, promotion included', () => {
    const cartonLine = mkCartItem(jar, 1, 6)
    const { onAddItems } = renderTab({
      lastOrder: orderOf([cartonLine]),
      promotions: [halfOff],
    })

    const carton = deriveDefaultUoms(jar.unit, jar.price, jar.cartonSize, CARTON_DISCOUNT)[1]
    const expected = resolveUomLinePrice(jar, carton, venue, customer, [halfOff])
    // 10 x 6 x 95% = 57.00 for a carton at list; the 50% promotion halves it.
    expect(expected).toBe(28.5)

    reorderAll()
    expect(onAddItems.mock.calls[0][0][0].price).toBe(expected)
  })

  it('still honours the venue price when nothing is on promotion', () => {
    const priced = mkHoReCa({ id: 10, name: 'Seaside Bistro', pricing: { 1: 7 } })
    const { onAddItems } = renderTab({ selectedHoReCa: priced })

    reorderAll()
    expect(onAddItems.mock.calls[0][0][0].price).toBe(resolvePromotionPrice(jar, priced, customer, []).finalPrice)
    expect(onAddItems.mock.calls[0][0][0].price).toBe(7)
  })

  it('does not leak its own display fields into the cart line', () => {
    const { onAddItems } = renderTab({ promotions: [halfOff] })
    reorderAll()
    const line = onAddItems.mock.calls[0][0][0]
    for (const key of ['removed', 'currentPrice', 'isAvailable', 'skipReason', 'isLowStock', 'currentProduct']) {
      expect(key in line).toBe(false)
    }
  })
})

describe('ReorderTab — lines it will not send', () => {
  it('skips an out-of-stock line and says why', () => {
    const { onAddItems } = renderTab({ products: [mkProduct({ id: 1, price: 10, available: 0 })] })
    expect(screen.getByText(/Out of Stock — will be skipped/)).toBeTruthy()
    // Nothing orderable is left, so the all-lines button is disabled.
    const all = screen.getByRole('button', { name: /Reorder All/ }) as HTMLButtonElement
    expect(all.disabled).toBe(true)
    fireEvent.click(all)
    expect(onAddItems).not.toHaveBeenCalled()
  })

  it('holds back a carton line whose pack no longer exists, rather than reading it as units', () => {
    // Ordered as a carton of 12; the product now has cartons of 6.
    const { onAddItems } = renderTab({ lastOrder: orderOf([mkCartItem(jar, 2, 12)]) })
    expect(screen.getByText(/Pack size changed — will be skipped/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Reorder All/ }))
    expect(onAddItems).not.toHaveBeenCalled()
  })
})

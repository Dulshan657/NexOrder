import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useOrderingState, type OrderingStateInput } from '@/hooks/useOrderingState'
import { mkHoReCa, mkProduct, mkUser } from './fixtures'
import type { Order } from '@/types'

/**
 * "Reorder" in the Shop repeats the venue's last order. A cancelled order is the
 * wrong thing to offer: the kitchen screen already skips them, and the Shop must
 * agree with it (both go through `pickKitchenOrders`).
 */

const venue = mkHoReCa({ id: 10 })

const order = (id: string, day: number, status: Order['status'], horecaId = 10): Order =>
  ({
    id,
    hoReCa: { id: horecaId },
    items: [],
    total: 10,
    orderDate: `2026-10-${String(day).padStart(2, '0')}T08:00:00Z`,
    status,
  }) as unknown as Order

const lastOrder = (allOrders: Order[], selected = venue) => {
  const input: OrderingStateInput = {
    products: [mkProduct({ id: 1 })],
    selectedHoReCa: selected,
    currentUser: mkUser({ id: 1 }),
    promotions: [],
    selectedCategory: '',
    searchQuery: '',
    sortOption: '',
    allOrders,
    orderItems: [],
  }
  return renderHook(() => useOrderingState(input)).result.current.lastOrderForHoReCa
}

describe('useOrderingState -- lastOrderForHoReCa', () => {
  it('is the newest order', () => {
    expect(lastOrder([order('a', 1, 'delivered'), order('b', 3, 'processing'), order('c', 2, 'delivered')])?.id).toBe('b')
  })

  it('skips a cancelled order, even the newest, and offers the one before it', () => {
    const orders = [order('a', 1, 'delivered'), order('b', 2, 'delivered'), order('cancelled-newest', 5, 'cancelled')]
    expect(lastOrder(orders)?.id).toBe('b')
  })

  it('is null when every order was cancelled', () => {
    expect(lastOrder([order('a', 1, 'cancelled'), order('b', 2, 'cancelled')])).toBeNull()
  })

  it('looks only at the selected venue', () => {
    expect(lastOrder([order('other', 9, 'delivered', 99), order('mine', 1, 'delivered')])?.id).toBe('mine')
  })

  it('is null with no venue selected or no orders', () => {
    expect(lastOrder([order('a', 1, 'delivered')], null as never)).toBeNull()
    expect(lastOrder([])).toBeNull()
  })
})

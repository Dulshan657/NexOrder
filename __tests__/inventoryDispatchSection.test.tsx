// The dashboard's order pipeline card: where orders placed in the chosen period
// sit now. It opens on This month, the same calendar month Nex answers "this
// month" with, and cancelled orders are a line under the chart rather than the
// last blue "stage" (they never were one).

import React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Order, OrderStatus } from '@/types'

vi.mock('@/context/WarehouseScopeContext', () => ({
  useWarehouseScope: () => ({ scope: 'all', scopeLabel: 'All sites' }),
}))
vi.mock('@/hooks/queries/useInventoryBalances', () => ({
  useProductStockByWarehouse: () => ({ data: [] }),
}))

const { default: InventoryDispatchSection } = await import('@/components/admin/InventoryDispatchSection')

beforeAll(() => {
  // Recharts' ResponsiveContainer observes its box; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(cleanup)

function placed(id: string, status: OrderStatus): Order {
  return {
    id,
    hoReCa: { id: 1, name: 'Cafe' },
    items: [],
    total: 10,
    orderDate: new Date().toISOString(),
    submittedBy: { id: 1, name: 'Rep' },
    status,
    statusHistory: [],
  } as unknown as Order
}

describe('InventoryDispatchSection', () => {
  it('opens on This month and shows cancelled orders as a line under the chart', () => {
    const orders = [placed('a', 'delivered'), placed('b', 'cancelled'), placed('c', 'cancelled')]
    render(React.createElement(InventoryDispatchSection, { allOrders: orders, products: [] }))

    expect(screen.getByRole('heading', { name: /order pipeline/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'This month' }).getAttribute('aria-pressed')).toBe('true')
    for (const label of ['7d', '30d', '90d']) {
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('false')
    }
    expect(screen.getByText('2 cancelled in this period')).toBeTruthy()
    const counts = screen.getByRole('list', { name: 'Order pipeline counts' })
    expect(counts.textContent).toContain('Delivered: 1')
    expect(counts.textContent).not.toContain('Cancelled')
  })

  it('hides the cancelled line when nothing was cancelled', () => {
    render(React.createElement(InventoryDispatchSection, { allOrders: [placed('a', 'packed')], products: [] }))
    expect(screen.queryByText(/cancelled in this period/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '7d' }))
    expect(screen.getByRole('button', { name: '7d' }).getAttribute('aria-pressed')).toBe('true')
  })
})

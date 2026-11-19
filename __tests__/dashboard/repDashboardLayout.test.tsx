// NX-0043. The Rep dashboard on the shared kit: real period deltas, the same
// period picker as Admin, one card-title style, and rows that lead somewhere.

import React from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Order, Product, User } from '@/types'
import { UserRole } from '@/types'
import { dashboardRange } from '@/lib/period'

vi.mock('@/hooks/queries/useSettings', () => ({ useSettings: () => ({ data: { low_stock_threshold: 10 } }) }))
vi.mock('@/components/qr/PendingQrRequests', () => ({ default: () => null }))

const { default: RepDashboardV2 } = await import('@/components/RepDashboardV2')

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

beforeEach(() => {
  localStorage.clear()
  // Open the Needs attention board (it starts collapsed).
  localStorage.setItem('nexorder_v1_rep_action_items', JSON.stringify({ collapsed: false, dismissed: [], snoozed: {}, assignments: {} }))
})
afterEach(cleanup)

const rep = { id: 5, name: 'Riley Rep', role: UserRole.OFFICE_REP } as unknown as User

const range = dashboardRange('this_month', new Date())
const at = (d: Date, plusSeconds: number) => new Date(d.getTime() + plusSeconds * 1000).toISOString()

function order(id: string, total: number, orderDate: string, productId = 11, productName = 'Thai Paste 200g'): Order {
  return {
    id,
    hoReCa: { id: 3, name: 'Harbour Cafe' },
    items: [{ id: productId, name: productName, quantity: 2, price: total / 2 }],
    total,
    orderDate,
    submittedBy: { id: rep.id, name: rep.name, role: rep.role },
    status: 'processing',
    statusHistory: [],
  } as unknown as Order
}

// Previous month: two orders of $100. This month: one order of $300.
// Period-over-period revenue is +50%; the old first-half/second-half split
// of all three orders said +300%.
const orders = [
  order('p1', 100, at(range.previous.from, 1)),
  order('p2', 100, at(range.previous.from, 2)),
  order('c1', 300, at(range.from, 1)),
]

const outOfStock = { id: 11, name: 'Thai Paste 200g', inventory: 0, available: 0, price: 10, isActive: true } as unknown as Product

function renderRep(extra: Record<string, unknown> = {}) {
  const onStartOrder = vi.fn()
  const onNavigate = vi.fn()
  render(
    React.createElement(
      React.Suspense,
      { fallback: null },
      React.createElement(RepDashboardV2, {
        currentUser: rep,
        hoReCas: [{ id: 3, name: 'Harbour Cafe' }],
        products: [outOfStock],
        orders,
        onStartOrder,
        onNavigate,
        ...extra,
      }),
    ),
  )
  return { onStartOrder, onNavigate }
}

describe('RepDashboard', () => {
  it('KPI deltas compare this period with the previous one', async () => {
    renderRep()
    const revenue = await screen.findByText('Revenue')
    const tile = revenue.closest('.dash-card') as HTMLElement
    expect(tile).toBeTruthy()
    expect(within(tile).getByText('$300.00')).toBeTruthy()
    expect(within(tile).getByText(/\+50\.0%/)).toBeTruthy()
  })

  it('offers the same period picker as Admin', async () => {
    renderRep()
    const group = await screen.findByRole('group', { name: 'Period' })
    expect(within(group).getByRole('button', { name: 'This Month' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('visit completion follows the period', async () => {
    const route = (id: string, date: string, arrived: number) => ({
      id, name: id, date, status: 'completed', createdBy: rep.id, createdAt: date,
      stops: [0, 1].map((i) => ({ hoReCaId: 3, order: i, status: i < arrived ? 'arrived' : 'pending' })),
    })
    renderRep({
      routes: [
        route('prev', at(range.previous.from, 1), 1), // 1 of 2 visited
        route('now', at(range.from, 1), 2), // 2 of 2 visited
      ],
    })
    const tile = (await screen.findByText('Visit completion')).closest('.dash-card') as HTMLElement
    expect(within(tile).getByText('100%')).toBeTruthy()
    expect(within(tile).getByText(/\+50\.0 pts/)).toBeTruthy()
  })

  it('a top customer row starts an order', async () => {
    const { onStartOrder } = renderRep()
    const list = await screen.findByRole('list', { name: 'Top customers' })
    fireEvent.click(within(list).getByRole('button', { name: /harbour cafe/i }))
    expect(onStartOrder).toHaveBeenCalledWith(3)
  })

  it('a low-stock row opens Stock', async () => {
    const { onNavigate } = renderRep()
    fireEvent.click(await screen.findByRole('button', { name: /^thai paste 200g/i }))
    expect(onNavigate).toHaveBeenCalledWith('stock')
  })

  it('every card title shares one style', async () => {
    renderRep()
    await screen.findByRole('list', { name: 'Top customers' })
    const titles = Array.from(document.querySelectorAll('h3'))
    expect(titles.length).toBeGreaterThan(2)
    expect(new Set(titles.map((h) => h.className)).size).toBe(1)
  })
})

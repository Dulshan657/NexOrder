// NX-0042 A4/A5. One card-title style across the page, and the KPI tiles lead
// somewhere the role can actually open.

import React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Order, Product, User } from '@/types'
import { UserRole } from '@/types'

vi.mock('@/components/admin/InventoryDispatchSection', () => ({ default: () => null }))
vi.mock('@/components/admin/POInboxStatsTile', () => ({ default: () => null }))

const { default: AdminDashboard } = await import('@/components/AdminDashboard')

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(cleanup)

const admin = { id: 7, name: 'Ada Admin', role: UserRole.ADMIN } as unknown as User

const product = { id: 11, name: 'Flour 25kg', inventory: 40, available: 40, price: 20 } as unknown as Product
const orders = [
  {
    id: 'o1',
    hoReCa: { id: 3, name: 'Harbour Cafe' },
    items: [{ id: 11, name: 'Flour 25kg', quantity: 4, price: 20 }],
    total: 80,
    orderDate: new Date().toISOString(),
    submittedBy: { id: 7, name: 'Ada Admin', role: UserRole.ADMIN },
    status: 'processing',
    statusHistory: [],
  },
] as unknown as Order[]

function renderDashboard(onNavigateTab = vi.fn()) {
  render(
    React.createElement(
      React.Suspense,
      { fallback: null },
      React.createElement(AdminDashboard, {
        allOrders: orders,
        products: [product],
        hoReCas: [],
        users: [admin],
        invoices: [],
        salesTargets: [],
        onUpdateSalesTargets: () => {},
        currentUser: admin,
        onNavigateTab,
      }),
    ),
  )
  return onNavigateTab
}

describe('AdminDashboard layout', () => {
  it('every card title shares one style', async () => {
    renderDashboard()
    await screen.findByRole('heading', { name: /sales trend/i })
    const titles = Array.from(document.querySelectorAll('h3'))
    expect(titles.length).toBeGreaterThan(3)
    const styles = new Set(titles.map((h) => h.className))
    expect([...styles]).toHaveLength(1)
    expect([...styles][0]).not.toMatch(/text-lg/)
  })

  it('the Revenue tile opens Order Import', async () => {
    const onNavigateTab = renderDashboard()
    fireEvent.click(await screen.findByRole('button', { name: /^revenue/i }))
    expect(onNavigateTab).toHaveBeenCalledWith('Order Import')
  })
})

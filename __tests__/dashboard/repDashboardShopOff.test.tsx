// NX-0043 A4, found by the gate: starting an order lands on the Shop, which a
// build without the shop module never renders (AppShell `MODULE_SHOP && view ===
// 'ordering'`). So without it, no row on the Rep dashboard may offer to start one.

import React from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { Order, User } from '@/types'
import { UserRole } from '@/types'
import { dashboardRange } from '@/lib/period'

vi.mock('@/lib/modules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/modules')>()),
  MODULE_SHOP: false,
}))
vi.mock('@/hooks/queries/useSettings', () => ({ useSettings: () => ({ data: { low_stock_threshold: 10 } }) }))

const { default: RepDashboardV2 } = await import('@/components/RepDashboardV2')

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
beforeEach(() => localStorage.clear())
afterEach(cleanup)

const rep = { id: 5, name: 'Riley Rep', role: UserRole.OFFICE_REP } as unknown as User
const range = dashboardRange('this_month', new Date())
const orders = [{
  id: 'c1',
  hoReCa: { id: 3, name: 'Harbour Cafe' },
  items: [],
  total: 300,
  orderDate: new Date(range.from.getTime() + 1000).toISOString(),
  submittedBy: { id: rep.id, name: rep.name, role: rep.role },
  status: 'processing',
  statusHistory: [],
}] as unknown as Order[]

describe('RepDashboard without the shop module', () => {
  it('offers no start-order link', async () => {
    const onStartOrder = vi.fn()
    render(
      React.createElement(
        React.Suspense,
        { fallback: null },
        React.createElement(RepDashboardV2, {
          currentUser: rep,
          hoReCas: [{ id: 3, name: 'Harbour Cafe' }],
          products: [],
          orders,
          onStartOrder,
          onNavigate: vi.fn(),
        }),
      ),
    )
    const list = await screen.findByRole('list', { name: 'Top customers' })
    expect(within(list).getByText('Harbour Cafe')).toBeTruthy()
    expect(within(list).queryByRole('button')).toBeNull()
    expect(screen.queryByText(/tap to start an order/i)).toBeNull()
  })
})

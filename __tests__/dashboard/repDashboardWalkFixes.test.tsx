// NX-0043 A8: fixes from the owner's walk of the Rep dashboard as a Field Rep.
// Ended targets crowded the page and fed a stale "$ to go" chip; a visit change
// was shown against a period with no visits; Office Reps saw a 0% visit tile.

import React from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { SalesTarget, User } from '@/types'
import { UserRole } from '@/types'
import { appDateKey, dashboardRange } from '@/lib/period'

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
beforeEach(() => localStorage.clear())
afterEach(cleanup)

const fieldRep = { id: 5, name: 'Charlie Field', role: UserRole.FIELD_REP } as unknown as User
const officeRep = { id: 6, name: 'Olive Office', role: UserRole.OFFICE_REP } as unknown as User
const today = appDateKey(new Date())

function target(id: string, startDate: string, endDate: string, targetValue: number): SalesTarget {
  return { id, userId: fieldRep.id, type: 'revenue', targetValue, startDate, endDate, createdAt: `${startDate}T00:00:00.000Z` } as SalesTarget
}

function renderRep(props: Record<string, unknown>) {
  render(
    React.createElement(
      React.Suspense,
      { fallback: null },
      React.createElement(RepDashboardV2, {
        currentUser: fieldRep,
        hoReCas: [],
        products: [],
        orders: [],
        onStartOrder: vi.fn(),
        onNavigate: vi.fn(),
        ...props,
      }),
    ),
  )
}

describe('RepDashboard walk fixes', () => {
  it('shows only current targets, with ended ones behind Past targets', async () => {
    renderRep({
      salesTargets: [
        target('ended', '2025-01-01', '2025-01-31', 4000), // first, as the stale chip used to pick it
        target('current', today, today, 1000),
      ],
      onUpdateSalesTargets: vi.fn(),
    })
    const card = (await screen.findByRole('heading', { name: 'Targets' })).closest('section') as HTMLElement
    expect(within(card).getAllByRole('progressbar')).toHaveLength(1)
    expect(screen.getByText('$1,000 to go')).toBeTruthy()
    expect(screen.queryByText('$4,000 to go')).toBeNull()

    fireEvent.click(within(card).getByRole('button', { name: /past targets \(1\)/i }))
    expect(within(card).getAllByRole('progressbar')).toHaveLength(2)
  })

  it('hides Visit completion from an Office Rep', async () => {
    renderRep({ currentUser: officeRep })
    await screen.findByText('Revenue')
    expect(screen.queryByText(/visit completion/i)).toBeNull()
  })

  it('shows no visit change when nothing was planned', async () => {
    const range = dashboardRange('this_month', new Date())
    const prevDate = new Date(range.previous.from.getTime() + 1000).toISOString()
    renderRep({
      routes: [{
        id: 'prev', name: 'prev', date: prevDate, status: 'completed', createdBy: fieldRep.id, createdAt: prevDate,
        stops: [{ hoReCaId: 3, order: 0, status: 'arrived' }, { hoReCaId: 4, order: 1, status: 'pending' }],
      }],
    })
    const tile = (await screen.findByText('Visit completion')).closest('.dash-card') as HTMLElement
    expect(within(tile).queryByText(/pts/)).toBeNull()
    expect(within(tile).getByText('0 of 0 visits')).toBeTruthy()
  })
})

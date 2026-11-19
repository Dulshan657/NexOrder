// NX-0041 A1. The Admin Dashboard's "Set Targets" button handed SalesTargetModal
// props it does not take (currentUser / salesTargets / allOrders), so the modal
// read `existingTargets.filter` on undefined and the whole page crashed.

import React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SalesTarget, User } from '@/types'
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

const target = {
  id: 'TGT-1',
  userId: 7,
  type: 'revenue',
  targetValue: 12345,
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  createdAt: '2026-11-01T00:00:00.000Z',
} as SalesTarget

describe('AdminDashboard Set Targets', () => {
  it("opens the targets dialog with the user's existing targets", async () => {
    // The page lazy-loads module panels, so it renders under Suspense, as it does in AdminView.
    render(
      React.createElement(
        React.Suspense,
        { fallback: null },
        React.createElement(AdminDashboard, {
          allOrders: [],
          products: [],
          hoReCas: [],
          users: [admin],
          invoices: [],
          salesTargets: [target],
          onUpdateSalesTargets: () => {},
          currentUser: admin,
        }),
      ),
    )

    fireEvent.click(await screen.findByRole('button', { name: /^edit$/i }))

    const dialog = await screen.findByRole('dialog', { name: /set sales targets/i })
    expect(dialog).toBeTruthy()
    expect(screen.getByDisplayValue('12345')).toBeTruthy()
  })
})

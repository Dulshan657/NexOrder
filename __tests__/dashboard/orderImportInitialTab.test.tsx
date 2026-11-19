// NX-0042 A2. A pipeline stage on the dashboard opens Order Import on the tab
// holding those orders, so the page must be able to open on a given tab.

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { Order, OrderStatus, User } from '@/types'
import { UserRole } from '@/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const noopMutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
vi.mock('@/hooks/queries/useInvoices', () => ({ useUpdateInvoiceStatus: noopMutation }))
vi.mock('@/hooks/queries/usePickQueue', () => ({
  useGeneratePickSlip: noopMutation,
  useGenerateDispatchAdvice: noopMutation,
}))
vi.mock('@/hooks/queries/useOrderDocuments', () => ({
  useOrderDocuments: () => ({ data: [] }),
  useOrderDocumentUrl: noopMutation,
}))
vi.mock('@/hooks/queries/useOrders', () => ({ usePendingOrderStatusIds: () => new Set() }))
vi.mock('@/context/DocumentViewerContext', () => ({ useDocumentViewer: () => ({ open: vi.fn() }) }))
vi.mock('@/hooks/useToasts', () => ({ useToastActions: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

const { default: OrderImportPage } = await import('@/components/OrderImportPage')

afterEach(cleanup)

const admin = { id: 1, name: 'Ada', role: UserRole.ADMIN } as unknown as User

function order(id: string, status: OrderStatus): Order {
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

describe('OrderImportPage', () => {
  it('opens on the tab it is given', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
    render(
      React.createElement(QueryClientProvider, { client }, React.createElement(OrderImportPage, {
        orders: [order('o1', 'processing'), order('o2', 'packed')],
        invoices: [],
        hoReCas: [],
        currentUser: admin,
        onReorder: () => {},
        onViewDetail: () => {},
        onUpdateStatus: () => {},
        onBack: () => {},
        initialTab: 'inProgress',
      })),
    )
    const nav = screen.getByRole('navigation', { name: 'Order workflow tabs' })
    const current = nav.querySelector('[aria-current="true"]')
    expect(current?.textContent).toMatch(/in progress/i)
  })
})

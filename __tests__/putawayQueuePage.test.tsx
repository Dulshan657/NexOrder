// NX-0007 — the Putaway screen: one scan-first screen (no Assign tab), a
// Scan / Guide toggle remembered per device, and a ?receipt= filter so "Put
// away now" on a receipt lands on just that delivery.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { tasksMock } = vi.hoisted(() => ({ tasksMock: vi.fn() }))

vi.mock('@/hooks/queries/usePutawayWalk', () => ({
  useOpenPutaways: () => tasksMock(),
  useAssignedPutaways: () => tasksMock(),
  usePutawayRoute: () => ({ data: { mode: 'legacy' }, isLoading: false, isError: false }),
  useCompletePutaway: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnassignPutaway: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/queries/useWarehouses', () => ({
  useWarehouses: () => ({ data: [{ id: 1, name: 'Main', code: 'MAIN', isActive: true }] }),
}))
vi.mock('@/hooks/queries/usePendingPutawayCounts', () => ({
  usePendingPutawayCounts: () => ({ data: { 1: 3 } }),
}))
vi.mock('@/context/WarehouseScopeContext', () => ({
  useWarehouseScope: () => ({ scope: 1, setScope: vi.fn() }),
}))
vi.mock('@/hooks/queries/useWarehouseLocations', () => ({
  useWarehouseLocations: () => ({ data: [], isLoading: false, isError: false }),
}))
vi.mock('@/hooks/queries/usePalletBreakdown', () => ({
  usePrintPlateLabels: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePlanBreakdown: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBreakDownPallet: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useToasts', () => ({
  useToasts: () => ({ addToast: vi.fn() }),
  useToastActions: () => ({ addToast: vi.fn() }),
}))
// The desk view is covered by its own test; here it only has to exist.
vi.mock('@/components/inventory/PutawayQueueView', () => ({
  default: () => <div>desk view</div>,
}))

import PutawayQueuePage from '@/components/inventory/PutawayQueuePage'
import { UserRole, type User } from '@/types'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import type { Product } from '@/types'

const WAREHOUSE_USER = { id: 'u1', name: 'Floor', role: UserRole.WAREHOUSE, homeWarehouseId: 1 } as unknown as User

function task(n: number, receiptId: number | null = null): PendingPutawayRow {
  return {
    id: 900 + n,
    productId: 30 + n,
    quantity: 4,
    recommendedLocationId: 600 + n,
    explanation: { engineVersion: 'v1', layoutId: 1, candidatesConsidered: 1, hardFilters: [], winner: null, alternatives: [] },
    createdAt: '2026-10-27T00:00:00Z',
    product: { id: 30 + n, name: `Item ${n}`, sku: `IT-${n}`, barcode: `55500000000${n}` } as Product,
    receipt: receiptId == null ? null : { id: receiptId, reference: `REF-${receiptId}`, receivedDate: null, supplierName: null },
    huId: null,
    huType: null,
    huCode: null,
    huLabelPrinted: false,
    huStatus: null,
    assignedLocationId: null,
    assignedAt: null,
    status: 'suggested',
    suggestionSource: 'home',
  }
}

beforeEach(() => {
  try { window.localStorage.clear() } catch { /* jsdom */ }
  window.history.replaceState({}, '', '/')
  tasksMock.mockReturnValue({ data: [task(1), task(2), task(3)], isLoading: false, isError: false })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PutawayQueuePage', () => {
  it('has no Assign tab', () => {
    render(<PutawayQueuePage currentUser={WAREHOUSE_USER} />)
    expect(screen.queryByRole('tab', { name: /Assign/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Assign/i })).toBeNull()
    expect(screen.getByLabelText(/Scan a plate, carton or bin/i)).toBeTruthy()
    expect(screen.getByText('Item 1')).toBeTruthy()
  })

  it('Guide shows one task with Skip and remembers the choice', () => {
    const { unmount } = render(<PutawayQueuePage currentUser={WAREHOUSE_USER} />)
    fireEvent.click(screen.getByRole('radio', { name: /Guide/i }))
    // One task, open, and the rest out of the way.
    expect(screen.getByText('Take it to')).toBeTruthy()
    expect(screen.getByText('Item 1')).toBeTruthy()
    expect(screen.queryByText('Item 2')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Skip$/ }))
    expect(screen.getByText('Item 2')).toBeTruthy()
    unmount()

    render(<PutawayQueuePage currentUser={WAREHOUSE_USER} />)
    expect((screen.getByRole('radio', { name: /Guide/i }) as HTMLInputElement).checked).toBe(true)
    cleanup()

    // Storage that throws (private mode, blocked site data) must not break it.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    render(<PutawayQueuePage currentUser={WAREHOUSE_USER} />)
    expect((screen.getByRole('radio', { name: /Scan/i }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: /Guide/i }))
    expect(screen.getByText('Take it to')).toBeTruthy()
  })

  it('filters to a receipt from ?receipt=', () => {
    tasksMock.mockReturnValue({ data: [task(1, 5), task(2, 6), task(3, 5)], isLoading: false, isError: false })
    window.history.replaceState({}, '', '/?receipt=5')
    render(<PutawayQueuePage currentUser={WAREHOUSE_USER} />)
    expect(screen.getByText('Item 1')).toBeTruthy()
    expect(screen.getByText('Item 3')).toBeTruthy()
    expect(screen.queryByText('Item 2')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Show all/i }))
    expect(screen.getByText('Item 2')).toBeTruthy()
  })
})

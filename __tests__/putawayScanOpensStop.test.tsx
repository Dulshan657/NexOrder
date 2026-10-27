// NX-0007 — a scan in the putaway scan bar opens that task, already past the
// "identify" step. Before this the scan bar only highlighted the stop
// (setActiveId) and left the card collapsed, so the operator still had to tap it.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { tasksMock, routeMock } = vi.hoisted(() => ({ tasksMock: vi.fn(), routeMock: vi.fn() }))

vi.mock('@/hooks/queries/usePutawayWalk', () => ({
  useOpenPutaways: () => tasksMock(),
  useAssignedPutaways: () => tasksMock(),
  usePutawayRoute: () => routeMock(),
  useCompletePutaway: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnassignPutaway: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

import PutawayWalkView from '@/components/inventory/PutawayWalkView'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import type { Product } from '@/types'

function task(n: number): PendingPutawayRow {
  return {
    id: 700 + n,
    productId: 10 + n,
    quantity: 6,
    recommendedLocationId: 500 + n,
    explanation: { engineVersion: 'v1', layoutId: 1, candidatesConsidered: 1, hardFilters: [], winner: null, alternatives: [] },
    createdAt: '2026-10-27T00:00:00Z',
    product: { id: 10 + n, name: `Product ${n}`, sku: `SKU-${n}`, barcode: `93120000000${n}` } as Product,
    receipt: null,
    huId: 800 + n,
    huType: 'carton',
    huCode: `HU-000${800 + n}`,
    huLabelPrinted: false,
    huStatus: 'open',
    assignedLocationId: null,
    assignedAt: null,
    status: 'suggested',
    suggestionSource: 'home',
  }
}

afterEach(cleanup)

describe('putaway scan bar', () => {
  it('opens the matching task at the bin step', () => {
    tasksMock.mockReturnValue({ data: [task(1), task(2), task(3)], isLoading: false, isError: false })
    routeMock.mockReturnValue({ data: { mode: 'legacy' }, isLoading: false, isError: false })
    render(<PutawayWalkView warehouseId={1} />)

    const bar = screen.getByLabelText(/Scan a plate, carton or bin/i) as HTMLInputElement
    fireEvent.change(bar, { target: { value: '931200000002' } })
    fireEvent.keyDown(bar, { key: 'Enter' })

    // No tap: the scanned product's card is open and asking for the bin.
    expect(screen.getByLabelText(/Scan the bin/)).toBeTruthy()
    expect(screen.getByText('Product 2')).toBeTruthy()
  })

  // Found end to end on dev: scanning before the warehouse's location list had
  // loaded showed "expecting #538", and the real bin then read as a wrong bin.
  // The task carries its own bin code, so the card never depends on that list.
  it('names the bin by the code the task carries while locations are not loaded', () => {
    const row = { ...task(4), recommendedLocationCode: 'MAIN-F01-R10' }
    tasksMock.mockReturnValue({ data: [row], isLoading: false, isError: false })
    routeMock.mockReturnValue({ data: { mode: 'legacy' }, isLoading: false, isError: false })
    render(<PutawayWalkView warehouseId={1} />)

    const bar = screen.getByLabelText(/Scan a plate, carton or bin/i) as HTMLInputElement
    fireEvent.change(bar, { target: { value: '931200000004' } })
    fireEvent.keyDown(bar, { key: 'Enter' })

    expect(screen.getByLabelText(/Scan the bin — expecting MAIN-F01-R10/)).toBeTruthy()
    expect(screen.queryByText('#504')).toBeNull()
  })
})

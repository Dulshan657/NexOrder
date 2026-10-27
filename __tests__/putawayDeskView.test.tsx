// NX-0007 — the desk view for Admin/Manager: nothing to assign any more. A desk
// can send a suggestion to another bin before anyone walks it (redirect), an
// Admin can still Place now, and shortages flagged on the floor are resolved
// here: Found it, or Write off with a reason.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { pendingMock, shortMock, redirectMock, resolveMock, decideMock } = vi.hoisted(() => ({
  pendingMock: vi.fn(),
  shortMock: vi.fn(),
  redirectMock: vi.fn(),
  resolveMock: vi.fn(),
  decideMock: vi.fn(),
}))

vi.mock('@/services/supabase/putawayQueueService', () => ({
  getPendingPutaways: () => pendingMock(),
  getShortPutaways: () => shortMock(),
}))
vi.mock('@/hooks/queries/usePutawayRecommendation', () => ({
  useDecidePutaway: () => ({ mutateAsync: decideMock, isPending: false }),
  useRerunPutaway: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRedirectPutaway: () => ({ mutateAsync: redirectMock, isPending: false }),
  useResolveShortPutaway: () => ({ mutateAsync: resolveMock, isPending: false }),
}))
vi.mock('@/hooks/queries/useWarehouseLocations', () => ({
  useWarehouseLocations: () => ({ data: [] }),
}))
vi.mock('@/hooks/useToasts', () => ({
  useToasts: () => ({ addToast: vi.fn() }),
  useToastActions: () => ({ addToast: vi.fn() }),
}))
// The bin picker has its own tests; here it only has to hand back a bin.
vi.mock('@/components/inventory/putaway/BinPickerSheet', () => ({
  BinPickerSheet: ({ onConfirm }: { onConfirm: (id: number, qty: number) => void }) => (
    <button onClick={() => onConfirm(777, 4)}>pick bin 777</button>
  ),
}))

import PutawayQueueView from '@/components/inventory/PutawayQueueView'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import type { Product } from '@/types'

function line(id: number, status: string): PendingPutawayRow {
  return {
    id,
    productId: 3,
    quantity: 4,
    recommendedLocationId: 537,
    explanation: { engineVersion: 'v1', layoutId: 1, candidatesConsidered: 1, hardFilters: [], winner: null, alternatives: [] },
    createdAt: '2026-10-27T00:00:00Z',
    product: { id: 3, name: `Coconut Milk ${id}`, sku: 'AYM-COC-003', barcode: '9312000000036' } as Product,
    receipt: null,
    huId: null,
    huType: null,
    huCode: null,
    huLabelPrinted: false,
    huStatus: null,
    assignedLocationId: null,
    assignedAt: null,
    status,
    suggestionSource: 'home',
  }
}

function mount(isAdmin: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <PutawayQueueView warehouseId={1} isAdmin={isAdmin} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  pendingMock.mockResolvedValue([line(11, 'suggested')])
  shortMock.mockResolvedValue([line(12, 'short')])
  redirectMock.mockReset().mockResolvedValue({ remainderQty: 0 })
  resolveMock.mockReset().mockResolvedValue({ remainderQty: 0 })
})
afterEach(cleanup)

describe('putaway desk view', () => {
  it('redirect, Admin-only Place now, and the Short list', async () => {
    mount(false)
    await screen.findByText('Coconut Milk 11')
    // Nothing to assign any more, and a Manager cannot Place now.
    expect(screen.queryByRole('button', { name: /Assign/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Place now/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Change bin/i }))
    fireEvent.click(screen.getByRole('button', { name: 'pick bin 777' }))
    await vi.waitFor(() => expect(redirectMock).toHaveBeenCalledWith({ recommendationId: 11, chosenLocationId: 777 }))

    // Shortages flagged on the floor.
    expect(await screen.findByText(/Short at putaway/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Found it/i }))
    await vi.waitFor(() => expect(resolveMock).toHaveBeenCalledWith({ recommendationId: 12, resolution: 'found' }))

    const writeOff = screen.getByRole('button', { name: /Write off/i }) as HTMLButtonElement
    expect(writeOff.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Why are they missing/i), { target: { value: 'not on the truck' } })
    expect(writeOff.disabled).toBe(false)
    fireEvent.click(writeOff)
    await vi.waitFor(() => expect(resolveMock).toHaveBeenLastCalledWith({
      recommendationId: 12, resolution: 'write_off', reason: 'not on the truck',
    }))
    cleanup()

    mount(true)
    await screen.findByText('Coconut Milk 11')
    expect(screen.getByRole('button', { name: /Place now/i })).toBeTruthy()
  })
})

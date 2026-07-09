import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Regression test for the actual bug this track fixes: ['putaway-queue', id] was
// written in exactly one place (PutawayQueueView) and invalidated nowhere, so a
// receipt into an already-fetched (and previously empty) warehouse replayed the
// stale `[]` from cache — the queue never showed new stock. useReceiveStock now
// invalidates putawayKeys.all/counts on success; this proves a mounted
// PutawayQueueView actually picks the change up, with no manual refetch.

const { invoke, from } = vi.hoisted(() => ({ invoke: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke }, from },
}))

// Sidestep unrelated network calls the view also makes (bin-code lookups,
// toasts) so this test stays focused on the cache-invalidation behaviour.
vi.mock('@/hooks/queries/useWarehouseLocations', () => ({
  useWarehouseLocations: () => ({ data: [] }),
}))
vi.mock('@/hooks/useToasts', () => ({
  useToasts: () => ({ addToast: vi.fn() }),
}))

import { useReceiveStock } from '@/hooks/queries/useReceiveStock'
import PutawayQueueView from '@/components/inventory/PutawayQueueView'

function queueResponse(rows: unknown[]) {
  return {
    select: (_cols: string) => ({
      eq: (_c1: string, _v1: unknown) => ({
        eq: (_c2: string, _v2: unknown) => ({
          order: (_c3: string, _opts?: unknown) => Promise.resolve({ data: rows, error: null }),
        }),
      }),
    }),
  }
}

function Harness({ warehouseId }: { warehouseId: number }) {
  const receive = useReceiveStock()
  return (
    <div>
      <button onClick={() => receive.mutate({ header: {}, lines: [] })}>Receive</button>
      <PutawayQueueView warehouseId={warehouseId} />
    </div>
  )
}

describe('putaway-queue cache invalidation (regression)', () => {
  beforeEach(() => {
    invoke.mockReset()
    from.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('a receipt refetches an already-mounted, previously-empty queue', async () => {
    const populatedRow = [
      { id: 342, product_id: 56, quantity: 2, recommended_location_id: 716, explanation: {} },
    ]
    let fetchCount = 0
    from.mockImplementation((table: string) => {
      expect(table).toBe('wie_putaway_recommendations')
      const rows = fetchCount === 0 ? [] : populatedRow
      fetchCount += 1
      return queueResponse(rows)
    })
    invoke.mockResolvedValue({
      data: { ok: true, result: { lines_received: 1, location_id: 705 }, putaway: null },
      error: null,
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <Harness warehouseId={705} />
      </QueryClientProvider>,
    )

    // Initial state reproduces the stale-cache bug's starting point: empty queue.
    await waitFor(() => expect(screen.getByText('Nothing to put away')).toBeTruthy())
    expect(fetchCount).toBe(1)

    fireEvent.click(screen.getByText('Receive'))

    // Without the fix, useReceiveStock's onSuccess never touched
    // ['putaway-queue', 705] and this screen would stay stuck on "Nothing to
    // put away" forever (5min staleTime, refetchOnWindowFocus: false).
    await waitFor(() => expect(screen.queryByText('Nothing to put away')).toBeNull())
    expect(fetchCount).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Product #56')).toBeTruthy()
  })
})

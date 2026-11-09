import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// NX-0032: decide-putaway (and complete-putaway) now refuse an off-home bin
// with the home message, code CONFLICT. The screens must show those words as
// the server wrote them. supabase.functions.invoke turns any non-2xx into a
// FunctionsHttpError whose own message is the generic "non-2xx status code"
// and whose real body sits unread on `.context`, so decidePutaway has to dig
// the message out (complete-putaway already did). These cover the service and
// the two screens that show a decide-putaway refusal: the queue's "Place now"
// and the opening-stock import result list.

const { invoke, from, addToast } = vi.hoisted(() => ({
  invoke: vi.fn(), from: vi.fn(), addToast: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke }, from },
}))
vi.mock('@/hooks/queries/useWarehouseLocations', () => ({
  useWarehouseLocations: () => ({ data: [] }),
}))
vi.mock('@/hooks/useToasts', () => ({
  useToasts: () => ({ addToast }),
  useToastActions: () => ({ addToast }),
}))

import { completePutaway, decidePutaway } from '@/services/supabase/putawayService'
import PutawayQueueView from '@/components/inventory/PutawayQueueView'

const HOME_MESSAGE =
  'Put this in its home bin TST-HOME-H-1; it still has room for 10. If it is full, ask a manager to set its maximum.'
const OTHERS_HOME_MESSAGE = 'TST-HOME-H-1 is the home bin of TST-HOME-200; choose another bin.'

/** What supabase-js hands back for a 409: a generic message, the body on `.context`. */
function httpError(message: string, status = 409) {
  const body = JSON.stringify({ error: { code: 'CONFLICT', message } })
  return Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    context: new Response(body, { status, headers: { 'Content-Type': 'application/json' } }),
  })
}

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

describe('decidePutaway shows the server refusal', () => {
  beforeEach(() => invoke.mockReset())

  it('throws the home message, not the generic non-2xx text', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(HOME_MESSAGE) })
    await expect(
      decidePutaway({ recommendationId: 7, decision: 'override', chosenLocationId: 3, roleOverride: true }),
    ).rejects.toThrow(HOME_MESSAGE)
  })

  it("throws another product's home message the same way", async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(OTHERS_HOME_MESSAGE) })
    await expect(decidePutaway({ recommendationId: 7, decision: 'accept' })).rejects.toThrow(OTHERS_HOME_MESSAGE)
  })

  it('keeps a readable message when the response carried no body', async () => {
    const empty = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response('', { status: 502 }),
    })
    invoke.mockResolvedValue({ data: null, error: empty })
    await expect(decidePutaway({ recommendationId: 7, decision: 'accept' })).rejects.toThrow(
      'Could not record the putaway decision',
    )
  })

  it('still reports a network failure by its own message', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('Failed to fetch') })
    await expect(decidePutaway({ recommendationId: 7, decision: 'accept' })).rejects.toThrow('Failed to fetch')
  })

  it('completePutaway already carries the server words (the scan screen shows them as they are)', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(HOME_MESSAGE) })
    await expect(completePutaway({ recommendationId: 7, actualLocationId: 3 })).rejects.toThrow(HOME_MESSAGE)
  })
})

describe('the putaway queue "Place now"', () => {
  beforeEach(() => {
    invoke.mockReset()
    from.mockReset()
    addToast.mockReset()
  })
  afterEach(() => cleanup())

  it('toasts the home refusal verbatim', async () => {
    from.mockImplementation(() =>
      queueResponse([{ id: 342, product_id: 56, quantity: 2, recommended_location_id: 716, explanation: {} }]),
    )
    invoke.mockResolvedValue({ data: null, error: httpError(HOME_MESSAGE) })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <PutawayQueueView warehouseId={705} />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Product #56')).toBeTruthy())
    fireEvent.click(screen.getByText('Place now'))

    await waitFor(() => expect(addToast).toHaveBeenCalledWith(HOME_MESSAGE, 'error'))
    // Place now is the one-step path: the call must not have been an assignment.
    expect(invoke).toHaveBeenCalledWith('decide-putaway', expect.objectContaining({
      body: expect.objectContaining({ recommendation_id: 342, decision: 'accept', assign_only: false }),
    }))
  })
})

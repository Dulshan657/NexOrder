import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// NX-0032: the receive card's "Suggested locations" panel (PutawayPanel) called
// decide.mutateAsync with no catch and nothing read decide.error, so a home
// refusal became an unhandled rejection and "Accept" / "Put here" silently did
// nothing. The panel must show the server's words next to the line, and keep the
// line open so the operator can choose another bin. There is no override here.

const { invoke, from } = vi.hoisted(() => ({ invoke: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke }, from },
}))
vi.mock('@/hooks/queries/useWarehouseLocations', () => ({
  useWarehouseLocations: () => ({
    data: [
      { id: 716, code: 'TST-HOME-H-1', isActive: true, kind: 'BIN' },
      { id: 717, code: 'TST-HOME-X-1', isActive: true, kind: 'BIN' },
    ],
  }),
}))

import { PutawayPanel } from '@/components/inventory/PutawayPanel'
import type { PutawayLineRecommendation } from '@/types'

const HOME_MESSAGE =
  'Put this in its home bin TST-HOME-H-1; it still has room for 10. If it is full, ask a manager to set its maximum.'

function httpError(message: string) {
  const body = JSON.stringify({ error: { code: 'CONFLICT', message } })
  return Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    context: new Response(body, { status: 409, headers: { 'Content-Type': 'application/json' } }),
  })
}

const recommendation = {
  recommendationId: 342,
  productId: 56,
  quantity: 4,
  recommendedLocationId: 717,
  alternatives: [],
  explanation: {
    engineVersion: 'test', layoutId: 1, candidatesConsidered: 2, hardFilters: [], winner: null, alternatives: [],
  },
} satisfies PutawayLineRecommendation

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PutawayPanel
        warehouseId={705}
        recommendations={[recommendation]}
        productNameById={new Map([[56, 'TST-HOME Product']])}
      />
    </QueryClientProvider>,
  )
}

describe('PutawayPanel shows a home refusal', () => {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => { unhandled.push(reason) }

  beforeEach(() => {
    invoke.mockReset()
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
  })
  afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    cleanup()
  })

  it('Accept: shows the server message and leaves the line open', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(HOME_MESSAGE) })
    renderPanel()

    fireEvent.click(screen.getByText('Accept'))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(HOME_MESSAGE)
    // Not marked as put away, and still actionable.
    expect(screen.queryByText('Put away')).toBeNull()
    expect(screen.getByText('Accept')).toBeTruthy()
    expect(invoke).toHaveBeenCalledWith('decide-putaway', expect.objectContaining({
      body: expect.objectContaining({ recommendation_id: 342, decision: 'accept' }),
    }))
    expect(unhandled).toEqual([])
  })

  it('Put here: shows the server message and leaves the line open', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(HOME_MESSAGE) })
    renderPanel()

    fireEvent.click(screen.getByLabelText('Why this bin?'))
    fireEvent.change(screen.getByLabelText('Choose another bin'), { target: { value: '716' } })
    fireEvent.click(screen.getByText('Put here'))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(HOME_MESSAGE)
    expect(screen.queryByText('Put away (override)')).toBeNull()
    expect(unhandled).toEqual([])
  })

  it('clears the message when the next attempt succeeds', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: httpError(HOME_MESSAGE) })
    invoke.mockResolvedValueOnce({ data: { ok: true, remainder_qty: 0 }, error: null })
    renderPanel()

    fireEvent.click(screen.getByText('Accept'))
    await screen.findByRole('alert')

    fireEvent.click(screen.getByText('Accept'))
    await waitFor(() => expect(screen.getByText('Put away')).toBeTruthy())
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

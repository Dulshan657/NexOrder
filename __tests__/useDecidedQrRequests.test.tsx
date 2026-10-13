import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { mkQrRequest } from './support/qrRequestFixture'

const listQrRequests = vi.fn()
vi.mock('@/services/supabase/qrService', () => ({
  listQrRequests: (...a: unknown[]) => listQrRequests(...a),
  // Imported by the same module; unused here.
  approveQrRequest: vi.fn(),
  cancelQrRequest: vi.fn(),
  previewQrRequest: vi.fn(),
  rejectQrRequest: vi.fn(),
  submitQrRequest: vi.fn(),
}))

const { useDecidedQrRequests, qrRequestKeys, qrStatusKey } = await import('@/hooks/queries/useQrOrderRequests')

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, Wrapper }
}

beforeEach(() => listQrRequests.mockReset())
afterEach(cleanup)

describe('useDecidedQrRequests', () => {
  it('asks for the venue\'s rejected AND cancelled requests, and nothing else', async () => {
    listQrRequests.mockResolvedValue([mkQrRequest({ id: 'r1' })])
    const { Wrapper } = wrapper()

    const { result } = renderHook(() => useDecidedQrRequests(7), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(listQrRequests).toHaveBeenCalledTimes(1)
    expect(listQrRequests).toHaveBeenCalledWith({ horecaId: 7, status: ['rejected', 'cancelled'] })
    expect(result.current.data?.map((r) => r.id)).toEqual(['r1'])
  })

  it('lives under the qr-order-requests prefix, so a decision made elsewhere (realtime) refreshes it', async () => {
    listQrRequests.mockResolvedValue([])
    const { qc, Wrapper } = wrapper()

    const { result } = renderHook(() => useDecidedQrRequests(7), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // `all` is a PREFIX: invalidating it is what the realtime channel does.
    expect(qc.getQueryCache().findAll({ queryKey: qrRequestKeys.all })).toHaveLength(1)
    expect(qc.getQueryCache().find({ queryKey: qrRequestKeys.list(7, qrStatusKey(['rejected', 'cancelled'])) })).toBeTruthy()
  })

  it('does not fetch while disabled', () => {
    const { Wrapper } = wrapper()
    renderHook(() => useDecidedQrRequests(7, { enabled: false }), { wrapper: Wrapper })
    expect(listQrRequests).not.toHaveBeenCalled()
  })

  it('does not share a cache entry with the pending list', async () => {
    listQrRequests.mockResolvedValue([])
    const { qc, Wrapper } = wrapper()
    const { result } = renderHook(() => useDecidedQrRequests(7), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(qc.getQueryCache().find({ queryKey: qrRequestKeys.list(7, 'pending') })).toBeUndefined()
  })
})

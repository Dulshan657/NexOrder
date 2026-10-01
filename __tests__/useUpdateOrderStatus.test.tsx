import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const updateOrderStatus = vi.fn()

vi.mock('@/services/supabase/orderService', () => ({
    getOrders: vi.fn(),
    getOrdersByHoReCa: vi.fn(),
    getOrdersByUser: vi.fn(),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    getPickedUnits: vi.fn(),
    updateOrderStatus: (...a: unknown[]) => updateOrderStatus(...a),
}))

const { useUpdateOrderStatus, usePendingOrderStatusIds, orderKeys } = await import('@/hooks/queries/useOrders')

let qc: QueryClient
const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)

const ALL = orderKeys.filtered({})
const BY_HORECA = orderKeys.byHoReCa(7)
const PICKED = orderKeys.pickedUnits('o1')

beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
    qc.setQueryData(ALL, [{ id: 'o1', status: 'processed' }, { id: 'o2', status: 'processed' }])
    qc.setQueryData(BY_HORECA, [{ id: 'o1', status: 'processed' }])
    qc.setQueryData(PICKED, 4)
    updateOrderStatus.mockReset()
})

describe('useUpdateOrderStatus', () => {
    it('patches the one order in every cached list as soon as the server agrees', async () => {
        let resolve: (v: unknown) => void = () => {}
        updateOrderStatus.mockReturnValue(new Promise((r) => { resolve = r }))
        const { result } = renderHook(() => useUpdateOrderStatus(), { wrapper })

        act(() => { result.current.mutate({ id: 'o1', status: 'packed' }) })
        // Pessimistic: the server validates the ladder, so nothing moves yet.
        expect((qc.getQueryData(ALL) as Array<{ status: string }>)[0].status).toBe('processed')

        await act(async () => { resolve({}) })
        await waitFor(() => expect((qc.getQueryData(ALL) as Array<{ status: string }>)[0].status).toBe('packed'))
        expect((qc.getQueryData(ALL) as Array<{ status: string }>)[1].status).toBe('processed')
        expect((qc.getQueryData(BY_HORECA) as Array<{ status: string }>)[0].status).toBe('packed')
        expect(qc.getQueryData(PICKED)).toBe(4)
    })

    it('leaves the cache alone when the server refuses', async () => {
        updateOrderStatus.mockRejectedValue(new Error('nope'))
        const { result } = renderHook(() => useUpdateOrderStatus(), { wrapper })

        await act(async () => { await result.current.mutateAsync({ id: 'o1', status: 'packed' }).catch(() => {}) })
        expect((qc.getQueryData(ALL) as Array<{ status: string }>)[0].status).toBe('processed')
    })

    it('reports which orders have a status change in flight', async () => {
        let resolve: (v: unknown) => void = () => {}
        updateOrderStatus.mockReturnValue(new Promise((r) => { resolve = r }))
        const { result } = renderHook(
            () => ({ mutation: useUpdateOrderStatus(), pending: usePendingOrderStatusIds() }),
            { wrapper },
        )
        expect(result.current.pending.has('o1')).toBe(false)

        act(() => { result.current.mutation.mutate({ id: 'o1', status: 'packed' }) })
        await waitFor(() => expect(result.current.pending.has('o1')).toBe(true))
        expect(result.current.pending.has('o2')).toBe(false)

        await act(async () => { resolve({}) })
        await waitFor(() => expect(result.current.pending.has('o1')).toBe(false))
    })
})

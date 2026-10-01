import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const recordPick = vi.fn()

vi.mock('@/services/supabase/pickService', () => ({
    getPickQueue: vi.fn(),
    recordPick: (...a: unknown[]) => recordPick(...a),
    generatePickSlip: vi.fn(),
    generateDispatchAdvice: vi.fn(),
}))
vi.mock('@/services/supabase/orderService', () => ({ updateOrderStatus: vi.fn() }))

const { useRecordPick, pickKeys } = await import('@/hooks/queries/usePickQueue')
const { pickTaskKeys } = await import('@/hooks/queries/useOrderPickTasks')

const TASKS = pickTaskKeys.forOrder('o1')
let qc: QueryClient
const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)

function deferred<T = unknown>() {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

const tasks = () => qc.getQueryData<Array<{ orderItemId: number; remaining: number; pickedQty: number }>>(TASKS)!
const picked = () => qc.getQueryData<Array<{ lines: Array<{ picked: number }> }>>(pickKeys.queue)![0].lines[0].picked

beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
    qc.setQueryData(TASKS, [
        { orderItemId: 1, locationId: 5, pickedQty: 0, remaining: 3 },
        { orderItemId: 2, locationId: 6, pickedQty: 0, remaining: 2 },
    ])
    qc.setQueryData(pickKeys.queue, [{ orderId: 'o1', lines: [{ orderItemId: 1, picked: 0 }] }])
    recordPick.mockReset()
})

const PICK = { orderId: 'o1', orderItemId: 1, pickedQty: 3, locationId: 5 }

describe('useRecordPick (optimistic)', () => {
    it('moves the counts on Confirm, before the server answers', async () => {
        const d = deferred()
        recordPick.mockReturnValue(d.promise)
        const { result } = renderHook(() => useRecordPick(), { wrapper })

        act(() => { result.current.mutate(PICK) })
        await waitFor(() => expect(picked()).toBe(3))
        expect(tasks()[0].remaining).toBe(0)
        // The finished task stays mounted until the server agrees.
        expect(tasks()).toHaveLength(2)

        await act(async () => { d.resolve({ line_fully_picked: false, order_fully_picked: false }) })
        await waitFor(() => expect(tasks()).toHaveLength(1))
    })

    it('rolls the counts back when the server refuses the scan', async () => {
        recordPick.mockRejectedValue(new Error('wrong bin'))
        const { result } = renderHook(() => useRecordPick(), { wrapper })

        await act(async () => { await result.current.mutateAsync(PICK).catch(() => {}) })
        expect(picked()).toBe(0)
        expect(tasks()[0].remaining).toBe(3)
    })

    it('does not undo a second in-flight pick when the first is refused', async () => {
        const first = deferred()
        const second = deferred()
        recordPick.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
        const a = renderHook(() => useRecordPick(), { wrapper })
        const b = renderHook(() => useRecordPick(), { wrapper })

        act(() => {
            a.result.current.mutate(PICK)
            b.result.current.mutate({ orderId: 'o1', orderItemId: 2, pickedQty: 2, locationId: 6 })
        })
        await waitFor(() => expect(tasks()[1].remaining).toBe(0))

        await act(async () => { first.reject(new Error('wrong bin')) })
        expect(tasks()[1].remaining).toBe(0)
        expect(qc.getQueryState(TASKS)?.isInvalidated).toBe(true)

        await act(async () => { second.resolve({ line_fully_picked: false, order_fully_picked: false }) })
    })
})

describe('useRecordPick with overlapping picks', () => {
    it('a refused pick undoes only itself, even after a later pick succeeded', async () => {
        const first = deferred()
        recordPick.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ line_fully_picked: false, order_fully_picked: false })
        const a = renderHook(() => useRecordPick(), { wrapper })
        const b = renderHook(() => useRecordPick(), { wrapper })

        act(() => { a.result.current.mutate({ orderId: 'o1', orderItemId: 1, pickedQty: 1, locationId: 5 }) })
        await waitFor(() => expect(tasks()[0].remaining).toBe(2))
        await act(async () => { await b.result.current.mutateAsync({ orderId: 'o1', orderItemId: 2, pickedQty: 1, locationId: 6 }) })

        await act(async () => { first.reject(new Error('wrong bin')) })
        // A is undone; B (which the server recorded) is not.
        expect(tasks().find((t) => t.orderItemId === 1)!.remaining).toBe(3)
        expect(tasks().find((t) => t.orderItemId === 2)!.remaining).toBe(1)
        expect(picked()).toBe(0)
    })

    it('a success removes only ITS finished task, not another pick still awaiting the server', async () => {
        const second = deferred()
        // B is sent first, so it takes the deferred answer.
        recordPick.mockReturnValueOnce(second.promise).mockResolvedValueOnce({ line_fully_picked: false, order_fully_picked: false })
        const a = renderHook(() => useRecordPick(), { wrapper })
        const b = renderHook(() => useRecordPick(), { wrapper })

        act(() => { b.result.current.mutate({ orderId: 'o1', orderItemId: 2, pickedQty: 2, locationId: 6 }) })
        await waitFor(() => expect(tasks()[1].remaining).toBe(0))
        await act(async () => { await a.result.current.mutateAsync(PICK) })

        expect(tasks().map((t) => t.orderItemId)).toEqual([2])
        await act(async () => { second.resolve({ line_fully_picked: false, order_fully_picked: false }) })
    })
})

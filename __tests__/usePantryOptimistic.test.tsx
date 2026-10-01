import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const upsertPantryItem = vi.fn()
const deletePantryItem = vi.fn()
const getPantryItems = vi.fn()

vi.mock('@/services/supabase/pantryService', () => ({
    upsertPantryItem: (...a: unknown[]) => upsertPantryItem(...a),
    deletePantryItem: (...a: unknown[]) => deletePantryItem(...a),
    getPantryItems: (...a: unknown[]) => getPantryItems(...a),
}))

const { useUpsertPantryItem, useDeletePantryItem, pantryKeys } = await import('@/hooks/queries/usePantry')

const KEY = pantryKeys.byHoReCa(7)
const ROW = { horeca_id: 7, product_id: 1, preferred_pack_size: null, default_quantity: 2 }

function deferred<T = unknown>() {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

let qc: QueryClient
const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)

beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
    qc.setQueryData(KEY, [ROW])
    upsertPantryItem.mockReset()
    deletePantryItem.mockReset()
    getPantryItems.mockReset()
    getPantryItems.mockImplementation(async () => qc.getQueryData(KEY))
})

const rows = () => qc.getQueryData<Array<typeof ROW>>(KEY)!

describe('useUpsertPantryItem (optimistic)', () => {
    it('writes the cache before the server answers', async () => {
        const d = deferred()
        upsertPantryItem.mockReturnValue(d.promise)
        const { result } = renderHook(() => useUpsertPantryItem(), { wrapper })

        act(() => { result.current.mutate({ ...ROW, default_quantity: 5 }) })
        await waitFor(() => expect(rows()[0].default_quantity).toBe(5))
        expect(upsertPantryItem).toHaveBeenCalledTimes(1)

        await act(async () => { d.resolve(ROW) })
    })

    it('rolls the cache back when the server refuses', async () => {
        upsertPantryItem.mockRejectedValue(new Error('nope'))
        const { result } = renderHook(() => useUpsertPantryItem(), { wrapper })

        await act(async () => {
            await result.current.mutateAsync({ ...ROW, default_quantity: 5 }).catch(() => {})
        })
        expect(rows()[0].default_quantity).toBe(2)
    })

    it('sends writes for one HoReCa one at a time, in click order', async () => {
        const first = deferred()
        upsertPantryItem.mockReturnValueOnce(first.promise).mockResolvedValue(ROW)
        const { result } = renderHook(() => useUpsertPantryItem(), { wrapper })

        act(() => {
            result.current.mutate({ ...ROW, default_quantity: 3 })
            result.current.mutate({ ...ROW, default_quantity: 4 })
        })
        await waitFor(() => expect(upsertPantryItem).toHaveBeenCalledTimes(1))
        await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
        expect(upsertPantryItem).toHaveBeenCalledTimes(1)

        await act(async () => { first.resolve(ROW) })
        await waitFor(() => expect(upsertPantryItem).toHaveBeenCalledTimes(2))
        expect(upsertPantryItem.mock.calls[1][0].default_quantity).toBe(4)
    })
})

describe('pantry write failures', () => {
    it('reports EVERY failed write, not just the latest mutate() call', async () => {
        const onWriteError = vi.fn()
        const first = deferred()
        upsertPantryItem.mockReturnValueOnce(first.promise).mockResolvedValue(ROW)
        const { result } = renderHook(() => useUpsertPantryItem({ onWriteError }), { wrapper })

        act(() => {
            result.current.mutate({ ...ROW, default_quantity: 3 })
            result.current.mutate({ ...ROW, default_quantity: 4 })
        })
        await act(async () => { first.reject(new Error('nope')) })
        await waitFor(() => expect(upsertPantryItem).toHaveBeenCalledTimes(2))

        expect(onWriteError).toHaveBeenCalledTimes(1)
    })

    it('does not roll back over newer queued edits; the final refetch settles it', async () => {
        const first = deferred()
        const second = deferred()
        upsertPantryItem.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
        getPantryItems.mockResolvedValue([{ ...ROW, default_quantity: 4 }])
        const { result } = renderHook(() => useUpsertPantryItem(), { wrapper })

        act(() => {
            result.current.mutate({ ...ROW, default_quantity: 3 })
            result.current.mutate({ ...ROW, default_quantity: 4 })
        })
        await waitFor(() => expect(rows()[0].default_quantity).toBe(4))

        await act(async () => { first.reject(new Error('nope')) })
        // Edit 2 is still queued: restoring edit 1's snapshot (2) would hide it.
        expect(rows()[0].default_quantity).toBe(4)

        await act(async () => { second.resolve(ROW) })
        // No observer is mounted here, so invalidation marks the query stale
        // (a mounted pantry list would refetch it) rather than fetching.
        await waitFor(() => expect(qc.getQueryState(KEY)?.isInvalidated).toBe(true))
        expect(rows()[0].default_quantity).toBe(4)
    })
})

describe('useDeletePantryItem (optimistic)', () => {
    it('removes the row immediately and restores it on failure', async () => {
        const d = deferred()
        deletePantryItem.mockReturnValue(d.promise)
        const { result } = renderHook(() => useDeletePantryItem(), { wrapper })

        act(() => { result.current.mutate({ horecaId: 7, productId: 1 }) })
        await waitFor(() => expect(rows()).toHaveLength(0))

        await act(async () => { d.reject(new Error('nope')) })
        await waitFor(() => expect(rows()).toHaveLength(1))
    })
})

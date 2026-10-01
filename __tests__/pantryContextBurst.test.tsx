import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Three "+" presses delivered in ONE synchronous burst must still add 3. The
// optimistic cache write lands a microtask after mutate(), so reading the
// cache alone would hand clicks 2 and 3 the pre-click quantity.

const upsertPantryItem = vi.fn()
vi.mock('@/services/supabase/pantryService', () => ({
    upsertPantryItem: (...a: unknown[]) => upsertPantryItem(...a),
    deletePantryItem: vi.fn(),
    getPantryItems: vi.fn(async () => [{ horeca_id: 7, product_id: 1, preferred_pack_size: null, default_quantity: 2 }]),
}))
vi.mock('@/context/OrderContext', () => ({
    useOrderContext: () => ({ selectedHoReCa: { id: 7 }, handleAddItem: vi.fn() }),
}))
vi.mock('../context/OrderContext', () => ({
    useOrderContext: () => ({ selectedHoReCa: { id: 7 }, handleAddItem: vi.fn() }),
}))

const { PantryProvider, usePantryContext } = await import('@/context/PantryContext')

let api: ReturnType<typeof usePantryContext> | null = null
function Probe() {
    api = usePantryContext()
    return null
}

beforeEach(() => {
    api = null
    upsertPantryItem.mockReset()
    upsertPantryItem.mockImplementation(async (item: unknown) => item)
})

describe('PantryContext quantity burst', () => {
    it('three synchronous +1s send 3, 4, 5', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
        render(
            <QueryClientProvider client={qc}>
                <PantryProvider products={[]} allOrders={[]} appSettings={{} as never} addToast={vi.fn()}>
                    <Probe />
                </PantryProvider>
            </QueryClientProvider>,
        )
        await waitFor(() => expect(api!.currentPantryItems).toHaveLength(1))

        act(() => {
            api!.handleUpdatePantryItem(1, { quantityDelta: 1 })
            api!.handleUpdatePantryItem(1, { quantityDelta: 1 })
            api!.handleUpdatePantryItem(1, { quantityDelta: 1 })
        })

        await waitFor(() => expect(upsertPantryItem).toHaveBeenCalledTimes(3))
        expect(upsertPantryItem.mock.calls.map((c) => (c[0] as { default_quantity: number }).default_quantity)).toEqual([3, 4, 5])
    })

    it('a quantity click right after adding a product builds on the added row', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
        render(
            <QueryClientProvider client={qc}>
                <PantryProvider products={[]} allOrders={[]} appSettings={{} as never} addToast={vi.fn()}>
                    <Probe />
                </PantryProvider>
            </QueryClientProvider>,
        )
        await waitFor(() => expect(api!.currentPantryItems).toHaveLength(1))

        act(() => {
            api!.handleTogglePantry(2)
            api!.handleUpdatePantryItem(2, { quantityDelta: 1 })
        })

        await waitFor(() => expect(upsertPantryItem).toHaveBeenCalledTimes(2))
        expect(upsertPantryItem.mock.calls.map((c) => (c[0] as { product_id: number; default_quantity: number }))
            .map((c) => [c.product_id, c.default_quantity])).toEqual([[2, 1], [2, 2]])
    })

    it('after a refused write, the next click builds on what is saved, not on the refused value', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
        let releaseOther!: () => void
        upsertPantryItem
            .mockImplementationOnce(async () => { throw new Error('refused') })
            .mockImplementationOnce(() => new Promise((res) => { releaseOther = () => res({}) }))
            .mockImplementation(async (item: unknown) => item)
        render(
            <QueryClientProvider client={qc}>
                <PantryProvider products={[]} allOrders={[]} appSettings={{} as never} addToast={vi.fn()}>
                    <Probe />
                </PantryProvider>
            </QueryClientProvider>,
        )
        await waitFor(() => expect(api!.currentPantryItems).toHaveLength(1))

        // Product 1: +1 is refused. Product 3 (added) keeps a write pending.
        act(() => { api!.handleUpdatePantryItem(1, { quantityDelta: 1 }) })
        await waitFor(() => expect(upsertPantryItem).toHaveBeenCalledTimes(1))
        act(() => { api!.handleTogglePantry(3) })
        await waitFor(() => expect(upsertPantryItem).toHaveBeenCalledTimes(2))

        act(() => { api!.handleUpdatePantryItem(1, { quantityDelta: 1 }) })
        releaseOther()
        await waitFor(() => expect(upsertPantryItem).toHaveBeenCalledTimes(3))
        // Saved quantity is 2, so this is 3 — not 4 built on the refused 3.
        expect((upsertPantryItem.mock.calls[2][0] as { default_quantity: number }).default_quantity).toBe(3)
    })
})

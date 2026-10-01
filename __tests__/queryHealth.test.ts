import { describe, it, expect } from 'vitest'
import { summariseQueries } from '@/lib/queryHealth'

const q = (o: Partial<{ isError: boolean; isPending: boolean; fetchStatus: 'fetching' | 'paused' | 'idle' }>) => ({
    isError: false,
    isPending: false,
    fetchStatus: 'idle' as const,
    ...o,
})

describe('summariseQueries', () => {
    it('reports failed queries by label', () => {
        const s = summariseQueries([
            { label: 'orders', query: q({ isError: true }) },
            { label: 'products', query: q({}) },
        ])
        expect(s.failed).toEqual(['orders'])
        expect(s.loading).toEqual([])
    })

    it('reports a first load in progress, but not a background refetch of data already shown', () => {
        const s = summariseQueries([
            { label: 'orders', query: q({ isPending: true, fetchStatus: 'fetching' }) },
            { label: 'products', query: q({ isPending: false, fetchStatus: 'fetching' }) },
        ])
        expect(s.loading).toEqual(['orders'])
    })

    it('ignores DISABLED queries (pending but idle) — a role that never loads a list is not "loading" it', () => {
        expect(summariseQueries([{ label: 'visits', query: q({ isPending: true, fetchStatus: 'idle' }) }]))
            .toEqual({ failed: [], loading: [] })
    })

    it('counts an offline first load (paused) as loading', () => {
        expect(summariseQueries([{ label: 'orders', query: q({ isPending: true, fetchStatus: 'paused' }) }]).loading)
            .toEqual(['orders'])
    })
})

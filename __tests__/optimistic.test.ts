import { describe, it, expect, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { optimisticUpdate, patchRowById, removeRowById } from '@/lib/optimistic'

let qc: QueryClient

beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    qc.setQueryData(['promotions'], [{ id: 'a', is_active: true }, { id: 'b', is_active: true }])
    qc.setQueryData(['promotions', 'active'], [{ id: 'a', is_active: true }])
    qc.setQueryData(['promotions', 'count'], 2)
    qc.setQueryData(['products'], [{ id: 'a', is_active: true }])
})

type Vars = { id: string; updates: { is_active: boolean } }
const handlers = () => optimisticUpdate<Vars>(qc, ['promotions'], (data, { id, updates }) => patchRowById(data, id, updates))

describe('optimisticUpdate', () => {
    it('patches every cached list under the prefix, and nothing outside it', async () => {
        await handlers().onMutate({ id: 'a', updates: { is_active: false } })

        expect(qc.getQueryData<Array<{ is_active: boolean }>>(['promotions'])![0].is_active).toBe(false)
        expect(qc.getQueryData<Array<{ is_active: boolean }>>(['promotions'])![1].is_active).toBe(true)
        expect(qc.getQueryData<Array<{ is_active: boolean }>>(['promotions', 'active'])![0].is_active).toBe(false)
        expect(qc.getQueryData(['promotions', 'count'])).toBe(2)
        expect(qc.getQueryData<Array<{ is_active: boolean }>>(['products'])![0].is_active).toBe(true)
    })

    it('restores every snapshot on error', async () => {
        const h = handlers()
        const vars = { id: 'a', updates: { is_active: false } }
        const ctx = await h.onMutate(vars)
        h.onError(new Error('nope'), vars, ctx)

        expect(qc.getQueryData<Array<{ is_active: boolean }>>(['promotions'])![0].is_active).toBe(true)
        expect(qc.getQueryData<Array<{ is_active: boolean }>>(['promotions', 'active'])![0].is_active).toBe(true)
    })

    it('marks the prefix stale once settled, so the server has the last word', async () => {
        const h = handlers()
        const vars = { id: 'a', updates: { is_active: false } }
        await h.onMutate(vars)
        await h.onSettled(undefined as never, null, vars)

        expect(qc.getQueryState(['promotions'])?.isInvalidated).toBe(true)
        expect(qc.getQueryState(['products'])?.isInvalidated).toBe(false)
    })

    it('derives the prefix from the variables when given a function', async () => {
        qc.setQueryData(['offhome', 7, 'suggested'], [{ id: 1 }, { id: 2 }])
        qc.setQueryData(['offhome', 8, 'suggested'], [{ id: 1 }])
        const h = optimisticUpdate<{ warehouseId: number; taskId: number }>(
            qc,
            ({ warehouseId }) => ['offhome', warehouseId],
            (data, { taskId }) => removeRowById(data, taskId),
        )
        await h.onMutate({ warehouseId: 7, taskId: 1 })

        expect(qc.getQueryData(['offhome', 7, 'suggested'])).toEqual([{ id: 2 }])
        expect(qc.getQueryData(['offhome', 8, 'suggested'])).toEqual([{ id: 1 }])
    })
})

describe('patchRowById / removeRowById', () => {
    it('return non-arrays untouched', () => {
        expect(patchRowById(5, 'a', { x: 1 })).toBe(5)
        expect(removeRowById(undefined, 'a')).toBeUndefined()
    })

    it('return the same array when no row matches, so observers do not re-render', () => {
        const rows = [{ id: 'a' }]
        expect(patchRowById(rows, 'zz', { x: 1 })).toBe(rows)
        expect(removeRowById(rows, 'zz')).toBe(rows)
    })

    it('accept a function patch', () => {
        expect(patchRowById([{ id: 'a', n: 1 }], 'a', (r: { n: number }) => ({ n: r.n + 1 }))).toEqual([{ id: 'a', n: 2 }])
    })
})

describe('optimisticUpdate with concurrent edits', () => {
    it('neither restores a stale snapshot nor refetches while another edit is in flight', async () => {
        const { MutationObserver } = await import('@tanstack/react-query')
        qc.setQueryData(['notifications'], [{ id: 'a', read: false }, { id: 'b', read: false }])
        const opts = (fn: () => Promise<unknown>) => ({
            mutationFn: fn,
            ...optimisticUpdate<string>(qc, ['notifications'], (d, id) => patchRowById(d, id, { read: true })),
        })
        let rejectA!: (e: unknown) => void
        let resolveB!: (v: unknown) => void
        const a = new MutationObserver(qc, opts(() => new Promise((_, rej) => { rejectA = rej })))
        const b = new MutationObserver(qc, opts(() => new Promise((res) => { resolveB = res })))

        const pa = a.mutate('a').catch(() => {})
        const pb = b.mutate('b')
        await new Promise((r) => setTimeout(r, 0))
        const rows = () => qc.getQueryData<Array<{ id: string; read: boolean }>>(['notifications'])!
        expect(rows().map((r) => r.read)).toEqual([true, true])

        rejectA(new Error('nope'))
        await pa
        // A's snapshot predates B's edit: restoring it would flash B unread.
        expect(rows()[1].read).toBe(true)
        expect(qc.getQueryState(['notifications'])?.isInvalidated).toBe(false)

        resolveB({})
        await pb
        expect(qc.getQueryState(['notifications'])?.isInvalidated).toBe(true)
    })
})

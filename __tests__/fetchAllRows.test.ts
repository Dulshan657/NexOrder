import { describe, it, expect, vi } from 'vitest'
import { fetchAllRows } from '@/lib/fetchAllRows'

const table = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }))

function pager(rows: Array<{ id: number }>) {
    return vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }))
}

describe('fetchAllRows', () => {
    it('one request when everything fits in a page', async () => {
        const page = pager(table(10))
        expect(await fetchAllRows(page, 4 * 10)).toHaveLength(10)
        expect(page).toHaveBeenCalledTimes(1)
    })

    it('keeps paging past the row cap instead of silently stopping at it', async () => {
        const page = pager(table(2500))
        const rows = await fetchAllRows(page, 1000)
        expect(rows).toHaveLength(2500)
        expect(page.mock.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
    })

    it('an exact multiple costs one extra (empty) page, not a lost page', async () => {
        const page = pager(table(2000))
        expect(await fetchAllRows(page, 1000)).toHaveLength(2000)
        expect(page).toHaveBeenCalledTimes(3)
    })

    it('throws the page error', async () => {
        const err = new Error('boom')
        await expect(fetchAllRows(async () => ({ data: null, error: err }), 10)).rejects.toBe(err)
    })
})

describe('fetchAllRows de-duplication', () => {
    it('drops a row repeated across a page boundary (an insert shifted the window)', async () => {
        const pages = [[{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }], [{ id: 4 }]]
        const rows = await fetchAllRows(async (from) => ({ data: pages[from / 2], error: null }), 2)
        expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4])
    })
})

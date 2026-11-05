import { beforeEach, describe, expect, it, vi } from 'vitest'

// `locations` is read whole by every screen that resolves a scanned bin code (the Stock
// lookup, the stocktake finder, and the any-bin pick on an imported order). PostgREST
// answers at most 1000 rows a request and says nothing when it truncates, so a site with
// more than 1000 locations (a racked warehouse has a row per bin level) silently lost the
// rest, and a scan of one of them read as "no bin matches". These pin that the list is
// paged past the cap and stays a single request below it.
//
// Every row is made up.

const pages = vi.hoisted(() => ({
  rows: [] as Array<{ id: number; code: string }>,
  ranges: [] as Array<[number, number]>,
  error: null as { message: string } | null,
}))

vi.mock('@/lib/supabase', () => {
  const query = () => {
    const q = {
      select: () => q,
      order: () => q,
      range: (from: number, to: number) => {
        pages.ranges.push([from, to])
        return Promise.resolve({ data: pages.error ? null : pages.rows.slice(from, to + 1), error: pages.error })
      },
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: pages.rows, error: null }).then(ok),
    }
    return q
  }
  return { supabase: { from: () => query() } }
})

const { getLocations } = await import('../services/supabase/inventoryService')

const makeRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    parent_id: null,
    kind: 'BIN',
    code: `TST-B-${i + 1}`,
    name: `Bin ${i + 1}`,
    materialized_path: `1/${i + 1}`,
    is_active: true,
  }))

beforeEach(() => {
  pages.rows = []
  pages.ranges = []
  pages.error = null
})

describe('getLocations', () => {
  it('reads every row of a list longer than the API cap, page by page', async () => {
    pages.rows = makeRows(2500) as never

    const rows = await getLocations()

    expect(rows).toHaveLength(2500)
    expect(rows[2499]).toMatchObject({ id: 2500, code: 'TST-B-2500' })
    expect(pages.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('costs one request for a list under the cap', async () => {
    pages.rows = makeRows(40) as never

    expect(await getLocations()).toHaveLength(40)
    expect(pages.ranges).toEqual([[0, 999]])
  })

  it('throws when a page fails, rather than answering with a short list', async () => {
    pages.rows = makeRows(2500) as never
    pages.error = { message: 'locations is down' }

    await expect(getLocations()).rejects.toMatchObject({ message: 'locations is down' })
  })
})

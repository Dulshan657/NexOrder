import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mirrors __tests__/adjustStock.test.ts's mocking pattern: hoist the fakes so
// they exist before vi.mock's factory runs, then stub the `.from().select().eq()`
// chain getPendingPutawayCounts exercises.
const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: { from },
}))

import { getPendingPutawayCounts } from '../services/supabase/putawayQueueService'

function selectEqChain(result: { data: unknown; error: unknown }) {
  return {
    select: (_cols: string) => ({
      eq: (_col: string, _val: string) => Promise.resolve(result),
    }),
  }
}

describe('getPendingPutawayCounts', () => {
  beforeEach(() => from.mockReset())

  it('reduces suggested rows to a per-warehouse total', async () => {
    from.mockReturnValue(
      selectEqChain({
        data: [{ warehouse_id: 1 }, { warehouse_id: 1 }, { warehouse_id: 2 }],
        error: null,
      }),
    )
    const counts = await getPendingPutawayCounts()
    expect(counts).toEqual({ 1: 2, 2: 1 })
    expect(from).toHaveBeenCalledWith('wie_putaway_recommendations')
  })

  it('returns {} when there are no pending rows', async () => {
    from.mockReturnValue(selectEqChain({ data: [], error: null }))
    expect(await getPendingPutawayCounts()).toEqual({})
  })

  it('treats a null data payload the same as an empty list', async () => {
    from.mockReturnValue(selectEqChain({ data: null, error: null }))
    expect(await getPendingPutawayCounts()).toEqual({})
  })

  it('throws on a query error rather than returning a silent {}', async () => {
    from.mockReturnValue(selectEqChain({ data: null, error: { message: 'boom' } }))
    await expect(getPendingPutawayCounts()).rejects.toEqual({ message: 'boom' })
  })
})

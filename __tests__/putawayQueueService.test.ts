import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mirrors __tests__/adjustStock.test.ts's mocking pattern: hoist the fakes so
// they exist before vi.mock's factory runs, then stub the `.from().select().eq()`
// chain getPendingPutawayCounts exercises.
const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: { from },
}))

import {
  getWalkPutaways,
  getPendingPutaways,
  getPendingPutawayCounts,
} from '../services/supabase/putawayQueueService'

// Since mig 00080 the counts read spans two statuses, so the chain terminates
// on .in() rather than .eq() — 'assigned' work is still outstanding work.
function selectInChain(result: { data: unknown; error: unknown }, seen: { statuses?: string[] } = {}) {
  return {
    select: (_cols: string) => ({
      in: (_col: string, values: string[]) => {
        seen.statuses = values
        return Promise.resolve(result)
      },
    }),
  }
}

// getPendingPutaways chains .select().eq().eq().order(); capture the column list
// so the test can assert the product/receipt joins are actually requested.
function queueChain(result: { data: unknown; error: unknown }, seen: { cols?: string } = {}) {
  const tail = {
    eq: () => tail,
    or: () => tail,
    order: (_col: string, _opts: unknown) => Promise.resolve(result),
  }
  return {
    select: (cols: string) => {
      seen.cols = cols
      return tail
    },
  }
}

// The Walk also reads each product's live home (NX-0033), in ONE batched read of
// product_home_bins. Answer per table so a test controls both reads.
function homesChain(result: { data: unknown; error: unknown }, calls: Array<[string, ...unknown[]]> = []) {
  const tail: Record<string, unknown> = {
    eq: (...a: unknown[]) => { calls.push(['eq', ...a]); return tail },
    in: (...a: unknown[]) => { calls.push(['in', ...a]); return Promise.resolve(result) },
  }
  return { select: (cols: string) => { calls.push(['select', cols]); return tail } }
}

/** `from(table)`: the queue table answers with `queue`, product_home_bins with `homes`. */
function routeTables(queue: unknown, homes: unknown) {
  from.mockImplementation((table: string) => (table === 'product_home_bins' ? homes : queue))
}

describe('getPendingPutaways', () => {
  beforeEach(() => from.mockReset())

  const dbRow = {
    id: 7,
    product_id: 42,
    quantity: '48.000',
    recommended_location_id: 100,
    explanation: { engineVersion: 'v1', candidatesConsidered: 3 },
    created_at: '2026-07-20T01:00:00Z',
    products: {
      id: 42, sku: 'FS-1', name: 'Fish Sauce', description: '', price: 4,
      category: 'Sauces', inventory: 0, available: 0, unit: 'bottle',
      carton_size: 12, supplier_id: 1,
      product_uoms: [
        { id: 1, product_id: 42, code: 'bottle', factor_to_base: 1, is_base: true, price: 4, is_orderable: true, is_receivable: true, sort_order: 0 },
      ],
    },
    goods_receipts: {
      id: 9, reference: 'GRN-9', received_date: '2026-07-20', suppliers: { name: 'Acme' },
    },
  }

  it('asks for the product and receipt joins, not a bare row', async () => {
    const seen: { cols?: string } = {}
    from.mockReturnValue(queueChain({ data: [], error: null }, seen))
    await getPendingPutaways(1)
    expect(seen.cols).toContain('products(')
    expect(seen.cols).toContain('product_uoms(*)')
    expect(seen.cols).toContain('goods_receipts(')
  })

  it('maps the embedded product and receipt onto the row', async () => {
    from.mockReturnValue(queueChain({ data: [dbRow], error: null }))
    const [row] = await getPendingPutaways(1)

    expect(row.id).toBe(7)
    expect(row.quantity).toBe(48)
    expect(row.createdAt).toBe('2026-07-20T01:00:00Z')
    expect(row.product?.name).toBe('Fish Sauce')
    expect(row.product?.sku).toBe('FS-1')
    expect(row.product?.uoms?.map((u) => u.code)).toEqual(['bottle'])
    expect(row.receipt).toEqual({
      id: 9, reference: 'GRN-9', receivedDate: '2026-07-20', supplierName: 'Acme',
    })
  })

  it('leaves product/receipt null when the embeds are absent', async () => {
    from.mockReturnValue(queueChain({
      data: [{ ...dbRow, products: null, goods_receipts: null }],
      error: null,
    }))
    const [row] = await getPendingPutaways(1)
    expect(row.product).toBeNull()
    expect(row.receipt).toBeNull()
    // The row is still actionable — the UI falls back to `Product #42`.
    expect(row.productId).toBe(42)
  })

  it('tolerates a receipt with no supplier joined', async () => {
    from.mockReturnValue(queueChain({
      data: [{ ...dbRow, goods_receipts: { id: 9, reference: null, received_date: null, suppliers: null } }],
      error: null,
    }))
    const [row] = await getPendingPutaways(1)
    expect(row.receipt).toEqual({ id: 9, reference: null, receivedDate: null, supplierName: null })
  })

  it('throws on a query error rather than returning an empty queue', async () => {
    from.mockReturnValue(queueChain({ data: null, error: { message: 'boom' } }))
    await expect(getPendingPutaways(1)).rejects.toEqual({ message: 'boom' })
  })
})

describe('getWalkPutaways', () => {
  beforeEach(() => from.mockReset())

  // The walk needs the destination bin, and it is NOT recommended_location_id:
  // the desk can assign somewhere the engine never suggested.
  it('maps the assigned bin and its timestamp onto the row', async () => {
    routeTables(queueChain({
      data: [{
        id: 7, product_id: 42, quantity: '48.000', recommended_location_id: 100,
        explanation: {}, created_at: '2026-07-20T01:00:00Z',
        products: null, goods_receipts: null,
        handling_units: { id: 3, code: 'HU-000123', hu_type: 'pallet' },
        assigned_location_id: 205, assigned_at: '2026-07-24T09:00:00Z',
      }],
      error: null,
    }), homesChain({ data: [], error: null }))
    const [row] = await getWalkPutaways(1)
    expect(row.assignedLocationId).toBe(205)
    expect(row.assignedAt).toBe('2026-07-24T09:00:00Z')
    // The plate is what the walker scans, so it has to survive the mapping.
    expect(row.huCode).toBe('HU-000123')
    expect(row.huType).toBe('pallet')
  })

  it('leaves the assigned bin null for a row that has none', async () => {
    routeTables(queueChain({
      data: [{
        id: 8, product_id: 42, quantity: '1', recommended_location_id: null,
        explanation: {}, created_at: '2026-07-20T01:00:00Z',
        products: null, goods_receipts: null,
      }],
      error: null,
    }), homesChain({ data: [], error: null }))
    const [row] = await getWalkPutaways(1)
    expect(row.assignedLocationId).toBeNull()
    expect(row.huCode).toBeNull()
  })
})

describe('getWalkPutaways (the query)', () => {
  beforeEach(() => from.mockReset())

  // Records each call in order, so the test pins the query's shape and not just
  // the rows it returns.
  function recordingChain(result: { data: unknown; error: unknown }) {
    const calls: Array<[string, ...unknown[]]> = []
    const tail: Record<string, unknown> = {
      eq: (...a: unknown[]) => { calls.push(['eq', ...a]); return tail },
      or: (...a: unknown[]) => { calls.push(['or', ...a]); return tail },
      order: (...a: unknown[]) => { calls.push(['order', ...a]); return Promise.resolve(result) },
    }
    return { calls, chain: { select: (_cols: string) => tail } }
  }

  it('asks for assigned lines and overflow lines awaiting confirmation, oldest first', async () => {
    const { calls, chain } = recordingChain({ data: [], error: null })
    from.mockReturnValue(chain)
    await getWalkPutaways(12)
    expect(from).toHaveBeenCalledWith('wie_putaway_recommendations')
    expect(calls).toEqual([
      ['eq', 'warehouse_id', 12],
      ['or', 'status.eq.assigned,and(status.eq.suggested,suggestion_source.eq.overflow,recommended_location_id.not.is.null,unit_load.eq.false)'],
      ['order', 'created_at', { ascending: true }],
    ])
  })

  it('maps the status onto the row, so a confirm stop can be told from an assigned one', async () => {
    const base = {
      product_id: 42, quantity: '2', explanation: {}, created_at: '2026-07-20T01:00:00Z',
      products: null, goods_receipts: null,
    }
    const { chain } = recordingChain({
      data: [
        { ...base, id: 1, status: 'assigned', recommended_location_id: 100, assigned_location_id: 100, suggestion_source: 'home' },
        { ...base, id: 2, status: 'suggested', recommended_location_id: 5002, assigned_location_id: null, suggestion_source: 'overflow' },
      ],
      error: null,
    })
    routeTables(chain, homesChain({ data: [], error: null }))
    const [assigned, confirm] = await getWalkPutaways(12)
    expect(assigned.status).toBe('assigned')
    expect(confirm).toMatchObject({
      status: 'suggested', suggestionSource: 'overflow', recommendedLocationId: 5002, assignedLocationId: null,
    })
  })

  it('carries unit_load onto the row, so a pallet is not read as a confirm stop', async () => {
    const base = {
      product_id: 42, quantity: '2', explanation: {}, created_at: '2026-07-20T01:00:00Z',
      products: null, goods_receipts: null, status: 'suggested', suggestion_source: 'overflow',
      recommended_location_id: 5002, assigned_location_id: null,
    }
    const { chain } = recordingChain({
      data: [{ ...base, id: 1, unit_load: true }, { ...base, id: 2, unit_load: false }, { ...base, id: 3 }],
      error: null,
    })
    routeTables(chain, homesChain({ data: [], error: null }))
    const rows = await getWalkPutaways(12)
    expect(rows.map((r) => r.unitLoad)).toEqual([true, false, false])
  })

  it('throws on a query error rather than returning an empty walk', async () => {
    const { chain } = recordingChain({ data: null, error: { message: 'boom' } })
    from.mockReturnValue(chain)
    await expect(getWalkPutaways(12)).rejects.toEqual({ message: 'boom' })
  })

  describe("each product's live home (NX-0033)", () => {
    const base = {
      quantity: '2', explanation: {}, created_at: '2026-07-20T01:00:00Z',
      products: null, goods_receipts: null, status: 'assigned',
      recommended_location_id: 100, assigned_location_id: 100, suggestion_source: 'engine',
    }

    it('reads the homes of every product on the walk in ONE batched read', async () => {
      const { chain } = recordingChain({
        data: [
          { ...base, id: 1, product_id: 42 },
          { ...base, id: 2, product_id: 43 },
          { ...base, id: 3, product_id: 42 },
        ],
        error: null,
      })
      const homeCalls: Array<[string, ...unknown[]]> = []
      routeTables(chain, homesChain({ data: [], error: null }, homeCalls))
      await getWalkPutaways(12)

      expect(from.mock.calls.filter(([t]) => t === 'product_home_bins')).toHaveLength(1)
      // This warehouse's primary homes, for the distinct products only.
      expect(homeCalls).toEqual([
        ['select', 'product_id, bin_id'],
        ['eq', 'warehouse_id', 12],
        ['eq', 'purpose', 'primary'],
        ['in', 'product_id', [42, 43]],
      ])
    })

    it("puts each product's current home on its rows, and null where it has none", async () => {
      const { chain } = recordingChain({
        data: [
          { ...base, id: 1, product_id: 42 },
          { ...base, id: 2, product_id: 43 },
          { ...base, id: 3, product_id: 42 },
        ],
        error: null,
      })
      routeTables(chain, homesChain({ data: [{ product_id: 42, bin_id: 6001 }], error: null }))
      const rows = await getWalkPutaways(12)

      expect(rows.map((r) => [r.id, r.homeLocationId])).toEqual([[1, 6001], [2, null], [3, 6001]])
    })

    it('does not read homes for an empty walk', async () => {
      const { chain } = recordingChain({ data: [], error: null })
      from.mockReturnValue(chain)
      await getWalkPutaways(12)
      expect(from.mock.calls.map(([t]) => t)).toEqual(['wie_putaway_recommendations'])
    })

    it('throws when the homes cannot be read, rather than offering a home to a homed product', async () => {
      const { chain } = recordingChain({ data: [{ ...base, id: 1, product_id: 42 }], error: null })
      routeTables(chain, homesChain({ data: null, error: { message: 'no homes' } }))
      await expect(getWalkPutaways(12)).rejects.toEqual({ message: 'no homes' })
    })
  })
})

describe('getPendingPutawayCounts', () => {
  beforeEach(() => from.mockReset())

  it('reduces outstanding rows to a per-warehouse total', async () => {
    from.mockReturnValue(
      selectInChain({
        data: [{ warehouse_id: 1 }, { warehouse_id: 1 }, { warehouse_id: 2 }],
        error: null,
      }),
    )
    const counts = await getPendingPutawayCounts()
    expect(counts).toEqual({ 1: 2, 2: 1 })
    expect(from).toHaveBeenCalledWith('wie_putaway_recommendations')
  })

  it('counts assigned work as outstanding, not just suggested', async () => {
    // A line sent to the walk is still stock sitting on the dock. Counting only
    // 'suggested' would empty the nav badge the moment someone assigned a
    // receipt, which reads as "nothing left to do".
    const seen: { statuses?: string[] } = {}
    from.mockReturnValue(selectInChain({ data: [], error: null }, seen))
    await getPendingPutawayCounts()
    expect(seen.statuses).toEqual(['suggested', 'assigned'])
  })

  it('returns {} when there are no pending rows', async () => {
    from.mockReturnValue(selectInChain({ data: [], error: null }))
    expect(await getPendingPutawayCounts()).toEqual({})
  })

  it('treats a null data payload the same as an empty list', async () => {
    from.mockReturnValue(selectInChain({ data: null, error: null }))
    expect(await getPendingPutawayCounts()).toEqual({})
  })

  it('throws on a query error rather than returning a silent {}', async () => {
    from.mockReturnValue(selectInChain({ data: null, error: { message: 'boom' } }))
    await expect(getPendingPutawayCounts()).rejects.toEqual({ message: 'boom' })
  })
})

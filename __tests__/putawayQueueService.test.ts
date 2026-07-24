import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mirrors __tests__/adjustStock.test.ts's mocking pattern: hoist the fakes so
// they exist before vi.mock's factory runs, then stub the `.from().select().eq()`
// chain getPendingPutawayCounts exercises.
const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: { from },
}))

import {
  getAssignedPutaways,
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
    order: (_col: string, _opts: unknown) => Promise.resolve(result),
  }
  return {
    select: (cols: string) => {
      seen.cols = cols
      return tail
    },
  }
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

describe('getAssignedPutaways', () => {
  beforeEach(() => from.mockReset())

  // The walk needs the destination bin, and it is NOT recommended_location_id:
  // the desk can assign somewhere the engine never suggested.
  it('maps the assigned bin and its timestamp onto the row', async () => {
    from.mockReturnValue(queueChain({
      data: [{
        id: 7, product_id: 42, quantity: '48.000', recommended_location_id: 100,
        explanation: {}, created_at: '2026-07-20T01:00:00Z',
        products: null, goods_receipts: null,
        handling_units: { id: 3, code: 'HU-000123', hu_type: 'pallet' },
        assigned_location_id: 205, assigned_at: '2026-07-24T09:00:00Z',
      }],
      error: null,
    }))
    const [row] = await getAssignedPutaways(1)
    expect(row.assignedLocationId).toBe(205)
    expect(row.assignedAt).toBe('2026-07-24T09:00:00Z')
    // The plate is what the walker scans, so it has to survive the mapping.
    expect(row.huCode).toBe('HU-000123')
    expect(row.huType).toBe('pallet')
  })

  it('leaves the assigned bin null for a row that has none', async () => {
    from.mockReturnValue(queueChain({
      data: [{
        id: 8, product_id: 42, quantity: '1', recommended_location_id: null,
        explanation: {}, created_at: '2026-07-20T01:00:00Z',
        products: null, goods_receipts: null,
      }],
      error: null,
    }))
    const [row] = await getAssignedPutaways(1)
    expect(row.assignedLocationId).toBeNull()
    expect(row.huCode).toBeNull()
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

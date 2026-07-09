import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase client singleton before importing the service, same
// pattern as __tests__/orderService.placeOrder.test.ts.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke } },
}))

import { bulkCreateProducts, type BulkRowOutcome } from '../services/supabase/productService'

const CHUNK_SIZE = 100

function makeRows(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({ sku: `SKU-${i}` }))
}

describe('productService.bulkCreateProducts chunk-error handling (FIX 2)', () => {
  beforeEach(() => invoke.mockReset())

  it('keeps a succeeded chunk\'s results when a LATER chunk fails at the transport level', async () => {
    const rows = makeRows(150) // 2 chunks: [0..99], [100..149]

    invoke
      .mockImplementationOnce(async () => ({
        data: {
          ok: true,
          results: Array.from({ length: CHUNK_SIZE }, (_, i) => ({ index: i, ok: true, id: 1000 + i, sku: `SKU-${i}` })),
        },
        error: null,
      }))
      .mockImplementationOnce(async () => ({
        data: null,
        error: new Error('Failed to fetch'), // simulated network/transport error
      }))

    const results = await bulkCreateProducts(rows)

    expect(results).toHaveLength(150)
    // First chunk's real, successful outcomes must survive untouched.
    const firstChunkResults = results.filter(r => r.index < CHUNK_SIZE)
    expect(firstChunkResults).toHaveLength(CHUNK_SIZE)
    expect(firstChunkResults.every(r => r.ok)).toBe(true)

    // Second chunk must be synthesized as failed, not thrown away or absent.
    const secondChunkResults = results.filter(r => r.index >= CHUNK_SIZE)
    expect(secondChunkResults).toHaveLength(50)
    expect(secondChunkResults.every(r => !r.ok)).toBe(true)
    expect(secondChunkResults.every(r => r.code === 'REQUEST_FAILED')).toBe(true)
    expect(secondChunkResults.map(r => r.index)).toEqual(
      Array.from({ length: 50 }, (_, i) => CHUNK_SIZE + i),
    )
    // sku is preserved per-row from the input, not lost.
    expect(secondChunkResults[0].sku).toBe(`SKU-${CHUNK_SIZE}`)
  })

  it('does not throw — a failed chunk resolves as failed row outcomes instead of rejecting the whole call', async () => {
    const rows = makeRows(10)
    invoke.mockImplementationOnce(async () => ({ data: null, error: new Error('boom') }))

    const results: BulkRowOutcome[] = await bulkCreateProducts(rows)

    expect(results).toHaveLength(10)
    expect(results.every(r => !r.ok)).toBe(true)
  })

  it('continues to a third chunk after a middle chunk fails', async () => {
    const rows = makeRows(250) // 3 chunks: 100, 100, 50

    invoke
      .mockImplementationOnce(async () => ({
        data: { ok: true, results: [{ index: 0, ok: true, id: 1, sku: 'SKU-0' }] },
        error: null,
      }))
      .mockImplementationOnce(async () => ({ data: null, error: new Error('transient failure') }))
      .mockImplementationOnce(async () => ({
        data: { ok: true, results: [{ index: 0, ok: true, id: 2, sku: 'SKU-200' }] },
        error: null,
      }))

    const results = await bulkCreateProducts(rows)

    expect(invoke).toHaveBeenCalledTimes(3)
    // Middle (failed) chunk contributes one synthesized failure per row.
    const middleChunkResults = results.filter(r => r.index >= 100 && r.index < 200)
    expect(middleChunkResults).toHaveLength(100)
    expect(middleChunkResults.every(r => !r.ok && r.code === 'REQUEST_FAILED')).toBe(true)
    // Third chunk's real result remapped to global index 200.
    const thirdChunkOk = results.find(r => r.index === 200)
    expect(thirdChunkOk).toMatchObject({ ok: true, id: 2, sku: 'SKU-200' })
  })
})

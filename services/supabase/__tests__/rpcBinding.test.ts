import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Regression test for a whole class of bug: `supabase.rpc` is a class method
// on SupabaseClient whose body reads `this.rest`. Assigning it to a local
// const (`const rpc = supabase.rpc`) DETACHES it from its receiver, so `this`
// is undefined inside the method and the call throws:
//
//   TypeError: Cannot read properties of undefined (reading 'rest')
//
// before any HTTP request is even attempted. Both getProductStockByWarehouse
// (inventoryService.ts) and getWarehouseReport (warehouseReportService.ts)
// used to do this. The fix is `supabase.rpc.bind(supabase)`.
//
// The fake below models that exact shape: `rpc` is a real method (not an
// arrow function, which would silently close over the outer scope and hide
// the bug) that throws unless called with its receiver intact.
// ---------------------------------------------------------------------------

interface RecordedCall {
  fn: string
  args: unknown
}

// vi.mock(...) below is hoisted above module-level statements, so anything
// it closes over must be created via vi.hoisted, not a plain top-level const.
const { calls, state, fakeSupabase } = vi.hoisted(() => {
  const calls: RecordedCall[] = []
  // Per-call response queue so each test controls what the "server" returns.
  const state: { nextResponse: { data: unknown; error: { message: string } | null } } = {
    nextResponse: { data: null, error: null },
  }
  const fakeSupabase = {
    rest: { marker: true },
    // Real method (shorthand), NOT an arrow function — must observe `this`.
    rpc(fn: string, args: unknown) {
      if (!this || !(this as { rest?: unknown }).rest) {
        throw new TypeError("Cannot read properties of undefined (reading 'rest')")
      }
      calls.push({ fn, args })
      return Promise.resolve(state.nextResponse)
    },
  }
  return { calls, state, fakeSupabase }
})

vi.mock('@/lib/supabase', () => ({
  supabase: fakeSupabase,
}))

import { getProductStockByWarehouse } from '../inventoryService'
import { getWarehouseReport } from '../warehouseReportService'
import type { WarehouseReport } from '@/types'

describe('supabase.rpc receiver binding', () => {
  beforeEach(() => {
    calls.length = 0
    state.nextResponse = { data: null, error: null }
  })

  describe('getProductStockByWarehouse', () => {
    it('resolves without throwing and coerces NUMERIC strings to numbers', async () => {
      state.nextResponse = {
        data: [
          { product_id: 5, on_hand: '120.000', allocated: '20.000', available: '100.000' },
        ],
        error: null,
      }

      const rows = await getProductStockByWarehouse(1)

      expect(rows).toEqual([{ productId: 5, onHand: 120, allocated: 20, available: 100 }])
      expect(calls).toEqual([
        { fn: 'inv_product_stock_by_warehouse', args: { p_warehouse_id: 1 } },
      ])
    })

    it('keeps a zero on-hand row present (absent-vs-zero semantics)', async () => {
      state.nextResponse = {
        data: [{ product_id: 7, on_hand: '0.000', allocated: '0.000', available: '0.000' }],
        error: null,
      }

      const rows = await getProductStockByWarehouse(1)

      expect(rows).toHaveLength(1)
      expect(rows[0]).toEqual({ productId: 7, onHand: 0, allocated: 0, available: 0 })
    })
  })

  describe('getWarehouseReport', () => {
    it('resolves without throwing', async () => {
      const report: WarehouseReport = {
        putaway: {},
        slotting: {},
        velocity: {},
        binCount: 10,
        emptyBins: 2,
        utilizationPct: 80,
        congestion: [],
        latestSimulation: null,
      }
      state.nextResponse = { data: report, error: null }

      const result = await getWarehouseReport(1)

      expect(result).toEqual(report)
      expect(calls).toEqual([{ fn: 'wie_warehouse_report', args: { p_warehouse_id: 1 } }])
    })
  })
})

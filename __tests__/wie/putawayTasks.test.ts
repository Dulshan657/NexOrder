import { describe, it, expect } from 'vitest'
import { generatePutawayTasks } from '../../supabase/functions/_shared/putawayTasks'

// Minimal in-memory Supabase-ish stub covering exactly the calls
// generatePutawayTasks makes: a handful of from(table) reads, the
// wie_putaway_candidates rpc, and insert().select('id').single().

interface StubOpts {
  warehouse: Record<string, unknown>
  candidates: Array<Record<string, unknown>>
  product?: Record<string, unknown>
}

function candidate(o: Partial<{
  location_id: number; code: string; capacity_slots: number | null; used_slots: number
  weight_capacity_kg: number | null; used_weight_kg: number; distance_from_dock_m: number | null
}> = {}): Record<string, unknown> {
  return {
    location_id: 1, code: 'B1', capacity_slots: 100, used_slots: 0,
    weight_capacity_kg: null, used_weight_kg: 0, graph_node_id: 1, access_offset_m: 0,
    has_same_product: false, distance_from_dock_m: 10, zone_id: null, zone_tag: null,
    zone_type: null, zone_priority_weight: null, zone_allowed_categories: null,
    zone_max_utilization_pct: null, bin_categories: [], pick_visits_30d: 0, ...o,
  }
}

function makeAdmin(opts: StubOpts) {
  const inserted: Array<Record<string, unknown>> = []
  const product = opts.product ?? { id: 1, sku: 'S1', name: 'S', size_factor: 1, category: null }

  const listFor = (table: string): Array<Record<string, unknown>> => {
    switch (table) {
      case 'locations': return [opts.warehouse]
      case 'products': return [product]
      case 'wie_rules':
      case 'category_compatibility':
      case 'wie_scoring_profiles':
      case 'product_wms_attributes':
      case 'wie_product_velocity':
      default: return []
    }
  }

  const builder = (rows: Array<Record<string, unknown>>) => {
    const b = {
      eq: () => b,
      or: () => b,
      order: () => b,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => ({ data: rows[0] ?? null, error: null }),
      then: (res: (v: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(res),
    }
    return b
  }

  const admin = {
    from(table: string) {
      return {
        select: () => builder(listFor(table)),
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const id = inserted.length + 1
              inserted.push({ ...row, id })
              return { data: { id }, error: null }
            },
          }),
        }),
      }
    },
    rpc: async (name: string) =>
      name === 'wie_putaway_candidates'
        ? { data: opts.candidates, error: null }
        : { data: null, error: null },
  }
  // deno/edge SupabaseClient type is stubbed for the test.
  return { admin: admin as unknown as Parameters<typeof generatePutawayTasks>[0], inserted }
}

const racked = { id: 9, kind: 'WAREHOUSE', location_type: 'racked', active_layout_id: 3 }

describe('generatePutawayTasks — self-guard', () => {
  it('returns legacy (no inserts) for a non-racked warehouse', async () => {
    const { admin, inserted } = makeAdmin({
      warehouse: { id: 9, kind: 'WAREHOUSE', location_type: 'bulk', active_layout_id: null },
      candidates: [candidate()],
    })
    const res = await generatePutawayTasks(admin, { warehouseId: 9, lines: [{ product_id: 1, quantity: 5 }], actorId: 'u1' })
    expect(res.mode).toBe('legacy')
    expect(inserted).toHaveLength(0)
  })

  it('returns legacy for a bin (non-WAREHOUSE) location', async () => {
    const { admin } = makeAdmin({
      warehouse: { id: 50, kind: 'BIN', location_type: 'racked', active_layout_id: 3 },
      candidates: [candidate()],
    })
    const res = await generatePutawayTasks(admin, { warehouseId: 50, lines: [{ product_id: 1, quantity: 5 }], actorId: 'u1' })
    expect(res.mode).toBe('legacy')
  })
})

describe('generatePutawayTasks — persistence', () => {
  it('persists one row for a line that fits a single bin', async () => {
    const { admin, inserted } = makeAdmin({ warehouse: racked, candidates: [candidate({ location_id: 7, capacity_slots: 100 })] })
    const res = await generatePutawayTasks(admin, { warehouseId: 9, lines: [{ product_id: 1, quantity: 30 }], actorId: 'u1' })
    expect(res.mode).toBe('engine')
    if (res.mode !== 'engine') return
    expect(res.recommendations).toHaveLength(1)
    expect(res.recommendations[0]).toMatchObject({ recommendedLocationId: 7, quantity: 30 })
    expect(inserted).toHaveLength(1)
    expect(inserted[0].recommended_location_id).toBe(7)
  })

  it('persists nothing on dryRun (recommendationId 0)', async () => {
    const { admin, inserted } = makeAdmin({ warehouse: racked, candidates: [candidate({ location_id: 7 })] })
    const res = await generatePutawayTasks(admin, { warehouseId: 9, lines: [{ product_id: 1, quantity: 5 }], actorId: 'u1', dryRun: true })
    expect(res.mode).toBe('engine')
    if (res.mode !== 'engine') return
    expect(res.recommendations[0].recommendationId).toBe(0)
    expect(inserted).toHaveLength(0)
  })

  it('splits an oversized line into placed + null-bin residual rows', async () => {
    const { admin, inserted } = makeAdmin({ warehouse: racked, candidates: [candidate({ location_id: 7, capacity_slots: 10 })] })
    const res = await generatePutawayTasks(admin, { warehouseId: 9, lines: [{ product_id: 1, quantity: 25 }], actorId: 'u1' })
    if (res.mode !== 'engine') throw new Error('expected engine')
    expect(inserted).toHaveLength(2)
    expect(inserted[0]).toMatchObject({ recommended_location_id: 7, quantity: 10 })
    expect(inserted[1]).toMatchObject({ recommended_location_id: null, quantity: 15 })
  })
})

describe('generatePutawayTasks — cross-line overlay', () => {
  it('does not over-fill a shared bin across two lines of the same product', async () => {
    // One 10-slot bin. Line 1 (qty 10) fills it; line 2 (qty 5) must spill to the
    // residual rather than double-book the same bin.
    const { admin, inserted } = makeAdmin({ warehouse: racked, candidates: [candidate({ location_id: 7, capacity_slots: 10 })] })
    const res = await generatePutawayTasks(admin, {
      warehouseId: 9,
      lines: [{ product_id: 1, quantity: 10 }, { product_id: 1, quantity: 5 }],
      actorId: 'u1',
    })
    if (res.mode !== 'engine') throw new Error('expected engine')
    // Line 1 → bin 7 (10). Line 2 → null residual (5), since the bin is now full.
    expect(inserted).toHaveLength(2)
    expect(inserted[0]).toMatchObject({ recommended_location_id: 7, quantity: 10 })
    expect(inserted[1]).toMatchObject({ recommended_location_id: null, quantity: 5 })
  })
})

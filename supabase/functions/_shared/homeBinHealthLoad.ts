// Server-side loader for the home-bin health check (NX-0032).
//
// Shared by the home-bin-health Edge Function (the Replenishment setup panel) and
// by `npm run check:home-bins`, so the panel and the pre-release check cannot give
// different answers about the same warehouse.
//
// Deliberately OUTSIDE _shared/wie/: that directory is under the purity contract
// (__tests__/wie/purity.test.ts) and may not perform I/O. The judging lives in
// wie/homeBinHealth.ts; this only gathers what it needs:
//
//   1. wie_home_bin_facts      one row per primary home (mig 00142)
//   2. the slotting rules      through slottingLoad.ts, the loader putaway itself
//                              uses, so "slotting refuses this bin" means exactly
//                              what it means at the dock
//
// It imports nothing but type-only URLs and relative `.ts` files, which is what
// lets the Node CLI run it under `tsx` (as warehouse-main/seed.mjs does for the
// pure engine modules).
//
// FAILS CLOSED, like the slotting load it calls: a health check that quietly drops
// the slotting rules on a transient read error would report a clean bill it did
// not earn. An error here is an error, not "no problems".

// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import {
  homeBinFactsFromRow,
  homeBinReport,
  slottingRefusalFor,
  type HomeBinFacts,
  type HomeBinFactsRow,
  type HomeBinHealthReport,
} from './wie/homeBinHealth.ts'
import { contextFor, loadSlottingProduct, loadWarehouseSlotting } from './slottingLoad.ts'

/** Product ids per `.in()` read: a long list becomes a long URL. */
const IN_CHUNK = 200
/** Products whose supplier links are read at once. */
const SLOTTING_BATCH = 8

async function brandsByProduct(
  admin: SupabaseClient,
  productIds: readonly number[],
): Promise<Map<number, string | null>> {
  const brands = new Map<number, string | null>()
  for (let i = 0; i < productIds.length; i += IN_CHUNK) {
    const { data, error } = await admin
      .from('products')
      .select('id, brand')
      .in('id', productIds.slice(i, i + IN_CHUNK))
    if (error) throw new Error(`product brand load failed: ${error.message}`)
    for (const row of (data ?? []) as any[]) brands.set(Number(row.id), row.brand ?? null)
  }
  return brands
}

/** Facts with `slottingRefusal` filled in. New objects; the input is untouched. */
async function withSlottingRefusals(
  admin: SupabaseClient,
  warehouseId: number,
  facts: readonly HomeBinFacts[],
): Promise<HomeBinFacts[]> {
  const slotting = await loadWarehouseSlotting(admin, warehouseId)
  // A site with no rules never consults slotting, here or at putaway.
  if (slotting.empty || facts.length === 0) return [...facts]

  const brands = await brandsByProduct(admin, facts.map((f) => f.productId))
  const out: HomeBinFacts[] = []
  for (let i = 0; i < facts.length; i += SLOTTING_BATCH) {
    const batch = facts.slice(i, i + SLOTTING_BATCH)
    const judged = await Promise.all(batch.map(async (f) => {
      const product = await loadSlottingProduct(admin, {
        id: f.productId,
        brand: brands.get(f.productId) ?? null,
        category: f.category,
      })
      // A hold bin is pinned by planSlotting and never excluded, as at putaway.
      const context = contextFor(slotting, product, f.isHold ? new Set([f.binId]) : undefined)
      if (!context) return f
      const slottingRefusal = slottingRefusalFor({ ...context, candidates: [] }, f.binId, f.binCode)
      return { ...f, slottingRefusal }
    }))
    out.push(...judged)
  }
  return out
}

/** Every primary home in a warehouse, judged. Throws on any read failure. */
export async function loadHomeBinHealth(
  admin: SupabaseClient,
  warehouseId: number,
): Promise<HomeBinHealthReport> {
  const { data, error } = await admin.rpc('wie_home_bin_facts', { p_warehouse_id: warehouseId })
  if (error) throw new Error(`home bin facts load failed: ${error.message}`)

  const facts = ((data ?? []) as HomeBinFactsRow[]).map((row) => homeBinFactsFromRow(row, warehouseId))
  return homeBinReport(warehouseId, await withSlottingRefusals(admin, warehouseId, facts))
}

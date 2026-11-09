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
  homeBinCandidateFactsFromRow,
  homeBinChoices,
  homeBinFactsFromRow,
  homeBinReport,
  homeChoiceRefusal,
  slottingRefusalFor,
  type HomeBinCandidateFacts,
  type HomeBinCandidateFactsRow,
  type HomeBinChoice,
  type HomeBinFacts,
  type HomeBinFactsRow,
  type HomeBinHealthReport,
} from './wie/homeBinHealth.ts'
import { contextFor, loadSlottingProduct, loadWarehouseSlotting } from './slottingLoad.ts'
import type { SlottingProduct } from './wie/slotting.ts'

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

/**
 * Facts with `slottingRefusal` filled in. New objects; the input is untouched.
 *
 * The product side of a rule match is read ONCE per distinct product, not once
 * per fact: the health check has one product per home, but a candidate list is
 * one product against every bin in the warehouse.
 */
async function withSlottingRefusals<T extends HomeBinFacts>(
  admin: SupabaseClient,
  warehouseId: number,
  facts: readonly T[],
): Promise<T[]> {
  const slotting = await loadWarehouseSlotting(admin, warehouseId)
  // A site with no rules never consults slotting, here or at putaway.
  if (slotting.empty || facts.length === 0) return [...facts]

  const categoryByProduct = new Map<number, string | null>()
  for (const f of facts) if (!categoryByProduct.has(f.productId)) categoryByProduct.set(f.productId, f.category)
  const productIds = [...categoryByProduct.keys()]

  const brands = await brandsByProduct(admin, productIds)
  const products = new Map<number, SlottingProduct>()
  for (let i = 0; i < productIds.length; i += SLOTTING_BATCH) {
    const loaded = await Promise.all(productIds.slice(i, i + SLOTTING_BATCH).map((id) =>
      loadSlottingProduct(admin, {
        id,
        brand: brands.get(id) ?? null,
        category: categoryByProduct.get(id) ?? null,
      })))
    for (const product of loaded) products.set(product.productId, product)
  }

  return facts.map((f) => {
    // A hold bin is pinned by planSlotting and never excluded, as at putaway.
    const context = contextFor(slotting, products.get(f.productId)!, f.isHold ? new Set([f.binId]) : undefined)
    if (!context) return f
    return { ...f, slottingRefusal: slottingRefusalFor({ ...context, candidates: [] }, f.binId, f.binCode) }
  })
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

/**
 * Every bin in the warehouse read as if it were this product's home (mig 00143),
 * judged. `binId` narrows it to one bin. Throws on any read failure.
 */
async function loadCandidates(
  admin: SupabaseClient,
  warehouseId: number,
  productId: number,
  binId?: number,
): Promise<HomeBinCandidateFacts[]> {
  const args: Record<string, number> = { p_warehouse_id: warehouseId, p_product_id: productId }
  if (binId !== undefined) args.p_bin_id = binId
  const { data, error } = await admin.rpc('wie_home_bin_candidate_facts', args)
  if (error) throw new Error(`home bin candidates load failed: ${error.message}`)

  const facts = ((data ?? []) as HomeBinCandidateFactsRow[])
    .map((row) => homeBinCandidateFactsFromRow(row, warehouseId))
  return withSlottingRefusals(admin, warehouseId, facts)
}

/**
 * The bins a Manager may give this product as its home (NX-0033): active, usable
 * by putaway, not full, and nobody else's home. Throws on any read failure.
 */
export async function loadHomeBinChoices(
  admin: SupabaseClient,
  warehouseId: number,
  productId: number,
): Promise<HomeBinChoice[]> {
  return homeBinChoices(await loadCandidates(admin, warehouseId, productId))
}

/**
 * Why this one bin cannot be the product's home, or null when it can. The check
 * complete-putaway makes before it sets a home, so a hand-made request cannot
 * pick a bin the chooser would not have offered. Throws on any read failure.
 */
export async function loadHomeChoiceRefusal(
  admin: SupabaseClient,
  warehouseId: number,
  productId: number,
  binId: number,
): Promise<string | null> {
  const [facts] = await loadCandidates(admin, warehouseId, productId, binId)
  // No row: the id is not a bin under this warehouse (a rack, a zone, another site).
  if (!facts) return 'That location is not a bin in this warehouse.'
  return homeChoiceRefusal(facts)
}

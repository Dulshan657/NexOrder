// Server-side loader for Slotting Rules (mig 00115).
//
// Deliberately OUTSIDE _shared/wie/: that directory is under the purity contract
// (__tests__/wie/purity.test.ts) and may not perform I/O. wie/slotting.ts takes
// rules as data; this is where that data comes from on the server. Same split as
// wie/zoneBinding.ts + zoneResolve.ts and wie/levelRoles.ts + levelRoleLookup.ts.
//
// LOADED ONCE PER CALL, NOT PER LINE. A receipt of forty lines shares one rule
// set and one block map; re-reading them per line would turn a two-query load
// into eighty.

// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import type { SlottingRuleSpec, SlottingProduct } from './wie/slotting.ts'
import type { SlottingContext } from './wie/types.ts'

/** Everything about a warehouse's slotting configuration that does not depend
 *  on which product is being put away. Assembled once, then narrowed per line
 *  by `contextFor`. */
export interface WarehouseSlotting {
  rules: SlottingRuleSpec[]
  blockNames: Map<number, string>
  blockIdsByLocation: Map<number, number[]>
  /** True when this warehouse has no active rules at all — the overwhelmingly
   *  common case, and the caller's cue to skip slotting entirely. */
  empty: boolean
}

const EMPTY: WarehouseSlotting = {
  rules: [],
  blockNames: new Map(),
  blockIdsByLocation: new Map(),
  empty: true,
}

/**
 * Load every active rule at this warehouse, plus its blocks and their bins.
 *
 * FAILS CLOSED, like the wie_rules and category_compatibility loads it sits
 * beside in putawayTasks.ts, and unlike the scoring-weights load. The reason is
 * the asymmetry between the two failure modes: a rule that silently vanishes on
 * a transient read error sends a pallet to the wrong aisle and nobody finds out
 * until someone goes looking for it, whereas a receipt that refuses to plan says
 * so immediately and can be retried. A `hard` rule is a safety gate and must
 * behave like one.
 */
export async function loadWarehouseSlotting(
  admin: SupabaseClient,
  warehouseId: number,
): Promise<WarehouseSlotting> {
  const { data: ruleRows, error: ruleErr } = await admin
    .from('slotting_rules')
    .select('id, name, specificity, match_product_id, match_brand, match_category, '
      + 'match_supplier_id, enforcement, reserve_empty, '
      + 'slotting_rule_blocks(block_id, rank)')
    .eq('warehouse_id', warehouseId)
    .eq('is_active', true)
  if (ruleErr) throw new Error(`slotting rule load failed: ${ruleErr.message}`)

  const rows = (ruleRows ?? []) as any[]
  if (rows.length === 0) return EMPTY

  const rules: SlottingRuleSpec[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    // Read, never recomputed: `specificity` is a GENERATED column, so the
    // database is the one definition of the ladder and this cannot drift from it.
    specificity: Number(r.specificity),
    matchProductId: r.match_product_id ?? null,
    matchBrand: r.match_brand ?? null,
    matchCategory: r.match_category ?? null,
    matchSupplierId: r.match_supplier_id ?? null,
    enforcement: r.enforcement === 'hard' ? 'hard' : 'soft',
    reserveEmpty: Boolean(r.reserve_empty),
    // ARRAY POSITION IS THE RANK downstream, so the sort here is what carries
    // the operator's ordering into the engine. `rank` exists only to survive
    // the round trip through the database.
    blockIds: ((r.slotting_rule_blocks ?? []) as any[])
      .slice()
      .sort((a, b) => Number(a.rank) - Number(b.rank))
      .map((b) => Number(b.block_id)),
  }))

  const wanted = new Set<number>()
  for (const r of rules) for (const b of r.blockIds) wanted.add(b)

  const blockNames = new Map<number, string>()
  const blockIdsByLocation = new Map<number, number[]>()

  // Names for every block at this site, not just the referenced ones: the
  // reservation pass reads blocks belonging to rules that do NOT match the
  // product, and an unnamed block would make its refusal unreadable.
  const { data: blockRows, error: blockErr } = await admin
    .from('slotting_blocks')
    .select('id, name')
    .eq('warehouse_id', warehouseId)
  if (blockErr) throw new Error(`slotting block load failed: ${blockErr.message}`)
  for (const b of (blockRows ?? []) as any[]) blockNames.set(Number(b.id), b.name)

  // v_slotting_block_bins is the SINGLE definition of the unit -> leaf-bin
  // expansion (mig 00115). Never restate the materialized_path prefix walk here
  // -- that is exactly the shape of the plan-reslot zone-blind bug.
  const { data: binRows, error: binErr } = await admin
    .from('v_slotting_block_bins')
    .select('block_id, location_id')
    .in('block_id', [...wanted.size ? wanted : blockNames.keys()])
  if (binErr) throw new Error(`slotting block membership load failed: ${binErr.message}`)

  for (const row of (binRows ?? []) as any[]) {
    const locationId = Number(row.location_id)
    const existing = blockIdsByLocation.get(locationId)
    if (existing) existing.push(Number(row.block_id))
    else blockIdsByLocation.set(locationId, [Number(row.block_id)])
  }

  return { rules, blockNames, blockIdsByLocation, empty: false }
}

/** The product side of a match. `product_suppliers` (mig 00070), NEVER the
 *  legacy `products.supplier_id`: reading one here and the other in
 *  plan-reslot would make the two engines disagree about the same rule. */
export async function loadSlottingProduct(
  admin: SupabaseClient,
  product: { id: number; brand?: string | null; category?: string | null },
): Promise<SlottingProduct> {
  const { data, error } = await admin
    .from('product_suppliers')
    .select('supplier_id')
    .eq('product_id', product.id)
  if (error) throw new Error(`product supplier load failed: ${error.message}`)
  return {
    productId: product.id,
    brand: product.brand ?? null,
    category: product.category ?? null,
    supplierIds: ((data ?? []) as any[]).map((r) => Number(r.supplier_id)),
  }
}

/** Narrow a warehouse's configuration to one product. Returns undefined when
 *  slotting has nothing to say, which the engine treats as "not consulted at
 *  all" — byte-identical to the pre-00115 behaviour. */
export function contextFor(
  slotting: WarehouseSlotting,
  product: SlottingProduct,
  heldLocationIds?: ReadonlySet<number>,
): SlottingContext | undefined {
  if (slotting.empty) return undefined
  return {
    product,
    rules: slotting.rules,
    blockNames: slotting.blockNames,
    blockIdsByLocation: slotting.blockIdsByLocation,
    heldLocationIds,
  }
}

/**
 * The bins that must survive `wie_putaway_candidates`' LIMIT cutoff for this
 * product — its own home blocks, expanded.
 *
 * The cutoff is a hard one over an ORDER BY dock distance, so without this a
 * home block at the far end of a large site would simply never be offered.
 * Resolving the winner here rather than in SQL keeps the ladder in exactly one
 * place; the function is told which ids matter, and decides nothing.
 */
export function priorityLocationsFor(
  slotting: WarehouseSlotting,
  homeBlockIds: readonly number[],
): number[] | null {
  if (slotting.empty || homeBlockIds.length === 0) return null
  const wanted = new Set(homeBlockIds)
  const ids: number[] = []
  for (const [locationId, blocks] of slotting.blockIdsByLocation) {
    if (blocks.some((b) => wanted.has(b))) ids.push(locationId)
  }
  return ids.length > 0 ? ids : null
}

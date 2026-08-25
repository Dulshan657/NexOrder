// Warehouse Intelligence Engine — multi-SKU re-slot allocator.
//
// The one genuinely new piece of the "re-allocate stock into a new layout" feature.
// The putaway engine (scoring.ts) ranks bins for ONE sku+quantity against a fixed
// fill; it has no notion of placing many SKUs that compete for the same bins, and
// it rejects a bin outright when the whole quantity won't fit. This module layers
// multi-SKU allocation on top of that engine:
//
//   • Places each SKU's movable stock best-first (full putaway scoring), then
//     SPILLS the remainder into the next-best bin(s) — capacity-aware splitting.
//   • CONSUMES capacity as it goes, so a bin filled by an earlier SKU is smaller
//     (or gone) for later SKUs. SKUs are ordered A→C velocity, then qty desc, so
//     fast-movers get first pick of prime bins.
//   • Leaves stock that already sits in a bin the new layout keeps exactly where it
//     is (its fill is pre-counted as used capacity) — no pointless physical churn.
//     Only stock in bins the new layout drops (orphaned) is planned for a move.
//   • Pairs destination allocations back to the source bins holding the stock to
//     emit concrete {product, from, to, qty} moves for the relocation worklist.
//
// Pure per the _shared/wie contract: plain data in, plain plan out. The caller
// (plan-reslot edge fn) loads stock/bins/rules and persists nothing here.

import { filterCandidates, scoreCandidates } from './scoring.ts'
import { planSlotting, tierOf } from './slotting.ts'
import type {
  CandidateBin,
  CandidateBreakdown,
  CompatibilityRule,
  RuleDefinition,
  ScoringWeights,
  SkuProfile,
  SlottingContext,
} from './types.ts'

/** One SKU's movable stock and where it currently sits (old, non-kept bins). */
export interface ReslotDemand {
  sku: SkuProfile
  /** Available (unreserved) base units in each source bin. Σ qty = total to place. */
  sources: Array<{ locationId: number; qty: number }>
  /** Slotting context for THIS product (mig 00115); undefined = not consulted.
   *  Per-demand rather than per-input because the rules are shared but the
   *  product side is not. */
  slotting?: SlottingContext
}

export interface ReslotMove {
  productId: number
  productCode: string
  productName: string
  fromLocationId: number
  toLocationId: number
  toLocationCode: string
  qty: number
  /** Destination bin's dock distance (for display); null if uncapped/unknown. */
  toDistanceM: number | null
  /** Why this bin won — the destination's scored breakdown (PutawayExplanationCard). */
  breakdown: CandidateBreakdown
}

export interface ReslotOverflow {
  productId: number
  productCode: string
  productName: string
  /** Base units that could not be placed anywhere (capacity exhausted). */
  qty: number
}

export interface ReslotPlanInput {
  demands: ReslotDemand[]
  /** New-layout bins; `usedSlots` reflects stock already staying in them. */
  candidates: CandidateBin[]
  rules: RuleDefinition[]
  compatibility: CompatibilityRule[]
  weights: ScoringWeights
}

export interface ReslotPlan {
  moves: ReslotMove[]
  overflow: ReslotOverflow[]
  /** Slots the movable stock needs (Σ qty × sizeFactor). */
  requiredSlots: number
  /** Free capacity across capped bins after accounting for staying stock. */
  providedFreeSlots: number
  /** True if any candidate bin is uncapped (capacitySlots === null). */
  hasUncapped: boolean
}

const EPS = 1e-9

/**
 * The location-id scope the re-slot planner scans for existing stock: the
 * warehouse ROOT plus all its descendant bins. Bulk / not-yet-racked warehouses
 * keep stock on the root location itself (`location_id === warehouseId`), so the
 * root MUST be included or that stock is silently dropped. Mirrors the client's
 * getBalancesByWarehouse `[warehouseId, ...descendants]`. De-duplicated.
 */
export function warehouseStockScope(warehouseId: number, descendantIds: number[]): number[] {
  return [...new Set([warehouseId, ...descendantIds])]
}

function totalQty(d: ReslotDemand): number {
  return d.sources.reduce((s, x) => s + x.qty, 0)
}

/** A→C first (fast-movers claim prime bins), unknown velocity last, then qty desc. */
function velocityRank(sku: SkuProfile): number {
  return sku.velocityClass === 'A' ? 0 : sku.velocityClass === 'B' ? 1 : sku.velocityClass === 'C' ? 2 : 3
}

/**
 * Allocate every demand into the candidate bins. Deterministic and pure.
 */
export function planReslot(input: ReslotPlanInput): ReslotPlan {
  const { candidates, rules, compatibility, weights } = input

  // Live per-bin fill (slots + weight), seeded from stock that stays in kept
  // bins. Both are mutated as we allocate so later SKUs see the reduced headroom.
  const used = new Map<number, number>()
  const usedWeight = new Map<number, number>()
  for (const c of candidates) {
    used.set(c.locationId, c.usedSlots)
    usedWeight.set(c.locationId, c.usedWeightKg)
  }

  const ordered = [...input.demands].sort(
    (a, b) => velocityRank(a.sku) - velocityRank(b.sku) || totalQty(b) - totalQty(a),
  )

  const moves: ReslotMove[] = []
  const overflow: ReslotOverflow[] = []
  let requiredSlots = 0

  for (const demand of ordered) {
    const sizeFactor = demand.sku.sizeFactor || 1
    const skuWeight = demand.sku.weightKg // null ⇒ no weight constraint
    let remaining = totalQty(demand)
    requiredSlots += remaining * sizeFactor
    if (remaining <= 0) continue

    // Candidate snapshot with current fill (slots + weight) applied.
    const live = candidates.map((c) => ({
      ...c,
      usedSlots: used.get(c.locationId) ?? c.usedSlots,
      usedWeightKg: usedWeight.get(c.locationId) ?? c.usedWeightKg,
    }))

    // Filter with a nominal single-unit need so bins with ANY headroom survive
    // (the engine's capacity gate would otherwise reject a bin that can hold part
    // of the quantity — we want to split into it). Rank with the real remaining so
    // best-fit / velocity reflect the true load.
    const base = {
      layoutId: 0, warehouseId: 0, sku: demand.sku, candidates: live,
      rules, compatibility, weights, slotting: demand.slotting,
    }
    const filter = filterCandidates({ ...base, quantity: 1 })
    const scored = scoreCandidates({ ...base, quantity: remaining }, filter)

    // Slotting tiering, exactly as planPutaway applies it: a stable sort, so
    // within a tier the score order is untouched.
    //
    // Note the `quantity: 1` above. That falsified quantity is why slotting.ts
    // is quantity-INDEPENDENT: a tier decision that asked "does this tier have
    // room" would read the 1, conclude the primary block fits, and collapse
    // every plan onto it -- pushing the rest into `overflow`, which carries no
    // reason field and would reach an operator as "capacity exhausted" with
    // nothing pointing at slotting. Deciding order only makes that impossible.
    const slotPlan = demand.slotting
      ? planSlotting({ ...demand.slotting, candidates: live })
      : null
    const ranked = slotPlan && !slotPlan.inert
      ? [...scored].sort((a, b) => tierOf(slotPlan, a.locationId) - tierOf(slotPlan, b.locationId))
      : scored

    // Destination allocations for this demand, best-first, filling to capacity.
    const allocations: Array<{ bin: CandidateBin; take: number; breakdown: CandidateBreakdown }> = []
    for (const breakdown of ranked) {
      if (remaining <= 0) break
      const bin = live.find((b) => b.locationId === breakdown.locationId)
      if (!bin) continue
      const cur = used.get(bin.locationId) ?? bin.usedSlots
      const headroomSlots = bin.capacitySlots === null ? Infinity : bin.capacitySlots - cur
      const qtyBySlots = headroomSlots === Infinity ? remaining : Math.floor(headroomSlots / sizeFactor + EPS)
      // Weight-limited units: how many fit under the remaining weight headroom.
      const curW = usedWeight.get(bin.locationId) ?? bin.usedWeightKg
      const qtyByWeight = bin.weightCapacityKg === null || skuWeight === null || skuWeight <= 0
        ? remaining
        : Math.floor((bin.weightCapacityKg - curW) / skuWeight + EPS)
      const take = Math.min(remaining, qtyBySlots, qtyByWeight)
      if (take <= 0) continue
      allocations.push({ bin, take, breakdown })
      used.set(bin.locationId, cur + take * sizeFactor)
      usedWeight.set(bin.locationId, curW + take * (skuWeight ?? 0))
      remaining -= take
    }

    // Pair the source bins (old stock) to the destination allocations FIFO to emit
    // concrete moves. Merge identical (from,to) so the worklist stays tidy.
    const sources = demand.sources.map((s) => ({ ...s }))
    const merged = new Map<string, ReslotMove>()
    for (const alloc of allocations) {
      let need = alloc.take
      for (const src of sources) {
        if (need <= 0) break
        if (src.qty <= 0) continue
        if (src.locationId === alloc.bin.locationId) continue // never move onto itself
        const move = Math.min(need, src.qty)
        const key = `${src.locationId}->${alloc.bin.locationId}`
        const existing = merged.get(key)
        if (existing) {
          existing.qty += move
        } else {
          merged.set(key, {
            productId: demand.sku.productId,
            productCode: demand.sku.code,
            productName: demand.sku.name,
            fromLocationId: src.locationId,
            toLocationId: alloc.bin.locationId,
            toLocationCode: alloc.bin.code,
            qty: move,
            toDistanceM: alloc.bin.distanceFromDockM,
            breakdown: alloc.breakdown,
          })
        }
        src.qty -= move
        need -= move
      }
    }
    moves.push(...merged.values())

    if (remaining > EPS) {
      overflow.push({
        productId: demand.sku.productId,
        productCode: demand.sku.code,
        productName: demand.sku.name,
        qty: remaining,
      })
    }
  }

  let providedFreeSlots = 0
  let hasUncapped = false
  for (const c of candidates) {
    if (c.capacitySlots === null) hasUncapped = true
    else providedFreeSlots += Math.max(0, c.capacitySlots - c.usedSlots)
  }

  return { moves, overflow, requiredSlots, providedFreeSlots, hasUncapped }
}

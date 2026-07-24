// Warehouse Intelligence Engine — multi-bin putaway planner.
//
// recommendPutaway (putaway.ts) answers "which ONE bin is best?". planPutaway
// answers "where does this WHOLE quantity go?" — splitting a line across bins
// when no single bin can hold it. It runs the same two-stage optimizer in 'fill'
// mode (capacity/weight become fill constraints rather than hard rejects), then
// greedily fills the best-scored bins up to each one's slot AND weight headroom.
// Any residual no bin can hold becomes a null-bin allocation (manual placement).
//
// The one exception is a UNIT LOAD — a pallet arriving into a pallet-denominated
// bin (mig 00078). It is a single physical object occupying one whole position,
// so it is never split: it goes entire into the best bin with a free position,
// or entire to manual placement.
//
// Pure: no I/O. The caller loads candidates/rules/weights and persists the plan.

import { buildExplanation } from './explain.ts'
import { filterCandidates, scoreCandidates } from './scoring.ts'
import { isUnitLoad } from './capacity.ts'
import type { CandidateBin, PutawayAllocation, PutawayPlan, PutawayRequest } from './types.ts'

const EPS = 1e-6
const ALTERNATIVES_SHOWN = 5

export function planPutaway(request: PutawayRequest): PutawayPlan {
  // 'fill' mode keeps partially-full bins so a line can span several of them.
  const filter = filterCandidates(request, { capacityMode: 'fill' })
  const ranked = scoreCandidates(request, filter)
  const explanation = buildExplanation(request, filter, ranked)
  const alternatives = ranked.slice(1, 1 + ALTERNATIVES_SHOWN)

  // Surviving bins by location, for headroom lookups during the fill. These are
  // the same objects scoreCandidates ranked, so mutating usedSlots/usedWeightKg
  // as we fill keeps later portions of THIS plan consistent.
  const binById = new Map<number, CandidateBin>()
  for (const b of filter.valid) binById.set(b.locationId, b)

  const sizeFactor = request.sku.sizeFactor > 0 ? request.sku.sizeFactor : 1
  const weightKg = request.sku.weightKg

  const allocations: PutawayAllocation[] = []
  let remaining = request.quantity

  for (const cand of ranked) {
    if (remaining <= EPS) break
    const bin = binById.get(cand.locationId)
    if (!bin) continue

    // A UNIT LOAD is one physical object: it consumes a whole position and
    // cannot be split across bins, so it either goes here entire or we move on
    // to the next-best bin (and, failing every bin, to manual placement).
    if (isUnitLoad(bin.slotKind, request.huType)) {
      const freePositions = bin.capacitySlots === null ? Infinity : bin.capacitySlots - bin.usedSlots
      if (freePositions + EPS < 1) continue
      const weightOk = bin.weightCapacityKg === null || weightKg === null || weightKg <= 0 ||
        bin.usedWeightKg + remaining * weightKg <= bin.weightCapacityKg + EPS
      if (!weightOk) continue

      allocations.push({
        locationId: bin.locationId,
        quantity: remaining,
        alternatives,
        explanation,
        needsManualPlacement: false,
      })
      bin.usedSlots += 1
      if (weightKg !== null) bin.usedWeightKg += remaining * weightKg
      remaining = 0
      break
    }

    // Base units that fit here, bounded by BOTH slot and weight headroom.
    // A null limit (or unknown SKU weight) means "no constraint" — Infinity.
    const slotHeadroom = bin.capacitySlots === null ? Infinity : bin.capacitySlots - bin.usedSlots
    const bySlots = slotHeadroom === Infinity ? Infinity : slotHeadroom / sizeFactor
    const byWeight = bin.weightCapacityKg === null || weightKg === null || weightKg <= 0
      ? Infinity
      : (bin.weightCapacityKg - bin.usedWeightKg) / weightKg
    const capacity = Math.min(bySlots, byWeight)
    if (capacity <= EPS) continue

    // If this bin can finish the line, take the exact remainder (may be
    // fractional). Otherwise take whole base units only, so a partial fill never
    // strands a sub-unit sliver — the remainder carries to the next bin.
    const take = capacity + EPS >= remaining ? remaining : Math.floor(capacity + EPS)
    if (take <= EPS) continue

    allocations.push({
      locationId: bin.locationId,
      quantity: take,
      alternatives,
      explanation,
      needsManualPlacement: false,
    })

    // Consume this bin's headroom so a later portion (or line, via a caller
    // overlay) sees it as fuller.
    bin.usedSlots += take * sizeFactor
    if (weightKg !== null) bin.usedWeightKg += take * weightKg
    remaining -= take
  }

  // Whatever no eligible bin could hold stays at root as a manual task.
  if (remaining > EPS) {
    allocations.push({
      locationId: null,
      quantity: remaining,
      alternatives,
      explanation,
      needsManualPlacement: true,
    })
  }

  return { allocations }
}

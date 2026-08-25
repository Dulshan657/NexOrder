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
import { planSlotting, tierOf, describeBin } from './slotting.ts'
import type { CandidateBin, PutawayAllocation, PutawayPlan, PutawayRequest } from './types.ts'

const EPS = 1e-6
const ALTERNATIVES_SHOWN = 5

/** Slotting provenance for one placed allocation.
 *
 *  `offHome` is derived AFTER the fill from the bin actually chosen, never
 *  predicted before it. That ordering is the whole point: whether stock ends up
 *  misplaced is a fact about where it landed, and the tier decision upstream is
 *  deliberately quantity-blind (see slotting.ts) so it cannot know in advance
 *  which tier will still have room. */
function slotProvenance(
  plan: ReturnType<typeof planSlotting> | null,
  locationId: number,
): Partial<PutawayAllocation> {
  if (!plan || !plan.resolution.rule) return {}
  const verdict = describeBin(plan, locationId)
  return {
    offHome: verdict.status === 'off_home',
    slotting: {
      ruleId: plan.resolution.rule.id,
      ruleName: plan.resolution.rule.name,
      blockName: verdict.blockName,
      rank: verdict.rank,
      text: verdict.text,
    },
  }
}

export function planPutaway(request: PutawayRequest): PutawayPlan {
  // 'fill' mode keeps partially-full bins so a line can span several of them.
  const filter = filterCandidates(request, { capacityMode: 'fill' })
  const scored = scoreCandidates(request, filter)

  // Slotting turns the score ranking into a TIERED ranking: the winning rule's
  // primary block first, then its overflow blocks in the operator's order, then
  // everything else.
  //
  // Array.prototype.sort is stable in ES2019+, so within a tier the score order
  // survives byte-for-byte — which is the entire reason "ranked homes, then
  // anywhere" is three lines here instead of a rewrite of the fill loop below.
  // And because the fill already spills to the next bin when one is full, the
  // overflow behaviour needs no branch at all: hand it a tier-ordered list and
  // it walks off the end of block 1 into block 2 on its own.
  const slotPlan = request.slotting
    ? planSlotting({ ...request.slotting, candidates: request.candidates })
    : null
  const ranked = slotPlan && !slotPlan.inert
    ? [...scored].sort((a, b) => tierOf(slotPlan, a.locationId) - tierOf(slotPlan, b.locationId))
    : scored

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
        ...slotProvenance(slotPlan, bin.locationId),
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
      ...slotProvenance(slotPlan, bin.locationId),
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

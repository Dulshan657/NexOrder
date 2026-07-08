// Warehouse Intelligence Engine — two-stage optimizer.
//
// Stage 1 (filter): remove invalid bins — over-capacity, unreachable, or vetoed
// by a hard rule — recording WHY for the explainability layer.
// Stage 2 (score): weighted sum of normalized factors over the survivors, plus
// soft-rule adjustments. Pure and deterministic: same inputs → same ranking.

import { evaluateRules, type RuleContext } from './rules.ts'
import { buildCompatibilityIndex, worstCompatibility } from './compat.ts'
import type {
  CandidateBin,
  CandidateBreakdown,
  FactorBreakdown,
  HardFilterReason,
  PutawayRequest,
  RuleTrigger,
} from './types.ts'

const SAMPLE_LIMIT = 3
/** Score penalty applied to a bin whose occupants are 'restricted' with the SKU. */
const RESTRICTED_PENALTY = 0.25

/** Effective travel cost = dock→node skeleton distance + access offset into bin. */
function effectiveDistance(bin: CandidateBin): number {
  return (bin.distanceFromDockM ?? Infinity) + bin.accessOffsetM
}

/** Slots this putaway consumes. */
function requiredSlots(request: PutawayRequest): number {
  return request.quantity * request.sku.sizeFactor
}

/** Weight this putaway adds, kg; null when the SKU has no weight on file. */
function requiredWeight(request: PutawayRequest): number | null {
  return request.sku.weightKg === null ? null : request.quantity * request.sku.weightKg
}

export interface FilterResult {
  valid: CandidateBin[]
  hardFilters: HardFilterReason[]
  /** Soft-rule triggers per surviving bin, threaded into scoring. */
  softByLocation: Map<number, RuleTrigger[]>
}

interface RejectionAccumulator {
  ruleId: number | null
  code: string
  label: string
  count: number
  sample: HardFilterReason['sample']
}

/** Stage 1 — filter invalid locations, capturing structured rejection reasons. */
export function filterCandidates(request: PutawayRequest): FilterResult {
  const need = requiredSlots(request)
  const needWeight = requiredWeight(request)
  const valid: CandidateBin[] = []
  const softByLocation = new Map<number, RuleTrigger[]>()
  const rejections = new Map<string, RejectionAccumulator>()
  const compatIndex = buildCompatibilityIndex(request.compatibility)

  const reject = (
    key: string,
    ruleId: number | null,
    code: string,
    label: string,
    bin: CandidateBin,
    reason: string,
  ): void => {
    let acc = rejections.get(key)
    if (!acc) {
      acc = { ruleId, code, label, count: 0, sample: [] }
      rejections.set(key, acc)
    }
    acc.count++
    if (acc.sample.length < SAMPLE_LIMIT) {
      acc.sample.push({ locationId: bin.locationId, code: bin.code, reason })
    }
  }

  for (const bin of request.candidates) {
    // Built-in: unreachable from any dock.
    if (bin.distanceFromDockM === null) {
      reject('unreachable', null, 'unreachable', 'No route from a receiving dock', bin,
        'bin has no path to a dock')
      continue
    }

    // Built-in: over soft capacity.
    if (bin.capacitySlots !== null && bin.usedSlots + need > bin.capacitySlots + 1e-6) {
      const headroom = Math.max(0, bin.capacitySlots - bin.usedSlots)
      reject('capacity', null, 'capacity', 'Not enough capacity', bin,
        `needs ${need.toFixed(2)} slots, ${headroom.toFixed(2)} free`)
      continue
    }

    // Built-in: over weight capacity (fails OPEN when either limit or SKU weight
    // is unknown). Enforced only where both the bin has a limit AND the SKU has a
    // weight on file (product_wms_attributes.weight_kg).
    if (bin.weightCapacityKg !== null && needWeight !== null && bin.usedWeightKg + needWeight > bin.weightCapacityKg + 1e-6) {
      const wHeadroom = Math.max(0, bin.weightCapacityKg - bin.usedWeightKg)
      reject('weight', null, 'weight', 'Over weight limit', bin,
        `needs ${needWeight.toFixed(1)} kg, ${wHeadroom.toFixed(1)} kg free`)
      continue
    }

    // Built-in: zone category allow-list (a zone_profile compatibility gate).
    if (
      bin.zoneAllowedCategories && bin.zoneAllowedCategories.length > 0 &&
      request.sku.category !== null && !bin.zoneAllowedCategories.includes(request.sku.category)
    ) {
      reject('zone_category', null, 'zone_category', 'Zone does not accept this category', bin,
        `${request.sku.category} not allowed in ${bin.zoneType ?? 'this zone'}`)
      continue
    }

    // Category compatibility with the bin's current occupants (matrix gate).
    const softTriggers: RuleTrigger[] = []
    if (request.sku.category !== null && bin.occupantCategories.length > 0) {
      const level = worstCompatibility(compatIndex, request.sku.category, bin.occupantCategories)
      if (level === 'forbidden') {
        reject('compatibility', null, 'compatibility', 'Incompatible with stored stock', bin,
          `${request.sku.category} cannot share a bin with ${bin.occupantCategories.join(', ')}`)
        continue
      }
      if (level === 'restricted') {
        softTriggers.push({
          ruleId: -1, name: 'Category restriction', effect: 'penalty', delta: -RESTRICTED_PENALTY,
        })
      }
    }

    // Hard rules.
    const ctx: RuleContext = { sku: request.sku, bin }
    const evalResult = evaluateRules(request.rules, ctx)
    if (evalResult.hardViolation) {
      const r = evalResult.hardViolation.rule
      reject(`rule:${r.id}`, r.id, 'rule', r.name, bin, evalResult.hardViolation.reason)
      continue
    }

    softTriggers.push(...evalResult.softTriggers)
    if (softTriggers.length > 0) softByLocation.set(bin.locationId, softTriggers)
    valid.push(bin)
  }

  const hardFilters: HardFilterReason[] = [...rejections.values()].map((a) => ({
    ruleId: a.ruleId,
    code: a.code,
    label: a.label,
    rejectedCount: a.count,
    sample: a.sample,
  }))

  return { valid, hardFilters, softByLocation }
}

/** Stage 2 — score the survivors. Returns breakdowns sorted best-first. */
export function scoreCandidates(request: PutawayRequest, filter: FilterResult): CandidateBreakdown[] {
  const { valid, softByLocation } = filter
  if (valid.length === 0) return []

  const need = requiredSlots(request)
  const w = request.weights

  // Distance normalization bounds across the survivor set.
  const distances = valid.map(effectiveDistance)
  const minDist = Math.min(...distances)
  const maxDist = Math.max(...distances)
  const distSpan = maxDist - minDist

  // Congestion normalization bounds (pick visits across survivors).
  const visits = valid.map((b) => b.pickVisits30d)
  const minVisits = Math.min(...visits)
  const maxVisits = Math.max(...visits)
  const visitSpan = maxVisits - minVisits

  const breakdowns = valid.map((bin): CandidateBreakdown => {
    const factors: FactorBreakdown[] = []

    // Travel distance — nearer the dock is better.
    const dist = effectiveDistance(bin)
    const distNorm = distSpan < 1e-9 ? 1 : (maxDist - dist) / distSpan
    factors.push({
      factor: 'travel_distance',
      weight: w.travelDistance,
      rawValue: dist,
      normalized: distNorm,
      weighted: distNorm * w.travelDistance,
      detail: `${dist.toFixed(1)} m from receiving dock`,
    })

    // Capacity fit — reward a snug fit (best-fit slotting) over a cavernous bin.
    const headroom = bin.capacitySlots === null ? null : bin.capacitySlots - bin.usedSlots
    const fitNorm = headroom === null || headroom <= 1e-9 ? 0.5 : Math.min(1, need / headroom)
    factors.push({
      factor: 'capacity_fit',
      weight: w.capacityFit,
      rawValue: headroom ?? 0,
      normalized: fitNorm,
      weighted: fitNorm * w.capacityFit,
      detail: headroom === null
        ? 'uncapped bin'
        : `${need.toFixed(2)} of ${headroom.toFixed(2)} free slots used`,
    })

    // Grouping — consolidate with existing stock of the same SKU.
    const groupNorm = bin.hasSameProduct ? 1 : 0
    factors.push({
      factor: 'grouping',
      weight: w.grouping,
      rawValue: groupNorm,
      normalized: groupNorm,
      weighted: groupNorm * w.grouping,
      detail: bin.hasSameProduct ? 'already holds this product' : 'no existing stock of this product',
    })

    // Zone preference — steer toward the operationally-preferred zone (fast-moving
    // near the dock, quarantine/returns away). A bin with no profile is neutral.
    const zoneNorm = bin.zonePriorityWeight ?? 0.5
    factors.push({
      factor: 'zone_preference',
      weight: w.zonePreference,
      rawValue: zoneNorm,
      normalized: zoneNorm,
      weighted: zoneNorm * w.zonePreference,
      detail: bin.zoneType ? `${bin.zoneType.replace('_', ' ')} zone` : 'no zone profile',
    })

    // Congestion — prefer less-trafficked nodes (fewer recent pick visits).
    const congestNorm = visitSpan < 1e-9 ? 1 : (maxVisits - bin.pickVisits30d) / visitSpan
    factors.push({
      factor: 'congestion',
      weight: w.congestion,
      rawValue: bin.pickVisits30d,
      normalized: congestNorm,
      weighted: congestNorm * w.congestion,
      detail: `${bin.pickVisits30d} pick visits / 30d`,
    })

    // Velocity match — A-movers belong near the dock, C-movers far; B/none neutral.
    const distRank = distSpan < 1e-9 ? 0 : (dist - minDist) / distSpan // 0 = nearest
    const velNorm = request.sku.velocityClass === 'A' ? 1 - distRank
      : request.sku.velocityClass === 'C' ? distRank
      : 0.5
    factors.push({
      factor: 'velocity_match',
      weight: w.velocityMatch,
      rawValue: distRank,
      normalized: velNorm,
      weighted: velNorm * w.velocityMatch,
      detail: request.sku.velocityClass
        ? `${request.sku.velocityClass}-mover ${request.sku.velocityClass === 'A' ? 'near' : request.sku.velocityClass === 'C' ? 'far from' : 'anywhere vs'} dock`
        : 'no velocity history',
    })

    const softTriggers = softByLocation.get(bin.locationId) ?? []
    const factorTotal = factors.reduce((sum, f) => sum + f.weighted, 0)
    const softTotal = softTriggers.reduce((sum, t) => sum + t.delta, 0)

    return {
      locationId: bin.locationId,
      locationCode: bin.code,
      totalScore: factorTotal + softTotal,
      factors,
      ruleTriggers: softTriggers,
    }
  })

  // Best score first; deterministic tie-break by location id.
  breakdowns.sort((a, b) => b.totalScore - a.totalScore || a.locationId - b.locationId)
  return breakdowns
}

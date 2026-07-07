// Warehouse Intelligence Engine — putaway orchestration.
//
// The engine's public entry point. Given a fully-loaded PutawayRequest (candidate
// bins with precomputed distances/fill, active rules, weights), run the two-stage
// optimizer and return a ranked recommendation plus its explanation. Pure: no
// I/O — the caller loads the data and persists the result.

import { buildExplanation } from './explain.ts'
import { filterCandidates, scoreCandidates } from './scoring.ts'
import type { PutawayRecommendation, PutawayRequest } from './types.ts'

export function recommendPutaway(request: PutawayRequest): PutawayRecommendation {
  const filter = filterCandidates(request)
  const ranked = scoreCandidates(request, filter)
  const explanation = buildExplanation(request, filter, ranked)
  const [winner, ...alternatives] = ranked
  return {
    recommendedLocationId: winner?.locationId ?? null,
    alternatives: alternatives.slice(0, 5),
    explanation,
  }
}

export * from './types.ts'
export { ENGINE_VERSION } from './version.ts'

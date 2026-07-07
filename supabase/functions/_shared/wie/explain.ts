// Warehouse Intelligence Engine — explanation assembly.
//
// Turns the filter + scoring output into the PutawayExplanation payload stored on
// wie_putaway_recommendations.explanation and rendered by the "Why?" popover.

import { ENGINE_VERSION } from './version.ts'
import type {
  CandidateBreakdown,
  PutawayExplanation,
  PutawayRequest,
} from './types.ts'
import type { FilterResult } from './scoring.ts'

const ALTERNATIVES_SHOWN = 5

export function buildExplanation(
  request: PutawayRequest,
  filter: FilterResult,
  ranked: CandidateBreakdown[],
): PutawayExplanation {
  const [winner, ...rest] = ranked
  return {
    engineVersion: ENGINE_VERSION,
    layoutId: request.layoutId,
    candidatesConsidered: request.candidates.length,
    hardFilters: filter.hardFilters,
    winner: winner ?? null,
    alternatives: rest.slice(0, ALTERNATIVES_SHOWN),
  }
}

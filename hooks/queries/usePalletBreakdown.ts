// Pallet break-down at putaway (mig 00126).
//
// Two mutations, not a query and a mutation: planning is a POST with
// `dry_run: true` and depends on what the operator has typed a moment ago, so
// caching it would serve a plan for a sheet that no longer exists.
//
// Invalidation matches useCompletePutaway exactly. Breaking down moves no stock
// to a bay, but it DOES rewrite `inventory_balances` at the root (the units
// change plate) and it rewrites the walk — one task becomes several — so the
// route and the counts are as stale afterwards as they are after a placement.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  breakDownPallet,
  planBreakdownPortions,
  type BreakdownPlanResult,
  type BreakdownPortionRequest,
  type BreakdownResult,
} from '@/services/supabase/palletBreakdownService'
import { generateLabels, type GenerateLabelsResult } from '@/services/supabase/labelService'
import { putawayKeys } from './putawayKeys'

export interface PlanBreakdownVars {
  recommendationId: number
  portions: readonly BreakdownPortionRequest[]
}

/** Score the portions and suggest a bin for each. Writes nothing, so nothing is
 *  invalidated. */
export function usePlanBreakdown() {
  return useMutation<BreakdownPlanResult, Error, PlanBreakdownVars>({
    mutationFn: ({ recommendationId, portions }) => planBreakdownPortions(recommendationId, portions),
  })
}

export interface BreakDownVars extends PlanBreakdownVars {
  roleOverride?: boolean
}

/** Commit the break-down: mint the plates, re-plate at the root, fan the task
 *  out into one assigned stop per plate. */
export function useBreakDownPallet() {
  const qc = useQueryClient()
  return useMutation<BreakdownResult, Error, BreakDownVars>({
    mutationFn: ({ recommendationId, portions, roleOverride }) =>
      breakDownPallet({ recommendationId, portions, roleOverride }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-balances'] })
      qc.invalidateQueries({ queryKey: ['inventoryBalances'] })
      qc.invalidateQueries({ queryKey: putawayKeys.all })
      qc.invalidateQueries({ queryKey: putawayKeys.counts })
      qc.invalidateQueries({ queryKey: ['putaway-route'] })
    },
  })
}

/**
 * Render the stickers for the plates a break-down just minted.
 *
 * `generate-labels` already accepts an explicit id list on the `handling_unit`
 * kind, flips `label_printed` once the PDF is safely stored, and returns a
 * short-lived signed URL — so this needs no server work at all. The caller
 * renders the URL as a link the operator TAPS; opening it programmatically
 * after the await is popup-blocked.
 */
export function usePrintPlateLabels() {
  return useMutation<GenerateLabelsResult, Error, number[]>({
    mutationFn: (handlingUnitIds) => generateLabels({ kind: 'handling_unit', ids: handlingUnitIds }),
  })
}

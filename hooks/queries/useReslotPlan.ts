import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  planReslot,
  commitReslotPlan,
  type CommitMove,
  type CommitReslotResult,
  type ReslotPlanResult,
} from '@/services/supabase/reslotService'
import { slottingKeys } from './useSlottingSuggestions'

/** On-demand: compute the re-slot plan for a draft layout (opened in the planner). */
export function usePlanReslot() {
  return useMutation<ReslotPlanResult, Error, number>({
    mutationFn: (layoutId) => planReslot(layoutId),
  })
}

/** After publish: write the approved moves as a relocation worklist. */
export function useCommitReslotPlan(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation<CommitReslotResult, Error, { layoutId: number; moves: CommitMove[] }>({
    mutationFn: ({ layoutId, moves }) => commitReslotPlan(layoutId, moves),
    onSuccess: () => qc.invalidateQueries({ queryKey: slottingKeys.byWarehouse(warehouseId) }),
  })
}

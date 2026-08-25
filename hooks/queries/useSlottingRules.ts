import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getSlottingRows,
  saveBlock,
  deleteBlock,
  saveRule,
  deleteRule,
  type SaveBlockInput,
  type SaveRuleInput,
} from '@/services/supabase/slottingRulesService'

/** Scoped per warehouse: rules and blocks belong to a site, so switching sites
 *  must not show the previous one's cache. */
export const slottingKeys = {
  all: ['slotting'] as const,
  forWarehouse: (warehouseId: number) => ['slotting', warehouseId] as const,
}

export function useSlottingRows(warehouseId: number | null | undefined) {
  return useQuery({
    queryKey: slottingKeys.forWarehouse(warehouseId ?? 0),
    queryFn: () => getSlottingRows(warehouseId as number),
    enabled: typeof warehouseId === 'number' && warehouseId > 0,
    // Rules change when an operator changes them and at no other time, so a
    // long stale window costs nothing and every mutation invalidates anyway.
    staleTime: 5 * 60_000,
  })
}

/** A dry run must NOT invalidate — it writes nothing, and refetching on a
 *  preview would make the panel flicker every keystroke. */
function invalidateUnlessDryRun(qc: ReturnType<typeof useQueryClient>, warehouseId: number, dryRun?: boolean) {
  if (!dryRun) qc.invalidateQueries({ queryKey: slottingKeys.forWarehouse(warehouseId) })
}

export function useSaveSlottingBlock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveBlockInput) => saveBlock(input),
    onSuccess: (_r, input) => invalidateUnlessDryRun(qc, input.warehouseId, input.dryRun),
  })
}

export function useDeleteSlottingBlock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ warehouseId, id }: { warehouseId: number; id: number }) => deleteBlock(warehouseId, id),
    onSuccess: (_r, { warehouseId }) => invalidateUnlessDryRun(qc, warehouseId),
  })
}

export function useSaveSlottingRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveRuleInput) => saveRule(input),
    onSuccess: (_r, input) => invalidateUnlessDryRun(qc, input.warehouseId, input.dryRun),
  })
}

export function useDeleteSlottingRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ warehouseId, id }: { warehouseId: number; id: number }) => deleteRule(warehouseId, id),
    onSuccess: (_r, { warehouseId }) => invalidateUnlessDryRun(qc, warehouseId),
  })
}

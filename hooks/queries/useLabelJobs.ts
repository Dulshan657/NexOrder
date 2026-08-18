import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  confirmLabelPrint,
  getLayoutLabelStatus,
  getLayoutLabelTargets,
  getWarehouseLabelPrefs,
  getWarehousePrintCalibration,
  printLayoutLabels,
  setWarehouseLabelPrefs,
  setWarehousePrintCalibration,
  type LayoutLabelJob,
  type PrintLayoutLabelsInput,
  type WarehouseLabelPref,
} from '@/services/supabase/labelService'
import { groupForKind, type SheetGroup } from '@/supabase/functions/_shared/labels/layoutLabelPlan'

export const labelJobKeys = {
  status: (layoutId: number | null) => ['layout-label-status', layoutId] as const,
  targets: (layoutId: number | null, rootId: number | null, onlyUnprinted: boolean) =>
    ['layout-label-targets', layoutId, rootId, onlyUnprinted] as const,
  prefs: (warehouseId: number | null) => ['warehouse-label-prefs', warehouseId] as const,
  calibration: (warehouseId: number | null) => ['warehouse-print-calibration', warehouseId] as const,
}

/** The sticker stock this site has chosen, by sheet group (mig 00106). */
export function useWarehouseLabelPrefs(warehouseId: number | null) {
  return useQuery({
    queryKey: labelJobKeys.prefs(warehouseId),
    queryFn: () => getWarehouseLabelPrefs(warehouseId as number),
    enabled: warehouseId != null,
  })
}

export function useSetWarehouseLabelPrefs(warehouseId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (prefs: WarehouseLabelPref[]) =>
      setWarehouseLabelPrefs({ warehouseId: warehouseId as number, prefs }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: labelJobKeys.prefs(warehouseId) })
    },
  })
}

/** This site's ink-spread compensation (mig 00110). `undefined` while loading,
 *  `null` once loaded and unmeasured — the two are not the same thing. */
export function useWarehousePrintCalibration(warehouseId: number | null) {
  return useQuery({
    queryKey: labelJobKeys.calibration(warehouseId),
    queryFn: () => getWarehousePrintCalibration(warehouseId as number),
    enabled: warehouseId != null,
  })
}

export function useSetWarehousePrintCalibration(warehouseId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { barWidthReductionPt: number | null; note?: string | null }) =>
      setWarehousePrintCalibration({ warehouseId: warehouseId as number, ...input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: labelJobKeys.calibration(warehouseId) })
    },
  })
}

/**
 * How many of a layout's locations still have no sticker — the badge.
 *
 * The RPC counts per location KIND; folding those into sheet groups happens
 * here, through the same `groupForKind` the renderer uses. Keeping the mapping
 * out of SQL means there is one definition of "which sheet does a BIN print on",
 * not two that drift.
 */
export interface LayoutLabelSummary {
  outstanding: number
  total: number
  byGroup: Record<SheetGroup, { total: number; outstanding: number }>
}

function emptySummary(): LayoutLabelSummary {
  return {
    outstanding: 0,
    total: 0,
    byGroup: {
      wayfinding: { total: 0, outstanding: 0 },
      slots: { total: 0, outstanding: 0 },
      staging: { total: 0, outstanding: 0 },
    },
  }
}

export function useLayoutLabelStatus(layoutId: number | null) {
  return useQuery({
    queryKey: labelJobKeys.status(layoutId),
    queryFn: async (): Promise<LayoutLabelSummary> => {
      const rows = await getLayoutLabelStatus(layoutId as number)
      return rows.reduce((acc, row) => {
        const group = groupForKind(row.kind)
        acc.total += row.total
        acc.outstanding += row.outstanding
        if (group) {
          acc.byGroup[group].total += row.total
          acc.byGroup[group].outstanding += row.outstanding
        }
        return acc
      }, emptySummary())
    },
    enabled: Boolean(layoutId),
    staleTime: 60_000,
  })
}

/** Preview of exactly what a run would print, grouped by sheet of stock. */
export function useLayoutLabelTargets(
  layoutId: number | null,
  opts: {
    rootLocationId?: number | null
    onlyUnprinted?: boolean
    enabled?: boolean
    locationIds?: readonly number[] | null
  } = {},
) {
  const rootId = opts.rootLocationId ?? null
  const onlyUnprinted = opts.onlyUnprinted ?? true
  const idKey = opts.locationIds && opts.locationIds.length > 0
    // Part of the cache key, or a narrowed run would serve the whole layout's
    // cached plan. Sorted and joined so the key is stable across re-renders that
    // produce the same set in a different order.
    ? [...opts.locationIds].sort((a, b) => a - b).join(',')
    : null
  return useQuery({
    queryKey: [...labelJobKeys.targets(layoutId, rootId, onlyUnprinted), idKey] as const,
    queryFn: () =>
      getLayoutLabelTargets(layoutId as number, {
        rootLocationId: rootId, onlyUnprinted, locationIds: opts.locationIds,
      }),
    enabled: Boolean(layoutId) && (opts.enabled ?? true),
    staleTime: 30_000,
  })
}

export function usePrintLayoutLabels() {
  const qc = useQueryClient()
  return useMutation<LayoutLabelJob, Error, PrintLayoutLabelsInput>({
    mutationFn: (input) => printLayoutLabels(input),
    onSuccess: (_job, input) => {
      // The print log gained rows; the backlog has NOT moved — label_printed only
      // flips on confirm — but the targets preview is refetched anyway so a
      // second run in the same session cannot reuse a stale plan.
      void qc.invalidateQueries({ queryKey: ['label-print-log'] })
      void qc.invalidateQueries({ queryKey: labelJobKeys.targets(input.layoutId, null, true) })
    },
  })
}

export function useConfirmLabelPrint(layoutId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ jobId, undo }: { jobId: string; undo?: boolean }) =>
      confirmLabelPrint(jobId, { undo }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: labelJobKeys.status(layoutId) })
      void qc.invalidateQueries({ queryKey: ['layout-label-targets'] })
      void qc.invalidateQueries({ queryKey: ['label-print-log'] })
    },
  })
}

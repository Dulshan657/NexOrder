// Gathers everything the setup checklist needs and hands it to the pure
// evaluator. The thinking lives in lib/warehouseSetup/evaluate.ts; this file
// only fetches.
//
// Almost nothing here is a new request. Every hook below is already mounted by
// the Warehouse tab or cached app-wide behind a stable query key with a 5-minute
// staleTime, so rendering this panel alongside WarehousePage costs two queries:
// the acknowledgement rows and the replenishment head-count.

import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useWarehouses } from './useWarehouses'
import { useLayouts } from './useLayouts'
import { useStorageTypes } from './useStorageTypes'
import { useLevelRoles } from './useLevelRoles'
import { useZoneProfiles } from './useZoneProfiles'
import { useWieRules } from './useWieRules'
import { useProducts } from './useProducts'
import { useBalancesByWarehouse } from './useInventoryBalances'
import { useLayoutLabelStatus } from './useLabelJobs'
import {
  acknowledgeSetupStep,
  countLayoutPlacements,
  countReplenConfigured,
  getSetupAcks,
  revokeSetupStep,
  type AcknowledgeInput,
} from '@/services/supabase/warehouseSetupService'
import { evaluateSetup, type SetupSummary } from '@/lib/warehouseSetup/evaluate'

export const warehouseSetupKeys = {
  all: ['warehouse-setup'] as const,
  acks: (warehouseId: number) => ['warehouse-setup', 'acks', warehouseId] as const,
  replen: (warehouseId: number) => ['warehouse-setup', 'replen', warehouseId] as const,
  placements: (layoutId: number) => ['warehouse-setup', 'placements', layoutId] as const,
}

export function useSetupAcks(warehouseId: number | null) {
  return useQuery({
    queryKey: warehouseSetupKeys.acks(warehouseId ?? 0),
    queryFn: () => getSetupAcks(warehouseId as number),
    enabled: warehouseId != null,
    staleTime: 60_000,
  })
}

export function useReplenConfiguredCount(warehouseId: number | null) {
  return useQuery({
    queryKey: warehouseSetupKeys.replen(warehouseId ?? 0),
    queryFn: () => countReplenConfigured(warehouseId as number),
    enabled: warehouseId != null,
    staleTime: 5 * 60_000,
  })
}

/** Placement count for a published layout — feeds the candidate-ceiling
 *  warning. A head-count, so it stays cheap on a 945-location site. */
export function useLayoutPlacementCount(layoutId: number | null) {
  return useQuery({
    queryKey: warehouseSetupKeys.placements(layoutId ?? 0),
    queryFn: () => countLayoutPlacements(layoutId as number),
    enabled: layoutId != null,
    staleTime: 5 * 60_000,
  })
}

export interface WarehouseSetupResult {
  summary: SetupSummary | null
  /** Published layout id, or null — several callers want it alongside. */
  publishedLayoutId: number | null
  isLoading: boolean
}

/**
 * Evaluate the setup chain for one warehouse.
 *
 * Returns `summary: null` while the warehouse itself is unknown, so callers
 * render nothing rather than a checklist full of false reds during first paint.
 */
export function useWarehouseSetup(warehouseId: number | null): WarehouseSetupResult {
  const { data: warehouses, isLoading: whLoading } = useWarehouses()
  const warehouse = useMemo(
    () => (warehouseId == null ? undefined : (warehouses ?? []).find((w) => w.id === warehouseId)),
    [warehouses, warehouseId],
  )

  const { data: layouts, isLoading: layoutsLoading } = useLayouts(warehouseId)
  const published = useMemo(
    () => (layouts ?? []).find((l) => l.status === 'published') ?? null,
    [layouts],
  )

  const { data: storageTypes } = useStorageTypes()
  const { data: levelRoles } = useLevelRoles()
  const { data: zoneProfiles } = useZoneProfiles()
  const { data: wieRules } = useWieRules()
  const { data: products } = useProducts()
  const { data: balances, isLoading: balancesLoading } = useBalancesByWarehouse(warehouseId)
  const { data: labelStatus } = useLayoutLabelStatus(published?.id ?? null)
  const { data: acks, isLoading: acksLoading } = useSetupAcks(warehouseId)
  const { data: replenCount, isLoading: replenLoading } = useReplenConfiguredCount(warehouseId)

  const summary = useMemo<SetupSummary | null>(() => {
    if (!warehouse) return null

    const rows = balances ?? []
    return evaluateSetup({
      warehouseId: warehouse.id,
      locationType: warehouse.locationType === 'racked' ? 'racked' : 'bulk',
      acknowledgedKeys: (acks ?? []).map((a) => a.stepKey),
      storageFormCount: (storageTypes ?? []).length,
      levelRoleCount: (levelRoles ?? []).length,
      pickZoneRoleCount: (levelRoles ?? []).filter((r) => r.isPickZone).length,
      zoneProfileCount: (zoneProfiles ?? []).length,
      // Scoped to THIS warehouse — a global rule doesn't mean this site was
      // considered, which is what the step is asking.
      hasWarehouseRule: (wieRules ?? []).some((r) => r.warehouseId === warehouse.id),
      layout: {
        hasDraft: (layouts ?? []).some((l) => l.status === 'draft'),
        publishedLayoutId: published?.id ?? null,
        needsRepublish: published?.needsRepublish === true,
      },
      labels: labelStatus ? { ...labelStatus.byGroup.slots } : null,
      productCount: (products ?? []).length,
      replenConfiguredCount: replenCount ?? 0,
      // Rows carry their location, so "not the root" is the bin-level test.
      hasBinLevelStock: rows.some((r) => r.locationId !== warehouse.id && r.onHand > 0),
      hasAnyStock: rows.some((r) => r.onHand > 0),
    })
  }, [
    warehouse, acks, storageTypes, levelRoles, zoneProfiles, wieRules,
    layouts, published, labelStatus, products, replenCount, balances,
  ])

  return {
    summary,
    publishedLayoutId: published?.id ?? null,
    isLoading: whLoading || layoutsLoading || acksLoading || replenLoading || balancesLoading,
  }
}

export function useAcknowledgeSetupStep(warehouseId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<AcknowledgeInput, 'warehouseId'>) =>
      acknowledgeSetupStep({ ...input, warehouseId: warehouseId as number }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: warehouseSetupKeys.acks(warehouseId ?? 0) }),
  })
}

export function useRevokeSetupStep(warehouseId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (stepKey: string) => revokeSetupStep(warehouseId as number, stepKey),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: warehouseSetupKeys.acks(warehouseId ?? 0) }),
  })
}

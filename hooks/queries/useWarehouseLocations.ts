import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  bindZones,
  getWarehouseLocations,
  createWarehouseLocation,
  updateWarehouseLocation,
  deactivateWarehouseLocation,
  paintAreas,
  paintSigns,
  recodeLocations,
  getLatestCodeSweep,
  revertCodeSweep,
  renameArea,
  renameRack,
  type CreateLocationInput,
  type PaintAreasArgs,
  type PaintSignsArgs,
  type RecodeArgs,
  type UpdateLocationInput,
} from '@/services/supabase/warehouseLocationService'

export const warehouseLocationKeys = {
  byWarehouse: (id: number) => ['warehouse-locations', id] as const,
}

/**
 * Invalidate every cache that holds a location's NAME or CODE.
 *
 * `['warehouse-locations', id]` is the one every warehouse screen reads, and it
 * was the only one these mutations invalidated. Two others carry the same two
 * strings and were invalidated by nothing at all:
 *
 *  - `['location-names']` (hooks/queries/useLocationNames.ts) — the ORDER-scoped
 *    lookup, because a pick stop carries no warehouseId. 5-minute staleTime plus
 *    `placeholderData: previous`, and its own header claimed "both rename
 *    mutations invalidate on success". They did not. That is the Pick workspace,
 *    where somebody is standing at the rack face reading a sticker.
 *  - `['locations']` (hooks/queries/useInventoryBalances.ts) — read by the Stock
 *    page rows.
 *
 * Neither self-heals: `lib/queryClient.ts` sets `refetchOnWindowFocus: false`.
 * Both are prefix keys, so this invalidates every id-set variant of them.
 */
function invalidateLocationIdentity(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: ['location-names'] })
  qc.invalidateQueries({ queryKey: ['locations'] })
  // `['pick-tasks', orderId]` carries the live-joined CODE while the name beside
  // it on the same row comes from `['location-names']`. Refreshing one and not
  // the other is worse than refreshing neither: it renders a NEW name against an
  // OLD code, a pair that never existed. Both, or nothing.
  qc.invalidateQueries({ queryKey: ['pick-tasks'] })
}

/**
 * Every location under one warehouse, retired rows included.
 *
 * 60s rather than the 5-minute global default, because one of the fields on
 * these rows is a SAFETY message and not a label: `isActive` is what raises the
 * "this bin has been retired from the layout" warning on a putaway stop
 * (PutawayStopCard). Publishing a layout retires bins, and it happens at a desk
 * while the handheld is out in the aisles — a different session, so none of the
 * mutation invalidations below can reach it. At five minutes with
 * refetchOnWindowFocus off (lib/queryClient.ts), a walker could be sent to a bay
 * that left the map minutes ago and learn about it only when complete-putaway
 * refuses the placement, having already carried the pallet there.
 *
 * Matches the 60s treatment the label-status key gets in this file, and for a
 * related reason: a cached answer that under-reports is worse than a slightly
 * chattier query.
 */
export function useWarehouseLocations(warehouseId: number | null) {
  return useQuery({
    queryKey: warehouseLocationKeys.byWarehouse(warehouseId ?? 0),
    queryFn: () => getWarehouseLocations(warehouseId as number),
    enabled: warehouseId != null,
    staleTime: 60_000,
  })
}

export function useCreateWarehouseLocation(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateLocationInput) => createWarehouseLocation(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: warehouseLocationKeys.byWarehouse(warehouseId) }),
  })
}

export function useUpdateWarehouseLocation(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: UpdateLocationInput }) =>
      updateWarehouseLocation(id, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: warehouseLocationKeys.byWarehouse(warehouseId) }),
  })
}

// ── Friendly names (mig 00094) ───────────────────────────────────────────────

/**
 * Rename an area and cascade to the bins inside it.
 *
 * Invalidates the LAYOUT detail as well as the locations: the area's own label
 * lives in `layout_objects.meta`, so the map would keep drawing the old name
 * over correctly-renamed bins.
 */
export function useRenameArea(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: Omit<Parameters<typeof renameArea>[0], 'warehouseId'>) =>
      renameArea({ ...args, warehouseId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: warehouseLocationKeys.byWarehouse(warehouseId) })
      qc.invalidateQueries({ queryKey: ['layout-detail'] })
      qc.invalidateQueries({ queryKey: ['layouts', warehouseId] })
      invalidateLocationIdentity(qc)
    },
  })
}

// ── Live area painting (mig 00095) ───────────────────────────────────────────

/**
 * Replace every named area on a live site, optionally cascading the bin names.
 *
 * Invalidates the same three keys as useRenameArea, and for the same reason: the
 * area's own geometry and label live in `layout_objects`, so the map would keep
 * drawing the old picture over correctly-renamed bins.
 */
export function usePaintAreas(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: Omit<PaintAreasArgs, 'warehouseId'>) => paintAreas({ ...args, warehouseId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: warehouseLocationKeys.byWarehouse(warehouseId) })
      qc.invalidateQueries({ queryKey: ['layout-detail'] })
      qc.invalidateQueries({ queryKey: ['layouts', warehouseId] })
      invalidateLocationIdentity(qc)
    },
  })
}

// ── Floor signs (mig 00097) ──────────────────────────────────────────────────

/**
 * Replace every floor sign on a live site.
 *
 * Invalidates the two LAYOUT keys but NOT the locations key, and the difference
 * is the point: a sign lives entirely in `layout_objects` and cannot touch a
 * `locations` row, so refetching the tree would be a lie about what just
 * happened. Compare usePaintAreas, which must invalidate all three because its
 * cascade renames bins and its binding re-parents them.
 */
export function usePaintSigns(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: Omit<PaintSignsArgs, 'warehouseId'>) => paintSigns({ ...args, warehouseId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['layout-detail'] })
      qc.invalidateQueries({ queryKey: ['layouts', warehouseId] })
    },
  })
}

// ── Code sweeps (mig 00107) ──────────────────────────────────────────────────

/**
 * Rewrite the codes of a selected block of bins.
 *
 * Many keys, and the last few are the ones easy to miss. The locations key
 * because the codes and paths just changed; the two layout keys because the map
 * labels every bin by its code; `invalidateLocationIdentity` because the pick
 * and stock screens hold the same two strings in caches of their own; and then:
 *
 *  - the label keys, because the sweep RESET `label_printed` on every row it
 *    touched. Miss these and the print-backlog badge reads zero outstanding for a
 *    week while every sticker on the racking names a code no row holds — which is
 *    exactly the failure mig 00084 added the column to prevent.
 *  - the setup-checklist key, because its label step reads that same backlog.
 */
export function useRecodeLocations(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: Omit<RecodeArgs, 'warehouseId'>) => recodeLocations({ ...args, warehouseId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: warehouseLocationKeys.byWarehouse(warehouseId) })
      qc.invalidateQueries({ queryKey: ['layout-detail'] })
      qc.invalidateQueries({ queryKey: ['layouts', warehouseId] })
      qc.invalidateQueries({ queryKey: ['layout-label-targets'] })
      qc.invalidateQueries({ queryKey: ['label-print-log'] })
      qc.invalidateQueries({ queryKey: ['warehouse-setup'] })
      qc.invalidateQueries({ queryKey: ['location-code-sweep', warehouseId] })
      // The backlog SUMMARY, not just its targets: the sweep resets
      // label_printed on every row it touched, and this 60s-cached key is what
      // carries `outstanding`. Missing it under-reports the backlog for a minute
      // — the same failure the targets key is invalidated to prevent.
      qc.invalidateQueries({ queryKey: ['layout-label-status'] })
      invalidateLocationIdentity(qc)
    },
  })
}

/** The undo offer, read from the server so it survives a reload. */
export function useLatestCodeSweep(warehouseId: number | null) {
  return useQuery({
    queryKey: ['location-code-sweep', warehouseId] as const,
    queryFn: () => getLatestCodeSweep(warehouseId as number),
    enabled: warehouseId != null,
  })
}

/**
 * Put the most recent sweep back (mig 00108).
 *
 * The SAME six invalidations as the sweep itself, because a revert moves exactly
 * the same rows in exactly the same ways — including `label_printed`, which the
 * RPC resets unconditionally on both passes.
 */
export function useRevertCodeSweep(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => revertCodeSweep(warehouseId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: warehouseLocationKeys.byWarehouse(warehouseId) })
      qc.invalidateQueries({ queryKey: ['layout-detail'] })
      qc.invalidateQueries({ queryKey: ['layouts', warehouseId] })
      qc.invalidateQueries({ queryKey: ['layout-label-targets'] })
      qc.invalidateQueries({ queryKey: ['label-print-log'] })
      qc.invalidateQueries({ queryKey: ['warehouse-setup'] })
      qc.invalidateQueries({ queryKey: ['location-code-sweep', warehouseId] })
      // The backlog SUMMARY, not just its targets: the sweep resets
      // label_printed on every row it touched, and this 60s-cached key is what
      // carries `outstanding`. Missing it under-reports the backlog for a minute
      // — the same failure the targets key is invalidated to prevent.
      qc.invalidateQueries({ queryKey: ['layout-label-status'] })
      invalidateLocationIdentity(qc)
    },
  })
}

// ── Zone binding (mig 00096) ─────────────────────────────────────────────────

/**
 * Bind every drawn bin to the ZONE its area names.
 *
 * Invalidates the locations (their parent and path just changed, which is what
 * the tree renders from) AND the layout keys — the map derives its zone washes
 * from the bins' ancestry, so a site that just gained zones draws them for the
 * first time and a stale layout would keep drawing none.
 */
export function useBindZones(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => bindZones(warehouseId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: warehouseLocationKeys.byWarehouse(warehouseId) })
      qc.invalidateQueries({ queryKey: ['layout-detail'] })
      qc.invalidateQueries({ queryKey: ['layouts', warehouseId] })
    },
  })
}

/** Rename one rack, optionally restamping its levels in the same round trip. */
export function useRenameRack(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name, includeLevels }: { id: number; name: string; includeLevels?: boolean }) =>
      renameRack(id, name, includeLevels ?? false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: warehouseLocationKeys.byWarehouse(warehouseId) })
      invalidateLocationIdentity(qc)
    },
  })
}

export function useDeactivateWarehouseLocation(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deactivateWarehouseLocation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: warehouseLocationKeys.byWarehouse(warehouseId) }),
  })
}

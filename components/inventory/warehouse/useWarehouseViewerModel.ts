// Composes the read-only queries behind the Warehouse viewer into memoized
// derived maps the grid/tree/detail panels consume. All inputs are cached
// TanStack queries; this hook does no I/O of its own — it just reshapes.

import { useMemo } from 'react'
import type { InventoryLocation, SlottingSuggestion, VelocityClass } from '@/types'
import { useWarehouseLocations } from '@/hooks/queries/useWarehouseLocations'
import { useBalancesByWarehouse } from '@/hooks/queries/useInventoryBalances'
import { useProductVelocity, useLocationTraffic } from '@/hooks/queries/useWieAnalytics'
import { useSlottingSuggestions } from '@/hooks/queries/useSlottingSuggestions'

/** One product's aggregated stock in a bin (batches summed). */
export interface BinContentRow {
  productId: number
  productName: string | null
  sizeFactor: number
  onHand: number
  allocated: number
  slots: number
  velocityClass?: VelocityClass
}

export interface LocationTreeNode {
  location: InventoryLocation
  children: LocationTreeNode[]
}

export interface WarehouseViewerModel {
  locationsById: Map<number, InventoryLocation>
  tree: LocationTreeNode[]
  /** locationId → its product rows (empty array for empty bins). Populated for
   *  both BIN-kind legacy bins and SHELF-kind rack levels (mig 00072) — see
   *  the `isAddressableStock` guard below. */
  binContents: Map<number, BinContentRow[]>
  /** locationId → used/capacity in [0, …]; null when the bin has no capacity set. */
  binFillPct: Map<number, number | null>
  /** locationId → dominant product's ABC class (null when empty/unclassified). */
  binVelocityClass: Map<number, VelocityClass | null>
  /** RACK location id → its level children (kind SHELF, levelIndex set),
   *  ascending by levelIndex. Empty for a rack with no levels (or a plain
   *  legacy BIN, which was never a RACK parent). Feeds RackLevelEditor. */
  levelsByRackId: Map<number, InventoryLocation[]>
  /** graphNodeId → 30-day pick visits. */
  visitsByNode: Map<number, number>
  maxVisits: number
  slotting: SlottingSuggestion[]
  isLoading: boolean
  isError: boolean
}

function buildTree(locations: InventoryLocation[]): LocationTreeNode[] {
  const nodes = new Map<number, LocationTreeNode>()
  for (const loc of locations) nodes.set(loc.id, { location: loc, children: [] })
  const roots: LocationTreeNode[] = []
  for (const node of nodes.values()) {
    const parentId = node.location.parentId
    const parent = parentId != null ? nodes.get(parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node) // parent is the warehouse root (outside this subtree)
  }
  return roots
}

export function useWarehouseViewerModel(
  warehouseId: number | null,
  layoutId: number | null,
): WarehouseViewerModel {
  const locationsQ = useWarehouseLocations(warehouseId)
  const balancesQ = useBalancesByWarehouse(warehouseId)
  const velocityQ = useProductVelocity(warehouseId)
  const trafficQ = useLocationTraffic(layoutId)
  const slottingQ = useSlottingSuggestions(warehouseId)

  return useMemo<WarehouseViewerModel>(() => {
    const locations = locationsQ.data ?? []
    const balances = balancesQ.data ?? []
    const velocity = velocityQ.data ?? []
    const traffic = trafficQ.data ?? []

    const locationsById = new Map<number, InventoryLocation>()
    for (const loc of locations) locationsById.set(loc.id, loc)

    const velocityByProduct = new Map<number, VelocityClass | undefined>()
    for (const v of velocity) velocityByProduct.set(v.productId, v.velocityClass)

    // Aggregate balances → per-bin, per-product rows (summing batches).
    const perBinProduct = new Map<number, Map<number, BinContentRow>>()
    for (const b of balances) {
      let byProduct = perBinProduct.get(b.locationId)
      if (!byProduct) {
        byProduct = new Map<number, BinContentRow>()
        perBinProduct.set(b.locationId, byProduct)
      }
      const existing = byProduct.get(b.productId)
      if (existing) {
        existing.onHand += b.onHand
        existing.allocated += b.allocated
        existing.slots += b.onHand * b.sizeFactor
      } else {
        byProduct.set(b.productId, {
          productId: b.productId,
          productName: b.productName,
          sizeFactor: b.sizeFactor,
          onHand: b.onHand,
          allocated: b.allocated,
          slots: b.onHand * b.sizeFactor,
          velocityClass: velocityByProduct.get(b.productId),
        })
      }
    }

    const binContents = new Map<number, BinContentRow[]>()
    const binFillPct = new Map<number, number | null>()
    const binVelocityClass = new Map<number, VelocityClass | null>()
    const levelsByRackId = new Map<number, InventoryLocation[]>()

    // A rack level (mig 00072) is a SHELF-kind row with `levelIndex` set; it
    // holds real inventory_balances exactly like a BIN, so it's addressable
    // stock too. A legacy BIN's behaviour is completely unchanged by this —
    // `loc.kind === 'BIN'` is untouched, this only ADDS eligible locations.
    const isAddressableStock = (loc: InventoryLocation) =>
      loc.kind === 'BIN' || (loc.kind === 'SHELF' && loc.levelIndex != null)

    for (const loc of locations) {
      if (loc.kind === 'SHELF' && loc.levelIndex != null && loc.parentId != null) {
        const siblings = levelsByRackId.get(loc.parentId) ?? []
        levelsByRackId.set(loc.parentId, [...siblings, loc])
      }

      if (!isAddressableStock(loc)) continue
      const rows = Array.from(perBinProduct.get(loc.id)?.values() ?? [])
      binContents.set(loc.id, rows)

      const usedSlots = rows.reduce((s, r) => s + r.slots, 0)
      const cap = loc.capacitySlots
      binFillPct.set(loc.id, cap != null && cap > 0 ? usedSlots / cap : null)

      // Dominant product = most slots occupied; tie-break by higher 30d velocity is
      // not needed here (slots already reflect volume) — first-max wins deterministically.
      let dominant: BinContentRow | null = null
      for (const r of rows) if (!dominant || r.slots > dominant.slots) dominant = r
      binVelocityClass.set(loc.id, dominant?.velocityClass ?? null)
    }

    for (const levels of levelsByRackId.values()) levels.sort((a, b) => (a.levelIndex ?? 0) - (b.levelIndex ?? 0))

    // Non-bin stock locations (warehouse root / staging) hold bulk + un-put-away
    // stock; expose their contents too so the bulk fallback view isn't empty.
    for (const [locId, byProduct] of perBinProduct) {
      if (!binContents.has(locId)) binContents.set(locId, Array.from(byProduct.values()))
    }

    const visitsByNode = new Map<number, number>()
    let maxVisits = 0
    for (const t of traffic) {
      visitsByNode.set(t.graphNodeId, t.pickVisits30d)
      if (t.pickVisits30d > maxVisits) maxVisits = t.pickVisits30d
    }

    return {
      locationsById,
      tree: buildTree(locations),
      binContents,
      binFillPct,
      binVelocityClass,
      levelsByRackId,
      visitsByNode,
      maxVisits,
      slotting: slottingQ.data ?? [],
      isLoading:
        locationsQ.isLoading || balancesQ.isLoading || velocityQ.isLoading || trafficQ.isLoading,
      isError: locationsQ.isError || balancesQ.isError,
    }
  }, [
    locationsQ.data, locationsQ.isLoading, locationsQ.isError,
    balancesQ.data, balancesQ.isLoading, balancesQ.isError,
    velocityQ.data, velocityQ.isLoading,
    trafficQ.data, trafficQ.isLoading,
    slottingQ.data,
  ])
}

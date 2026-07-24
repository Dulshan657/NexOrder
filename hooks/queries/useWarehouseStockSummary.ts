import { useMemo } from 'react'
import { useBalancesByWarehouse } from './useInventoryBalances'
import { positionsUsed } from '@/supabase/functions/_shared/wie/capacity'
import type { OccupancyRow } from '@/supabase/functions/_shared/wie/capacity'

/** Aggregate capacity demand of a warehouse's current stock, for the layout
 *  designer's capacity advisor and the publish gate.
 *
 *  Two figures, because a layout's capacity is denominated in whatever its bins
 *  are: `requiredSlots` counts per unit (Σ onHand × sizeFactor), `requiredPositions`
 *  counts a pallet as ONE (mig 00078). The caller picks the one matching the bins
 *  it drew — comparing 36 pallets' worth of stock against 36 pallet positions
 *  must not read as a 430-slot shortfall. */
export interface WarehouseStockSummary {
  requiredSlots: number
  /** Same stock, counted in pallet positions: one per pallet plate, per-unit for
   *  everything else. */
  requiredPositions: number
  totalUnits: number
  productCount: number
  hasStock: boolean
  isLoading: boolean
}

export function useWarehouseStockSummary(warehouseId: number | null): WarehouseStockSummary {
  const query = useBalancesByWarehouse(warehouseId)
  return useMemo(() => {
    const rows = query.data ?? []
    let requiredSlots = 0
    let totalUnits = 0
    const products = new Set<number>()
    const occupancy: OccupancyRow[] = []
    for (const r of rows) {
      if (r.onHand <= 0) continue
      requiredSlots += r.onHand * (r.sizeFactor || 1)
      totalUnits += r.onHand
      products.add(r.productId)
      occupancy.push({
        onHand: r.onHand,
        sizeFactor: r.sizeFactor || 1,
        huId: r.huId ?? null,
        huType: r.huType ?? null,
      })
    }
    return {
      requiredSlots,
      // 'pallet' = "score this stock as if it were going into pallet bays".
      requiredPositions: positionsUsed('pallet', occupancy),
      totalUnits,
      productCount: products.size,
      hasStock: totalUnits > 0,
      isLoading: query.isLoading,
    }
  }, [query.data, query.isLoading])
}

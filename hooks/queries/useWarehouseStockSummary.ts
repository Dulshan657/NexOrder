import { useMemo } from 'react'
import { useBalancesByWarehouse } from './useInventoryBalances'

/** Aggregate slot demand of a warehouse's current stock, for the layout designer's
 *  capacity advisor and the publish gate. requiredSlots = Σ onHand × sizeFactor. */
export interface WarehouseStockSummary {
  requiredSlots: number
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
    for (const r of rows) {
      if (r.onHand <= 0) continue
      requiredSlots += r.onHand * (r.sizeFactor || 1)
      totalUnits += r.onHand
      products.add(r.productId)
    }
    return {
      requiredSlots,
      totalUnits,
      productCount: products.size,
      hasStock: totalUnits > 0,
      isLoading: query.isLoading,
    }
  }, [query.data, query.isLoading])
}

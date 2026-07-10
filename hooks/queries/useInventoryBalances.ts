import { useQuery } from '@tanstack/react-query'
import {
  getInventoryBalances,
  getLocations,
  getBalancesByProduct,
  getBalancesByWarehouse,
  getRecentReceipts,
  getProductStockByWarehouse,
} from '@/services/supabase/inventoryService'
import { toInventoryBalance, toInventoryLocation } from '@/lib/adapters'

export const inventoryKeys = {
  balances: ['inventory_balances'] as const,
  locations: ['locations'] as const,
  byProduct: (productId: number) => ['inventory_balances', 'product', productId] as const,
  byWarehouse: (warehouseId: number) => ['inventory_balances', 'warehouse', warehouseId] as const,
  recentReceipts: ['inventory_movements', 'recent_receipts'] as const,
  // Deliberately nested under the `['inventory_balances']` prefix (not a
  // sibling key) so the existing `useAdjustStock` invalidation and the
  // realtime subscription's `qc.invalidateQueries({ queryKey: ['inventory_balances'] })`
  // (hooks/useRealtimeSubscriptions.ts) — both of which invalidate by prefix
  // match — cover this query for free, with no changes needed at either call site.
  stockByWarehouse: (warehouseId: number) => ['inventory_balances', 'stock_by_warehouse', warehouseId] as const,
} as const

export function useInventoryBalances(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: inventoryKeys.balances,
    queryFn: async () => {
      const rows = await getInventoryBalances()
      return (rows ?? []).map(toInventoryBalance)
    },
    enabled: opts?.enabled ?? true,
  })
}

/** Per-product stock totals scoped to one warehouse's subtree, via the
 * `inv_product_stock_by_warehouse` RPC. Disabled until a warehouse is chosen. */
export function useProductStockByWarehouse(warehouseId: number | null) {
  return useQuery({
    queryKey: inventoryKeys.stockByWarehouse(warehouseId ?? 0),
    queryFn: () => getProductStockByWarehouse(warehouseId as number),
    enabled: warehouseId != null,
  })
}

export function useLocations() {
  return useQuery({
    queryKey: inventoryKeys.locations,
    queryFn: async () => {
      const rows = await getLocations()
      return (rows ?? []).map(toInventoryLocation)
    },
  })
}

/** Per-batch balances for one product — lazy-loaded when a Stock row expands. */
export function useBalancesByProduct(productId: number | null) {
  return useQuery({
    queryKey: inventoryKeys.byProduct(productId ?? 0),
    queryFn: () => getBalancesByProduct(productId as number),
    enabled: productId != null,
  })
}

/** Every bin's stock for one warehouse — powers the Warehouse viewer's contents
 * + occupancy. Disabled until a warehouse is chosen. */
export function useBalancesByWarehouse(warehouseId: number | null) {
  return useQuery({
    queryKey: inventoryKeys.byWarehouse(warehouseId ?? 0),
    queryFn: () => getBalancesByWarehouse(warehouseId as number),
    enabled: warehouseId != null,
  })
}

/** Recent goods receipts for the Receive Stock activity panel. */
export function useRecentReceipts(limit = 10) {
  return useQuery({
    queryKey: inventoryKeys.recentReceipts,
    queryFn: () => getRecentReceipts(limit),
  })
}

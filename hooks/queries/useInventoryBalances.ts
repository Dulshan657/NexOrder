import { useQuery } from '@tanstack/react-query'
import {
  getInventoryBalances,
  getLocations,
  getBalancesByProduct,
  getRecentReceipts,
} from '@/services/supabase/inventoryService'
import { toInventoryBalance, toInventoryLocation } from '@/lib/adapters'

export const inventoryKeys = {
  balances: ['inventory_balances'] as const,
  locations: ['locations'] as const,
  byProduct: (productId: number) => ['inventory_balances', 'product', productId] as const,
  recentReceipts: ['inventory_movements', 'recent_receipts'] as const,
} as const

export function useInventoryBalances() {
  return useQuery({
    queryKey: inventoryKeys.balances,
    queryFn: async () => {
      const rows = await getInventoryBalances()
      return (rows ?? []).map(toInventoryBalance)
    },
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

/** Recent goods receipts for the Receive Stock activity panel. */
export function useRecentReceipts(limit = 10) {
  return useQuery({
    queryKey: inventoryKeys.recentReceipts,
    queryFn: () => getRecentReceipts(limit),
  })
}

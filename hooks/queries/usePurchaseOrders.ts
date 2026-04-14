import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getPurchaseOrders,
  createPurchaseOrder,
  updatePurchaseOrder,
} from '@/services/supabase/purchaseOrderService'
import type { Database } from '@/lib/database.types'

type PurchaseOrderInsert = Database['public']['Tables']['purchase_orders']['Insert']
type PurchaseOrderUpdate = Database['public']['Tables']['purchase_orders']['Update']
type PurchaseOrderItemInsert = Database['public']['Tables']['purchase_order_items']['Insert']

export const purchaseOrderKeys = {
  all: ['purchaseOrders'] as const,
} as const

export function usePurchaseOrders() {
  return useQuery({
    queryKey: purchaseOrderKeys.all,
    queryFn: getPurchaseOrders,
  })
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      po,
      items,
    }: {
      po: PurchaseOrderInsert
      items: Omit<PurchaseOrderItemInsert, 'purchase_order_id'>[]
    }) => createPurchaseOrder(po, items),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: purchaseOrderKeys.all })
    },
  })
}

export function useUpdatePurchaseOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: PurchaseOrderUpdate }) =>
      updatePurchaseOrder(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: purchaseOrderKeys.all })
    },
  })
}

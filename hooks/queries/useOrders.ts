import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getOrders,
  getOrdersByHoReCa,
  getOrdersByUser,
  createOrder,
  updateOrderStatus,
} from '@/services/supabase/orderService'
import type { OrderFilters } from '@/services/supabase/orderService'
import type { Database } from '@/lib/database.types'
import { productKeys } from './useProducts'

type OrderInsert = Database['public']['Tables']['orders']['Insert']
type OrderItemInsert = Database['public']['Tables']['order_items']['Insert']

export const orderKeys = {
  all: ['orders'] as const,
  filtered: (filters: OrderFilters) => ['orders', filters] as const,
  byHoReCa: (horecaId: number) => ['orders', 'horeca', horecaId] as const,
  byUser: (userId: string) => ['orders', 'user', userId] as const,
} as const

export function useOrders(filters: OrderFilters = {}) {
  return useQuery({
    queryKey: orderKeys.filtered(filters),
    queryFn: () => getOrders(filters),
  })
}

export function useOrdersByHoReCa(horecaId: number | null | undefined) {
  return useQuery({
    queryKey: orderKeys.byHoReCa(horecaId ?? 0),
    queryFn: () => getOrdersByHoReCa(horecaId!),
    enabled: !!horecaId,
  })
}

export function useOrdersByUser(userId: string | null | undefined) {
  return useQuery({
    queryKey: orderKeys.byUser(userId ?? ''),
    queryFn: () => getOrdersByUser(userId!),
    enabled: !!userId,
  })
}

export function useCreateOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      order,
      items,
    }: {
      order: Omit<OrderInsert, 'id'>
      items: Omit<OrderItemInsert, 'order_id'>[]
    }) => createOrder(order, items),
    onSuccess: () => {
      // Invalidate all order queries since the new order affects every filter view
      qc.invalidateQueries({ queryKey: orderKeys.all })
      // Inventory levels change when an order is placed
      qc.invalidateQueries({ queryKey: productKeys.all })
    },
  })
}

export function useUpdateOrderStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      status,
      note,
    }: {
      id: string
      status: string
      note?: string
    }) => updateOrderStatus(id, status, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orderKeys.all })
    },
  })
}

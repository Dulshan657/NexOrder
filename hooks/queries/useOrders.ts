import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getOrders,
  getOrdersByHoReCa,
  getOrdersByUser,
  placeOrder,
  updateOrderStatus,
} from '@/services/supabase/orderService'
import type { OrderFilters, PlaceOrderInput, PlaceOrderResult } from '@/services/supabase/orderService'
import { productKeys } from './useProducts'

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

export function usePlaceOrder() {
  const qc = useQueryClient()
  return useMutation<PlaceOrderResult, Error, PlaceOrderInput>({
    mutationFn: (input) => placeOrder(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orderKeys.all })
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

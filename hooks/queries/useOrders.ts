import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getOrders,
  getOrdersByHoReCa,
  getOrdersByUser,
  placeOrder,
  updateOrderStatus,
} from '@/services/supabase/orderService'
import type { OrderFilters, PlaceOrderInput, PlaceOrderResult } from '@/services/supabase/orderService'
import type { OrderStatus } from '@/types'
import { productKeys } from './useProducts'
import { pickKeys } from './usePickQueue'
import { orderDocumentKeys } from './useOrderDocuments'

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
      locationId,
      locationPref,
    }: {
      id: string
      status: OrderStatus
      note?: string
      locationId?: number
      locationPref?: number[]
    }) => updateOrderStatus(id, status, note, { locationId, locationPref }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: orderKeys.all })
      // Processing an order (status → processed) makes it pickable — surface it
      // in the Pick Queue immediately instead of waiting for staleTime.
      qc.invalidateQueries({ queryKey: pickKeys.queue })
      // Dispatching auto-generates the dispatch advice server-side — refresh the
      // documents list so it appears without waiting for staleTime.
      if (variables.status === 'dispatched') {
        qc.invalidateQueries({ queryKey: orderDocumentKeys.all })
      }
    },
  })
}

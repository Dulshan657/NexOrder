import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getPickQueue,
  recordPick,
  generatePickSlip,
  generateDispatchAdvice,
} from '@/services/supabase/pickService'
import { updateOrderStatus } from '@/services/supabase/orderService'
import type { OrderStatus } from '@/types'
import { orderDocumentKeys } from './useOrderDocuments'

export const pickKeys = {
  queue: ['pick_queue'] as const,
}

export function usePickQueue() {
  return useQuery({
    queryKey: pickKeys.queue,
    queryFn: getPickQueue,
  })
}

export function useRecordPick() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderItemId, pickedQty }: { orderItemId: number; pickedQty: number }) =>
      recordPick(orderItemId, pickedQty),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pickKeys.queue })
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['inventory_balances'] })
      qc.invalidateQueries({ queryKey: ['products'] })
    },
  })
}

/** Advance an order's fulfillment status (packed/dispatched) from the warehouse. */
export function useUpdateOrderStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, status, note }: { orderId: string; status: OrderStatus; note?: string }) =>
      updateOrderStatus(orderId, status, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pickKeys.queue })
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}

export function useGeneratePickSlip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) => generatePickSlip(orderId),
    onSuccess: () => qc.invalidateQueries({ queryKey: orderDocumentKeys.all }),
  })
}

export function useGenerateDispatchAdvice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) => generateDispatchAdvice(orderId),
    onSuccess: () => qc.invalidateQueries({ queryKey: orderDocumentKeys.all }),
  })
}

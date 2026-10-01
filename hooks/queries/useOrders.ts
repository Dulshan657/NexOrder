import { useMemo } from 'react'
import { useQuery, useMutation, useMutationState, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  getOrders,
  getOrdersByHoReCa,
  getOrdersByUser,
  placeOrder,
  updateOrderStatus,
  cancelOrder,
  getPickedUnits,
} from '@/services/supabase/orderService'
import type { OrderFilters, PlaceOrderInput, PlaceOrderResult } from '@/services/supabase/orderService'
import type { OrderStatus } from '@/types'
import { productKeys } from './useProducts'
import { pickKeys } from './usePickQueue'
import { orderDocumentKeys } from './useOrderDocuments'
import { invoiceKeys } from './useInvoices'

export const orderKeys = {
  all: ['orders'] as const,
  filtered: (filters: OrderFilters) => ['orders', filters] as const,
  byHoReCa: (horecaId: number) => ['orders', 'horeca', horecaId] as const,
  byUser: (userId: string) => ['orders', 'user', userId] as const,
  pickedUnits: (orderId: string) => ['orders', 'pickedUnits', orderId] as const,
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

const orderStatusMutationKey = [...orderKeys.all, 'status'] as const

type StatusVars = { id: string; status: OrderStatus }

/** Put the server-confirmed status on that one order in every cached order
 *  list, so the row's label and next action change as soon as the server
 *  agrees instead of after the full, unbounded orders refetch. Non-list
 *  entries under the prefix (e.g. pickedUnits) are left alone. */
function patchOrderStatus(qc: QueryClient, id: string, status: OrderStatus) {
  qc.setQueriesData<unknown>({ queryKey: orderKeys.all }, (data) => {
    if (!Array.isArray(data)) return data
    let hit = false
    const next = data.map((row: { id?: string }) => {
      if (row?.id !== id) return row
      hit = true
      return { ...row, status }
    })
    return hit ? next : data
  })
}

/** Ids of orders with a status change in flight — for disabling their
 *  advance buttons, so a slow round-trip does not invite a second click. */
export function usePendingOrderStatusIds(): Set<string> {
  const ids = useMutationState({
    filters: { mutationKey: orderStatusMutationKey, status: 'pending' },
    select: (m) => (m.state.variables as StatusVars | undefined)?.id,
  })
  // A string key keeps the Set's identity stable while the pending ids are.
  const key = ids.filter((id): id is string => Boolean(id)).sort().join('\n')
  return useMemo(() => new Set(key ? key.split('\n') : []), [key])
}

export function useUpdateOrderStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: orderStatusMutationKey,
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
      patchOrderStatus(qc, variables.id, variables.status)
      // Still refetch: a status change can carry server-side effects
      // (fulfilments, totals) that the patch above does not know about.
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

/**
 * Cancel a placed order (Admin only, reason mandatory).
 *
 * Invalidates the pick queue and the invoice cache as well as the order list:
 * cancelling releases the order's reservation and cancels its unpaid invoice,
 * so a stale Pick Queue would keep offering work that must not be done and a
 * stale Orders tab would keep showing the invoice as payable.
 */
export function useCancelOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => cancelOrder(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orderKeys.all })
      qc.invalidateQueries({ queryKey: pickKeys.queue })
      qc.invalidateQueries({ queryKey: invoiceKeys.all })
      // The released reservation changes products.available (inv_apply_leg
      // maintains the cache), so the Shop and Stock surfaces are stale too.
      qc.invalidateQueries({ queryKey: productKeys.all })
    },
  })
}

/**
 * Units picked against an order, for the Cancel action's precondition.
 *
 * `enabled` is the point: this is an extra round trip and it is only ever asked
 * when someone can actually cancel. While it is loading the caller must treat
 * the answer as unknown rather than as zero, or the button would offer to
 * cancel a part-picked order that the server then refuses.
 */
export function useOrderPickedUnits(orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: orderKeys.pickedUnits(orderId),
    queryFn: () => getPickedUnits(orderId),
    enabled: enabled && Boolean(orderId),
  })
}

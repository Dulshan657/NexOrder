import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getPickQueue,
  recordPick,
  generatePickSlip,
  generateDispatchAdvice,
  type PickQueueOrder,
  type PickTask,
  type PickScanEvidence,
} from '@/services/supabase/pickService'
import { updateOrderStatus } from '@/services/supabase/orderService'
import type { OrderStatus } from '@/types'
import { orderDocumentKeys } from './useOrderDocuments'
import { pickTaskKeys } from './useOrderPickTasks'

export const pickKeys = {
  queue: ['pick_queue'] as const,
}

export function usePickQueue() {
  return useQuery({
    queryKey: pickKeys.queue,
    queryFn: getPickQueue,
  })
}

interface RecordPickVariables {
  /** Needed to target the right ['pick-tasks', orderId] / queue-line cache
   *  entries surgically — record-pick itself is scoped by orderItemId alone. */
  orderId: string
  orderItemId: number
  pickedQty: number
  locationId?: number
  /** Scan evidence (Phase 3); re-validated server-side. */
  scan?: PickScanEvidence
}

export function useRecordPick() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderItemId, pickedQty, locationId, scan }: RecordPickVariables) =>
      recordPick(orderItemId, pickedQty, locationId, scan),
    // Directed picking hits one bin at a time (one task, one Pick button) —
    // a broad invalidation here refetches every row's data and re-renders the
    // whole pick workspace, which drops fast clicks. Patch the two caches that
    // actually changed instead, and only fall back to a real refetch when the
    // pick moved the line or the order across a status boundary.
    onSuccess: (result, { orderId, orderItemId, pickedQty, locationId }) => {
      if (locationId != null) {
        qc.setQueryData<PickTask[]>(pickTaskKeys.forOrder(orderId), (tasks) =>
          (tasks ?? [])
            .map((t) =>
              t.orderItemId === orderItemId && t.locationId === locationId
                ? { ...t, pickedQty: t.pickedQty + pickedQty, remaining: Math.max(t.remaining - pickedQty, 0) }
                : t,
            )
            .filter((t) => t.remaining > 0),
        )
      }

      qc.setQueryData<PickQueueOrder[]>(pickKeys.queue, (orders) =>
        (orders ?? []).map((o) =>
          o.orderId !== orderId
            ? o
            : {
                ...o,
                lines: o.lines.map((l) =>
                  l.orderItemId === orderItemId ? { ...l, picked: l.picked + pickedQty } : l,
                ),
              },
        ),
      )

      if (result.line_fully_picked || result.order_fully_picked) {
        qc.invalidateQueries({ queryKey: pickKeys.queue })
        qc.invalidateQueries({ queryKey: ['orders'] })
      }
    },
  })
}

/** Advance an order's fulfillment status (packed/dispatched) from the warehouse. */
export function useUpdateOrderStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, status, note }: { orderId: string; status: OrderStatus; note?: string }) =>
      updateOrderStatus(orderId, status, note),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: pickKeys.queue })
      qc.invalidateQueries({ queryKey: ['orders'] })
      // Dispatching auto-generates the dispatch advice server-side — refresh the
      // documents list so it appears without waiting for staleTime.
      if (variables.status === 'dispatched') {
        qc.invalidateQueries({ queryKey: orderDocumentKeys.all })
      }
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

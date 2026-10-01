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

const recordPickKey = ['pick_queue', 'record'] as const

/** This pick's own task row as it was before the optimistic patch. */
type PickSnapshot = { task: PickTask | undefined }

const isTask = (t: PickTask, orderItemId: number, locationId: number | undefined) =>
  t.orderItemId === orderItemId && t.locationId === locationId

export function useRecordPick() {
  const qc = useQueryClient()
  return useMutation<Awaited<ReturnType<typeof recordPick>>, Error, RecordPickVariables, PickSnapshot>({
    mutationKey: recordPickKey,
    mutationFn: ({ orderItemId, pickedQty, locationId, scan }: RecordPickVariables) =>
      recordPick(orderItemId, pickedQty, locationId, scan),
    // OPTIMISTIC on the counts, so the queue and the task's remaining move on
    // Confirm. The server still re-validates the scan; a refusal rolls back.
    //
    // Directed picking hits one bin at a time (one task, one Pick button) —
    // a broad invalidation here refetches every row's data and re-renders the
    // whole pick workspace, which drops fast clicks. Patch the two caches that
    // actually change instead, and only fall back to a real refetch when the
    // pick moved the line or the order across a status boundary.
    onMutate: async ({ orderId, orderItemId, pickedQty, locationId }) => {
      const tasksKey = pickTaskKeys.forOrder(orderId)
      await Promise.all([
        qc.cancelQueries({ queryKey: tasksKey }),
        qc.cancelQueries({ queryKey: pickKeys.queue, exact: true }),
      ])
      const snapshot: PickSnapshot = {
        task: qc.getQueryData<PickTask[]>(tasksKey)?.find((t) => isTask(t, orderItemId, locationId)),
      }

      // The finished task is NOT removed here: the row is still awaiting this
      // mutation, and unmounting it would swallow a refusal's error message.
      if (locationId != null) {
        qc.setQueryData<PickTask[]>(tasksKey, (tasks) =>
          tasks?.map((t) =>
            isTask(t, orderItemId, locationId)
              ? { ...t, pickedQty: t.pickedQty + pickedQty, remaining: Math.max(t.remaining - pickedQty, 0) }
              : t,
          ),
        )
      }
      qc.setQueryData<PickQueueOrder[]>(pickKeys.queue, (orders) =>
        orders?.map((o) =>
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
      return snapshot
    },
    // Undo THIS pick only — its own task row and its own count — never a
    // whole-cache snapshot, which may predate another pick the server has
    // since recorded. Then refetch, so the server has the last word.
    onError: (_err, { orderId, orderItemId, pickedQty, locationId }, snapshot) => {
      const tasksKey = pickTaskKeys.forOrder(orderId)
      if (snapshot?.task) {
        qc.setQueryData<PickTask[]>(tasksKey, (tasks) =>
          tasks?.map((t) => (isTask(t, orderItemId, locationId) ? snapshot.task! : t)),
        )
      }
      qc.setQueryData<PickQueueOrder[]>(pickKeys.queue, (orders) =>
        orders?.map((o) =>
          o.orderId !== orderId
            ? o
            : {
                ...o,
                lines: o.lines.map((l) =>
                  l.orderItemId === orderItemId ? { ...l, picked: l.picked - pickedQty } : l,
                ),
              },
        ),
      )
      qc.invalidateQueries({ queryKey: tasksKey })
      qc.invalidateQueries({ queryKey: pickKeys.queue, exact: true })
    },
    onSuccess: (result, { orderId, orderItemId, locationId }) => {
      // Only the task this pick finished: another pick's row at 0 is still
      // awaiting its own answer and must stay mounted to show a refusal.
      qc.setQueryData<PickTask[]>(pickTaskKeys.forOrder(orderId), (tasks) =>
        tasks?.filter((t) => !(isTask(t, orderItemId, locationId) && t.remaining <= 0)),
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

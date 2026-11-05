import { useMutation, useQueryClient } from '@tanstack/react-query'
import { recordShortPick, type PickTask, type ShortPickResult } from '@/services/supabase/pickService'
import { pickKeys } from './usePickQueue'
import { pickFactsKeys, pickTaskKeys, type PickFacts } from './useOrderPickTasks'

export interface RecordShortPickVariables {
  /** For the ['pick-tasks', orderId] cache entries; record-short-pick itself is
   *  scoped by orderItemId alone. */
  orderId: string
  orderItemId: number
  /** The bin that was checked, when one is known. Omitted rather than guessed. */
  locationId?: number
}

/**
 * Finish an open line of an imported order short.
 *
 * Not optimistic, unlike a pick: closing a line cannot be undone from the screen, so
 * the row only changes once the server has said yes. On success it refreshes what a
 * pick refreshes: this order's tasks, the pick queue and the orders lists. It shows
 * the line as closed straight away, and the refetch confirms it.
 */
export function useRecordShortPick() {
  const qc = useQueryClient()
  return useMutation<ShortPickResult, Error, RecordShortPickVariables>({
    mutationKey: ['pick_queue', 'short'],
    mutationFn: ({ orderItemId, locationId }) => recordShortPick(orderItemId, locationId),
    onSuccess: (result, { orderId, orderItemId }) => {
      // 'already_picked' means the line was in fact complete: nothing was closed.
      if (result.status !== 'already_picked') {
        qc.setQueryData<PickTask[]>(pickTaskKeys.forOrder(orderId), (tasks) =>
          tasks?.filter((t) => t.orderItemId !== orderItemId),
        )
        qc.setQueryData<PickFacts>(pickFactsKeys.forOrder(orderId), (facts) =>
          facts && !facts.closedShortLineIds.includes(orderItemId)
            ? { ...facts, closedShortLineIds: [...facts.closedShortLineIds, orderItemId] }
            : facts,
        )
      }
      qc.invalidateQueries({ queryKey: pickTaskKeys.forOrder(orderId) })
      qc.invalidateQueries({ queryKey: pickKeys.queue })
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}

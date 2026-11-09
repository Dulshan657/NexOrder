import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { getOrderPickTasks, type OrderPickTasks, type PickTask } from '@/services/supabase/pickService'

export const pickTaskKeys = {
  forOrder: (orderId: string) => ['pick-tasks', orderId] as const,
}

/** What order-pick-tasks says about the ORDER rather than about one bin (NX-0029). */
export type PickFacts = Pick<OrderPickTasks, 'imported' | 'closedShortLineIds' | 'foundByLine'>

/** Until the first answer lands, and for any order that is not imported: nothing is
 *  closed and nothing may be finished short. */
export const NO_PICK_FACTS: PickFacts = { imported: false, closedShortLineIds: [], foundByLine: {} }

// A sibling cache entry, not part of the tasks entry. ['pick-tasks', orderId] holds
// the PickTask[] that useRecordPick patches task by task, and widening it into an
// object would change what every one of those patches reads. The two are written by
// the same request, so they are never out of step for longer than one render.
export const pickFactsKeys = {
  forOrder: (orderId: string) => ['pick-tasks-facts', orderId] as const,
}

/** Directed, per-bin pick tasks for one order (see order-pick-tasks Edge
 *  Function). Disabled until an orderId is known. Also stores the order's
 *  {@link PickFacts}, read with {@link useOrderPickFacts}. */
export function useOrderPickTasks(orderId: string | null) {
  const qc = useQueryClient()
  return useQuery<PickTask[]>({
    queryKey: pickTaskKeys.forOrder(orderId ?? ''),
    enabled: orderId != null,
    queryFn: async () => {
      const { tasks, ...facts } = await getOrderPickTasks(orderId as string)
      qc.setQueryData<PickFacts>(pickFactsKeys.forOrder(orderId as string), facts)
      return tasks
    },
  })
}

/** Whether the order is imported, which lines are closed short, and what was found on
 *  each. Reads the entry {@link useOrderPickTasks} fills; it never fetches by itself. */
export function useOrderPickFacts(orderId: string | null): PickFacts {
  const { data } = useQuery<PickFacts>({
    queryKey: pickFactsKeys.forOrder(orderId ?? ''),
    queryFn: skipToken,
    staleTime: Infinity,
  })
  return data ?? NO_PICK_FACTS
}

import { useQuery } from '@tanstack/react-query'
import { getOrderPickTasks, type PickTask } from '@/services/supabase/pickService'

export const pickTaskKeys = {
  forOrder: (orderId: string) => ['pick-tasks', orderId] as const,
}

/** Directed, per-bin pick tasks for one order (see order-pick-tasks Edge
 *  Function). Disabled until an orderId is known. */
export function useOrderPickTasks(orderId: string | null) {
  return useQuery<PickTask[]>({
    queryKey: pickTaskKeys.forOrder(orderId ?? ''),
    enabled: orderId != null,
    queryFn: () => getOrderPickTasks(orderId as string),
  })
}

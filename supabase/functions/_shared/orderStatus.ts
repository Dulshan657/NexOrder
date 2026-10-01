// The one way an Edge Function moves orders.status (other than cancelling,
// which is order_cancel_tx's job). Wraps order_set_status_tx (mig 00128), which
// locks the row, refuses a cancelled order or one whose status has left `from`
// since the caller checked it, and appends the history entry in SQL so
// concurrent writers never lose each other's entries.
//
// Transition POLICY (who may, which ladder, forward-only) stays with the
// caller; `from` is the set of statuses that policy was evaluated against.

// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'

export type SetOrderStatusVerdict =
  | { ok: true; changed: boolean; order: Record<string, unknown> }
  | { ok: false; code: 'NOT_FOUND' | 'CANCELLED' }
  | { ok: false; code: 'CONFLICT'; status: string }

export interface SetOrderStatusInput {
  orderId: string
  /** Statuses the caller's checks assumed; null accepts any live status. */
  from: readonly string[] | null
  to: string
  entry: Record<string, unknown>
}

export async function setOrderStatus(
  admin: Pick<SupabaseClient, 'rpc'>,
  { orderId, from, to, entry }: SetOrderStatusInput,
): Promise<SetOrderStatusVerdict> {
  const { data, error } = await admin.rpc('order_set_status_tx', {
    p_order_id: orderId,
    p_from: from ? [...from] : null,
    p_to: to,
    p_entry: entry,
  })
  if (error) throw new Error(`order_set_status_tx failed: ${error.message}`)
  return data as SetOrderStatusVerdict
}

/** Every rung of `ladder` up to and including `to`: the statuses a
 *  forward-only move to `to` may start from. Empty when `to` is off the ladder. */
export function statusesUpTo<T>(ladder: readonly T[], to: T): T[] {
  const idx = ladder.indexOf(to)
  return idx < 0 ? [] : ladder.slice(0, idx + 1)
}

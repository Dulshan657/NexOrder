// In-app notifications to the people who answer for a venue's QR access.
//
// Used when a venue's code locks (qr-unlock) and when a QR order is submitted or
// decided (qr-order-request): the audience is the same -- the venue's own
// Customer logins, the reps ASSIGNED to it, and Admin/Manager -- and resolving
// it twice is how two functions end up telling different people about one event.
//
// ── WHY PER-USER ROWS FOR THREE OF THE FOUR GROUPS ──────────────────────────
//
// `notifications` offers two addressing modes (00001): `user_id` for one person,
// or `user_id IS NULL` plus `target_roles` for everyone holding a role. A
// broadcast to 'Restaurant/Hotel Customer' would reach every customer of every
// venue, and one to the rep roles would reach every rep. So Customers of THIS
// venue and its assigned reps get a row each; Admin and Manager, who really do
// see every venue, get one broadcast row (the shape `health` uses for Admin).
//
// Never throws. A notification is a courtesy on top of a mutation that has
// already happened -- failing the unlock or the submit because the bell could
// not be rung would be the wrong trade -- but it is logged, because a silent
// failure here means an approver never learns a code locked.

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'

export interface QrNotice {
  /** `notifications.type` -- free text in the database, a union in the client. */
  type: string
  message: string
  metadata?: Record<string, unknown>
}

interface NotificationRow {
  id: string
  type: string
  message: string
  user_id: string | null
  target_roles: string[] | null
  metadata: Record<string, unknown>
}

/**
 * @returns how many rows were written (0 when nobody could be told or the
 *   insert failed -- both are logged).
 */
export async function notifyHorecaApprovers(
  service: SupabaseClient,
  horecaId: number,
  notice: QrNotice,
): Promise<number> {
  try {
    const [customers, reps] = await Promise.all([
      service
        .from('profiles')
        .select('id')
        .eq('role', 'Restaurant/Hotel Customer')
        .eq('horeca_id', horecaId),
      service.from('horeca_reps').select('rep_id').eq('horeca_id', horecaId),
    ])

    if (customers.error || reps.error) {
      console.warn(
        '[qrNotify] could not resolve recipients:',
        customers.error?.message ?? reps.error?.message,
      )
    }

    const userIds = new Set<string>()
    for (const row of (customers.data ?? []) as Array<{ id: string }>) userIds.add(row.id)
    for (const row of (reps.data ?? []) as Array<{ rep_id: string }>) userIds.add(row.rep_id)

    const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    const metadata = { ...(notice.metadata ?? {}), horecaId }
    const base = { type: notice.type, message: notice.message, metadata }

    const rows: NotificationRow[] = [
      {
        ...base,
        id: `notif-${notice.type}-${horecaId}-${stamp}-staff`,
        user_id: null,
        target_roles: ['Admin', 'Manager'],
      },
      ...[...userIds].map((userId, i) => ({
        ...base,
        id: `notif-${notice.type}-${horecaId}-${stamp}-${i}`,
        user_id: userId,
        target_roles: null,
      })),
    ]

    const { error } = await service.from('notifications').insert(rows)
    if (error) {
      console.warn(`[qrNotify] insert failed (${notice.type}, venue ${horecaId}):`, error.message)
      return 0
    }
    return rows.length
  } catch (e) {
    console.warn(
      `[qrNotify] threw (${notice.type}, venue ${horecaId}):`,
      e instanceof Error ? e.message : e,
    )
    return 0
  }
}

/**
 * Mark every `qr_order_pending` notification for these requests as read.
 *
 * A request leaves the queue three ways -- approved, rejected, cancelled (by the
 * kitchen, or by revoking the person who sent it) -- and the "waiting for your
 * approval" bell entry has to leave with it, or every approver keeps an unread
 * badge for an order that needs nothing from them. Marked READ rather than
 * deleted: the entry is history, the `read` flag is what the bell already treats
 * as handled, and a broadcast row (Admin/Manager share one) cannot be
 * un-addressed per person anyway.
 *
 * Matches on `metadata->>requestId`, which `qr-order-request` `submit` writes.
 * Service role only (an approver may not update someone else's row).
 *
 * Never throws -- a stale badge is a smaller harm than failing a decision that
 * has already been made -- but is logged. Returns how many rows it changed.
 */
export async function retirePendingNotifications(
  service: SupabaseClient,
  requestIds: ReadonlyArray<string>,
): Promise<number> {
  const ids = [...new Set(requestIds.filter((id) => typeof id === 'string' && id !== ''))]
  if (ids.length === 0) return 0
  try {
    const { data, error } = await service
      .from('notifications')
      .update({ read: true })
      .eq('type', 'qr_order_pending')
      .eq('read', false)
      .in('metadata->>requestId', ids)
      .select('id')
    if (error) {
      console.warn('[qrNotify] could not retire pending notifications:', error.message)
      return 0
    }
    return (data ?? []).length
  } catch (e) {
    console.warn('[qrNotify] retiring pending notifications threw:', e instanceof Error ? e.message : e)
    return 0
  }
}

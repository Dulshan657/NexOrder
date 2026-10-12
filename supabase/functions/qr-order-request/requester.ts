// The kitchen's two actions: file a request, and withdraw it while it is pending.

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { type AuthContext } from '../_shared/auth.ts'
import { EdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { notifyHorecaApprovers, retirePendingNotifications } from '../_shared/qrNotify.ts'
import {
  deliveryDateProblem,
  findInvalidRequestLines,
  firstInactiveProduct,
  withSnapshot,
} from '../_shared/qrRequestItems.ts'
import type { Input, SubmitInput } from './schema.ts'
import {
  HOUR,
  MAX_WAITING_PER_STAFF,
  MINUTE,
  assertEdge,
  cleanNotes,
  conflict,
  currentStatus,
  dryRun,
  enforce,
  plural,
  requireRequester,
  toLines,
} from './shared.ts'

/**
 * One person may have this many requests waiting at once. Held orders reserve
 * nothing, so without a cap a phone (or a script holding a valid session for two
 * hours) can pile an unbounded queue onto the approvers. `approving` counts: a
 * claim whose placement fails goes back to `pending`.
 *
 * A read-then-insert, so two submits in the same instant can both pass it; the
 * per-user rate limit above bounds that overshoot to a handful, and the cap is a
 * courtesy to the queue rather than a safety control.
 */
async function assertUnderWaitingCap(admin: SupabaseClient, userId: string): Promise<void> {
  const { count, error } = await admin
    .from('qr_order_requests')
    .select('id', { count: 'exact', head: true })
    .eq('requested_by', userId)
    .in('status', ['pending', 'approving'])
  if (error) {
    console.error('[qr-order-request] could not count waiting requests:', error.message)
    throw new EdgeFunctionError('INTERNAL', 'Could not save your order. Please try again.')
  }
  if ((count ?? 0) >= MAX_WAITING_PER_STAFF) {
    throw new EdgeFunctionError(
      'QR_REQUEST_CONFLICT',
      `You already have ${MAX_WAITING_PER_STAFF} orders waiting for approval`,
    )
  }
}

/**
 * Refuse a product the catalogue has switched off. `placeOrderCore` loads
 * products without looking at `is_active` (and must keep behaving as it does for
 * `place-order`), so a stale "same again" would otherwise queue a line the venue
 * can no longer buy. A product that does not exist at all is the dry run's
 * PRODUCT_NOT_FOUND, below.
 */
async function assertProductsActive(admin: SupabaseClient, lines: ReadonlyArray<{ productId: number }>): Promise<void> {
  const ids = [...new Set(lines.map((l) => l.productId))]
  const { data, error } = await admin.from('products').select('id, name, is_active').in('id', ids)
  if (error) {
    console.error('[qr-order-request] could not check products:', error.message)
    throw new EdgeFunctionError('INTERNAL', 'Could not save your order. Please try again.')
  }
  const gone = firstInactiveProduct(
    (data ?? []) as Array<{ id: number; name: string | null; is_active: boolean | null }>,
    lines,
  )
  if (gone) {
    throw new EdgeFunctionError('PRODUCT_NOT_FOUND', `${gone.name} is no longer available. Remove it and try again.`)
  }
}

export async function submit(admin: SupabaseClient, auth: AuthContext, input: SubmitInput) {
  const staff = requireRequester(auth)
  await enforce(`qr-order:${auth.userId}`, MINUTE, 10, 'Too many orders in a short period')
  await enforce(`qr-order:hc:${staff.horecaId}`, HOUR, 30, 'This venue has placed too many orders this hour')

  const lines = toLines(input.items)
  const invalid = findInvalidRequestLines(lines)
  if (invalid) throw new EdgeFunctionError('INVALID_INPUT', invalid)

  const dateProblem = deliveryDateProblem(input.deliveryDate, new Date())
  if (dateProblem) throw new EdgeFunctionError('INVALID_INPUT', dateProblem)

  await assertUnderWaitingCap(admin, auth.userId)
  await assertProductsActive(admin, lines)

  // Quote the order under the venue's own rules. The result is an ESTIMATE shown
  // to the kitchen; the authoritative total is computed when the order is placed.
  const quote = await dryRun(admin, { horeca_id: staff.horecaId, requested_by: auth.userId }, auth.userId, lines)

  // An unknown product can never be approved, so refuse it now. Everything else a
  // dry run finds -- shortages, the minimum, the credit limit -- is the APPROVER's
  // to weigh, and is deliberately not shown to the kitchen: the credit message
  // quotes the venue's balance, and kitchen staff do not see money owed.
  const fatal = quote.problems.find((p) => p.code === 'PRODUCT_NOT_FOUND' || p.code === 'HORECA_NOT_FOUND')
  if (fatal) throw new EdgeFunctionError(fatal.code, fatal.message)

  const stored = withSnapshot(lines, quote.lines)
  const notes = cleanNotes(input.notes)

  const { data, error } = await admin
    .from('qr_order_requests')
    .insert({
      horeca_id: staff.horecaId,
      requested_by: auth.userId,
      qr_staff_id: staff.id,
      staff_name: staff.name,
      status: 'pending',
      items: stored,
      notes,
      delivery_date: input.deliveryDate ?? null,
      delivery_time_slot: input.deliveryTimeSlot ?? null,
      delivery_address: input.deliveryAddress ?? null,
      quoted_total: quote.total,
    })
    .select('id, created_at')
    .single()
  if (error || !data) {
    console.error('[qr-order-request] insert failed:', error?.message)
    throw new EdgeFunctionError('INTERNAL', 'Could not save your order. Please try again.')
  }
  const row = data as { id: string; created_at: string }
  const venue = quote.hoReCa?.name ?? 'the venue'

  await logAuditEvent(admin, {
    actorId: auth.userId,
    actorRole: auth.role,
    action: 'create',
    resource: 'qr_order_request',
    resourceId: row.id,
    after: { status: 'pending', itemCount: stored.length, quotedTotal: quote.total, staffName: staff.name },
    metadata: { horecaId: staff.horecaId, qrStaffId: staff.id },
  })

  await notifyHorecaApprovers(admin, staff.horecaId, {
    type: 'qr_order_pending',
    message: `${staff.name} at ${venue} placed an order (${plural(stored.length, 'item')}) waiting for approval`,
    metadata: {
      requestId: row.id,
      horecaName: venue,
      staffName: staff.name,
      itemCount: stored.length,
      quotedTotal: quote.total,
    },
  })

  return { status: 201, body: { ok: true, requestId: row.id, quotedTotal: quote.total, status: 'pending', createdAt: row.created_at } }
}

export async function cancel(admin: SupabaseClient, auth: AuthContext, input: Extract<Input, { action: 'cancel' }>) {
  requireRequester(auth)
  await enforce(`qr-order:${auth.userId}`, MINUTE, 10, 'Too many requests in a short period')
  assertEdge('pending', 'cancelled', 'requester')

  // Race-safe by construction: only the requester's own, still-pending request
  // matches. An approver's claim flips the status first and this finds nothing.
  const { data, error } = await admin
    .from('qr_order_requests')
    .update({ status: 'cancelled', decided_at: new Date().toISOString() })
    .eq('id', input.requestId)
    .eq('status', 'pending')
    .eq('requested_by', auth.userId)
    .select('id, horeca_id')
  if (error) {
    console.error('[qr-order-request] cancel failed:', error.message)
    throw new EdgeFunctionError('INTERNAL', 'Could not cancel the order. Please try again.')
  }

  const updated = (data ?? []) as Array<{ id: string; horeca_id: number }>
  if (updated.length === 0) {
    const now = await currentStatus(admin, input.requestId)
    // Someone else's request is "not found" to you, whatever its status.
    if (now.status === null || now.requestedBy !== auth.userId) {
      throw new EdgeFunctionError('NOT_FOUND', 'No such order request')
    }
    throw conflict(now.status, 'cancel')
  }

  await logAuditEvent(admin, {
    actorId: auth.userId,
    actorRole: auth.role,
    action: 'update',
    resource: 'qr_order_request',
    resourceId: input.requestId,
    before: { status: 'pending' },
    after: { status: 'cancelled' },
    metadata: { horecaId: updated[0].horeca_id },
  })

  // The "waiting for your approval" bell entries have nothing left to ask.
  await retirePendingNotifications(admin, [input.requestId])

  return { status: 200, body: { ok: true, requestId: input.requestId, status: 'cancelled' } }
}

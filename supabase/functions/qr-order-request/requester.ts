// The kitchen's two actions: file a request, and withdraw it while it is pending.

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { type AuthContext } from '../_shared/auth.ts'
import { EdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { notifyHorecaApprovers } from '../_shared/qrNotify.ts'
import { findInvalidRequestLines, withSnapshot } from '../_shared/qrRequestItems.ts'
import type { Input, SubmitInput } from './schema.ts'
import {
  HOUR,
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

export async function submit(admin: SupabaseClient, auth: AuthContext, input: SubmitInput) {
  const staff = requireRequester(auth)
  await enforce(`qr-order:${auth.userId}`, MINUTE, 10, 'Too many orders in a short period')
  await enforce(`qr-order:hc:${staff.horecaId}`, HOUR, 30, 'This venue has placed too many orders this hour')

  const lines = toLines(input.items)
  const invalid = findInvalidRequestLines(lines)
  if (invalid) throw new EdgeFunctionError('INVALID_INPUT', invalid)

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

  return { status: 200, body: { ok: true, requestId: input.requestId, status: 'cancelled' } }
}

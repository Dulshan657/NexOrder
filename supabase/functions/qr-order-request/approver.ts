// The approvers' three actions: preview, approve (place the real order) and reject.
// See the header of `index.ts` for the claim protocol `approve` follows.

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { type AuthContext } from '../_shared/auth.ts'
import { EdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { placeOrderCore, type PlaceOrderCoreInput, type PlaceOrderResult } from '../_shared/placeOrderCore.ts'
import { linesDiffer, toOrderLines } from '../_shared/qrRequestItems.ts'
import { approvalFailureMessage, claimableFilter, storedFailureMessage } from '../_shared/qrRequestTransitions.ts'
import type { Input } from './schema.ts'
import {
  MINUTE,
  PRICING_ROLE,
  assertEdge,
  cleanNotes,
  conflict,
  currentStatus,
  dryRun,
  enforce,
  horecaNameOf,
  loadRequest,
  notifyRequester,
  requireApproverRole,
  requireCanApprove,
  resolveLines,
} from './shared.ts'

export async function preview(admin: SupabaseClient, auth: AuthContext, input: Extract<Input, { action: 'preview' }>) {
  requireApproverRole(auth)
  await enforce(`qr-order:decide:${auth.userId}`, MINUTE, 30, 'Too many requests in a short period')

  const row = await loadRequest(admin, input.requestId)
  await requireCanApprove(admin, auth, row.horeca_id)

  // A decided request has nothing left to preview: hand back the row so the
  // reviewer sees how it ended rather than pricing a cart that no longer matters.
  if (row.status !== 'pending' && row.status !== 'approving') {
    return { status: 200, body: { ok: true, request: row, preview: null } }
  }

  const result = await dryRun(admin, row, auth.userId, resolveLines(row, input.items))
  return { status: 200, body: { ok: true, request: row, preview: result } }
}

/** Put a claimed request back in the queue after a failed placement. */
async function revertClaim(admin: SupabaseClient, id: string, claimedAt: string, lastError: string): Promise<void> {
  assertEdge('approving', 'pending', 'approver')
  const { error } = await admin
    .from('qr_order_requests')
    .update({ status: 'pending', claimed_at: null, decided_by: null, last_error: lastError })
    .eq('id', id)
    .eq('status', 'approving')
    // Only OUR claim: if it went stale and another approver took it over, this
    // must not clobber theirs.
    .eq('claimed_at', claimedAt)
  if (error) {
    // The request stays `approving` and frees itself after QR_CLAIM_STALE_MS.
    console.error(`[qr-order-request] could not revert claim on ${id}:`, error.message)
  }
}

const FINALIZE_ATTEMPTS = 3
const FINALIZE_BACKOFF_MS = [150, 400]

export async function approve(admin: SupabaseClient, auth: AuthContext, input: Extract<Input, { action: 'approve' }>) {
  requireApproverRole(auth)
  await enforce(`qr-order:decide:${auth.userId}`, MINUTE, 30, 'Too many requests in a short period')

  const row = await loadRequest(admin, input.requestId)
  await requireCanApprove(admin, auth, row.horeca_id)

  // The requester is the order's owner (`orders.submitted_by`). If their profile
  // is gone there is nobody to own it, and inventing an owner would misattribute
  // the order; the approver is told to decline and have the venue reorder.
  if (!row.requested_by) {
    throw new EdgeFunctionError(
      'CONFLICT',
      'The person who placed this order no longer exists, so it cannot be approved. Decline it and ask the venue to order again.',
    )
  }

  // Validate and decide what is being ordered BEFORE claiming anything.
  const storedLines = resolveLines(row, undefined)
  const lines = input.items ? resolveLines(row, input.items) : storedLines
  const edited = input.items ? linesDiffer(storedLines, lines) : false
  const notes = input.notes !== undefined ? cleanNotes(input.notes) : row.notes

  // ── claim ────────────────────────────────────────────────────────────────
  assertEdge('pending', 'approving', 'approver')
  const nowMs = Date.now()
  const { data: claimedRows, error: claimError } = await admin
    .from('qr_order_requests')
    .update({ status: 'approving', claimed_at: new Date(nowMs).toISOString(), decided_by: auth.userId })
    .eq('id', input.requestId)
    .or(claimableFilter(nowMs))
    .select('id, claimed_at')
  if (claimError) {
    console.error('[qr-order-request] claim failed:', claimError.message)
    throw new EdgeFunctionError('INTERNAL', 'Could not start approving this order. Please try again.')
  }
  const claim = ((claimedRows ?? []) as Array<{ id: string; claimed_at: string }>)[0]
  if (!claim) throw conflict((await currentStatus(admin, input.requestId)).status, 'approve')

  // ── place the real order ─────────────────────────────────────────────────
  let placed: PlaceOrderResult
  try {
    const coreInput: PlaceOrderCoreInput = {
      submittedBy: row.requested_by,
      actorId: auth.userId,
      actorRole: PRICING_ROLE,
      hoReCaId: row.horeca_id,
      items: toOrderLines(lines),
      notes,
      deliveryDate: row.delivery_date,
      // The core types this 'AM' | 'PM' (place-order's old vocabulary) but writes
      // the value to `orders.delivery_time_slot` verbatim, and that column holds
      // the long form. Pass through exactly what the request holds.
      deliveryTimeSlot: row.delivery_time_slot as PlaceOrderCoreInput['deliveryTimeSlot'],
      verification: row.verification,
    }
    placed = await placeOrderCore(admin, coreInput)
  } catch (err) {
    const code = err instanceof EdgeFunctionError ? err.code : null
    const raw = err instanceof Error ? err.message : JSON.stringify(err)
    console.error(`[qr-order-request] placement failed for ${row.id} (${code ?? 'unexpected'}):`, raw)
    const rawMessage = err instanceof Error ? err.message : null
    const userMessage = approvalFailureMessage(code, rawMessage)
    // The stored copy is readable by the kitchen too, so it is the redacted one.
    await revertClaim(admin, row.id, claim.claimed_at, storedFailureMessage(code, rawMessage))
    // Keep the code (the UI keys on INSUFFICIENT_STOCK / CREDIT_EXCEEDED ...) but
    // never the raw message of a failure that was not a business rule.
    if (err instanceof EdgeFunctionError) throw new EdgeFunctionError(err.code, userMessage, err.details, err.status)
    throw new EdgeFunctionError('INTERNAL', userMessage)
  }

  // The core has no delivery-address parameter; the order's snapshot column does.
  // Best effort -- the order is already placed and a missing snapshot falls back
  // to the venue's own address (mig 00021).
  if (row.delivery_address) {
    const { error } = await admin.from('orders').update({ delivery_address: row.delivery_address }).eq('id', placed.orderId)
    if (error) console.warn(`[qr-order-request] could not copy delivery address to ${placed.orderId}:`, error.message)
  }

  // ── finish ───────────────────────────────────────────────────────────────
  // The order EXISTS from here. If this write fails and the request stays
  // `approving`, its claim goes stale in two minutes and a second Approve would
  // place the order again -- so retry, and if it still fails tell the approver
  // the order was placed rather than letting them try again.
  assertEdge('approving', 'approved', 'approver')
  const decidedAt = new Date().toISOString()
  let finalized = false
  for (let attempt = 0; attempt < FINALIZE_ATTEMPTS && !finalized; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, FINALIZE_BACKOFF_MS[attempt - 1]))
    const { data, error } = await admin
      .from('qr_order_requests')
      .update({
        status: 'approved',
        approved_order_id: placed.orderId,
        decided_at: decidedAt,
        decided_by: auth.userId,
        edited_by_approver: edited,
        last_error: null,
      })
      .eq('id', row.id)
      .eq('status', 'approving')
      .select('id')
    if (error) {
      console.error(`[qr-order-request] finalize attempt ${attempt + 1} failed for ${row.id}:`, error.message)
      continue
    }
    if (((data ?? []) as unknown[]).length === 0) {
      // Nothing was `approving` any more (our claim was taken over). The order is
      // real and unlinked; say so loudly rather than pretend it did not happen.
      console.error(`[qr-order-request] ORPHAN ORDER ${placed.orderId}: request ${row.id} was no longer approving`)
    }
    finalized = true
  }
  if (!finalized) {
    console.error(`[qr-order-request] ORPHAN ORDER ${placed.orderId}: request ${row.id} could not be marked approved`)
    throw new EdgeFunctionError(
      'INTERNAL',
      `Order ${placed.orderId} was placed, but this request could not be marked approved. Do not approve it again; check Order History.`,
      { orderId: placed.orderId },
    )
  }

  await logAuditEvent(admin, {
    actorId: auth.userId,
    actorRole: auth.role,
    action: 'update',
    resource: 'qr_order_request',
    resourceId: row.id,
    before: { status: 'pending', ...(edited ? { items: storedLines } : {}) },
    after: { status: 'approved', orderId: placed.orderId, total: placed.total, edited, ...(edited ? { items: lines } : {}) },
    metadata: { horecaId: row.horeca_id, requestedBy: row.requested_by, orderId: placed.orderId },
  })

  const venue = await horecaNameOf(admin, row.horeca_id)
  await notifyRequester(
    admin,
    row,
    'qr_order_approved',
    `Your order for ${venue} was approved${edited ? ' with changes' : ''}`,
    { orderId: placed.orderId, horecaName: venue, edited },
  )

  return {
    status: 200,
    body: {
      ok: true,
      requestId: row.id,
      status: 'approved',
      orderId: placed.orderId,
      total: placed.total,
      cartDiscount: placed.cartDiscount,
      appliedPromotionIds: placed.appliedPromotionIds,
      bogoFreeItems: placed.bogoFreeItems,
      editedByApprover: edited,
    },
  }
}

export async function reject(admin: SupabaseClient, auth: AuthContext, input: Extract<Input, { action: 'reject' }>) {
  requireApproverRole(auth)
  await enforce(`qr-order:decide:${auth.userId}`, MINUTE, 30, 'Too many requests in a short period')

  const row = await loadRequest(admin, input.requestId)
  await requireCanApprove(admin, auth, row.horeca_id)

  assertEdge('pending', 'rejected', 'approver')
  const { data, error } = await admin
    .from('qr_order_requests')
    .update({
      status: 'rejected',
      decided_at: new Date().toISOString(),
      decided_by: auth.userId,
      decision_reason: input.reason,
    })
    .eq('id', input.requestId)
    .eq('status', 'pending')
    .select('id')
  if (error) {
    console.error('[qr-order-request] reject failed:', error.message)
    throw new EdgeFunctionError('INTERNAL', 'Could not decline the order. Please try again.')
  }
  if (((data ?? []) as unknown[]).length === 0) {
    throw conflict((await currentStatus(admin, input.requestId)).status, 'reject')
  }

  await logAuditEvent(admin, {
    actorId: auth.userId,
    actorRole: auth.role,
    action: 'update',
    resource: 'qr_order_request',
    resourceId: row.id,
    before: { status: 'pending' },
    after: { status: 'rejected' },
    reason: input.reason,
    metadata: { horecaId: row.horeca_id, requestedBy: row.requested_by },
  })

  const venue = await horecaNameOf(admin, row.horeca_id)
  await notifyRequester(
    admin,
    row,
    'qr_order_rejected',
    `Your order for ${venue} was not approved: ${input.reason}`,
    { horecaName: venue, reason: input.reason },
  )

  return { status: 200, body: { ok: true, requestId: row.id, status: 'rejected' } }
}

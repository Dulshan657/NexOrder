// What every action of `qr-order-request` leans on: the request row and its
// lookups, the role and rate-limit guards, and the small helpers around a decision.
// The actions themselves are `requester.ts` (QR Staff) and `approver.ts`.

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { type AuthContext, type QrStaffInfo } from '../_shared/auth.ts'
import { EdgeFunctionError } from '../_shared/errors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { canApproveHoreca } from '../_shared/qrAccess.ts'
import { placeOrderCore, type OrderPreview } from '../_shared/placeOrderCore.ts'
import {
  findInvalidRequestLines,
  parseStoredLines,
  toOrderLines,
  type QrRequestLine,
} from '../_shared/qrRequestItems.ts'
import {
  canTransition,
  conflictMessage,
  isQrRequestStatus,
  type QrRequestAction,
  type QrRequestActor,
  type QrRequestStatus,
} from '../_shared/qrRequestTransitions.ts'
import type { LineInput } from './schema.ts'

// ── policy ──────────────────────────────────────────────────────────────────

/** Who may preview, approve and reject (and then only for a venue they answer for). */
const APPROVER_ROLES: ReadonlySet<string> = new Set([
  'Admin',
  'Manager',
  'Field Sales Rep',
  'Office Sales Rep',
  'Restaurant/Hotel Customer',
])

/** See the header: the venue's own semantics, for the quote, the preview and the order alike. */
export const PRICING_ROLE = 'Restaurant/Hotel Customer'

export const MINUTE = 60_000
export const HOUR = 3_600_000

/** How many requests one kitchen staff member may have waiting at once. */
export const MAX_WAITING_PER_STAFF = 3

// ── the request row ─────────────────────────────────────────────────────────

export interface RequestRow {
  id: string
  horeca_id: number
  requested_by: string | null
  qr_staff_id: string | null
  staff_name: string
  status: string
  items: unknown
  notes: string | null
  delivery_date: string | null
  delivery_time_slot: string | null
  delivery_address: Record<string, unknown> | null
  verification: Record<string, unknown> | null
  quoted_total: number | string
  created_at: string
  claimed_at: string | null
  decided_at: string | null
  decided_by: string | null
  decision_reason: string | null
  last_error: string | null
  edited_by_approver: boolean
  approved_order_id: string | null
}

export async function loadRequest(admin: SupabaseClient, id: string): Promise<RequestRow> {
  const { data, error } = await admin.from('qr_order_requests').select('*').eq('id', id).maybeSingle()
  if (error) {
    console.error('[qr-order-request] could not read the request:', error.message)
    throw new EdgeFunctionError('INTERNAL', 'Could not read the order request')
  }
  if (!data) throw new EdgeFunctionError('NOT_FOUND', 'No such order request')
  return data as RequestRow
}

export async function currentStatus(admin: SupabaseClient, id: string): Promise<{ status: string | null; requestedBy: string | null }> {
  const { data } = await admin.from('qr_order_requests').select('status, requested_by').eq('id', id).maybeSingle()
  const row = data as { status: string; requested_by: string | null } | null
  return { status: row?.status ?? null, requestedBy: row?.requested_by ?? null }
}

/**
 * The state machine's verdict, as a guard. Every conditional UPDATE below encodes
 * its own `WHERE status = ...`; this ties that to the tested table, so changing one
 * without the other fails here instead of silently allowing a move the tests forbid.
 */
export function assertEdge(from: QrRequestStatus, to: QrRequestStatus, actor: QrRequestActor): void {
  if (!canTransition(from, to, actor)) {
    throw new EdgeFunctionError('INTERNAL', `Illegal order request transition ${from} -> ${to} for ${actor}`)
  }
}

export function conflict(status: string | null, action: QrRequestAction): EdgeFunctionError {
  return new EdgeFunctionError('QR_REQUEST_CONFLICT', conflictMessage(status, action), {
    status: isQrRequestStatus(status) ? status : null,
  })
}

// ── guards ──────────────────────────────────────────────────────────────────

export function requireRequester(auth: AuthContext): QrStaffInfo {
  if (auth.role !== 'QR Staff' || !auth.qrStaff) {
    throw new EdgeFunctionError('FORBIDDEN', 'Only staff can place and cancel QR orders')
  }
  return auth.qrStaff
}

export function requireApproverRole(auth: AuthContext): void {
  if (!APPROVER_ROLES.has(auth.role)) {
    throw new EdgeFunctionError('FORBIDDEN', 'Your role cannot decide QR orders')
  }
}

export async function requireCanApprove(admin: SupabaseClient, auth: AuthContext, horecaId: number): Promise<void> {
  requireApproverRole(auth)
  if (!(await canApproveHoreca(admin, auth, horecaId))) {
    throw new EdgeFunctionError('FORBIDDEN', 'You do not answer for this venue')
  }
}

export async function enforce(key: string, windowMs: number, max: number, what: string): Promise<void> {
  const rl = await checkRateLimit(key, { windowMs, max })
  if (!rl.ok) {
    throw new EdgeFunctionError('TOO_MANY_REQUESTS', `${what}; try again in ${Math.ceil(rl.resetMs / 1000)}s`)
  }
}

// ── small helpers ───────────────────────────────────────────────────────────

export const cleanNotes = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function toLines(items: ReadonlyArray<LineInput>): QrRequestLine[] {
  return items.map((i) => ({
    productId: i.productId,
    quantity: i.quantity,
    packSize: i.packSize ?? null,
    uomId: i.uomId ?? null,
  }))
}

/** The lines to price: the approver's edit if there is one (re-validated), else what was stored. */
export function resolveLines(row: RequestRow, edited: ReadonlyArray<LineInput> | undefined): QrRequestLine[] {
  if (edited) {
    const lines = toLines(edited)
    const invalid = findInvalidRequestLines(lines)
    if (invalid) throw new EdgeFunctionError('INVALID_INPUT', invalid)
    return lines
  }
  const stored = parseStoredLines(row.items)
  if (!stored) {
    console.error(`[qr-order-request] request ${row.id} holds unreadable items`)
    throw new EdgeFunctionError('INTERNAL', 'This order request is damaged and cannot be processed')
  }
  return stored
}

export async function horecaNameOf(admin: SupabaseClient, horecaId: number): Promise<string> {
  const { data } = await admin.from('horecas').select('name').eq('id', horecaId).maybeSingle()
  return (data as { name?: string } | null)?.name ?? 'your venue'
}

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** A courtesy to the requester on top of a decision already made: never fails it, always logs. */
export async function notifyRequester(
  admin: SupabaseClient,
  row: RequestRow,
  type: 'qr_order_approved' | 'qr_order_rejected',
  message: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!row.requested_by) return
  try {
    const { error } = await admin.from('notifications').insert({
      // Deterministic: a retried decision cannot ring the requester twice.
      id: `notif-${type}-${row.id}`,
      type,
      message,
      user_id: row.requested_by,
      target_roles: null,
      metadata: { requestId: row.id, horecaId: row.horeca_id, ...metadata },
    })
    if (error) console.warn(`[qr-order-request] could not notify requester (${type}):`, error.message)
  } catch (e) {
    console.warn(`[qr-order-request] notify threw (${type}):`, e instanceof Error ? e.message : e)
  }
}

/** Run the order rules without writing, on behalf of the venue. */
export function dryRun(admin: SupabaseClient, row: Pick<RequestRow, 'horeca_id' | 'requested_by'>, userId: string, lines: QrRequestLine[]): Promise<OrderPreview> {
  return placeOrderCore(
    admin,
    {
      submittedBy: row.requested_by ?? userId,
      actorId: userId,
      actorRole: PRICING_ROLE,
      hoReCaId: row.horeca_id,
      items: toOrderLines(lines),
    },
    { dryRun: true },
  )
}

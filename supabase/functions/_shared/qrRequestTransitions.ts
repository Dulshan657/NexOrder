// The lifecycle of a held QR order (`qr_order_requests`, mig 00129), as a pure
// state machine. No Deno global, no URL import, no I/O -- vitest drives it
// directly (`__tests__/qrRequestTransitions.test.ts`) and `qr-order-request`
// imports the very same file, so the rules the tests pin are the rules the
// function enforces.
//
//   pending ──approver──▶ approving ──approver──▶ approved   (terminal)
//      │                      │
//      │                      └──approver (placement failed)──▶ pending
//      ├──approver (reason)──▶ rejected                        (terminal)
//      └──requester──────────▶ cancelled                       (terminal)
//
// WHY `approving` EXISTS. Approval runs `placeOrderCore` for real: it inserts an
// order, reserves stock, writes an invoice and sends an email. None of that can
// share a transaction with the request row, so the row is CLAIMED first
// (`pending -> approving`, one conditional UPDATE) and a second approver, or the
// requester's Cancel, finds it no longer `pending` and is refused. Without the
// claim two approvers pressing Approve in the same second place the order twice.
//
// WHY A STALE CLAIM IS RE-CLAIMABLE. If the function dies between the claim and
// the finish (isolate killed, network cut), nothing ever moves the row on, and a
// request stuck in `approving` could not be approved, rejected or cancelled by
// anyone. After `QR_CLAIM_STALE_MS` the claim is treated as abandoned and a new
// approver may take it. The window is deliberately much longer than a placement
// takes (a few seconds), so a slow-but-alive first attempt is not stolen from.
// This is the one transition that is not an edge in the table below -- it is
// `approving -> approving` by a DIFFERENT claimant -- which is why it lives in
// `canClaim`, not in `canTransition`.
//
// WHY A REQUESTER CANNOT CANCEL DURING `approving`. At that point an order may
// already be inserted and stock reserved. Cancelling the request would not undo
// either, and would leave an order behind a request that says it never happened.

export const QR_REQUEST_STATUSES = [
  'pending',
  'approving',
  'approved',
  'rejected',
  'cancelled',
] as const

export type QrRequestStatus = (typeof QR_REQUEST_STATUSES)[number]

/** Who is acting. QR Staff are always `requester`; everyone who may approve is `approver`. */
export type QrRequestActor = 'requester' | 'approver'

/** How long an `approving` claim is honoured before another approver may take it over. */
export const QR_CLAIM_STALE_MS = 120_000

const TRANSITIONS: Readonly<Record<QrRequestStatus, Readonly<Record<QrRequestActor, readonly QrRequestStatus[]>>>> = {
  pending: { requester: ['cancelled'], approver: ['approving', 'rejected'] },
  // `approving -> pending` is the revert after a placement that failed (stock
  // changed, credit limit, ...): the request goes back to the queue with
  // `last_error` set so an approver can edit it or reject it.
  approving: { requester: [], approver: ['approved', 'pending'] },
  approved: { requester: [], approver: [] },
  rejected: { requester: [], approver: [] },
  cancelled: { requester: [], approver: [] },
}

export function isQrRequestStatus(value: unknown): value is QrRequestStatus {
  return typeof value === 'string' && (QR_REQUEST_STATUSES as readonly string[]).includes(value)
}

/** May `actor` move a request from `from` to `to`? Unknown statuses are refused. */
export function canTransition(from: string, to: string, actor: QrRequestActor): boolean {
  if (!isQrRequestStatus(from) || !isQrRequestStatus(to)) return false
  return TRANSITIONS[from][actor].includes(to)
}

/** A decided request never changes again. */
export function isTerminal(status: string): boolean {
  return status === 'approved' || status === 'rejected' || status === 'cancelled'
}

// ── claims ──────────────────────────────────────────────────────────────────

function toMs(value: string | number | Date | null | undefined): number | null {
  if (value == null) return null
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Has an `approving` claim been abandoned? A claim with no (or an unreadable)
 * timestamp counts as abandoned: it cannot be aged, and treating it as live would
 * strand the request forever.
 */
export function isClaimStale(claimedAt: string | number | Date | null | undefined, nowMs: number): boolean {
  const claimed = toMs(claimedAt)
  if (claimed === null) return true
  return nowMs - claimed > QR_CLAIM_STALE_MS
}

/** May an approver claim this request right now? `pending`, or an abandoned `approving`. */
export function canClaim(
  status: string,
  claimedAt: string | number | Date | null | undefined,
  nowMs: number,
): boolean {
  if (status === 'pending') return true
  if (status === 'approving') return isClaimStale(claimedAt, nowMs)
  return false
}

/** The instant before which an `approving` claim is abandoned, as an ISO string. */
export function staleClaimCutoff(nowMs: number): string {
  return new Date(nowMs - QR_CLAIM_STALE_MS).toISOString()
}

/**
 * The PostgREST `.or()` filter that selects exactly the rows `canClaim` accepts.
 * supabase-js cannot express "pending, or approving with an old claim" any other
 * way, and the claim has to be ONE conditional UPDATE -- a read followed by a
 * write would let two approvers both see `pending`. Kept beside `canClaim` so the
 * two cannot drift: the test file pins them against each other.
 */
export function claimableFilter(nowMs: number): string {
  const cutoff = staleClaimCutoff(nowMs)
  return [
    'status.eq.pending',
    `and(status.eq.approving,claimed_at.lt.${cutoff})`,
    'and(status.eq.approving,claimed_at.is.null)',
  ].join(',')
}

// ── wording ─────────────────────────────────────────────────────────────────

export type QrRequestAction = 'cancel' | 'approve' | 'reject'

/**
 * What to tell the user when their conditional UPDATE matched nothing, i.e.
 * somebody else got there first. `status` is the row's CURRENT status, re-read
 * after the failed UPDATE; null means the row is gone.
 */
export function conflictMessage(status: string | null, action: QrRequestAction): string {
  switch (status) {
    case 'approved':
      return action === 'cancel'
        ? 'This order was already approved, so it can no longer be cancelled.'
        : 'This order has already been approved.'
    case 'rejected':
      return 'This order was already declined.'
    case 'cancelled':
      return action === 'cancel' ? 'This order was already cancelled.' : 'This order was cancelled by the person who placed it.'
    case 'approving':
      return action === 'cancel'
        ? 'This order is being approved right now, so it can no longer be cancelled.'
        : 'Someone else is approving this order right now. Reload to see the result.'
    case 'pending':
      // The UPDATE missed although the row is pending: a different guard
      // (owner, claim timestamp) failed, or the status moved and moved back.
      return 'This order changed while you were working on it. Reload and try again.'
    default:
      return 'This order no longer exists.'
  }
}

/** Placement failures whose message is already written for a person to read. */
const USER_FACING_CODES: ReadonlySet<string> = new Set([
  'INSUFFICIENT_STOCK',
  'BELOW_MINIMUM',
  'CREDIT_EXCEEDED',
  'PRODUCT_NOT_FOUND',
  'HORECA_NOT_FOUND',
  'INVALID_INPUT',
])

export const GENERIC_APPROVAL_FAILURE = 'Could not place the order. Please try again.'

/**
 * What the APPROVER is told when a placement fails and the request goes back to
 * `pending`.
 *
 * Business-rule failures (stock, minimum, credit) carry sentences meant for a
 * person and pass through. Anything else (`DB_ORDER_INSERT_FAILED`,
 * `STOCK_RACE`, a thrown Error) carries a database or driver message, which is
 * not for a browser and is replaced; the full text goes to the function's log.
 */
export function approvalFailureMessage(code: string | null | undefined, message: string | null | undefined): string {
  if (code && USER_FACING_CODES.has(code) && message && message.trim()) return message.trim()
  return GENERIC_APPROVAL_FAILURE
}

export const CREDIT_FAILURE_REDACTED = 'This order would take the venue over its credit limit.'

/**
 * What is STORED in `qr_order_requests.last_error`, which is a different
 * audience from the response above. The row is readable, over RLS, by everyone
 * who answers for the venue AND by the kitchen staff behind the QR -- and the
 * credit-limit sentence quotes the venue's limit and its unpaid balance, which
 * is invoice data kitchen staff are not meant to see. The approver already has
 * the figures (in the error response and in the preview); the stored copy says
 * only that the limit was the problem.
 */
export function storedFailureMessage(code: string | null | undefined, message: string | null | undefined): string {
  if (code === 'CREDIT_EXCEEDED') return CREDIT_FAILURE_REDACTED
  return approvalFailureMessage(code, message)
}

// Client for the HoReCa QR reorder flow (migs 00129/00130).
//
// Three Edge Functions and one PDF function, plus two direct table reads:
//
//   qr-unlock           PUBLIC (verify_jwt = false) -- called BEFORE any login.
//                       resolve a sticker's token, unlock with a PIN.
//   mutate-qr-access    managers: the code, the staff PINs. Admin, Manager, the
//                       venue's assigned reps, the venue's own Customer logins.
//   qr-order-request    submit/cancel: QR Staff. preview/approve/reject: the
//                       same people who manage access.
//   generate-qr-poster  the printable PDF. Same people as mutate-qr-access.
//   qr_staff / qr_order_requests (PostgREST, RLS)   the lists.
//
// ── ERRORS ──────────────────────────────────────────────────────────────────
// Every function here throws a `QrApiError` (lib/qr/qrApiError.ts) and nothing
// else: `code` to branch on, `message` safe to show, plus `lockedUntil`,
// `permanent`, `requestStatus`, `orderId` where the server sends them. The two
// PostgREST reads throw PostgREST's own error, as every other read in the app does.
//
// ── TIMEOUTS ────────────────────────────────────────────────────────────────
// lib/supabase.ts caps every request at 20s, but functions-js attaches its own
// AbortSignal when `timeout` is passed, which bypasses that ceiling and enforces
// this one instead (same reasoning as labelService / extractFloorplan). Approving
// places a real order -- pricing, reservation, invoice, email -- so it gets longer.
//
// ── THE ANON KEY ────────────────────────────────────────────────────────────
// `resolveQr` and `unlockQr` run with no session. supabase-js's fetch wrapper
// sends `Authorization: Bearer <anon key>` whenever there is no session, which is
// all `verify_jwt = false` needs; the functions then gate themselves (rate limit,
// per-code backoff, the PIN).

import { supabase } from '@/lib/supabase'
import {
  qrOrderRequestFromRow,
  qrStaffFromRow,
  type QrOrderRequestRow,
  type QrStaffRow,
} from '@/lib/adapters'
import { QrApiError, toQrApiError } from '@/lib/qr/qrApiError'
import type {
  DeliveryTimeSlot,
  OrderDeliveryAddress,
  QrOrderRequest,
  QrOrderRequestStatus,
  QrStaff,
} from '@/types'

export { QrApiError, isQrApiError } from '@/lib/qr/qrApiError'
export type { QrErrorCode, KnownQrErrorCode, QrIssue } from '@/lib/qr/qrApiError'

const SHORT_TIMEOUT_MS = 20_000
const DEFAULT_TIMEOUT_MS = 30_000
const ORDER_TIMEOUT_MS = 60_000
const POSTER_TIMEOUT_MS = 60_000

/**
 * Invoke an Edge Function and return its JSON body, or throw a QrApiError.
 * `data` is typed by the caller; the functions are ours and their bodies are
 * pinned by the interfaces below.
 */
async function call<T>(fn: string, body: unknown, timeout = DEFAULT_TIMEOUT_MS): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(fn, { body, timeout })
  if (error) throw await toQrApiError(error)
  if (data === null || data === undefined) {
    throw new QrApiError({ code: 'INTERNAL', message: 'The server returned no data. Please try again.' })
  }
  return data
}

// ═══════════════════════════════════════════════════════════════════════════
// qr-unlock -- before login
// ═══════════════════════════════════════════════════════════════════════════

/** What a sticker's token names: the venue, and the operator's public identity (what the poster prints). */
export interface QrVenueInfo {
  /** Lets the entry screen compare against a signed-in session (lib/qr/qrEntryDecision.ts). */
  horecaId: number
  horecaName: string
  /** The operator's logo, or null when none is set. */
  logoUrl: string | null
  /** The operator's company name; '' when Settings has none (never a made-up default). */
  companyName: string
  /** The operator's phone; '' when unset. */
  phone: string
}

/**
 * Look up the venue behind a scanned token. Throws QR_UNKNOWN_CODE for a token
 * that was never issued OR was regenerated (indistinguishable on purpose), and
 * TOO_MANY_REQUESTS past 60 per minute per IP.
 */
export async function resolveQr(token: string): Promise<QrVenueInfo> {
  return call<QrVenueInfo>('qr-unlock', { action: 'resolve', token }, SHORT_TIMEOUT_MS)
}

/** A correct PIN. `tokenHash` is single-use: exchange it for a session straight away. */
export interface QrUnlockResult {
  tokenHash: string
  /** ISO. The database enforces it; the UI counts down to it. */
  expiresAt: string
  staffName: string
  horecaId: number
}

/**
 * Check a PIN against a venue's token. Does NOT sign anyone in -- prefer
 * `signInWithQrPin`. Errors: QR_BAD_PIN ("Incorrect PIN", never an attempt count;
 * `err.locked` says whether this attempt tripped a lock), QR_LOCKED
 * (`lockedUntil` / `permanent`), QR_UNKNOWN_CODE, INVALID_INPUT for something
 * that is not 4-6 digits (nothing is counted against the code), TOO_MANY_REQUESTS.
 */
export async function unlockQr(token: string, pin: string): Promise<QrUnlockResult> {
  return call<QrUnlockResult>('qr-unlock', { action: 'unlock', token, pin }, SHORT_TIMEOUT_MS)
}

/**
 * The whole PIN-pad submit: verify the PIN, then exchange the hashed token for a
 * real session, the same mechanism ResetPasswordView uses for recovery links
 * (`verifyOtp`, no email sent, no PKCE verifier needed). Resolves once the
 * session exists; AuthProvider then picks it up from onAuthStateChange.
 *
 * Call `signOutQrLocally()` first if another QR session is still on the phone
 * (`decideQrEntry` -> 'pin_after_signout').
 */
export async function signInWithQrPin(token: string, pin: string): Promise<QrUnlockResult> {
  const result = await unlockQr(token, pin)
  const { error } = await supabase.auth.verifyOtp({ token_hash: result.tokenHash, type: 'magiclink' })
  if (error) {
    throw new QrApiError({
      code: 'INTERNAL',
      message: 'Could not start your session. Try again.',
      details: error.message,
    })
  }
  return result
}

/**
 * Drop the local session without waiting on the server. For an expired or
 * other-venue kitchen session: the server side is already gone or inert, so
 * only this browser's copy needs clearing. Never throws.
 */
export async function signOutQrLocally(): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // Nothing useful to do; the next verifyOtp replaces the stored session anyway.
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// mutate-qr-access -- the code and the staff PINs
// ═══════════════════════════════════════════════════════════════════════════
// `horecaId` is required on every call here although the server lets a Customer
// omit it: every caller already knows the venue (a Customer's is
// `profile.horeca_id`), and the returned `QrStaff` rows carry it.

export interface QrAccessState {
  horecaId: number
  horecaName: string
  /** The raw entry token. Treat like a URL-shaped secret: never log it. */
  token: string
  /** The full printed URL: `${APP_URL}/?qr=${token}`. */
  url: string
  /** Active (not revoked) staff, oldest first. */
  staff: QrStaff[]
  /** The code is refusing PINs right now. */
  locked: boolean
  /** ISO end of the lock; null when not locked or `permanent`. */
  lockedUntil: string | null
  /** Locked until `unlockQrCode` (20 wrong PINs). */
  permanent: boolean
  failedAttempts: number
}

interface AccessGetWire {
  horecaId: number
  horecaName: string
  token: string
  url: string
  staff: Array<{
    id: string
    name: string
    unlockedUntil: string | null
    lastUnlockedAt: string | null
    createdAt: string
  }>
  locked: boolean
  lockedUntil: string | null
  permanent: boolean
  failedAttempts: number
}

/**
 * The venue's code state. NOTE: creates the code the first time anyone asks
 * (lazily, so printing "just works") -- mount it only where the QR & PINs panel
 * is actually open, never as an always-on background query.
 */
export async function getQrAccess(horecaId: number): Promise<QrAccessState> {
  const r = await call<AccessGetWire>('mutate-qr-access', { action: 'get', horecaId })
  return {
    horecaId: r.horecaId,
    horecaName: r.horecaName,
    token: r.token,
    url: r.url,
    staff: r.staff.map((s) => ({ ...s, horecaId: r.horecaId, revokedAt: null })),
    locked: r.locked,
    lockedUntil: r.lockedUntil,
    permanent: r.permanent,
    failedAttempts: r.failedAttempts,
  }
}

export interface QrRegenerateResult {
  horecaId: number
  /** The NEW token. The old sticker is dead; PINs survive; every unlock ended. */
  token: string
  url: string
  sessionsEnded: number
  /** Sessions that could not be deleted. Harmless (their unlock is already cleared); reported so it is not silent. */
  sessionsFailed: number
}

/** Replace the venue's token. Rate-limited (10/min): TOO_MANY_REQUESTS. */
export async function regenerateQrCode(horecaId: number): Promise<QrRegenerateResult> {
  return call<QrRegenerateResult>('mutate-qr-access', { action: 'regenerate_code', horecaId })
}

/**
 * Add a staff member with a manager-chosen PIN. Validate it first with
 * `validatePin` from `@/supabase/functions/_shared/qrPin` -- the server applies
 * the same rule. Errors: QR_WEAK_PIN, QR_PIN_TAKEN (another active person here
 * has it), INVALID_INPUT (not 4-6 digits / empty name), TOO_MANY_REQUESTS.
 */
export async function createQrStaff(input: { horecaId: number; name: string; pin: string }): Promise<QrStaff> {
  const r = await call<{
    staff: { id: string; name: string; unlockedUntil: string | null; lastUnlockedAt: string | null; createdAt: string }
  }>('mutate-qr-access', { action: 'create_staff', horecaId: input.horecaId, name: input.name, pin: input.pin })
  return { ...r.staff, horecaId: input.horecaId, revokedAt: null }
}

export async function renameQrStaff(staffId: string, name: string): Promise<{ id: string; name: string }> {
  const r = await call<{ staff: { id: string; name: string } }>('mutate-qr-access', {
    action: 'rename_staff',
    staffId,
    name,
  })
  return r.staff
}

/**
 * Give someone a new PIN. Also ends their current unlock and sessions. Same
 * errors as `createQrStaff` for the PIN.
 */
export async function resetQrPin(staffId: string, pin: string): Promise<{ sessionsEnded: boolean }> {
  const r = await call<{ sessionsEnded: boolean }>('mutate-qr-access', { action: 'reset_pin', staffId, pin })
  return { sessionsEnded: r.sessionsEnded }
}

/**
 * Remove a staff member (soft: the row stays so their past orders keep a name).
 * If it throws INTERNAL "Access was removed, but ending their login did not
 * finish. Remove them again to retry.", the access IS removed -- refetch the
 * list; calling it again is safe (idempotent).
 */
export async function revokeQrStaff(staffId: string): Promise<void> {
  await call<{ ok: true }>('mutate-qr-access', { action: 'revoke_staff', staffId })
}

/** Clear a wrong-PIN lock-out (the 20-attempt permanent lock included). */
export async function unlockQrCode(horecaId: number): Promise<void> {
  await call<{ ok: true }>('mutate-qr-access', { action: 'unlock_code', horecaId })
}

// ═══════════════════════════════════════════════════════════════════════════
// generate-qr-poster
// ═══════════════════════════════════════════════════════════════════════════

export type QrPosterFormat = 'a4' | 'sticker'

/**
 * The printable PDF for a venue. Nothing is stored server-side (the PDF contains
 * the entry token), so each call renders afresh; revoke the object URL you make
 * from the Blob when done. Needs the code to exist: NOT_FOUND "Open QR & PINs
 * first to create the code" means call `getQrAccess` once first. The suggested
 * file name is `posterFileName` in `@/supabase/functions/_shared/qrPoster/layout`.
 */
export async function fetchQrPoster(horecaId: number, format: QrPosterFormat): Promise<Blob> {
  const { data, error } = await supabase.functions.invoke<Blob>('generate-qr-poster', {
    body: { horecaId, format },
    timeout: POSTER_TIMEOUT_MS,
  })
  if (error) throw await toQrApiError(error)
  // functions-js hands back a Blob for application/pdf; anything else means the
  // function did not produce a poster.
  if (!(data instanceof Blob)) {
    throw new QrApiError({ code: 'INTERNAL', message: 'Could not generate the poster. Please try again.' })
  }
  return data
}

// ═══════════════════════════════════════════════════════════════════════════
// qr-order-request
// ═══════════════════════════════════════════════════════════════════════════

/** One line of a held order, as the server takes it. The name snapshot is added server-side. */
export interface QrLineInput {
  productId: number
  quantity: number
  packSize?: number | null
  uomId?: number | null
}

export interface QrSubmitInput {
  items: QrLineInput[]
  notes?: string | null
  /** YYYY-MM-DD. */
  deliveryDate?: string | null
  deliveryTimeSlot?: DeliveryTimeSlot | null
  deliveryAddress?: OrderDeliveryAddress | null
}

export interface QrSubmitResult {
  requestId: string
  /** An ESTIMATE under the venue's own pricing; the real total is computed on approval. */
  quotedTotal: number
  status: 'pending'
  createdAt: string
}

/**
 * QR Staff files a request for approval. Reserves no stock and creates no order.
 * Throws PRODUCT_NOT_FOUND for a product that no longer exists (the one problem
 * the kitchen is told about -- stock, minimum and credit are the approver's),
 * INVALID_INPUT with `err.issues` for a bad payload, FORBIDDEN for any role other
 * than QR Staff, QR_SESSION_EXPIRED when the unlock has lapsed.
 */
export async function submitQrRequest(input: QrSubmitInput): Promise<QrSubmitResult> {
  const address = input.deliveryAddress
  return call<QrSubmitResult>(
    'qr-order-request',
    {
      action: 'submit',
      items: input.items,
      notes: input.notes ?? null,
      deliveryDate: input.deliveryDate ?? null,
      deliveryTimeSlot: input.deliveryTimeSlot ?? null,
      // The wire is snake_case for recipient_name only; the rest match.
      deliveryAddress: address
        ? {
            street: address.street,
            city: address.city ?? null,
            postcode: address.postcode ?? null,
            country: address.country ?? null,
            recipient_name: address.recipientName ?? null,
          }
        : null,
    },
    ORDER_TIMEOUT_MS,
  )
}

/**
 * QR Staff withdraws their OWN request while it is still pending. Throws
 * QR_REQUEST_CONFLICT (with `err.requestStatus`) when an approver got there first,
 * NOT_FOUND for anyone else's request.
 */
export async function cancelQrRequest(requestId: string): Promise<void> {
  await call<{ ok: true }>('qr-order-request', { action: 'cancel', requestId }, SHORT_TIMEOUT_MS)
}

// -- preview / approve / reject (approvers) -----------------------------------

export type QrProblemCode =
  | 'HORECA_NOT_FOUND'
  | 'PRODUCT_NOT_FOUND'
  | 'INSUFFICIENT_STOCK'
  | 'BELOW_MINIMUM'
  | 'CREDIT_EXCEEDED'

/** One broken rule a preview found. Numbers are present only for the codes that use them. */
export interface QrOrderProblem {
  code: QrProblemCode
  message: string
  productId?: number
  requested?: number
  available?: number
  total?: number
  minimum?: number
  limit?: number
  outstanding?: number
}

export interface QrPricedLine {
  productId: number
  quantity: number
  packSize: number | null
  uomId?: number | null
  productName: string
  productSku: string
  unitPrice: number
  appliedPromotionId: string | null
  /** unitPrice x quantity, to the cent. */
  lineTotal: number
  /** quantity x pack factor: the unit stock is counted in. */
  baseUnits: number
}

export interface QrStockLine {
  productId: number
  productName: string
  requested: number
  available: number
  short: boolean
}

/** What approving would do, with EVERY problem at once (not just the first). `ok` === no problems. */
export interface QrOrderPreview {
  ok: boolean
  problems: QrOrderProblem[]
  lines: QrPricedLine[]
  stock: QrStockLine[]
  subtotal: number
  cartDiscount: number
  total: number
  appliedPromotionIds: string[]
  bogoFreeItems: Array<{ productId: number; freeQuantity: number; promoId: string }>
  /** 0 = no limit. */
  creditLimit: number
  outstanding: number
  /** 0 = no minimum. */
  minimumOrderValue: number
  hoReCa: { id: number; name: string } | null
}

export interface QrPreviewResult {
  request: QrOrderRequest
  /** Null when the request is already decided: there is nothing left to price. */
  preview: QrOrderPreview | null
}

/**
 * Price the request as it stands, or with an approver's edited `items`, without
 * writing anything. Re-call it after each edit. Rate-limited with approve/reject
 * (30/min).
 */
export async function previewQrRequest(requestId: string, items?: QrLineInput[]): Promise<QrPreviewResult> {
  const r = await call<{ request: QrOrderRequestRow; preview: QrOrderPreview | null }>(
    'qr-order-request',
    { action: 'preview', requestId, ...(items ? { items } : {}) },
    DEFAULT_TIMEOUT_MS,
  )
  return { request: qrOrderRequestFromRow(r.request), preview: r.preview }
}

export interface QrApproveInput {
  requestId: string
  /** Send only if the approver EDITED the lines; omitted means "as requested". */
  items?: QrLineInput[]
  /** Omitted keeps the requester's notes; a string (even '') replaces them. */
  notes?: string | null
}

export interface QrApproveResult {
  requestId: string
  status: 'approved'
  /** The real order now in Order History. */
  orderId: string
  total: number
  cartDiscount: number
  appliedPromotionIds: string[]
  bogoFreeItems: Array<{ productId: number; freeQuantity: number; promoId: string }>
  editedByApprover: boolean
}

/**
 * Claim the request, place the REAL order (pricing, promotions, stock
 * reservation, invoice, email), link it. On a business-rule failure the request
 * goes back to `pending` with `lastError` set and this throws the rule's code:
 * INSUFFICIENT_STOCK, BELOW_MINIMUM, CREDIT_EXCEEDED, PRODUCT_NOT_FOUND ...
 * Other errors: QR_REQUEST_CONFLICT (decided/cancelled first; `err.requestStatus`),
 * and INTERNAL with `err.orderId` set when the order WAS placed but the request
 * could not be marked approved -- do not offer Approve again.
 */
export async function approveQrRequest(input: QrApproveInput): Promise<QrApproveResult> {
  return call<QrApproveResult>(
    'qr-order-request',
    {
      action: 'approve',
      requestId: input.requestId,
      ...(input.items ? { items: input.items } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    ORDER_TIMEOUT_MS,
  )
}

/** Decline with a reason of 3-500 characters; the requester is told it. QR_REQUEST_CONFLICT if already decided. */
export async function rejectQrRequest(requestId: string, reason: string): Promise<void> {
  await call<{ ok: true }>('qr-order-request', { action: 'reject', requestId, reason }, DEFAULT_TIMEOUT_MS)
}

// ═══════════════════════════════════════════════════════════════════════════
// Reads (PostgREST + RLS)
// ═══════════════════════════════════════════════════════════════════════════

// qr_staff has a COLUMN-level grant (never pin_hmac or auth_user_id), so
// `select=*` is refused and every read must name its columns.
const QR_STAFF_COLUMNS = 'id, horeca_id, name, unlocked_until, last_unlocked_at, created_at, revoked_at'

// Not `*`: `verification` and `claimed_at` are server business the UI never uses.
const QR_REQUEST_COLUMNS =
  'id, horeca_id, requested_by, qr_staff_id, staff_name, status, items, notes, delivery_date, ' +
  'delivery_time_slot, delivery_address, quoted_total, created_at, decided_at, decided_by, ' +
  'decision_reason, last_error, edited_by_approver, approved_order_id'

const DEFAULT_REQUEST_LIMIT = 200

export interface QrRequestFilter {
  /** Omit for every venue the caller may see (RLS narrows it: Admin/Manager all, reps their assigned, a venue its own). */
  horecaId?: number
  /** One status or several. Omit for all. */
  status?: QrOrderRequestStatus | QrOrderRequestStatus[]
  /** Newest first, capped (default 200). */
  limit?: number
}

/** Held QR orders, newest first. RLS decides which rows the caller sees; for a lapsed QR Staff session that is none. */
export async function listQrRequests(filter: QrRequestFilter = {}): Promise<QrOrderRequest[]> {
  let query = supabase
    .from('qr_order_requests')
    .select(QR_REQUEST_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(filter.limit ?? DEFAULT_REQUEST_LIMIT)

  if (filter.horecaId !== undefined) query = query.eq('horeca_id', filter.horecaId)
  if (Array.isArray(filter.status)) query = query.in('status', filter.status)
  else if (filter.status !== undefined) query = query.eq('status', filter.status)

  const { data, error } = await query
  if (error) throw error
  return ((data ?? []) as unknown as QrOrderRequestRow[]).map(qrOrderRequestFromRow)
}

/** Active (not revoked) staff of a venue, oldest first. Names and unlock times only -- never a PIN. */
export async function listQrStaff(horecaId: number): Promise<QrStaff[]> {
  const { data, error } = await supabase
    .from('qr_staff')
    .select(QR_STAFF_COLUMNS)
    .eq('horeca_id', horecaId)
    .is('revoked_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as unknown as QrStaffRow[]).map(qrStaffFromRow)
}

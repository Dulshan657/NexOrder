// The one error type every QR call throws (services/supabase/qrService.ts).
//
// `supabase.functions.invoke` collapses every non-2xx into a FunctionsHttpError
// whose `.message` is the useless "Edge Function returned a non-2xx status code";
// the real `{ error: { code, message, details } }` body sits unread on `.context`
// (see lib/functionError.ts). The QR screens need MORE than the message -- they
// branch on the code (a wrong PIN, a locked code, a request somebody else decided
// first) and on structured `details` (when a lock ends) -- so this reads the whole
// envelope once and exposes it as typed fields, and `message` is always safe to
// show to a user.
//
// Pure: no Supabase client import, so components and hooks can `instanceof` it
// and tests can build one without any mocking.

import { extractFunctionErrorEnvelope } from '@/lib/functionError'
import type { QrOrderRequestStatus } from '@/types'

/**
 * Every `code` the qr-* functions (and the place-order core behind `approve`) can
 * answer with, plus `NETWORK` for a call that never got a response. Mirrors
 * `ErrorCode` in supabase/functions/_shared/errors.ts, which a browser build
 * cannot import (it pulls in Deno-only modules).
 */
export type KnownQrErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL'
  // approve (placeOrderCore): the reasons an order could not be placed
  | 'HORECA_NOT_FOUND'
  | 'PRODUCT_NOT_FOUND'
  | 'INSUFFICIENT_STOCK'
  | 'STOCK_RACE'
  | 'BELOW_MINIMUM'
  | 'CREDIT_EXCEEDED'
  // QR specific
  | 'QR_SESSION_EXPIRED' // the 2h unlock lapsed or was revoked -> show the PIN pad
  | 'QR_UNKNOWN_CODE' // the token names no venue (never issued, or regenerated)
  | 'QR_LOCKED' // too many wrong PINs on this code; see lockedUntil / permanent
  | 'QR_BAD_PIN' // wrong PIN -- one fixed message, never an attempt count
  | 'QR_WEAK_PIN' // a PIN a manager may not choose
  | 'QR_PIN_TAKEN' // another active staff member here already has that PIN
  | 'QR_REQUEST_CONFLICT' // a held order was decided/cancelled by someone else first
  // client side
  | 'NETWORK' // no response at all: offline, aborted, timed out

/** `(string & {})` keeps autocomplete for the known codes while tolerating a new server code. */
export type QrErrorCode = KnownQrErrorCode | (string & {})

export interface QrApiErrorInit {
  code: QrErrorCode
  message: string
  /** HTTP status, or null when there was no response. */
  status?: number | null
  /** The envelope's `details`, untouched. */
  details?: unknown
}

export interface QrIssue {
  path: string
  message: string
}

const REQUEST_STATUSES: ReadonlySet<string> = new Set<QrOrderRequestStatus>([
  'pending',
  'approving',
  'approved',
  'rejected',
  'cancelled',
])

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

export class QrApiError extends Error {
  /** Machine-readable reason. Branch on this, never on `message`. */
  readonly code: QrErrorCode
  /** HTTP status, or null when no response arrived (`code === 'NETWORK'`). */
  readonly status: number | null
  /** The server's `details`, untouched, for anything not surfaced below. */
  readonly details: unknown
  /**
   * QR_LOCKED / QR_BAD_PIN: when the lock ends (ISO). Null when the code is not
   * locked, or the lock is `permanent` (no end until a manager unlocks it).
   */
  readonly lockedUntil: string | null
  /** QR_LOCKED / QR_BAD_PIN: locked until a manager unlocks it (20+ wrong PINs). */
  readonly permanent: boolean
  /**
   * The code is locked right now: always true for QR_LOCKED, and for QR_BAD_PIN
   * only when THIS wrong PIN is the one that tripped a lock.
   */
  readonly locked: boolean
  /**
   * QR_REQUEST_CONFLICT: where the request stands now ("someone approved it a
   * moment ago"). Null when the server did not say.
   */
  readonly requestStatus: QrOrderRequestStatus | null
  /**
   * `approve` only. Set on the INTERNAL "Order X was placed, but this request
   * could not be marked approved" failure: the order EXISTS, so the UI must not
   * offer Approve again and should refetch instead.
   */
  readonly orderId: string | null

  constructor(init: QrApiErrorInit) {
    super(init.message)
    this.name = 'QrApiError'
    this.code = init.code
    this.status = init.status ?? null
    this.details = init.details

    const d = asRecord(init.details)
    this.lockedUntil = typeof d?.lockedUntil === 'string' ? d.lockedUntil : null
    this.permanent = d?.permanent === true
    this.locked = init.code === 'QR_LOCKED' || (init.code === 'QR_BAD_PIN' && d?.locked === true)
    this.requestStatus =
      typeof d?.status === 'string' && REQUEST_STATUSES.has(d.status)
        ? (d.status as QrOrderRequestStatus)
        : null
    this.orderId = typeof d?.orderId === 'string' ? d.orderId : null
  }

  /**
   * The signed-in kitchen session is no longer usable: the 2h unlock ended
   * (`QR_SESSION_EXPIRED`) or the session itself is gone (`UNAUTHORIZED`, e.g.
   * the staff member was removed or unlocked on another phone). Either way the
   * right response is to sign out locally and show the PIN pad.
   */
  get sessionEnded(): boolean {
    return this.code === 'QR_SESSION_EXPIRED' || this.code === 'UNAUTHORIZED'
  }

  /** Field-level problems of an INVALID_INPUT, normalised from either server shape. */
  get issues(): QrIssue[] {
    const raw = this.details
    // qr-order-request: details is [{ path, message }, ...]
    const list = Array.isArray(raw) ? raw : (asRecord(raw)?.issues as unknown)
    if (!Array.isArray(list)) return []
    const out: QrIssue[] = []
    for (const i of list) {
      const r = asRecord(i)
      if (r && typeof r.message === 'string') {
        out.push({ path: typeof r.path === 'string' ? r.path : '', message: r.message })
      }
    }
    return out
  }
}

export function isQrApiError(e: unknown): e is QrApiError {
  return e instanceof QrApiError
}

export const NETWORK_MESSAGE = 'Could not reach the server. Check your connection and try again.'
export const GENERIC_MESSAGE = 'Something went wrong. Please try again.'

function codeFromStatus(status: number): QrErrorCode {
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 429) return 'TOO_MANY_REQUESTS'
  return 'INTERNAL'
}

/**
 * Turn whatever `supabase.functions.invoke` produced into a QrApiError.
 *
 *   FunctionsHttpError (our envelope)   -> its code, message and details
 *   FunctionsHttpError / RelayError     -> a code from the HTTP status, generic message
 *     (gateway page, no envelope)
 *   FunctionsFetchError / abort / other -> code 'NETWORK'
 *
 * Never throws; `fallbackMessage` is for a response that carried no message.
 */
export async function toQrApiError(error: unknown, fallbackMessage = GENERIC_MESSAGE): Promise<QrApiError> {
  if (error instanceof QrApiError) return error

  const envelope = await extractFunctionErrorEnvelope(error)
  if (envelope) {
    return new QrApiError({
      code: envelope.code ?? codeFromStatus(envelope.status),
      message: envelope.message ?? fallbackMessage,
      status: envelope.status,
      details: envelope.details,
    })
  }
  return new QrApiError({ code: 'NETWORK', message: NETWORK_MESSAGE, status: null })
}

/**
 * A TanStack Query `retry` predicate for QR calls: try again after a failure that
 * a second attempt could fix (a dropped connection, a 5xx, a timeout), never after
 * one the server answered deliberately with a 4xx -- FORBIDDEN, NOT_FOUND,
 * QR_SESSION_EXPIRED, TOO_MANY_REQUESTS. Repeating those cannot change the answer;
 * it only delays the message the person needs, and for a 429 it spends more of the
 * very budget that refused them.
 *
 * Anything that is not a `QrApiError` (a PostgREST error, say) keeps the app-wide
 * default of one retry (`lib/queryClient.ts`).
 */
export function retryUnlessClientError(failureCount: number, error: unknown, maxRetries = 1): boolean {
  if (error instanceof QrApiError && error.status !== null && error.status >= 400 && error.status < 500) {
    return false
  }
  return failureCount < maxRetries
}

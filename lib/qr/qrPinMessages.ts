// What the PIN pad tells a person when an unlock attempt fails.
//
// Pure: it turns a thrown error into one short sentence and a few facts the
// screen needs (is the pad locked, until when). Two rules shape the wording:
//
//   - A wrong PIN is always the same two words, "Incorrect PIN", and never an
//     attempt count. A count tells a stranger with a stolen sticker how many
//     guesses are left, and the server deliberately does not say (qr-unlock).
//   - A lock is described by WHEN it ends, in the person's own clock, because
//     "try again in 14 minutes" goes stale on a screen that stays open.

import { isQrApiError, type QrApiError } from '@/lib/qr/qrApiError'

export type PinFailureKind = 'bad_pin' | 'locked' | 'unknown_code' | 'network' | 'invalid' | 'throttled' | 'other'

export interface PinFailure {
  kind: PinFailureKind
  message: string
  /** The code is refusing PINs right now (a lock, permanent or timed). */
  locked: boolean
  /** ISO end of a timed lock. Null for a permanent lock or no lock. */
  lockedUntil: string | null
  /** Locked until a manager unlocks it. */
  permanent: boolean
}

export const BAD_PIN_MESSAGE = 'Incorrect PIN'
export const PERMANENT_LOCK_MESSAGE = 'This code is locked. Ask your manager to unlock it.'
export const UNKNOWN_CODE_MESSAGE = 'This code is no longer active. Ask your manager for the new one.'
export const THROTTLED_MESSAGE = 'Too many attempts. Wait a minute, then try again.'
export const INVALID_PIN_MESSAGE = 'Enter your 4 to 6 digit PIN.'
export const GENERIC_PIN_MESSAGE = 'Could not unlock. Please try again.'

/** "14:05" / "2:05 pm" in the viewer's own locale and clock. Empty string for an unreadable timestamp. */
export function formatClockTime(iso: string | Date | null | undefined, locale?: string): string {
  if (!iso) return ''
  const d = iso instanceof Date ? iso : new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

function lockMessage(err: QrApiError): string {
  if (err.permanent) return PERMANENT_LOCK_MESSAGE
  const at = formatClockTime(err.lockedUntil)
  return at ? `Too many attempts. Try again at ${at}.` : 'Too many attempts. Try again in a few minutes.'
}

/**
 * Is the lock still in force at `now`? A permanent lock always is; a timed one
 * until its end. A lock the server gave no end for cannot be timed, so the pad
 * is left usable and the server (which still refuses) stays the control.
 */
export function isStillLocked(failure: Pick<PinFailure, 'locked' | 'permanent' | 'lockedUntil'>, now: Date): boolean {
  if (!failure.locked) return false
  if (failure.permanent) return true
  if (!failure.lockedUntil) return false
  const end = Date.parse(failure.lockedUntil)
  return Number.isFinite(end) && end > now.getTime()
}

export function describePinFailure(error: unknown): PinFailure {
  if (!isQrApiError(error)) {
    return { kind: 'other', message: GENERIC_PIN_MESSAGE, locked: false, lockedUntil: null, permanent: false }
  }

  // A lock beats everything else, including a wrong-PIN answer that TRIPPED it.
  if (error.locked) {
    return {
      kind: 'locked',
      message: lockMessage(error),
      locked: true,
      lockedUntil: error.lockedUntil,
      permanent: error.permanent,
    }
  }

  const base = { locked: false, lockedUntil: null, permanent: false } as const
  switch (error.code) {
    case 'QR_BAD_PIN':
      return { ...base, kind: 'bad_pin', message: BAD_PIN_MESSAGE }
    case 'QR_UNKNOWN_CODE':
      return { ...base, kind: 'unknown_code', message: UNKNOWN_CODE_MESSAGE }
    case 'TOO_MANY_REQUESTS':
      return { ...base, kind: 'throttled', message: THROTTLED_MESSAGE }
    case 'INVALID_INPUT':
      return { ...base, kind: 'invalid', message: INVALID_PIN_MESSAGE }
    case 'NETWORK':
      // The client's own wording: it already says what to do.
      return { ...base, kind: 'network', message: error.message }
    default:
      return { ...base, kind: 'other', message: error.message || GENERIC_PIN_MESSAGE }
  }
}

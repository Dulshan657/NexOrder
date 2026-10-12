// What `qr_verify_pin()` said, turned into what `qr-unlock` should do about it.
//
// The function does the work that has to be atomic -- look the PIN up, count the
// failure, apply the backoff, stamp the unlock -- under a row lock in Postgres
// (mig 00129). This is the part that does NOT need a lock and DOES need a test:
// reading its jsonb answer without trusting its shape, choosing the error code,
// and deciding what the wire is allowed to reveal.
//
// PURE: no Deno, no IO. Same reason as `qrPin.ts`.
//
// ── WHAT THE WIRE MAY SAY ───────────────────────────────────────────────────
//
// The QR sticker is public, so everything this returns is returned to a
// stranger who may be guessing. Two rules follow:
//
//   * A wrong PIN is always the SAME message ("Incorrect PIN") and never carries
//     an attempt count. Whether a code is locked is observable (the next try is
//     refused), so saying so costs nothing; how many guesses remain would hand
//     an attacker the exact budget.
//   * An unknown token and a regenerated token are the same answer. Neither
//     reveals that a venue ever had a code.

import type { ErrorCode } from './errors.ts'

/** The failure count at which `qr_verify_pin` locks a code until someone resets it. */
export const PERMANENT_LOCK_ATTEMPTS = 20

export interface LockInfo {
  /** ISO timestamp the lock ends, or null (not locked, or permanent). */
  lockedUntil: string | null
  /** Locked until a human resets it -- Postgres' 'infinity'. */
  permanent: boolean
}

/**
 * `qr_codes.locked_until` as PostgREST returns it: an ISO string, the literal
 * 'infinity' for a permanent lock, or null. Anything else is treated as "not
 * locked" -- the database is the authority, and a value this cannot read must
 * not be allowed to invent a lock the database does not hold.
 */
export function lockInfo(raw: unknown): LockInfo {
  if (raw === 'infinity') return { lockedUntil: null, permanent: true }
  if (typeof raw === 'string' && raw !== '') {
    const t = new Date(raw).getTime()
    if (!Number.isNaN(t)) return { lockedUntil: new Date(t).toISOString(), permanent: false }
  }
  return { lockedUntil: null, permanent: false }
}

export type UnlockOutcome =
  | {
      kind: 'unlocked'
      staffId: string
      authUserId: string
      horecaId: number
      name: string
      unlockedUntil: string
    }
  | {
      kind: 'refused'
      code: Extract<ErrorCode, 'QR_UNKNOWN_CODE' | 'QR_LOCKED' | 'QR_BAD_PIN'>
      message: string
      details?: Record<string, unknown>
      /** This attempt was the one that locked the code for good: tell the approvers. */
      permanentLockReached: boolean
    }
  | { kind: 'malformed' }

export const BAD_PIN_MESSAGE = 'Incorrect PIN'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function interpretVerifyResult(raw: unknown): UnlockOutcome {
  if (!isRecord(raw) || typeof raw.ok !== 'boolean') return { kind: 'malformed' }

  if (raw.ok) {
    const { staff_id, auth_user_id, horeca_id, name, unlocked_until } = raw
    if (
      typeof staff_id !== 'string' ||
      typeof auth_user_id !== 'string' ||
      typeof horeca_id !== 'number' ||
      typeof name !== 'string' ||
      typeof unlocked_until !== 'string'
    ) {
      return { kind: 'malformed' }
    }
    return {
      kind: 'unlocked',
      staffId: staff_id,
      authUserId: auth_user_id,
      horecaId: horeca_id,
      name,
      unlockedUntil: unlocked_until,
    }
  }

  switch (raw.reason) {
    case 'unknown_code':
      return {
        kind: 'refused',
        code: 'QR_UNKNOWN_CODE',
        message: 'This QR code is not valid.',
        permanentLockReached: false,
      }

    case 'locked': {
      const lock = lockInfo(raw.locked_until)
      return {
        kind: 'refused',
        code: 'QR_LOCKED',
        message: lock.permanent
          ? 'This code is locked. Ask your manager to unlock it.'
          : 'Too many incorrect PINs. Try again later.',
        details: { lockedUntil: lock.lockedUntil, permanent: lock.permanent },
        permanentLockReached: false,
      }
    }

    case 'bad_pin': {
      const lock = lockInfo(raw.locked_until)
      const locked = lock.permanent || lock.lockedUntil !== null
      const failed = typeof raw.failed_attempts === 'number' ? raw.failed_attempts : 0
      return {
        kind: 'refused',
        code: 'QR_BAD_PIN',
        message: BAD_PIN_MESSAGE,
        // Only whether it is now locked -- never how many attempts were made.
        details: locked
          ? { locked: true, lockedUntil: lock.lockedUntil, permanent: lock.permanent }
          : undefined,
        // `=== 20`, not `>= 20`: attempts made while locked are refused without
        // being counted, so the counter reaches 20 exactly once per lock cycle
        // and the approvers are told once.
        permanentLockReached: lock.permanent && failed === PERMANENT_LOCK_ATTEMPTS,
      }
    }

    default:
      return { kind: 'malformed' }
  }
}

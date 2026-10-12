import { describe, expect, it } from 'vitest'

import {
  BAD_PIN_MESSAGE,
  PERMANENT_LOCK_ATTEMPTS,
  PIN_ALERT_ATTEMPTS,
  failureAlertMessage,
  interpretVerifyResult,
  lockInfo,
  type UnlockOutcome,
} from '@/supabase/functions/_shared/qrUnlockPolicy'

/**
 * `qr_verify_pin()` answers a stranger holding a public sticker. These pin what
 * the wire is allowed to say about it: one fixed wrong-PIN message, no attempt
 * counts, and the approvers told once each at 5, 10 and 20 wrong PINs.
 *
 * (The wire is `code`, `message` and `details`. `alert` and `failedAttempts` are
 * for the server's own use -- the notification and the log -- and are asserted
 * to stay off the wire by reading `details` and `message` alone.)
 */
const wire = (out: UnlockOutcome) => {
  if (out.kind !== 'refused') throw new Error('expected a refusal')
  return JSON.stringify({ code: out.code, message: out.message, details: out.details })
}
describe('lockInfo', () => {
  it('reads Postgres infinity as a permanent lock', () => {
    expect(lockInfo('infinity')).toEqual({ lockedUntil: null, permanent: true })
  })

  it('normalises a timestamp to ISO', () => {
    expect(lockInfo('2030-01-02T03:04:05+00:00')).toEqual({
      lockedUntil: '2030-01-02T03:04:05.000Z',
      permanent: false,
    })
  })

  it.each([null, undefined, '', 'not a date', 42, {}])('treats %j as not locked', (raw) => {
    expect(lockInfo(raw)).toEqual({ lockedUntil: null, permanent: false })
  })
})

describe('interpretVerifyResult -- success', () => {
  it('returns the staff member and the unlock window', () => {
    expect(
      interpretVerifyResult({
        ok: true,
        staff_id: 's1',
        auth_user_id: 'u1',
        horeca_id: 7,
        name: 'Sam',
        unlocked_until: '2030-01-01T02:00:00+00:00',
      }),
    ).toEqual({
      kind: 'unlocked',
      staffId: 's1',
      authUserId: 'u1',
      horecaId: 7,
      name: 'Sam',
      unlockedUntil: '2030-01-01T02:00:00+00:00',
    })
  })

  it.each(['staff_id', 'auth_user_id', 'horeca_id', 'name', 'unlocked_until'])(
    'is malformed without %s -- never a half-built unlock',
    (missing) => {
      const full: Record<string, unknown> = {
        ok: true,
        staff_id: 's1',
        auth_user_id: 'u1',
        horeca_id: 7,
        name: 'Sam',
        unlocked_until: '2030-01-01T02:00:00+00:00',
      }
      delete full[missing]
      expect(interpretVerifyResult(full)).toEqual({ kind: 'malformed' })
    },
  )
})

describe('interpretVerifyResult -- refusals', () => {
  it('maps unknown_code to QR_UNKNOWN_CODE', () => {
    expect(interpretVerifyResult({ ok: false, reason: 'unknown_code' })).toMatchObject({
      kind: 'refused',
      code: 'QR_UNKNOWN_CODE',
      alert: null,
      failedAttempts: null,
    })
  })

  it('maps a timed lock to QR_LOCKED with the end time', () => {
    const out = interpretVerifyResult({
      ok: false,
      reason: 'locked',
      locked_until: '2030-01-01T00:15:00+00:00',
      horeca_id: 7,
    })
    expect(out).toMatchObject({
      kind: 'refused',
      code: 'QR_LOCKED',
      details: { lockedUntil: '2030-01-01T00:15:00.000Z', permanent: false },
      alert: null,
      failedAttempts: null,
    })
  })

  it('maps a permanent lock to QR_LOCKED and tells the user who can fix it', () => {
    const out = interpretVerifyResult({ ok: false, reason: 'locked', locked_until: 'infinity' })
    expect(out).toMatchObject({
      kind: 'refused',
      code: 'QR_LOCKED',
      details: { lockedUntil: null, permanent: true },
    })
    expect((out as { message: string }).message).toMatch(/manager/i)
  })

  it('a refusal made WHILE locked never re-announces the lock to approvers', () => {
    const out = interpretVerifyResult({ ok: false, reason: 'locked', locked_until: 'infinity' })
    expect(out).toMatchObject({ alert: null, failedAttempts: null })
  })
})

describe('interpretVerifyResult -- wrong PIN', () => {
  it('always says the same thing', () => {
    for (const failed of [1, 2, 3, 4]) {
      const out = interpretVerifyResult({
        ok: false,
        reason: 'bad_pin',
        failed_attempts: failed,
        locked_until: null,
        horeca_id: 7,
      })
      expect(out).toMatchObject({ kind: 'refused', code: 'QR_BAD_PIN', message: BAD_PIN_MESSAGE })
    }
  })

  it('carries no attempt count and no details while the code is not locked', () => {
    const out = interpretVerifyResult({
      ok: false,
      reason: 'bad_pin',
      failed_attempts: 3,
      locked_until: null,
    })
    expect(out).toMatchObject({ details: undefined, alert: null, failedAttempts: 3 })
    expect(wire(out)).not.toMatch(/failed|attempt|3/)
  })

  it('says only that it is now locked when this attempt locked it', () => {
    const out = interpretVerifyResult({
      ok: false,
      reason: 'bad_pin',
      failed_attempts: 5,
      locked_until: '2030-01-01T00:01:00+00:00',
    })
    expect(out).toMatchObject({
      code: 'QR_BAD_PIN',
      message: BAD_PIN_MESSAGE,
      details: { locked: true, lockedUntil: '2030-01-01T00:01:00.000Z', permanent: false },
    })
    expect(wire(out)).not.toMatch(/failed|attempt|"5"|:5[,}]/)
  })
})

describe('interpretVerifyResult -- who is told, and when', () => {
  const bad = (failed: number, lockedUntil: string | null) =>
    interpretVerifyResult({ ok: false, reason: 'bad_pin', failed_attempts: failed, locked_until: lockedUntil })

  it('alerts the approvers at exactly 5, 10 and 20 wrong PINs', () => {
    expect(PIN_ALERT_ATTEMPTS).toEqual([5, 10, PERMANENT_LOCK_ATTEMPTS])
    expect(bad(5, '2030-01-01T00:01:00+00:00')).toMatchObject({
      alert: { failedAttempts: 5, permanent: false },
    })
    expect(bad(10, '2030-01-01T00:15:00+00:00')).toMatchObject({
      alert: { failedAttempts: 10, permanent: false },
    })
    expect(bad(PERMANENT_LOCK_ATTEMPTS, 'infinity')).toMatchObject({
      code: 'QR_BAD_PIN',
      alert: { failedAttempts: PERMANENT_LOCK_ATTEMPTS, permanent: true },
    })
  })

  it.each([1, 2, 3, 4, 6, 7, 8, 9, 11, 14, 15, 16, 19, 21, 25])(
    'says nothing at %i wrong PINs (each level is announced once, not on every attempt)',
    (n) => {
      expect(bad(n, n >= 5 ? '2030-01-01T00:01:00+00:00' : null)).toMatchObject({ alert: null })
    },
  )

  it('does not call a timed lock permanent just because the count is a threshold', () => {
    expect(bad(PERMANENT_LOCK_ATTEMPTS, '2030-01-01T01:00:00+00:00')).toMatchObject({
      alert: { permanent: false },
    })
  })

  it('writes the log fields the server needs and keeps them off the wire', () => {
    const out = bad(10, '2030-01-01T00:15:00+00:00')
    expect(out).toMatchObject({ kind: 'refused', failedAttempts: 10 })
    expect(JSON.parse(wire(out)).details).toEqual({
      locked: true,
      lockedUntil: '2030-01-01T00:15:00.000Z',
      permanent: false,
    })
  })
})

describe('failureAlertMessage', () => {
  it('names the venue and, below the permanent level, how many and what to do', () => {
    const m = failureAlertMessage({ failedAttempts: 5, permanent: false }, 'Cafe Roma')
    expect(m).toMatch(/Cafe Roma/)
    expect(m).toMatch(/5 incorrect PINs/)
    expect(m).toMatch(/regenerate/i)
  })

  it('says the code is locked, and how to clear it, at the permanent level', () => {
    const m = failureAlertMessage({ failedAttempts: 20, permanent: true }, 'Cafe Roma')
    expect(m).toMatch(/locked/i)
    expect(m).toMatch(/unlock it/i)
    expect(m).not.toMatch(/regenerate/i)
  })
})

describe('interpretVerifyResult -- unreadable answers', () => {
  it.each([null, undefined, 'ok', 42, [], {}, { ok: 'yes' }, { ok: false }, { ok: false, reason: 'weird' }])(
    'is malformed for %j',
    (raw) => {
      expect(interpretVerifyResult(raw)).toEqual({ kind: 'malformed' })
    },
  )
})

import { describe, expect, it } from 'vitest'

import {
  BAD_PIN_MESSAGE,
  PERMANENT_LOCK_ATTEMPTS,
  interpretVerifyResult,
  lockInfo,
} from '@/supabase/functions/_shared/qrUnlockPolicy'

/**
 * `qr_verify_pin()` answers a stranger holding a public sticker. These pin what
 * the wire is allowed to say about it: one fixed wrong-PIN message, no attempt
 * counts, and the approvers told exactly once when a code locks for good.
 */
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
      permanentLockReached: false,
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
      permanentLockReached: false,
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
    expect(out).toMatchObject({ permanentLockReached: false })
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
    expect(out).toMatchObject({ details: undefined })
    expect(JSON.stringify(out)).not.toMatch(/failed|attempt|3/)
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
      permanentLockReached: false,
    })
    expect(JSON.stringify(out)).not.toMatch(/failed_attempts|"5"|:5[,}]/)
  })

  it('flags the permanent lock exactly at the threshold', () => {
    const out = interpretVerifyResult({
      ok: false,
      reason: 'bad_pin',
      failed_attempts: PERMANENT_LOCK_ATTEMPTS,
      locked_until: 'infinity',
    })
    expect(out).toMatchObject({ code: 'QR_BAD_PIN', permanentLockReached: true })
  })

  it('does not flag a permanent lock past the threshold or below it', () => {
    expect(
      interpretVerifyResult({
        ok: false,
        reason: 'bad_pin',
        failed_attempts: PERMANENT_LOCK_ATTEMPTS + 1,
        locked_until: 'infinity',
      }),
    ).toMatchObject({ permanentLockReached: false })
    expect(
      interpretVerifyResult({
        ok: false,
        reason: 'bad_pin',
        failed_attempts: 15,
        locked_until: '2030-01-01T01:00:00+00:00',
      }),
    ).toMatchObject({ permanentLockReached: false })
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

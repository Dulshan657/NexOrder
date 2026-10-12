import { describe, it, expect } from 'vitest'
import { QrApiError } from '@/lib/qr/qrApiError'
import {
  BAD_PIN_MESSAGE,
  GENERIC_PIN_MESSAGE,
  PERMANENT_LOCK_MESSAGE,
  THROTTLED_MESSAGE,
  UNKNOWN_CODE_MESSAGE,
  describePinFailure,
  formatClockTime,
  isStillLocked,
} from '@/lib/qr/qrPinMessages'

const err = (code: string, details?: unknown, message = 'server words') => new QrApiError({ code, message, details })

describe('describePinFailure', () => {
  it('words a wrong PIN as "Incorrect PIN" and never gives a count', () => {
    const f = describePinFailure(err('QR_BAD_PIN', { attemptsLeft: 2 }))
    expect(f.kind).toBe('bad_pin')
    expect(f.message).toBe(BAD_PIN_MESSAGE)
    expect(f.message).not.toMatch(/\d/)
    expect(f.locked).toBe(false)
  })

  it('names the clock time a timed lock ends', () => {
    const lockedUntil = '2026-10-12T14:05:00.000Z'
    const f = describePinFailure(err('QR_LOCKED', { lockedUntil }))
    expect(f.kind).toBe('locked')
    expect(f.locked).toBe(true)
    expect(f.lockedUntil).toBe(lockedUntil)
    expect(f.message).toBe(`Too many attempts. Try again at ${formatClockTime(lockedUntil)}.`)
  })

  it('says to ask a manager when the lock is permanent', () => {
    const f = describePinFailure(err('QR_LOCKED', { permanent: true }))
    expect(f.permanent).toBe(true)
    expect(f.message).toBe(PERMANENT_LOCK_MESSAGE)
  })

  it('treats the wrong PIN that TRIPPED a lock as the lock', () => {
    const f = describePinFailure(err('QR_BAD_PIN', { locked: true, lockedUntil: '2026-10-12T14:05:00.000Z' }))
    expect(f.kind).toBe('locked')
    expect(f.message).toMatch(/^Too many attempts/)
  })

  it('does not invent a time for a lock with none', () => {
    const f = describePinFailure(err('QR_LOCKED'))
    expect(f.message).toBe('Too many attempts. Try again in a few minutes.')
  })

  it('maps the other codes to a person-sized sentence', () => {
    expect(describePinFailure(err('QR_UNKNOWN_CODE')).message).toBe(UNKNOWN_CODE_MESSAGE)
    expect(describePinFailure(err('QR_UNKNOWN_CODE')).kind).toBe('unknown_code')
    expect(describePinFailure(err('TOO_MANY_REQUESTS')).message).toBe(THROTTLED_MESSAGE)
    expect(describePinFailure(err('INVALID_INPUT')).kind).toBe('invalid')
  })

  it('passes the client wording for a network failure straight through', () => {
    const f = describePinFailure(err('NETWORK', undefined, 'Could not reach the server. Check your connection and try again.'))
    expect(f.kind).toBe('network')
    expect(f.message).toBe('Could not reach the server. Check your connection and try again.')
  })

  it('falls back to a generic sentence for anything that is not a QrApiError', () => {
    expect(describePinFailure(new Error('boom')).message).toBe(GENERIC_PIN_MESSAGE)
    expect(describePinFailure('boom').kind).toBe('other')
    expect(describePinFailure(null).kind).toBe('other')
  })
})

describe('isStillLocked', () => {
  const now = new Date('2026-10-12T10:00:00.000Z')

  it('is false when nothing is locked', () => {
    expect(isStillLocked({ locked: false, permanent: false, lockedUntil: null }, now)).toBe(false)
  })

  it('is true until a timed lock ends, then false', () => {
    const f = { locked: true, permanent: false, lockedUntil: '2026-10-12T10:05:00.000Z' }
    expect(isStillLocked(f, now)).toBe(true)
    expect(isStillLocked(f, new Date('2026-10-12T10:05:00.001Z'))).toBe(false)
  })

  it('is always true for a permanent lock', () => {
    expect(isStillLocked({ locked: true, permanent: true, lockedUntil: null }, now)).toBe(true)
  })

  it('leaves the pad usable when the server gave a lock no end time', () => {
    expect(isStillLocked({ locked: true, permanent: false, lockedUntil: null }, now)).toBe(false)
  })
})

describe('formatClockTime', () => {
  it('returns an empty string for a missing or unreadable time', () => {
    expect(formatClockTime(null)).toBe('')
    expect(formatClockTime(undefined)).toBe('')
    expect(formatClockTime('not a date')).toBe('')
  })

  it('formats a readable time in the viewer clock', () => {
    expect(formatClockTime('2026-10-12T14:05:00.000Z')).toMatch(/\d{1,2}[:.]\d{2}/)
  })
})

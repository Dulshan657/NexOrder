import { describe, it, expect } from 'vitest'
import { decideQrEntry, isUnlocked, type QrEntryInput } from '@/lib/qr/qrEntryDecision'
import { UserRole } from '@/types'

const NOW = new Date('2026-10-12T10:00:00.000Z')
const FUTURE = '2026-10-12T11:30:00.000Z'
const PAST = '2026-10-12T09:59:59.000Z'
const VENUE = 7
const OTHER_VENUE = 8

const base: QrEntryInput = { session: true, tokenHorecaId: VENUE, now: NOW }

describe('decideQrEntry', () => {
  describe('no session', () => {
    it('shows the PIN pad', () => {
      expect(decideQrEntry({ session: false, tokenHorecaId: VENUE, now: NOW })).toBe('pin')
    })

    it('ignores stale role/venue fields when there is no session', () => {
      expect(
        decideQrEntry({
          session: false,
          role: UserRole.CUSTOMER,
          profileHorecaId: VENUE,
          tokenHorecaId: VENUE,
          now: NOW,
        }),
      ).toBe('pin')
    })
  })

  describe('a Customer login', () => {
    it('of this venue skips the PIN', () => {
      expect(decideQrEntry({ ...base, role: UserRole.CUSTOMER, profileHorecaId: VENUE })).toBe('enter')
    })

    it('of another venue is "other_user", never silently signed out', () => {
      expect(decideQrEntry({ ...base, role: UserRole.CUSTOMER, profileHorecaId: OTHER_VENUE })).toBe('other_user')
    })

    it('with no venue on the profile is "other_user"', () => {
      expect(decideQrEntry({ ...base, role: UserRole.CUSTOMER, profileHorecaId: null })).toBe('other_user')
      expect(decideQrEntry({ ...base, role: UserRole.CUSTOMER })).toBe('other_user')
    })

    it('does not need an unlock time', () => {
      expect(
        decideQrEntry({ ...base, role: UserRole.CUSTOMER, profileHorecaId: VENUE, qrUnlockedUntil: PAST }),
      ).toBe('enter')
    })
  })

  describe('a QR Staff login', () => {
    const staff = { ...base, role: UserRole.QR_STAFF, profileHorecaId: VENUE }

    it('of this venue with a live unlock skips the PIN', () => {
      expect(decideQrEntry({ ...staff, qrUnlockedUntil: FUTURE })).toBe('enter')
    })

    it('of this venue whose unlock lapsed signs out locally, then shows the PIN pad', () => {
      expect(decideQrEntry({ ...staff, qrUnlockedUntil: PAST })).toBe('pin_after_signout')
    })

    it('whose unlock ends exactly now is expired (strictly in the future is required)', () => {
      expect(decideQrEntry({ ...staff, qrUnlockedUntil: NOW.toISOString() })).toBe('pin_after_signout')
    })

    it('with no unlock time, or an unreadable one, counts as locked', () => {
      expect(decideQrEntry({ ...staff })).toBe('pin_after_signout')
      expect(decideQrEntry({ ...staff, qrUnlockedUntil: null })).toBe('pin_after_signout')
      expect(decideQrEntry({ ...staff, qrUnlockedUntil: 'not a date' })).toBe('pin_after_signout')
      expect(decideQrEntry({ ...staff, qrUnlockedUntil: '' })).toBe('pin_after_signout')
    })

    it('of ANOTHER venue signs out locally even with a live unlock', () => {
      expect(decideQrEntry({ ...staff, profileHorecaId: OTHER_VENUE, qrUnlockedUntil: FUTURE })).toBe(
        'pin_after_signout',
      )
    })

    it('with no venue on the profile is treated as the wrong venue', () => {
      expect(decideQrEntry({ ...staff, profileHorecaId: null, qrUnlockedUntil: FUTURE })).toBe('pin_after_signout')
    })
  })

  describe('anyone else who is signed in', () => {
    const others = [UserRole.ADMIN, UserRole.MANAGER, UserRole.FIELD_REP, UserRole.OFFICE_REP, UserRole.WAREHOUSE]

    it.each(others)('%s is "other_user" and is never signed out silently', (role) => {
      expect(decideQrEntry({ ...base, role, profileHorecaId: VENUE, qrUnlockedUntil: FUTURE })).toBe('other_user')
    })

    it('an unknown or missing role is "other_user"', () => {
      expect(decideQrEntry({ ...base, role: 'Something New', profileHorecaId: VENUE })).toBe('other_user')
      expect(decideQrEntry({ ...base })).toBe('other_user')
      expect(decideQrEntry({ ...base, role: null })).toBe('other_user')
    })
  })

  it('is a pure function of its input', () => {
    const input: QrEntryInput = {
      ...base,
      role: UserRole.QR_STAFF,
      profileHorecaId: VENUE,
      qrUnlockedUntil: FUTURE,
    }
    const copy = JSON.stringify(input)
    expect(decideQrEntry(input)).toBe(decideQrEntry(input))
    expect(JSON.stringify(input)).toBe(copy)
  })
})

describe('isUnlocked', () => {
  it('is true only for a parseable instant strictly after now', () => {
    expect(isUnlocked(FUTURE, NOW)).toBe(true)
    expect(isUnlocked(PAST, NOW)).toBe(false)
    expect(isUnlocked(NOW.toISOString(), NOW)).toBe(false)
    expect(isUnlocked(null, NOW)).toBe(false)
    expect(isUnlocked(undefined, NOW)).toBe(false)
    expect(isUnlocked('garbage', NOW)).toBe(false)
  })

  it('reads a Postgres-style timestamp with an offset', () => {
    expect(isUnlocked('2026-10-12T21:30:00+10:00', NOW)).toBe(true) // 11:30Z
    expect(isUnlocked('2026-10-12T19:30:00+10:00', NOW)).toBe(false) // 09:30Z
  })
})

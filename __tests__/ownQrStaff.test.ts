import { describe, it, expect, vi, afterEach } from 'vitest'
import { ownUnlockedUntil } from '@/lib/qr/ownQrStaff'

// qr_staff rows as a QR Staff phone can read them: only its own while LAPSED,
// the whole venue while UNLOCKED, nothing once revoked.

const row = (name: string, unlockedUntil: string | null) => ({ name, unlockedUntil })

afterEach(() => vi.useRealTimers())

describe('ownUnlockedUntil', () => {
  it('is null when no row is visible (revoked)', () => {
    expect(ownUnlockedUntil([], 'Sam')).toBeNull()
  })

  it('takes the only row, whoever it is', () => {
    expect(ownUnlockedUntil([row('Sam', '2026-10-12T12:00:00.000Z')], 'Sam')).toBe('2026-10-12T12:00:00.000Z')
    expect(ownUnlockedUntil([row('Sam', null)], 'Sam')).toBeNull()
  })

  it('matches on the profile name when siblings are visible', () => {
    const rows = [
      row('Alex', '2026-10-12T13:00:00.000Z'),
      row('Sam', '2026-10-12T12:00:00.000Z'),
      row('Jo', null),
    ]
    expect(ownUnlockedUntil(rows, 'Sam')).toBe('2026-10-12T12:00:00.000Z')
  })

  it('takes the EARLIEST expiry when two staff share a name', () => {
    const rows = [row('Sam', '2026-10-12T13:00:00.000Z'), row('Sam', '2026-10-12T12:00:00.000Z'), row('Alex', null)]
    expect(ownUnlockedUntil(rows, 'Sam')).toBe('2026-10-12T12:00:00.000Z')
  })

  it('falls back to the soonest FUTURE expiry when no row carries the name', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-12T10:00:00.000Z'))
    const rows = [
      row('Alex', '2026-10-12T09:00:00.000Z'), // already over: not "mine"
      row('Jo', '2026-10-12T12:30:00.000Z'),
      row('Kim', '2026-10-12T11:00:00.000Z'),
    ]
    expect(ownUnlockedUntil(rows, 'Samantha')).toBe('2026-10-12T11:00:00.000Z')
  })

  it('is null when several rows are visible and none is in the future', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-12T10:00:00.000Z'))
    expect(ownUnlockedUntil([row('A', null), row('B', '2026-10-12T09:00:00.000Z')], 'Sam')).toBeNull()
  })
})

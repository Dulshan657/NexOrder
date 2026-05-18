import { describe, it, expect } from 'vitest'

import { formatRelative } from '../components/admin/EmailAccountsTab'

describe('formatRelative', () => {
  const NOW = new Date('2026-05-18T12:00:00.000Z').getTime()

  it('returns "just now" within the first minute', () => {
    const t = new Date(NOW - 30_000).toISOString()
    expect(formatRelative(t, NOW)).toBe('just now')
  })

  it('returns minutes for less than an hour', () => {
    expect(formatRelative(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5 min ago')
    expect(formatRelative(new Date(NOW - 59 * 60_000).toISOString(), NOW)).toBe('59 min ago')
  })

  it('returns hours under one day', () => {
    expect(formatRelative(new Date(NOW - 2 * 3_600_000).toISOString(), NOW)).toBe('2 h ago')
    expect(formatRelative(new Date(NOW - 23 * 3_600_000).toISOString(), NOW)).toBe('23 h ago')
  })

  it('returns days otherwise', () => {
    expect(formatRelative(new Date(NOW - 3 * 86_400_000).toISOString(), NOW)).toBe('3 d ago')
  })

  it('handles unparseable input gracefully', () => {
    expect(formatRelative('not-a-date', NOW)).toBe('unknown')
  })
})

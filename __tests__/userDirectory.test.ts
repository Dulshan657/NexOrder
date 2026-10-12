import { describe, it, expect } from 'vitest'
import { directoryUsers, isDirectoryUser } from '@/lib/userDirectory'
import { UserRole } from '@/types'

const people = Object.values(UserRole).map((role, i) => ({ id: i + 1, name: `User ${i + 1}`, role }))

describe('directoryUsers', () => {
  it('drops the hidden QR Staff logins and keeps every other role', () => {
    const kept = directoryUsers(people)
    expect(kept.some((u) => u.role === UserRole.QR_STAFF)).toBe(false)
    expect(kept).toHaveLength(people.length - 1)
    for (const role of Object.values(UserRole)) {
      if (role === UserRole.QR_STAFF) continue
      expect(kept.some((u) => u.role === role), role).toBe(true)
    }
  })

  it('returns a new array and leaves the input alone', () => {
    const copy = [...people]
    const out = directoryUsers(people)
    expect(out).not.toBe(people)
    expect(people).toEqual(copy)
  })

  it('keeps an unknown role: this is a deny-list for exactly one role', () => {
    expect(isDirectoryUser({ role: 'Something New' })).toBe(true)
    expect(isDirectoryUser({ role: UserRole.QR_STAFF })).toBe(false)
  })

  it('handles an empty list', () => {
    expect(directoryUsers([])).toEqual([])
  })
})

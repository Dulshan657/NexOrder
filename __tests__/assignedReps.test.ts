import { describe, expect, it } from 'vitest'
import { repCandidates, sameIdSet, toggleId } from '@/lib/qr/assignedReps'

const profiles = [
  { id: 'a', name: 'Zed', email: 'zed@x.com', role: 'Field Sales Rep' },
  { id: 'b', name: 'Amy', email: 'amy@x.com', role: 'Office Sales Rep' },
  { id: 'c', name: 'Cust', email: 'c@x.com', role: 'Restaurant/Hotel Customer' },
  { id: 'd', name: 'Boss', email: 'boss@x.com', role: 'Admin' },
  { id: 'e', name: 'Sam', email: 'qr-1@qr.nexorder.invalid', role: 'QR Staff' },
]

describe('repCandidates', () => {
  it('offers only the roles set_reps accepts, A to Z', () => {
    expect(repCandidates(profiles).map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('never offers a hidden QR Staff login, a customer or an admin', () => {
    const roles = repCandidates(profiles).map((p) => p.role)
    expect(roles.every((r) => r === 'Field Sales Rep' || r === 'Office Sales Rep')).toBe(true)
  })

  it('copes with nothing loaded yet and does not reorder its input', () => {
    expect(repCandidates(undefined)).toEqual([])
    expect(repCandidates(null)).toEqual([])
    const input = [...profiles]
    repCandidates(input)
    expect(input).toEqual(profiles)
  })
})

describe('sameIdSet', () => {
  it('ignores order', () => {
    expect(sameIdSet(['a', 'b'], ['b', 'a'])).toBe(true)
  })
  it('notices a difference in either direction', () => {
    expect(sameIdSet(['a'], ['a', 'b'])).toBe(false)
    expect(sameIdSet(['a', 'b'], ['a', 'c'])).toBe(false)
    expect(sameIdSet([], [])).toBe(true)
  })
})

describe('toggleId', () => {
  it('adds and removes without mutating', () => {
    const ids = ['a']
    expect(toggleId(ids, 'b')).toEqual(['a', 'b'])
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b'])
    expect(ids).toEqual(['a'])
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearDismissedMemory,
  dismissedKey,
  MAX_DISMISSED,
  readDismissed,
  withDismissed,
  writeDismissed,
} from '@/lib/qr/dismissedRequests'

// Which "Not approved" cards a person has put away. Per user, in localStorage --
// which can be absent, full, or throw in a private window -- so every access is
// guarded and the screen must work (for this session) without it.

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  clearDismissedMemory()
})

describe('dismissedKey', () => {
  it('is per user, so one phone shared by two cooks keeps two lists', () => {
    expect(dismissedKey('a')).not.toBe(dismissedKey('b'))
  })
})

describe('readDismissed / writeDismissed', () => {
  it('round-trips ids through localStorage, per user', () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)

    writeDismissed('u1', ['r1', 'r2'])
    writeDismissed('u2', ['r9'])

    expect(readDismissed('u1')).toEqual(['r1', 'r2'])
    expect(readDismissed('u2')).toEqual(['r9'])
  })

  it('reads as empty when nothing was ever stored', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    expect(readDismissed('u1')).toEqual([])
  })

  it('reads as empty when there is no user to key it by', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    expect(readDismissed(null)).toEqual([])
    expect(readDismissed('')).toEqual([])
  })

  it('survives garbage: not JSON, not an array, non-strings', () => {
    vi.stubGlobal('localStorage', fakeStorage({ [dismissedKey('u1')]: '{not json' }))
    expect(readDismissed('u1')).toEqual([])

    vi.stubGlobal('localStorage', fakeStorage({ [dismissedKey('u1')]: JSON.stringify({ a: 1 }) }))
    expect(readDismissed('u1')).toEqual([])

    vi.stubGlobal('localStorage', fakeStorage({ [dismissedKey('u1')]: JSON.stringify(['ok', 3, null, 'also']) }))
    expect(readDismissed('u1')).toEqual(['ok', 'also'])
  })

  describe('with a localStorage that throws on every access', () => {
    beforeEach(() => {
      const boom = () => {
        throw new Error('SecurityError: storage is blocked')
      }
      vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom })
    })

    it('reads as empty instead of throwing, when nothing was dismissed', () => {
      expect(() => readDismissed('u1')).not.toThrow()
      expect(readDismissed('u1')).toEqual([])
    })

    it('writes without throwing', () => {
      expect(() => writeDismissed('u1', ['r1'])).not.toThrow()
    })

    it('still remembers for the rest of the visit, in memory, so a card does not come back on navigation', () => {
      writeDismissed('u1', ['r1', 'r2'])

      expect(readDismissed('u1')).toEqual(['r1', 'r2'])
      // Per user, here too.
      expect(readDismissed('u2')).toEqual([])
    })
  })

  describe('with no localStorage at all (server render, some webviews)', () => {
    beforeEach(() => vi.stubGlobal('localStorage', undefined))

    it('reads empty and writes without throwing', () => {
      expect(readDismissed('u1')).toEqual([])
      expect(() => writeDismissed('u1', ['r1'])).not.toThrow()
    })

    it('remembers in memory', () => {
      writeDismissed('u1', ['r1'])
      expect(readDismissed('u1')).toEqual(['r1'])
    })
  })

  it('remembers in memory when the browser refuses the write (quota), though it could read', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      },
    })
    expect(() => writeDismissed('u1', ['r1'])).not.toThrow()
    expect(readDismissed('u1')).toEqual(['r1'])
  })

  it('counts a dismissal held in either place: stored and in-memory ones are joined, once each', () => {
    vi.stubGlobal('localStorage', undefined)
    writeDismissed('u1', ['both', 'memory-only'])
    vi.stubGlobal('localStorage', fakeStorage({ [dismissedKey('u1')]: JSON.stringify(['stored-only', 'both']) }))

    expect(readDismissed('u1').sort()).toEqual(['both', 'memory-only', 'stored-only'])
  })

  it('does not hand out its internal list: changing a result changes nothing remembered', () => {
    vi.stubGlobal('localStorage', undefined)
    writeDismissed('u1', ['r1'])
    readDismissed('u1').push('intruder')
    expect(readDismissed('u1')).toEqual(['r1'])
  })

  it('forgets the in-memory list on request (tests, sign-out)', () => {
    vi.stubGlobal('localStorage', undefined)
    writeDismissed('u1', ['r1'])
    clearDismissedMemory()
    expect(readDismissed('u1')).toEqual([])
  })
})

describe('withDismissed', () => {
  it('returns a new list with the id added, leaving the old one alone', () => {
    const before = ['r1']
    const after = withDismissed(before, 'r2')

    expect(after).toEqual(['r1', 'r2'])
    expect(before).toEqual(['r1'])
    expect(after).not.toBe(before)
  })

  it('does not list an id twice', () => {
    expect(withDismissed(['r1', 'r2'], 'r1')).toEqual(['r1', 'r2'])
  })

  it('forgets the oldest once the list is long, so it cannot grow for ever', () => {
    const full = Array.from({ length: MAX_DISMISSED }, (_, i) => `r${i}`)
    const next = withDismissed(full, 'newest')

    expect(next).toHaveLength(MAX_DISMISSED)
    expect(next[next.length - 1]).toBe('newest')
    expect(next).not.toContain('r0')
  })
})

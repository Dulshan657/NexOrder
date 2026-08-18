// These breadcrumbs exist to answer one question that has been open since
// `persistSession` was turned back on: does a session survive a warehouse shift
// on a handheld? So the tests are mostly about the two ways the answer could be
// a lie — a miscounted refresh, and the seconds/milliseconds trap on
// `expires_at`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  clearSessionBreadcrumbs,
  readSessionBreadcrumbs,
  recordAuthEvent,
  recordRefresh,
  recordSignIn,
} from '@/lib/auth/sessionBreadcrumbs'
import { describeSession } from '@/components/admin/sessionHealthFormat'

const KEY = 'nexorder.auth.breadcrumbs'

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage
}

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

function useStorage(storage: Storage | undefined) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  useStorage(fakeStorage())
})

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original)
})

const MINUTE = 60_000
const HOUR = 60 * MINUTE

describe('recording a session', () => {
  it('starts empty', () => {
    const crumbs = readSessionBreadcrumbs()
    expect(crumbs.signedInAt).toBeNull()
    expect(crumbs.refreshCount).toBe(0)
    expect(crumbs.refreshes).toEqual([])
  })

  it('counts refreshes against the session that is running', () => {
    recordSignIn(null, 1_000)
    recordRefresh(null, 1_000 + HOUR)
    recordRefresh(null, 1_000 + 2 * HOUR)

    const crumbs = readSessionBreadcrumbs()
    expect(crumbs.refreshCount).toBe(2)
    expect(crumbs.refreshes).toEqual([1_000 + HOUR, 1_000 + 2 * HOUR])
  })

  it('resets the count on a NEW sign-in', () => {
    // Carrying a previous session's count forward would make the soak
    // unreadable: "3 refreshes" would not say whether any of them were this
    // session's, which is the only thing being asked.
    recordSignIn(null, 1_000)
    recordRefresh(null, 2_000)
    recordSignIn(null, 3_000)

    const crumbs = readSessionBreadcrumbs()
    expect(crumbs.refreshCount).toBe(0)
    expect(crumbs.signedInAt).toBe(3_000)
  })

  it('stamps a start when a refresh arrives with no recorded sign-in', () => {
    // The session was restored from storage on page load — which is itself the
    // behaviour under test. Leaving signedInAt null would report the age as
    // unknown forever.
    recordRefresh(null, 5_000)
    expect(readSessionBreadcrumbs().signedInAt).toBe(5_000)
  })

  it('caps the stored timestamps so an all-day session cannot grow unbounded', () => {
    recordSignIn(null, 0)
    for (let i = 1; i <= 40; i += 1) recordRefresh(null, i * MINUTE)

    const crumbs = readSessionBreadcrumbs()
    expect(crumbs.refreshCount).toBe(40)
    expect(crumbs.refreshes).toHaveLength(24)
    // The cap drops the OLDEST — the recent cadence is what is being read.
    expect(crumbs.refreshes[crumbs.refreshes.length - 1]).toBe(40 * MINUTE)
  })

  it('forgets everything on sign-out', () => {
    recordSignIn(null, 1_000)
    clearSessionBreadcrumbs()
    expect(readSessionBreadcrumbs().signedInAt).toBeNull()
  })
})

describe('recordAuthEvent', () => {
  it('converts expires_at from SECONDS to milliseconds', () => {
    // supabase reports epoch seconds; everything else here is epoch ms. Passed
    // through unconverted this lands in January 1970 and the health tab reports
    // the token as having expired decades ago.
    const expiresAtSeconds = 1_760_000_000
    recordAuthEvent('SIGNED_IN', expiresAtSeconds)
    expect(readSessionBreadcrumbs().expiresAt).toBe(expiresAtSeconds * 1000)
  })

  it('counts TOKEN_REFRESHED — the event the whole soak is looking for', () => {
    recordAuthEvent('SIGNED_IN', null)
    recordAuthEvent('TOKEN_REFRESHED', null)
    expect(readSessionBreadcrumbs().refreshCount).toBe(1)
  })

  it('clears on SIGNED_OUT', () => {
    recordAuthEvent('SIGNED_IN', null)
    recordAuthEvent('SIGNED_OUT', null)
    expect(readSessionBreadcrumbs().signedInAt).toBeNull()
  })

  it('ignores events it does not know, rather than defaulting them', () => {
    // supabase-js emits USER_UPDATED and INITIAL_SESSION too. Treating either
    // as a refresh would inflate exactly the number being read.
    recordAuthEvent('SIGNED_IN', null)
    recordAuthEvent('USER_UPDATED', null)
    recordAuthEvent('INITIAL_SESSION', null)
    expect(readSessionBreadcrumbs().refreshCount).toBe(0)
  })

  it('tolerates a missing expiry', () => {
    recordAuthEvent('SIGNED_IN', undefined)
    expect(readSessionBreadcrumbs().expiresAt).toBeNull()
  })
})

describe('failing silently', () => {
  // These calls sit on the auth path. A breadcrumb is diagnostic; losing one
  // must never cost a session.
  it('survives storage being absent entirely', () => {
    useStorage(undefined)
    expect(() => recordSignIn(null)).not.toThrow()
    expect(() => recordRefresh(null)).not.toThrow()
    expect(() => clearSessionBreadcrumbs()).not.toThrow()
    expect(readSessionBreadcrumbs().refreshCount).toBe(0)
  })

  it('survives a storage that throws on write — a full quota', () => {
    useStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    } as unknown as Storage)
    expect(() => recordSignIn(null)).not.toThrow()
  })

  it('degrades to empty on corrupt JSON rather than throwing', () => {
    globalThis.localStorage.setItem(KEY, '{not json')
    expect(readSessionBreadcrumbs().refreshCount).toBe(0)
  })

  it('degrades on a value of the wrong shape', () => {
    // An older shape, or a half-written value. Must not render as NaN.
    globalThis.localStorage.setItem(KEY, JSON.stringify({ refreshCount: 'lots', refreshes: 'nope' }))
    const crumbs = readSessionBreadcrumbs()
    expect(crumbs.refreshCount).toBe(0)
    expect(crumbs.refreshes).toEqual([])
    expect(crumbs.signedInAt).toBeNull()
  })
})

describe('describeSession', () => {
  const at = (over: Partial<ReturnType<typeof readSessionBreadcrumbs>>) => ({
    signedInAt: null,
    refreshCount: 0,
    refreshes: [],
    expiresAt: null,
    ...over,
  })

  it('reads as dashes with nothing recorded', () => {
    const r = describeSession(at({}), 1_000)
    expect(r.age).toBe('—')
    expect(r.refreshCount).toBe('0')
    expect(r.lastRefresh).toBe('—')
    expect(r.expiresIn).toBe('—')
  })

  it('will not call a young session a failure', () => {
    // Supabase renews about ten minutes before a one-hour token expires, so
    // zero refreshes at 20 minutes proves nothing. Saying so is the difference
    // between a result and a shrug.
    const r = describeSession(at({ signedInAt: 0 }), 20 * MINUTE)
    expect(r.age).toBe('20m')
    expect(r.refreshHint).toBe('too soon to tell — none due yet')
  })

  it('calls out a session old enough to have refreshed and not have', () => {
    const r = describeSession(at({ signedInAt: 0 }), 75 * MINUTE)
    expect(r.refreshHint).toBe('none yet, and one was due')
  })

  it('reports a working auto-refresh', () => {
    const r = describeSession(
      at({ signedInAt: 0, refreshCount: 1, refreshes: [55 * MINUTE] }),
      90 * MINUTE,
    )
    expect(r.refreshHint).toBe('auto-refresh is working')
    expect(r.lastRefresh).toBe('35m ago')
  })

  it('says expired rather than showing a negative duration', () => {
    const r = describeSession(at({ expiresAt: 10 * MINUTE }), 90 * MINUTE)
    expect(r.expiresIn).toBe('expired')
  })

  it('formats hours and minutes', () => {
    expect(describeSession(at({ signedInAt: 0 }), 90 * MINUTE).age).toBe('1h 30m')
    expect(describeSession(at({ signedInAt: 0 }), 120 * MINUTE).age).toBe('2h')
    expect(describeSession(at({ signedInAt: 0 }), 30_000).age).toBe('<1m')
  })

  it('would make a seconds/milliseconds mistake obvious', () => {
    // The regression guard for the trap in recordAuthEvent: an unconverted
    // epoch-seconds value is ~1970 in milliseconds, so it reads as expired
    // rather than as a plausible near-future time.
    const nowMs = 1_760_000_000_000
    const unconverted = 1_760_003_600
    expect(describeSession(at({ expiresAt: unconverted }), nowMs).expiresIn).toBe('expired')
    expect(describeSession(at({ expiresAt: unconverted * 1000 }), nowMs).expiresIn).toBe('1h')
  })
})

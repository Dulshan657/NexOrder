import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
    PASSWORD_SET_WINDOW_MS,
    PENDING_PASSWORD_SET_KEY,
    clearPendingPasswordSet,
    decideAuthScreen,
    isExpired,
    readPendingPasswordSet,
    writePendingPasswordSet,
} from '@/lib/auth/pendingPasswordSet'
import type { PendingPasswordSet } from '@/lib/auth/pendingPasswordSet'

// The `.test.ts` project runs under node, which has no localStorage. A minimal
// stand-in is enough — nothing here exercises quota or eviction, and the module
// only ever calls three methods.
class MemoryStorage {
    private store = new Map<string, string>()
    getItem(key: string): string | null {
        return this.store.get(key) ?? null
    }
    setItem(key: string, value: string): void {
        this.store.set(key, value)
    }
    removeItem(key: string): void {
        this.store.delete(key)
    }
}

const NOW = 1_700_000_000_000

const marker = (over: Partial<PendingPasswordSet> = {}): PendingPasswordSet => ({
    userId: 'user-1',
    flow: 'recovery',
    issuedAt: NOW,
    ...over,
})

beforeEach(() => {
    ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
})

afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage
})

describe('isExpired', () => {
    it('is false the instant it is issued', () => {
        expect(isExpired(marker(), NOW)).toBe(false)
    })

    it('is false one millisecond inside the window', () => {
        expect(isExpired(marker(), NOW + PASSWORD_SET_WINDOW_MS - 1)).toBe(false)
    })

    it('is true exactly at the window — the boundary belongs to expiry', () => {
        expect(isExpired(marker(), NOW + PASSWORD_SET_WINDOW_MS)).toBe(true)
    })

    it('matches mailer_otp_exp of 3600 seconds', () => {
        expect(PASSWORD_SET_WINDOW_MS).toBe(3600 * 1000)
    })
})

describe('decideAuthScreen', () => {
    // Every auth-link shape routes to the set-password screen on the URL alone,
    // with no marker yet — that is the first visit from an email.
    it.each(['tokens', 'token_hash', 'error'] as const)(
        'routes a %s link to the set-password screen with no marker',
        (kind) => {
            expect(decideAuthScreen(kind, null)).toBe('set-password')
        },
    )

    it('routes an ordinary load with no marker to the app', () => {
        expect(decideAuthScreen('none', null)).toBe('app')
    })

    // The regression under test: the URL is stripped the moment the session
    // exists, so from then until the password is typed this is ALL there is.
    it('keeps a stripped URL on the set-password screen while a marker is live', () => {
        expect(decideAuthScreen('none', marker())).toBe('set-password')
    })

    // An earlier cut treated a stale marker as absent and let it through to the
    // app "to be signed out there". Nothing in the app tree signs anything out
    // — AuthGate just renders. Caught on the live demo: an aged marker put a
    // recovery session straight into the admin UI.
    it('does NOT let an expired marker through to the app', () => {
        const stale = marker({ issuedAt: NOW - PASSWORD_SET_WINDOW_MS - 1 })
        expect(decideAuthScreen('none', stale)).toBe('set-password')
    })

    it.each(['tokens', 'token_hash', 'error', 'none'] as const)(
        'a marker never routes a %s load to the app',
        (kind) => {
            expect(decideAuthScreen(kind, marker())).toBe('set-password')
        },
    )
})

describe('storage round trip', () => {
    it('reads back exactly what was written', () => {
        const written = marker({ userId: 'abc-123', flow: 'invite' })
        writePendingPasswordSet(written)
        expect(readPendingPasswordSet()).toEqual(written)
    })

    it('reads null when nothing was ever written', () => {
        expect(readPendingPasswordSet()).toBeNull()
    })

    it('reads null after clearing', () => {
        writePendingPasswordSet(marker())
        clearPendingPasswordSet()
        expect(readPendingPasswordSet()).toBeNull()
    })

    // A corrupt marker must read as absent rather than throw: this runs inside
    // a useState initialiser at the very top of the tree, where an exception
    // is a white screen.
    it('reads null on unparseable JSON', () => {
        localStorage.setItem(PENDING_PASSWORD_SET_KEY, '{not json')
        expect(readPendingPasswordSet()).toBeNull()
    })

    it.each([
        ['a bare string', '"nope"'],
        ['null', 'null'],
        ['a missing userId', JSON.stringify({ flow: 'recovery', issuedAt: NOW })],
        ['an empty userId', JSON.stringify({ userId: '', flow: 'recovery', issuedAt: NOW })],
        ['an unknown flow', JSON.stringify({ userId: 'u', flow: 'signup', issuedAt: NOW })],
        ['a string issuedAt', JSON.stringify({ userId: 'u', flow: 'invite', issuedAt: 'now' })],
    ])('reads null on %s', (_label, raw) => {
        localStorage.setItem(PENDING_PASSWORD_SET_KEY, raw)
        expect(readPendingPasswordSet()).toBeNull()
    })

    it('survives localStorage being absent entirely', () => {
        delete (globalThis as { localStorage?: unknown }).localStorage
        expect(() => writePendingPasswordSet(marker())).not.toThrow()
        expect(() => clearPendingPasswordSet()).not.toThrow()
        expect(readPendingPasswordSet()).toBeNull()
    })

    it('survives localStorage throwing on every access', () => {
        ;(globalThis as { localStorage?: unknown }).localStorage = {
            getItem() {
                throw new Error('denied')
            },
            setItem() {
                throw new Error('denied')
            },
            removeItem() {
                throw new Error('denied')
            },
        }
        expect(() => writePendingPasswordSet(marker())).not.toThrow()
        expect(() => clearPendingPasswordSet()).not.toThrow()
        expect(readPendingPasswordSet()).toBeNull()
    })
})

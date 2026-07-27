import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

// The invariant under test: the onAuthStateChange callback must return
// synchronously and must not await another supabase call.
//
// supabase-js dispatches that callback while holding its internal auth lock,
// and awaits whatever the callback returns. A PostgREST query from inside it
// needs getSession(), which waits for the same lock — a self-deadlock that
// strands setSession() forever. It is invisible in ordinary login (
// signInWithPassword does not take the lock) and only surfaced on the
// password-recovery screen, which hung on "Verifying recovery link…".

let onAuthStateChangeCallback: ((event: string, session: unknown) => unknown) | null = null
const profileQuery = vi.fn()

vi.mock('@/lib/supabase', () => ({
    supabase: {
        auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
            onAuthStateChange: (cb: (event: string, session: unknown) => unknown) => {
                onAuthStateChangeCallback = cb
                return { data: { subscription: { unsubscribe: vi.fn() } } }
            },
        },
        from: () => ({
            select: () => ({
                eq: () => ({
                    single: profileQuery,
                }),
            }),
        }),
    },
}))

const { AuthProvider } = await import('@/hooks/useAuth')

const SESSION = { user: { id: 'user-1' } }

beforeEach(() => {
    onAuthStateChangeCallback = null
    profileQuery.mockReset()
    profileQuery.mockResolvedValue({ data: { id: 'user-1', role: 'Admin' }, error: null })
})

describe('AuthProvider onAuthStateChange', () => {
    it('returns synchronously — anything thenable would be awaited under the lock', async () => {
        render(React.createElement(AuthProvider, null, 'child'))
        await waitFor(() => expect(onAuthStateChangeCallback).not.toBeNull())

        const returned = onAuthStateChangeCallback!('SIGNED_IN', SESSION)

        expect(returned).toBeUndefined()
        expect(typeof (returned as { then?: unknown })?.then).not.toBe('function')
    })

    it('does not touch the database before returning', async () => {
        render(React.createElement(AuthProvider, null, 'child'))
        await waitFor(() => expect(onAuthStateChangeCallback).not.toBeNull())

        // Count-relative, because a deferred fetch scheduled by an earlier
        // test can land during the waitFor above.
        const before = profileQuery.mock.calls.length
        onAuthStateChangeCallback!('SIGNED_IN', SESSION)

        // The whole point: the query must be deferred past the lock, not
        // issued while supabase is still dispatching.
        expect(profileQuery.mock.calls.length).toBe(before)
    })

    it('still loads the profile, just on a later task', async () => {
        render(React.createElement(AuthProvider, null, 'child'))
        await waitFor(() => expect(onAuthStateChangeCallback).not.toBeNull())

        const before = profileQuery.mock.calls.length
        onAuthStateChangeCallback!('SIGNED_IN', SESSION)

        await waitFor(() => expect(profileQuery.mock.calls.length).toBeGreaterThan(before))
    })

    it('clears state synchronously on sign-out without querying', async () => {
        render(React.createElement(AuthProvider, null, 'child'))
        await waitFor(() => expect(onAuthStateChangeCallback).not.toBeNull())

        const before = profileQuery.mock.calls.length
        const returned = onAuthStateChangeCallback!('SIGNED_OUT', null)

        expect(returned).toBeUndefined()
        expect(profileQuery.mock.calls.length).toBe(before)
    })
})

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'

// The profile row is the one dependency the whole app is gated on: AuthGate
// renders LoginPage whenever `profile` is null. A transient failure of the
// profile fetch — which re-runs on every hourly TOKEN_REFRESHED — used to set
// profile to null and unmount the app mid-shift with a valid session. These
// tests pin the resilient behaviour.

let onAuthStateChangeCallback: ((event: string, session: unknown) => unknown) | null = null
const profileQuery = vi.fn()
const getSession = vi.fn()

vi.mock('@/lib/supabase', () => ({
    supabase: {
        auth: {
            getSession: (...args: unknown[]) => getSession(...args),
            onAuthStateChange: (cb: (event: string, session: unknown) => unknown) => {
                onAuthStateChangeCallback = cb
                return { data: { subscription: { unsubscribe: vi.fn() } } }
            },
        },
        from: () => ({ select: () => ({ eq: () => ({ single: profileQuery }) }) }),
    },
}))

const { AuthProvider, useAuth } = await import('@/hooks/useAuth')

const SESSION = { user: { id: 'user-1' } }
const PROFILE = { id: 'user-1', role: 'Admin', full_name: 'Ada' }
const NETWORK_ERROR = { data: null, error: { code: '', message: 'Failed to fetch' } }
const NO_ROW = { data: null, error: { code: 'PGRST116', message: 'no rows' } }

type Ctx = ReturnType<typeof useAuth>
let latest: Ctx | null = null
const seen: Array<Ctx['profile']> = []

function Probe() {
    latest = useAuth()
    seen.push(latest.profile)
    return null
}

function mount() {
    return render(React.createElement(AuthProvider, null, React.createElement(Probe)))
}

beforeEach(() => {
    onAuthStateChangeCallback = null
    latest = null
    seen.length = 0
    profileQuery.mockReset()
    getSession.mockReset()
    getSession.mockResolvedValue({ data: { session: SESSION } })
    // A fresh object per call, as PostgREST returns — so reference equality
    // in the tests below is the hook's doing, not the mock's.
    profileQuery.mockImplementation(async () => ({ data: { ...PROFILE }, error: null }))
})

async function loaded() {
    mount()
    await waitFor(() => expect(latest?.profile?.id).toBe('user-1'))
    await waitFor(() => expect(onAuthStateChangeCallback).not.toBeNull())
}

describe('AuthProvider profile resilience', () => {
    it('keeps the last good profile when a refresh-time refetch fails', async () => {
        await loaded()
        profileQuery.mockResolvedValue(NETWORK_ERROR)
        const before = profileQuery.mock.calls.length

        act(() => { onAuthStateChangeCallback!('TOKEN_REFRESHED', SESSION) })
        await waitFor(() => expect(profileQuery.mock.calls.length).toBeGreaterThan(before))
        await act(async () => { await new Promise((r) => setTimeout(r, 10)) })

        expect(latest!.profile?.id).toBe('user-1')
        expect(latest!.profileError).toBe(false)
    })

    it('keeps the last good profile when the refetch throws', async () => {
        await loaded()
        profileQuery.mockRejectedValue(new Error('timeout'))
        const before = profileQuery.mock.calls.length

        act(() => { onAuthStateChangeCallback!('TOKEN_REFRESHED', SESSION) })
        await waitFor(() => expect(profileQuery.mock.calls.length).toBeGreaterThan(before))
        await act(async () => { await new Promise((r) => setTimeout(r, 10)) })

        expect(latest!.profile?.id).toBe('user-1')
    })

    it('reuses the same profile object when a refetch returns identical data', async () => {
        await loaded()
        const first = latest!.profile
        const before = profileQuery.mock.calls.length

        act(() => { onAuthStateChangeCallback!('TOKEN_REFRESHED', SESSION) })
        await waitFor(() => expect(profileQuery.mock.calls.length).toBeGreaterThan(before))
        await act(async () => { await new Promise((r) => setTimeout(r, 10)) })

        expect(latest!.profile).toBe(first)
    })

    it('picks up a changed profile (e.g. a role change) on refetch', async () => {
        await loaded()
        profileQuery.mockResolvedValue({ data: { ...PROFILE, role: 'Manager' }, error: null })

        act(() => { onAuthStateChangeCallback!('TOKEN_REFRESHED', SESSION) })
        await waitFor(() => expect(latest!.profile?.role).toBe('Manager'))
    })

    it('a genuinely missing profile row still yields no profile and no error', async () => {
        profileQuery.mockResolvedValue(NO_ROW)
        mount()
        await waitFor(() => expect(latest!.isLoading).toBe(false))

        expect(latest!.profile).toBeNull()
        expect(latest!.profileError).toBe(false)
    })

    it('flags an initial-load failure and recovers via retryProfile', async () => {
        profileQuery.mockResolvedValue(NETWORK_ERROR)
        mount()
        await waitFor(() => expect(latest!.isLoading).toBe(false))
        await waitFor(() => expect(latest!.profileError).toBe(true))
        expect(latest!.profile).toBeNull()

        profileQuery.mockResolvedValue({ data: { ...PROFILE }, error: null })
        await act(async () => { await latest!.retryProfile() })

        expect(latest!.profile?.id).toBe('user-1')
        expect(latest!.profileError).toBe(false)
    })

    it('fetches the profile once at startup when getSession and INITIAL_SESSION race', async () => {
        let resolve: (v: unknown) => void = () => {}
        profileQuery.mockImplementation(() => new Promise((r) => { resolve = r }))
        mount()
        await waitFor(() => expect(onAuthStateChangeCallback).not.toBeNull())
        await waitFor(() => expect(profileQuery).toHaveBeenCalledTimes(1))

        act(() => { onAuthStateChangeCallback!('INITIAL_SESSION', SESSION) })
        await act(async () => { await new Promise((r) => setTimeout(r, 10)) })

        expect(profileQuery).toHaveBeenCalledTimes(1)
        await act(async () => { resolve({ data: { ...PROFILE }, error: null }) })
        await waitFor(() => expect(latest!.profile?.id).toBe('user-1'))
    })

    it('drops a load that resolves after sign-out', async () => {
        await loaded()
        let resolve: (v: unknown) => void = () => {}
        profileQuery.mockImplementation(() => new Promise((r) => { resolve = r }))
        const before = profileQuery.mock.calls.length

        act(() => { onAuthStateChangeCallback!('TOKEN_REFRESHED', SESSION) })
        await waitFor(() => expect(profileQuery.mock.calls.length).toBeGreaterThan(before))
        act(() => { onAuthStateChangeCallback!('SIGNED_OUT', null) })
        await act(async () => { resolve({ data: { ...PROFILE }, error: null }) })
        await act(async () => { await new Promise((r) => setTimeout(r, 10)) })

        expect(latest!.user).toBeNull()
        expect(latest!.profile).toBeNull()
        expect(latest!.profileError).toBe(false)
    })

    it('never shows the previous user\'s profile to the next user', async () => {
        await loaded()
        let resolveA: (v: unknown) => void = () => {}
        profileQuery.mockImplementationOnce(() => new Promise((r) => { resolveA = r }))
        const before = profileQuery.mock.calls.length

        act(() => { onAuthStateChangeCallback!('TOKEN_REFRESHED', SESSION) })
        await waitFor(() => expect(profileQuery.mock.calls.length).toBeGreaterThan(before))

        const B = { user: { id: 'user-2' } }
        profileQuery.mockImplementation(async () => ({ data: { ...PROFILE, id: 'user-2', role: 'Manager' }, error: null }))
        act(() => { onAuthStateChangeCallback!('SIGNED_OUT', null) })
        act(() => { onAuthStateChangeCallback!('SIGNED_IN', B) })
        await waitFor(() => expect(latest!.profile?.id).toBe('user-2'))

        await act(async () => { resolveA({ data: { ...PROFILE }, error: null }) })
        await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
        expect(latest!.profile?.id).toBe('user-2')
    })

    it('still clears the profile on sign-out', async () => {
        await loaded()
        act(() => { onAuthStateChangeCallback!('SIGNED_OUT', null) })
        await waitFor(() => expect(latest!.profile).toBeNull())
        expect(latest!.user).toBeNull()
    })
})

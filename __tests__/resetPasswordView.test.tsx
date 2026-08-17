import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'

/**
 * The invariant under test: a recovery or invite session must never survive
 * this screen as an ordinary login.
 *
 * `verifyOtp` hands back a real session, `lib/supabase.ts` persists it to
 * localStorage, and this screen strips the token out of the URL the instant
 * that happens. Between then and the user typing a password the URL is a bare
 * `/` — so a refresh used to render the whole app for someone who had never
 * chosen a password. On the invite flow that account has no password at all.
 *
 * Nothing covered `Root` or this component before, which is why 2000+ passing
 * tests missed it.
 */

const verifyOtp = vi.fn()
const setSession = vi.fn()
const getSession = vi.fn()
const updateUser = vi.fn()
const signOut = vi.fn()

vi.mock('@/lib/supabase', () => ({
    supabase: {
        auth: { verifyOtp, setSession, getSession, updateUser, signOut },
    },
}))

const { default: ResetPasswordView } = await import('@/components/auth/ResetPasswordView')
const {
    PASSWORD_SET_WINDOW_MS,
    readPendingPasswordSet,
    writePendingPasswordSet,
    clearPendingPasswordSet,
} = await import('@/lib/auth/pendingPasswordSet')

const USER_ID = 'user-1'
const sessionFor = (id: string) => ({ user: { id } })

function goTo(url: string): void {
    window.history.replaceState(null, '', url)
}

/** Records the marker as it stood at each history rewrite, then calls through. */
function watchUrlStrip(): { markerAtStrip: unknown[] } {
    const seen: unknown[] = []
    const real = window.history.replaceState.bind(window.history)
    vi.spyOn(window.history, 'replaceState').mockImplementation((...args) => {
        seen.push(readPendingPasswordSet())
        return real(...(args as Parameters<typeof real>))
    })
    return { markerAtStrip: seen }
}

beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    goTo('/')
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    signOut.mockResolvedValue({ error: null })
    updateUser.mockResolvedValue({ data: {}, error: null })
    verifyOtp.mockResolvedValue({
        data: { session: sessionFor(USER_ID), user: { id: USER_ID } },
        error: null,
    })
    setSession.mockResolvedValue({
        data: { session: sessionFor(USER_ID), user: { id: USER_ID } },
        error: null,
    })
})

afterEach(() => {
    // `globals` is off in vitest.config.ts, so testing-library's automatic
    // cleanup never registers — without this every render stacks up in the
    // document and `screen` queries find several copies.
    cleanup()
    vi.restoreAllMocks()
})

const readyLead = 'Choose a new password to finish resetting your account.'

describe('a fresh link', () => {
    it('exchanges the token, marks the flow, and only then strips the URL', async () => {
        goTo('/?token_hash=tok-abc&type=recovery')
        const { markerAtStrip } = watchUrlStrip()

        render(<ResetPasswordView onComplete={vi.fn()} />)

        await screen.findByText(readyLead)

        expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'tok-abc', type: 'recovery' })
        expect(readPendingPasswordSet()).toMatchObject({ userId: USER_ID, flow: 'recovery' })

        // The ordering IS the fix. If the URL is cleared first there is a
        // window in which nothing anywhere records the flow.
        expect(markerAtStrip).toHaveLength(1)
        expect(markerAtStrip[0]).toMatchObject({ userId: USER_ID })
        expect(window.location.search).toBe('')
    })

    it('carries the invite flow onto the marker', async () => {
        goTo('/?token_hash=tok-abc&type=invite')
        render(<ResetPasswordView onComplete={vi.fn()} />)

        await screen.findByText('Choose a password to activate your account and sign in.')
        expect(readPendingPasswordSet()).toMatchObject({ flow: 'invite' })
    })

    it('handles the hash shape via setSession', async () => {
        goTo('/#access_token=at&refresh_token=rt&type=recovery')
        render(<ResetPasswordView onComplete={vi.fn()} />)

        await screen.findByText(readyLead)
        expect(setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' })
        expect(readPendingPasswordSet()).toMatchObject({ userId: USER_ID })
    })

    it('writes no marker and leaves the URL alone when the token is refused', async () => {
        goTo('/?token_hash=spent&type=recovery')
        verifyOtp.mockResolvedValue({ data: {}, error: new Error('Token has expired') })

        render(<ResetPasswordView onComplete={vi.fn()} />)

        await screen.findByText('Token has expired')
        expect(readPendingPasswordSet()).toBeNull()
        // A pre-existing session in this browser belongs to whoever was signed
        // in, and a failed link is no reason to end it.
        expect(signOut).not.toHaveBeenCalled()
    })
})

describe('resuming after the URL has been stripped', () => {
    // The reported bug: refresh the set-password screen and you landed in the
    // app. This is also the tab-restore path and StrictMode's second mount.
    it('returns to the password form without re-spending the token', async () => {
        writePendingPasswordSet({ userId: USER_ID, flow: 'recovery', issuedAt: Date.now() })
        getSession.mockResolvedValue({ data: { session: sessionFor(USER_ID) }, error: null })

        render(<ResetPasswordView onComplete={vi.fn()} />)

        await screen.findByText(readyLead)
        expect(verifyOtp).not.toHaveBeenCalled()
        expect(setSession).not.toHaveBeenCalled()
        expect(signOut).not.toHaveBeenCalled()
    })

    it('remembers it was an invitation', async () => {
        writePendingPasswordSet({ userId: USER_ID, flow: 'invite', issuedAt: Date.now() })
        getSession.mockResolvedValue({ data: { session: sessionFor(USER_ID) }, error: null })

        render(<ResetPasswordView onComplete={vi.fn()} />)
        await screen.findByText('Choose a password to activate your account and sign in.')
    })

    it('signs out and refuses once the one-hour window has passed', async () => {
        writePendingPasswordSet({
            userId: USER_ID,
            flow: 'recovery',
            issuedAt: Date.now() - PASSWORD_SET_WINDOW_MS - 1,
        })
        getSession.mockResolvedValue({ data: { session: sessionFor(USER_ID) }, error: null })

        render(<ResetPasswordView onComplete={vi.fn()} />)

        await screen.findByText(/has expired/i)
        expect(signOut).toHaveBeenCalled()
        expect(readPendingPasswordSet()).toBeNull()
    })

    it('signs out when the live session belongs to a different user', async () => {
        writePendingPasswordSet({ userId: USER_ID, flow: 'recovery', issuedAt: Date.now() })
        getSession.mockResolvedValue({ data: { session: sessionFor('somebody-else') }, error: null })

        render(<ResetPasswordView onComplete={vi.fn()} />)

        await screen.findByText('Link no longer valid')
        expect(signOut).toHaveBeenCalled()
        expect(readPendingPasswordSet()).toBeNull()
    })

    it('clears a marker whose session is already gone', async () => {
        writePendingPasswordSet({ userId: USER_ID, flow: 'recovery', issuedAt: Date.now() })
        getSession.mockResolvedValue({ data: { session: null }, error: null })

        render(<ResetPasswordView onComplete={vi.fn()} />)

        await screen.findByText('Link no longer valid')
        expect(readPendingPasswordSet()).toBeNull()
    })

    it('shows the dead end when there is neither a link nor a marker', async () => {
        render(<ResetPasswordView onComplete={vi.fn()} />)
        await screen.findByText('Link no longer valid')
        expect(signOut).not.toHaveBeenCalled()
    })
})

describe('setting the password', () => {
    const fillAndSubmit = async (container: HTMLElement) => {
        await screen.findByText(readyLead)
        fireEvent.change(container.querySelector('#new-password')!, {
            target: { value: 'hunter2hunter2' },
        })
        fireEvent.change(container.querySelector('#confirm-password')!, {
            target: { value: 'hunter2hunter2' },
        })
        fireEvent.click(screen.getByText('Update password'))
    }

    it('clears the marker and signs out', async () => {
        goTo('/?token_hash=tok-abc&type=recovery')
        const { container } = render(<ResetPasswordView onComplete={vi.fn()} />)

        await fillAndSubmit(container)

        await screen.findByText('Password updated')
        expect(updateUser).toHaveBeenCalledWith({ password: 'hunter2hunter2' })
        expect(readPendingPasswordSet()).toBeNull()
        expect(signOut).toHaveBeenCalled()
    })

    it('keeps the marker when the update fails, so a refresh still resumes', async () => {
        goTo('/?token_hash=tok-abc&type=recovery')
        updateUser.mockResolvedValue({ data: {}, error: new Error('Password is too weak') })
        const { container } = render(<ResetPasswordView onComplete={vi.fn()} />)

        await fillAndSubmit(container)

        await screen.findByText('Password is too weak')
        expect(readPendingPasswordSet()).not.toBeNull()
        expect(signOut).not.toHaveBeenCalled()
    })
})

describe('leaving without setting a password', () => {
    // Every one of these used to hand the caller straight to the app tree on a
    // live, passwordless session — the same bug through a different door.
    const withErrorLinkAndMarker = () => {
        goTo('/?error=access_denied&error_description=Email+link+is+invalid')
        writePendingPasswordSet({ userId: USER_ID, flow: 'recovery', issuedAt: Date.now() })
    }

    it('signs out before "Back to sign in"', async () => {
        withErrorLinkAndMarker()
        const onComplete = vi.fn()
        render(<ResetPasswordView onComplete={onComplete} />)

        fireEvent.click(await screen.findByText('Back to sign in'))

        await waitFor(() => expect(onComplete).toHaveBeenCalled())
        expect(signOut).toHaveBeenCalled()
        expect(readPendingPasswordSet()).toBeNull()
    })

    it('signs out before "Request a new link"', async () => {
        withErrorLinkAndMarker()
        const onComplete = vi.fn()
        render(<ResetPasswordView onComplete={onComplete} />)

        fireEvent.click(await screen.findByText('Request a new link'))

        await waitFor(() => expect(onComplete).toHaveBeenCalled())
        expect(signOut).toHaveBeenCalled()
        expect(window.location.search).toBe('?reset=1')
    })

    it('leaves an unrelated pre-existing session alone', async () => {
        // A dead link opened in a browser already signed in as somebody else.
        // No marker means the session is not ours to end.
        goTo('/?error=access_denied&error_description=Email+link+is+invalid')
        clearPendingPasswordSet()
        const onComplete = vi.fn()
        render(<ResetPasswordView onComplete={onComplete} />)

        fireEvent.click(await screen.findByText('Back to sign in'))

        await waitFor(() => expect(onComplete).toHaveBeenCalled())
        expect(signOut).not.toHaveBeenCalled()
    })

    it('refuses to hand over when the sign-out did not take', async () => {
        withErrorLinkAndMarker()
        // signOut resolves, but the session is still there afterwards. Clearing
        // the marker here would re-open the hole, so we must not move on.
        getSession.mockResolvedValue({ data: { session: sessionFor(USER_ID) }, error: null })
        const onComplete = vi.fn()
        render(<ResetPasswordView onComplete={onComplete} />)

        fireEvent.click(await screen.findByText('Back to sign in'))

        await screen.findByText(/Could not sign out/i)
        expect(onComplete).not.toHaveBeenCalled()
        expect(readPendingPasswordSet()).not.toBeNull()
    })
})

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { AuthLinkFlow } from '@/lib/auth/recoveryLink'
import { DEFAULT_RECOVERY_ERROR, RESET_REQUEST_PARAM, parseAuthLink } from '@/lib/auth/recoveryLink'
import {
    PASSWORD_SET_WINDOW_LABEL,
    clearPendingPasswordSet,
    isExpired,
    readPendingPasswordSet,
    writePendingPasswordSet,
} from '@/lib/auth/pendingPasswordSet'
import { AuthAlert, AuthEyebrow, AuthField, AuthSubmit, authStagger } from './authChrome'

// The same screen serves a forgotten password and a fresh invitation. Only the
// words differ, and they matter: an invitee has never had a password, so
// "reset" would be a lie and "finish resetting your account" reads as an error.
const COPY: Record<AuthLinkFlow, {
    eyebrow: string
    heading: string
    successHeading: string
    verifying: string
    lead: string
    success: string
}> = {
    recovery: {
        eyebrow: 'Reset password',
        heading: 'Set a new password',
        successHeading: 'Password updated',
        verifying: 'Verifying recovery link…',
        lead: 'Choose a new password to finish resetting your account.',
        success: 'Password updated. Please sign in with your new password.',
    },
    invite: {
        eyebrow: 'Welcome to Nex Order',
        heading: 'Set your password',
        successHeading: 'Account activated',
        verifying: 'Verifying your invitation…',
        lead: 'Choose a password to activate your account and sign in.',
        success: 'Account activated. Please sign in with your new password.',
    },
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    return 'Could not reset password. Please request a new recovery link.'
}

// Shown when a flow was started but abandoned for longer than the link itself
// would have lived. Says the window out loud so "but I opened it this morning"
// has an answer.
const EXPIRED_MESSAGE =
    `This password setup was started more than ${PASSWORD_SET_WINDOW_LABEL} ago and has expired. ` +
    'Request a new link from the sign-in page.'

// The half-finished session could not be ended, so we must not hand the user to
// the app — that is precisely the hole this screen exists to close.
const RELEASE_FAILED_MESSAGE =
    'Could not sign out of the unfinished password setup. Check your connection and try again.'

interface ResetPasswordViewProps {
    onComplete: () => void
}

export default function ResetPasswordView({ onComplete }: ResetPasswordViewProps) {
    const [phase, setPhase] = useState<'verifying' | 'ready' | 'invalid' | 'updating' | 'success'>('verifying')
    const [error, setError] = useState<string | null>(null)
    const [password, setPassword] = useState('')
    const [confirm, setConfirm] = useState('')
    // Defaults to 'recovery' so a dead link — which carries no type= — keeps the
    // wording it has always had rather than greeting a stranger.
    const [flow, setFlow] = useState<AuthLinkFlow>('recovery')

    useEffect(() => {
        const link = parseAuthLink(window.location.hash, window.location.search)
        const marker = readPendingPasswordSet()

        // Supabase already told us why the link failed (expired, already used,
        // wrong project). Show its reason rather than dropping the user on a
        // bare login page, which is what happened before this branch existed.
        // Checked before `none` because a failed link carries no token either.
        if (link.kind === 'error') {
            setError(link.description)
            setPhase('invalid')
            return
        }

        let cancelled = false

        // RESUME. No token on the URL, but a marker says a flow is in progress.
        // Three ways here, all the same situation: the user refreshed, the tab
        // was discarded and restored, or StrictMode mounted us twice. The token
        // was consumed on the first pass, so re-calling verifyOtp would be
        // refused and would show "invalid" over a perfectly live session — which
        // is the dev-only flash this branch also fixes.
        if (link.kind === 'none') {
            if (marker === null) {
                setPhase('invalid')
                return
            }

            setFlow(marker.flow)
            ;(async () => {
                const stale = isExpired(marker, Date.now())
                const { data } = await supabase.auth.getSession()
                const sessionUserId = data.session?.user?.id ?? null

                if (!stale && sessionUserId !== null && sessionUserId === marker.userId) {
                    if (!cancelled) setPhase('ready')
                    return
                }

                // Expired, signed out underneath us, or a different user
                // altogether. Either way the session must not go on to serve as
                // an ordinary login, so end it before showing the dead end.
                await supabase.auth.signOut()
                clearPendingPasswordSet()
                if (!cancelled) {
                    setError(stale ? EXPIRED_MESSAGE : DEFAULT_RECOVERY_ERROR)
                    setPhase('invalid')
                }
            })()

            return () => {
                cancelled = true
            }
        }

        setFlow(link.flow)
        ;(async () => {
            try {
                let userId: string | null = null

                if (link.kind === 'tokens') {
                    const { data, error: sessionError } = await supabase.auth.setSession({
                        access_token: link.accessToken,
                        refresh_token: link.refreshToken,
                    })
                    if (sessionError) throw sessionError
                    userId = data.session?.user?.id ?? data.user?.id ?? null
                } else {
                    // verifyOtp needs no PKCE verifier, which is why the project's
                    // templates use it. `type` must match the token that was
                    // issued — sending 'recovery' for an invite token is refused
                    // server-side.
                    const { data, error: verifyError } = await supabase.auth.verifyOtp({
                        token_hash: link.tokenHash,
                        type: link.flow,
                    })
                    if (verifyError) throw verifyError
                    userId = data.session?.user?.id ?? data.user?.id ?? null
                }

                // A session we cannot identify is a session we cannot guard, and
                // it is already persisted by now. Refuse rather than carry on
                // with the URL as the only record of the flow.
                if (userId === null) {
                    await supabase.auth.signOut()
                    throw new Error(
                        'The link was accepted but no account came back with it. Please request a new one.',
                    )
                }

                // Record the flow BEFORE the URL stops being a record of it.
                // This ordering is the entire fix: between replaceState and the
                // user typing a password there is otherwise nothing anywhere
                // that says this session has not chosen one.
                writePendingPasswordSet({ userId, flow: link.flow, issuedAt: Date.now() })

                // Strip the credentials from the URL before the user can refresh
                // or share it. One shape carries them in the hash, the other in
                // the query string, so drop both.
                window.history.replaceState(null, '', window.location.pathname)

                if (!cancelled) setPhase('ready')
            } catch (err) {
                if (!cancelled) {
                    setError(getErrorMessage(err))
                    setPhase('invalid')
                }
            }
        })()

        return () => {
            cancelled = true
        }
    }, [])

    /**
     * Leaving this screen without having set a password. `onComplete` renders
     * the normal app tree, so any session still lying around becomes an
     * ordinary login — the bug in a different door.
     *
     * Only a session WE established is ours to end: a dead link opened in a
     * browser already signed in as somebody else has no marker, and that person
     * is left exactly where they were.
     *
     * Confirms rather than assumes. Clearing the marker while the session
     * survives would re-open the hole, so a sign-out that did not take leaves
     * the marker in place and the user on this screen.
     */
    const releaseRecoverySession = async (): Promise<boolean> => {
        if (readPendingPasswordSet() === null) return true

        await supabase.auth.signOut()
        const { data } = await supabase.auth.getSession()
        if (data.session !== null) return false

        clearPendingPasswordSet()
        return true
    }

    // A dead recovery link is the one moment the user definitely wants a fresh
    // one, but the request dialog lives on LoginPage. Leave a marker in the URL
    // and let LoginPage open it on arrival, rather than plumbing a callback up
    // through Root → AuthGate.
    const handleRequestNewLink = async () => {
        if (!(await releaseRecoverySession())) {
            setError(RELEASE_FAILED_MESSAGE)
            return
        }
        window.history.replaceState(null, '', `${window.location.pathname}?${RESET_REQUEST_PARAM}=1`)
        onComplete()
    }

    const handleBackToSignIn = async () => {
        if (!(await releaseRecoverySession())) {
            setError(RELEASE_FAILED_MESSAGE)
            return
        }
        onComplete()
    }

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setError(null)

        if (password.length < 8) {
            setError('Password must be at least 8 characters.')
            return
        }
        if (password !== confirm) {
            setError('Passwords do not match.')
            return
        }

        setPhase('updating')
        try {
            const { error: updateError } = await supabase.auth.updateUser({ password })
            if (updateError) throw updateError
            // The marker has done its job. Clear it before the sign-out so a
            // reload racing that round trip cannot land back on this screen.
            clearPendingPasswordSet()
            // Global scope on purpose: changing a password should end that
            // user's sessions everywhere, not just this tab.
            await supabase.auth.signOut()
            setPhase('success')
        } catch (err) {
            setError(getErrorMessage(err))
            setPhase('ready')
        }
    }

    return (
        <div className="min-h-[100dvh] bg-stone-50 flex items-center justify-center p-6">
            <div
                className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-elevated sm:p-8 auth-in"
                style={authStagger(0)}
            >
                {/* Branded the same way as the AuthGate splash and the login rail —
                    navy tile, mono mark inverted to white. This screen is reached
                    from an emailed link with no other context, so it has to say
                    whose app it is before it asks for a password. */}
                <div className="mb-6">
                    <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-nexgen-navy auth-rail-wash p-2.5">
                        <img
                            src="/assets/Nex-Order-no-bg-logo.png"
                            alt="Nex Order"
                            className="h-full w-auto object-contain"
                            style={{ filter: 'brightness(0) invert(1)' }}
                        />
                    </div>
                    <AuthEyebrow className="mb-3 text-stone-500">{COPY[flow].eyebrow}</AuthEyebrow>
                    <h1 className="font-display text-3xl leading-none tracking-tighter text-stone-900">
                        {phase === 'success' && COPY[flow].successHeading}
                        {phase === 'invalid' && 'Link no longer valid'}
                        {phase !== 'success' && phase !== 'invalid' && COPY[flow].heading}
                    </h1>
                </div>

                {phase === 'verifying' && (
                    <div className="flex items-center gap-3 text-sm text-stone-600">
                        <span className="inline-block h-4 w-4 rounded-full border-2 border-stone-200 border-t-nexgen-blue animate-spin" />
                        {COPY[flow].verifying}
                    </div>
                )}

                {phase === 'invalid' && (
                    <div className="space-y-4">
                        <AuthAlert tone="error">{error ?? DEFAULT_RECOVERY_ERROR}</AuthAlert>
                        <AuthSubmit type="button" onClick={handleRequestNewLink}>
                            Request a new link
                        </AuthSubmit>
                        <button
                            type="button"
                            onClick={handleBackToSignIn}
                            className="w-full text-center text-sm text-stone-500 underline-offset-4 hover:text-stone-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue focus-visible:ring-offset-2 rounded"
                        >
                            Back to sign in
                        </button>
                    </div>
                )}

                {(phase === 'ready' || phase === 'updating') && (
                    <form onSubmit={handleSubmit} noValidate className="space-y-4">
                        <p className="text-sm leading-relaxed text-stone-600">
                            {COPY[flow].lead}
                        </p>

                        {error !== null && <AuthAlert tone="error">{error}</AuthAlert>}

                        <AuthField
                            id="new-password"
                            label="New password"
                            type="password"
                            autoComplete="new-password"
                            required
                            minLength={8}
                            autoFocus
                            value={password}
                            onChange={setPassword}
                            placeholder="At least 8 characters"
                            disabled={phase === 'updating'}
                        />

                        <AuthField
                            id="confirm-password"
                            label="Confirm new password"
                            type="password"
                            autoComplete="new-password"
                            required
                            minLength={8}
                            value={confirm}
                            onChange={setConfirm}
                            placeholder="Repeat the new password"
                            disabled={phase === 'updating'}
                        />

                        <div className="pt-2">
                            <AuthSubmit
                                disabled={phase === 'updating' || password === '' || confirm === ''}
                            >
                                {phase === 'updating' ? 'Updating…' : 'Update password'}
                            </AuthSubmit>
                        </div>
                    </form>
                )}

                {phase === 'success' && (
                    <div className="space-y-4">
                        <AuthAlert tone="success">{COPY[flow].success}</AuthAlert>
                        <AuthSubmit type="button" onClick={onComplete}>
                            Continue to sign in
                        </AuthSubmit>
                    </div>
                )}
            </div>
        </div>
    )
}

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { AuthLinkFlow } from '@/lib/auth/recoveryLink'
import { DEFAULT_RECOVERY_ERROR, RESET_REQUEST_PARAM, parseAuthLink } from '@/lib/auth/recoveryLink'
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

        if (link.kind === 'none') {
            setPhase('invalid')
            return
        }

        // Supabase already told us why the link failed (expired, already used,
        // wrong project). Show its reason rather than dropping the user on a
        // bare login page, which is what happened before this branch existed.
        if (link.kind === 'error') {
            setError(link.description)
            setPhase('invalid')
            return
        }

        setFlow(link.flow)

        let cancelled = false
        ;(async () => {
            try {
                if (link.kind === 'tokens') {
                    const { error: sessionError } = await supabase.auth.setSession({
                        access_token: link.accessToken,
                        refresh_token: link.refreshToken,
                    })
                    if (sessionError) throw sessionError
                } else if (link.kind === 'token_hash') {
                    // verifyOtp needs no PKCE verifier, so it works even though
                    // the client runs with persistSession:false and no storage.
                    // `type` must match the token that was issued — sending
                    // 'recovery' for an invite token is refused server-side.
                    const { error: verifyError } = await supabase.auth.verifyOtp({
                        token_hash: link.tokenHash,
                        type: link.flow,
                    })
                    if (verifyError) throw verifyError
                }

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

    // A dead recovery link is the one moment the user definitely wants a fresh
    // one, but the request dialog lives on LoginPage. Leave a marker in the URL
    // and let LoginPage open it on arrival, rather than plumbing a callback up
    // through Root → AuthGate.
    const handleRequestNewLink = () => {
        window.history.replaceState(null, '', `${window.location.pathname}?${RESET_REQUEST_PARAM}=1`)
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
                            onClick={onComplete}
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

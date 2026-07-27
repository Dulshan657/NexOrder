import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AuthAlert, AuthEyebrow, AuthField, AuthSubmit, authStagger } from './authChrome'

interface RecoveryTokens {
    access_token: string
    refresh_token: string
}

/**
 * Parse the recovery URL hash. Supabase emits links of the form
 *   https://app.example.com/#access_token=…&refresh_token=…&type=recovery
 * (Older email templates may use a `?token_hash=…&type=recovery` query
 * string, but this project uses the default template.)
 */
function parseRecoveryHash(hash: string): RecoveryTokens | null {
    const trimmed = hash.startsWith('#') ? hash.slice(1) : hash
    const params = new URLSearchParams(trimmed)
    if (params.get('type') !== 'recovery') return null
    const access_token = params.get('access_token')
    const refresh_token = params.get('refresh_token')
    if (!access_token || !refresh_token) return null
    return { access_token, refresh_token }
}

export function isRecoveryUrl(): boolean {
    if (typeof window === 'undefined') return false
    return parseRecoveryHash(window.location.hash) !== null
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

    useEffect(() => {
        const tokens = parseRecoveryHash(window.location.hash)
        if (!tokens) {
            setPhase('invalid')
            return
        }

        let cancelled = false
        ;(async () => {
            try {
                const { error: sessionError } = await supabase.auth.setSession({
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                })
                if (sessionError) throw sessionError

                // Strip the hash from the URL before the user can refresh.
                window.history.replaceState(null, '', window.location.pathname + window.location.search)

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
                <div className="mb-6">
                    <AuthEyebrow className="mb-3 text-stone-500">Reset password</AuthEyebrow>
                    <h1 className="font-display text-3xl leading-none tracking-tighter text-stone-900">
                        {phase === 'success' ? 'Password updated' : 'Set a new password'}
                    </h1>
                </div>

                {phase === 'verifying' && (
                    <div className="flex items-center gap-3 text-sm text-stone-600">
                        <span className="inline-block h-4 w-4 rounded-full border-2 border-stone-200 border-t-nexgen-blue animate-spin" />
                        Verifying recovery link…
                    </div>
                )}

                {phase === 'invalid' && (
                    <div className="space-y-4">
                        <AuthAlert tone="error">
                            {error ?? 'This recovery link is invalid or has expired. Request a new one from the sign-in page.'}
                        </AuthAlert>
                        <AuthSubmit type="button" onClick={onComplete}>
                            Back to sign in
                        </AuthSubmit>
                    </div>
                )}

                {(phase === 'ready' || phase === 'updating') && (
                    <form onSubmit={handleSubmit} noValidate className="space-y-4">
                        <p className="text-sm leading-relaxed text-stone-600">
                            Choose a new password to finish resetting your account.
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
                        <AuthAlert tone="success">
                            Password updated. Please sign in with your new password.
                        </AuthAlert>
                        <AuthSubmit type="button" onClick={onComplete}>
                            Continue to sign in
                        </AuthSubmit>
                    </div>
                )}
            </div>
        </div>
    )
}

import React, { useEffect, useState } from 'react'
import { ArrowRight, Check, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'

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
            <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 sm:p-8">
                <div className="mb-6">
                    <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.24em] text-stone-500">
                        Reset password
                    </p>
                    <h1 className="font-display text-3xl tracking-tight text-stone-900">
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
                        <div className="flex items-start gap-3 rounded-lg bg-rose-50 border border-rose-200 px-4 py-3">
                            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-rose-600" />
                            <p className="text-sm text-rose-900 leading-relaxed">
                                {error ?? 'This recovery link is invalid or has expired. Request a new one from the sign-in page.'}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onComplete}
                            className="w-full px-5 py-3 rounded-lg bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 btn-press transition-colors"
                        >
                            Back to sign in
                        </button>
                    </div>
                )}

                {(phase === 'ready' || phase === 'updating') && (
                    <form onSubmit={handleSubmit} noValidate className="space-y-4">
                        <p className="text-sm text-stone-600 leading-relaxed">
                            Choose a new password to finish resetting your account.
                        </p>

                        {error !== null && (
                            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
                                <p className="text-sm text-rose-800 leading-relaxed">{error}</p>
                            </div>
                        )}

                        <div className="grid gap-2">
                            <label htmlFor="new-password" className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-600">
                                New password
                            </label>
                            <input
                                id="new-password"
                                type="password"
                                autoComplete="new-password"
                                required
                                minLength={8}
                                autoFocus
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="At least 8 characters"
                                disabled={phase === 'updating'}
                                className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 placeholder-stone-400 focus:border-nexgen-blue focus:outline-none focus:ring-2 focus:ring-nexgen-blue/15 disabled:bg-stone-100 disabled:text-stone-400 transition-colors"
                            />
                        </div>

                        <div className="grid gap-2">
                            <label htmlFor="confirm-password" className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-600">
                                Confirm new password
                            </label>
                            <input
                                id="confirm-password"
                                type="password"
                                autoComplete="new-password"
                                required
                                minLength={8}
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                                placeholder="Repeat the new password"
                                disabled={phase === 'updating'}
                                className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 placeholder-stone-400 focus:border-nexgen-blue focus:outline-none focus:ring-2 focus:ring-nexgen-blue/15 disabled:bg-stone-100 disabled:text-stone-400 transition-colors"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={phase === 'updating' || password === '' || confirm === ''}
                            className="group inline-flex w-full items-center justify-between gap-3 rounded-lg bg-nexgen-blue px-5 py-3 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-nexgen-blue-dark active:translate-y-[1px] focus:outline-none focus:ring-2 focus:ring-nexgen-blue focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
                        >
                            <span>{phase === 'updating' ? 'Updating…' : 'Update password'}</span>
                            <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" strokeWidth={2} />
                        </button>
                    </form>
                )}

                {phase === 'success' && (
                    <div className="space-y-4">
                        <div className="flex items-start gap-3 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
                            <Check className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600" strokeWidth={2} />
                            <p className="text-sm text-emerald-900 leading-relaxed">
                                Password updated. Please sign in with your new password.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onComplete}
                            className="w-full px-5 py-3 rounded-lg bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 btn-press transition-colors"
                        >
                            Continue to sign in
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}

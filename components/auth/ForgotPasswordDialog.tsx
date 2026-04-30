import React, { useState } from 'react'
import { ArrowRight, X, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface ForgotPasswordDialogProps {
    open: boolean
    onClose: () => void
    initialEmail?: string
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    return 'An unexpected error occurred. Please try again.'
}

export default function ForgotPasswordDialog({
    open,
    onClose,
    initialEmail = '',
}: ForgotPasswordDialogProps) {
    const [email, setEmail] = useState(initialEmail)
    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isSent, setIsSent] = useState(false)

    React.useEffect(() => {
        if (open) {
            setEmail(initialEmail)
            setError(null)
            setIsSent(false)
        }
    }, [open, initialEmail])

    if (!open) return null

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setError(null)
        setIsSubmitting(true)

        try {
            const redirectTo = `${window.location.origin}/`
            const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo,
            })
            if (resetError) throw resetError
            setIsSent(true)
        } catch (err: unknown) {
            setError(getErrorMessage(err))
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="forgot-password-title"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 sm:p-8"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between mb-5">
                    <div>
                        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.24em] text-stone-500">
                            Reset password
                        </p>
                        <h2 id="forgot-password-title" className="font-display text-2xl tracking-tight text-stone-900">
                            {isSent ? 'Check your inbox' : 'Forgot your password?'}
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-stone-400 hover:text-stone-700 cursor-pointer p-1 -m-1"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {isSent ? (
                    <div className="space-y-4">
                        <div className="flex items-start gap-3 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
                            <Check className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600" strokeWidth={2} />
                            <p className="text-sm text-emerald-900 leading-relaxed">
                                We've sent a recovery link to <span className="font-mono font-semibold">{email}</span>.
                                Click the link in the email to set a new password.
                            </p>
                        </div>
                        <p className="text-xs text-stone-500 leading-relaxed">
                            The link is single-use and expires in 1 hour. Didn't get the email? Check your spam folder or
                            request a new link below.
                        </p>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setIsSent(false)}
                                className="flex-1 px-4 py-2.5 rounded-lg bg-white text-stone-700 border border-stone-200 hover:bg-stone-50 text-sm font-medium transition-colors btn-press"
                            >
                                Send again
                            </button>
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 px-4 py-2.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 text-sm font-medium transition-colors btn-press"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} noValidate className="space-y-4">
                        <p className="text-sm text-stone-600 leading-relaxed">
                            Enter the email associated with your account and we'll send you a link to set a new password.
                        </p>

                        {error !== null && (
                            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
                                <p className="text-sm text-rose-800 leading-relaxed">{error}</p>
                            </div>
                        )}

                        <div className="grid gap-2">
                            <label
                                htmlFor="reset-email"
                                className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-600"
                            >
                                Email address
                            </label>
                            <input
                                id="reset-email"
                                type="email"
                                autoComplete="email"
                                required
                                autoFocus
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@company.com"
                                disabled={isSubmitting}
                                className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 placeholder-stone-400 focus:border-nexgen-blue focus:outline-none focus:ring-2 focus:ring-nexgen-blue/15 disabled:bg-stone-100 disabled:text-stone-400 transition-colors"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting || email === ''}
                            className="group inline-flex w-full items-center justify-between gap-3 rounded-lg bg-nexgen-blue px-5 py-3 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-nexgen-blue-dark active:translate-y-[1px] focus:outline-none focus:ring-2 focus:ring-nexgen-blue focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
                        >
                            <span>{isSubmitting ? 'Sending…' : 'Send reset link'}</span>
                            <ArrowRight
                                className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5"
                                strokeWidth={2}
                            />
                        </button>
                    </form>
                )}
            </div>
        </div>
    )
}

import React, { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button, Modal } from '@/components/ui'
import { PASSWORD_SET_WINDOW_LABEL } from '@/lib/auth/pendingPasswordSet'
import { AuthAlert, AuthField } from './authChrome'

interface ForgotPasswordDialogProps {
    open: boolean
    onClose: () => void
    initialEmail?: string
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    return 'An unexpected error occurred. Please try again.'
}

/**
 * Migrated off a hand-rolled full-screen backdrop onto <Modal> (removing this
 * file's entry from components/overlay-baseline.json). The hand-rolled version had
 * no focus trap, no scroll lock and no Escape handler, and sat at a bare `z-50`
 * outside overlayStack.ts with a backdrop one step lighter than every other dialog.
 *
 * The panel becomes a <form> only while `onSubmit` is set, which matches this
 * dialog's two phases exactly: a form to request the link, then a receipt.
 */
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
        <Modal
            open={open}
            onClose={onClose}
            size="md"
            title={isSent ? 'Check your inbox' : 'Forgot your password?'}
            onSubmit={isSent ? undefined : handleSubmit}
            footer={({ requestClose }) =>
                isSent ? (
                    <>
                        <Button variant="secondary" onClick={() => setIsSent(false)}>
                            Send again
                        </Button>
                        <Button onClick={requestClose}>Done</Button>
                    </>
                ) : (
                    <>
                        <Button variant="secondary" onClick={requestClose}>
                            Cancel
                        </Button>
                        <Button type="submit" loading={isSubmitting} disabled={email === ''}>
                            {isSubmitting ? 'Sending…' : 'Send reset link'}
                        </Button>
                    </>
                )
            }
        >
            {isSent ? (
                <div className="space-y-4">
                    <AuthAlert tone="success">
                        We've sent a recovery link to{' '}
                        <span className="font-mono font-semibold">{email}</span>. Click the link in
                        the email to set a new password.
                    </AuthAlert>
                    {/* The window is Supabase's `mailer_otp_exp`. Read from the
                        one constant rather than restated here, so the prose
                        cannot drift from what the server actually enforces. */}
                    <p className="text-xs leading-relaxed text-stone-500">
                        The link is single-use and expires in {PASSWORD_SET_WINDOW_LABEL}. Didn't
                        get the email? Check your spam folder, or send it again.
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    <p className="text-sm leading-relaxed text-stone-600">
                        Enter the email associated with your account and we'll send you a link to
                        set a new password.
                    </p>

                    {error !== null && <AuthAlert tone="error">{error}</AuthAlert>}

                    <AuthField
                        id="reset-email"
                        label="Email address"
                        type="email"
                        autoComplete="email"
                        required
                        autoFocus
                        value={email}
                        onChange={setEmail}
                        placeholder="you@company.com"
                        disabled={isSubmitting}
                    />
                </div>
            )}
        </Modal>
    )
}

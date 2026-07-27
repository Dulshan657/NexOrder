/**
 * Parse the URL a Supabase password-recovery email lands on.
 *
 * This module is deliberately pure — no React, no Supabase client — so the
 * parsing can be tested without standing up either. `ResetPasswordView`
 * consumes the result and owns all the session work.
 *
 * Supabase can deliver four meaningfully different URLs, and until this module
 * existed the app understood exactly one of them. Everything else fell through
 * to a bare login page with no explanation, which is the single most confusing
 * thing a reset link can do.
 */

export type RecoveryLink =
    /** Implicit flow: `#access_token=…&refresh_token=…&type=recovery`. */
    | { kind: 'tokens'; accessToken: string; refreshToken: string }
    /** `?token_hash=…&type=recovery`, exchanged with verifyOtp. */
    | { kind: 'token_hash'; tokenHash: string }
    /** The link was expired, already used, or otherwise refused. */
    | { kind: 'error'; errorCode: string | null; description: string }
    /** Not a recovery URL at all. */
    | { kind: 'none' }

const DEFAULT_ERROR = 'This recovery link is invalid or has expired. Request a new one from the sign-in page.'

function toParams(fragment: string): URLSearchParams {
    const trimmed = fragment.startsWith('#') || fragment.startsWith('?') ? fragment.slice(1) : fragment
    return new URLSearchParams(trimmed)
}

/**
 * Supabase puts the failure in the hash when the redirect came back from
 * /auth/v1/verify, and in the query string on some other legs — so both are
 * checked. URLSearchParams already decodes `+` to a space, which is how the
 * description arrives ("Email+link+is+invalid+or+has+expired").
 */
function readError(params: URLSearchParams): RecoveryLink | null {
    const error = params.get('error')
    const errorCode = params.get('error_code')
    if (error === null && errorCode === null) return null
    const description = params.get('error_description')
    return {
        kind: 'error',
        errorCode,
        description: description !== null && description !== '' ? description : DEFAULT_ERROR,
    }
}

/**
 * @param hash   `window.location.hash` (with or without the leading '#')
 * @param search `window.location.search` (with or without the leading '?')
 *
 * Note on PKCE `?code=…` links: they are deliberately NOT claimed here. The
 * Supabase client runs with `persistSession: false` and no storage, so there is
 * nowhere for the code verifier to live and `exchangeCodeForSession` could not
 * succeed. `?code=` is also what the PO-Inbox OAuth popup uses. The project's
 * recovery template is the default `{{ .ConfirmationURL }}`, which never emits
 * one.
 */
export function parseRecoveryLink(hash: string, search: string): RecoveryLink {
    const hashParams = toParams(hash)
    const queryParams = toParams(search)

    const hashError = readError(hashParams)
    if (hashError !== null) return hashError
    const queryError = readError(queryParams)
    if (queryError !== null) return queryError

    if (hashParams.get('type') === 'recovery') {
        const accessToken = hashParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token')
        // Both are required: setSession cannot establish a session from one.
        if (accessToken !== null && refreshToken !== null) {
            return { kind: 'tokens', accessToken, refreshToken }
        }
    }

    if (queryParams.get('type') === 'recovery') {
        const tokenHash = queryParams.get('token_hash')
        if (tokenHash !== null && tokenHash !== '') {
            return { kind: 'token_hash', tokenHash }
        }
    }

    return { kind: 'none' }
}

/**
 * True when the current URL should route to the reset view rather than the
 * normal app tree — including failed links, so the reason can be shown.
 */
export function isRecoveryUrl(): boolean {
    if (typeof window === 'undefined') return false
    return parseRecoveryLink(window.location.hash, window.location.search).kind !== 'none'
}

/**
 * Query marker the dead-link screen leaves behind so LoginPage opens the
 * forgot-password dialog on arrival. Lives here so the two ends of that
 * handoff cannot drift apart.
 */
export const RESET_REQUEST_PARAM = 'reset'

export function wantsResetRequest(search: string): boolean {
    return toParams(search).get(RESET_REQUEST_PARAM) === '1'
}

export { DEFAULT_ERROR as DEFAULT_RECOVERY_ERROR }

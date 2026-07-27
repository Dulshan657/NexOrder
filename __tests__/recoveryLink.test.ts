import { describe, it, expect } from 'vitest'
import {
    DEFAULT_RECOVERY_ERROR,
    parseRecoveryLink,
    wantsResetRequest,
} from '@/lib/auth/recoveryLink'

// The URL shapes below are the ones Supabase actually emits. They are the
// contract this module exists to hold: before it, only the first case was
// understood and every other one silently dropped the user on a login page.

describe('parseRecoveryLink — implicit flow (the default template)', () => {
    it('reads access + refresh tokens from the hash', () => {
        const link = parseRecoveryLink('#access_token=abc&refresh_token=def&type=recovery', '')
        expect(link).toEqual({ kind: 'tokens', accessToken: 'abc', refreshToken: 'def' })
    })

    it('tolerates a hash with no leading #', () => {
        const link = parseRecoveryLink('access_token=abc&refresh_token=def&type=recovery', '')
        expect(link.kind).toBe('tokens')
    })

    it('rejects a hash missing the refresh token — setSession needs both', () => {
        const link = parseRecoveryLink('#access_token=abc&type=recovery', '')
        expect(link.kind).toBe('none')
    })

    it('ignores a non-recovery type, so signup/magiclink links fall through', () => {
        const link = parseRecoveryLink('#access_token=abc&refresh_token=def&type=signup', '')
        expect(link.kind).toBe('none')
    })
})

describe('parseRecoveryLink — token_hash flow', () => {
    it('reads token_hash from the query string', () => {
        const link = parseRecoveryLink('', '?token_hash=pkce_abc123&type=recovery')
        expect(link).toEqual({ kind: 'token_hash', tokenHash: 'pkce_abc123' })
    })

    it('requires type=recovery, so a bare token_hash is not claimed', () => {
        const link = parseRecoveryLink('', '?token_hash=pkce_abc123')
        expect(link.kind).toBe('none')
    })
})

describe('parseRecoveryLink — failed links', () => {
    const EXPIRED_HASH =
        '#error=access_denied&error_code=otp_expired' +
        '&error_description=Email+link+is+invalid+or+has+expired'

    it('surfaces the reason from a hash error, with + decoded to spaces', () => {
        const link = parseRecoveryLink(EXPIRED_HASH, '')
        expect(link).toEqual({
            kind: 'error',
            errorCode: 'otp_expired',
            description: 'Email link is invalid or has expired',
        })
    })

    it('surfaces the same error from the query string', () => {
        const link = parseRecoveryLink('', EXPIRED_HASH.replace('#', '?'))
        expect(link.kind).toBe('error')
    })

    it('falls back to house copy when no description is supplied', () => {
        const link = parseRecoveryLink('#error=access_denied', '')
        expect(link).toEqual({
            kind: 'error',
            errorCode: null,
            description: DEFAULT_RECOVERY_ERROR,
        })
    })

    it('reports an error_code with no error param', () => {
        const link = parseRecoveryLink('#error_code=otp_expired', '')
        expect(link.kind).toBe('error')
    })

    it('prefers the error over tokens when both somehow appear', () => {
        const link = parseRecoveryLink(`${EXPIRED_HASH}&access_token=a&refresh_token=b&type=recovery`, '')
        expect(link.kind).toBe('error')
    })
})

describe('parseRecoveryLink — everything else', () => {
    it('does not claim a PKCE ?code= link (no verifier storage, and the OAuth popup uses it)', () => {
        expect(parseRecoveryLink('', '?code=abc123').kind).toBe('none')
    })

    it('does not claim the OAuth popup completion params', () => {
        expect(parseRecoveryLink('', '?connected=1').kind).toBe('none')
        expect(parseRecoveryLink('', '?connect_error=denied').kind).toBe('none')
    })

    it('does not claim the reset-request marker it leaves behind', () => {
        expect(parseRecoveryLink('', '?reset=1').kind).toBe('none')
    })

    it.each([
        ['empty', '', ''],
        ['bare hash', '#', ''],
        ['bare query', '', '?'],
        ['unrelated params', '#foo=bar', '?wh=2'],
    ])('returns none for %s', (_label, hash, search) => {
        expect(parseRecoveryLink(hash, search).kind).toBe('none')
    })
})

describe('wantsResetRequest', () => {
    it('matches the marker ResetPasswordView writes', () => {
        expect(wantsResetRequest('?reset=1')).toBe(true)
        expect(wantsResetRequest('reset=1')).toBe(true)
    })

    it('ignores anything else', () => {
        expect(wantsResetRequest('')).toBe(false)
        expect(wantsResetRequest('?reset=0')).toBe(false)
        expect(wantsResetRequest('?resets=1')).toBe(false)
    })
})

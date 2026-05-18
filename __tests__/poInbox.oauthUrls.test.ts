import { describe, it, expect } from 'vitest'

import {
  buildAuthorizeUrl,
  buildCallbackUri,
  generatePkce,
  randomState,
} from '../supabase/functions/_shared/poInbox/oauthUrls'

describe('buildAuthorizeUrl — Gmail', () => {
  const base = {
    provider: 'gmail' as const,
    clientId: 'client-123.apps.googleusercontent.com',
    redirectUri: 'https://xxx.supabase.co/functions/v1/gmail-oauth-callback',
    state: 'state-abc',
  }

  it('targets the Google authorize endpoint', () => {
    expect(buildAuthorizeUrl(base)).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/)
  })

  it('requests gmail.readonly + userinfo.email scopes', () => {
    const u = new URL(buildAuthorizeUrl(base))
    const scope = u.searchParams.get('scope') ?? ''
    expect(scope).toContain('https://www.googleapis.com/auth/gmail.readonly')
    expect(scope).toContain('https://www.googleapis.com/auth/userinfo.email')
  })

  it('sets access_type=offline and prompt=consent so a refresh_token is always returned', () => {
    const u = new URL(buildAuthorizeUrl(base))
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('prompt')).toBe('consent')
  })

  it('carries the state token through verbatim', () => {
    const u = new URL(buildAuthorizeUrl(base))
    expect(u.searchParams.get('state')).toBe('state-abc')
  })

  it('attaches PKCE challenge when provided', () => {
    const u = new URL(buildAuthorizeUrl({ ...base, codeChallenge: 'challenge-xyz' }))
    expect(u.searchParams.get('code_challenge')).toBe('challenge-xyz')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
  })
})

describe('buildAuthorizeUrl — Outlook', () => {
  const base = {
    provider: 'outlook' as const,
    clientId: '11111111-2222-3333-4444-555555555555',
    redirectUri: 'https://xxx.supabase.co/functions/v1/outlook-oauth-callback',
    state: 'state-def',
  }

  it('targets the Microsoft common-tenant endpoint', () => {
    expect(buildAuthorizeUrl(base)).toMatch(/^https:\/\/login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/authorize\?/)
  })

  it('requests Mail.Read + offline_access', () => {
    const u = new URL(buildAuthorizeUrl(base))
    const scope = u.searchParams.get('scope') ?? ''
    expect(scope).toContain('https://graph.microsoft.com/Mail.Read')
    expect(scope).toContain('offline_access')
  })

  it('uses response_mode=query', () => {
    const u = new URL(buildAuthorizeUrl(base))
    expect(u.searchParams.get('response_mode')).toBe('query')
  })
})

describe('buildCallbackUri', () => {
  it('builds the gmail callback path', () => {
    expect(buildCallbackUri('https://xxx.supabase.co', 'gmail'))
      .toBe('https://xxx.supabase.co/functions/v1/gmail-oauth-callback')
  })

  it('builds the outlook callback path', () => {
    expect(buildCallbackUri('https://xxx.supabase.co', 'outlook'))
      .toBe('https://xxx.supabase.co/functions/v1/outlook-oauth-callback')
  })

  it('tolerates a trailing slash on the base URL', () => {
    expect(buildCallbackUri('https://xxx.supabase.co/', 'gmail'))
      .toBe('https://xxx.supabase.co/functions/v1/gmail-oauth-callback')
  })
})

describe('randomState', () => {
  it('is URL-safe base64 (no +/=)', () => {
    for (let i = 0; i < 50; i++) {
      const s = randomState()
      expect(s).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('has at least 32 bytes of entropy worth of characters', () => {
    // 32 bytes -> ceil(32 * 8 / 6) = 43 base64 chars (no padding).
    expect(randomState().length).toBeGreaterThanOrEqual(43)
  })

  it('is unique per call (collision-free in 100 draws)', () => {
    const draws = new Set<string>()
    for (let i = 0; i < 100; i++) draws.add(randomState())
    expect(draws.size).toBe(100)
  })
})

describe('generatePkce', () => {
  it('returns a verifier + challenge that hash correctly', async () => {
    const { verifier, challenge } = await generatePkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    // Re-derive the challenge from the verifier and compare.
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    )
    let bin = ''
    for (const b of digest) bin += String.fromCharCode(b)
    const expected = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    expect(challenge).toBe(expected)
  })
})

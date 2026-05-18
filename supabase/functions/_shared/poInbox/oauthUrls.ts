// Provider-specific OAuth URL builders. Pure functions — exported so the
// start-po-oauth Edge Function and any future re-auth helper share the
// same scope set and redirect contract.
//
// Scopes follow the principle of least privilege:
//   Gmail:    gmail.readonly  (no write, no send, no delete)
//   Outlook:  Mail.Read + offline_access  (no compose, no send)
//
// Refresh tokens require Google's offline access flag and Microsoft's
// offline_access scope respectively.

const GMAIL_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const OUTLOOK_AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
].join(' ')

// User.Read is required to call /me?$select=mail,userPrincipalName in the
// OAuth callback. Mail.Read alone does not authorize the /me endpoint.
// This grants read access to the signing user's own profile only —
// no access to other users in the directory, no access to write fields.
const OUTLOOK_SCOPES = [
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/User.Read',
  'offline_access',
].join(' ')

export type Provider = 'gmail' | 'outlook'

export interface BuildAuthorizeUrlInput {
  provider: Provider
  clientId: string
  redirectUri: string
  state: string
  /** PKCE code_challenge (S256). Required for Microsoft; optional for Google. */
  codeChallenge?: string
}

/**
 * Build the provider's authorize URL with all required parameters.
 * The caller is expected to have already inserted the state row into
 * oauth_pending_states; this function does no DB work.
 */
export function buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
  if (input.provider === 'gmail') {
    const params = new URLSearchParams({
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: GMAIL_SCOPES,
      state: input.state,
      access_type: 'offline',        // returns a refresh token
      prompt: 'consent',             // forces refresh-token return even after first grant
      include_granted_scopes: 'true',
    })
    if (input.codeChallenge) {
      params.set('code_challenge', input.codeChallenge)
      params.set('code_challenge_method', 'S256')
    }
    return `${GMAIL_AUTHORIZE_URL}?${params.toString()}`
  }

  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: OUTLOOK_SCOPES,
    state: input.state,
    response_mode: 'query',
    prompt: 'consent',
  })
  if (input.codeChallenge) {
    params.set('code_challenge', input.codeChallenge)
    params.set('code_challenge_method', 'S256')
  }
  return `${OUTLOOK_AUTHORIZE_URL}?${params.toString()}`
}

/**
 * Compute the redirect_uri the OAuth callback Edge Function lives at.
 * Built from SUPABASE_URL so the function isn't pinned to a specific
 * project ref.
 */
export function buildCallbackUri(supabaseUrl: string, provider: Provider): string {
  const base = supabaseUrl.replace(/\/+$/, '')
  const fn = provider === 'gmail' ? 'gmail-oauth-callback' : 'outlook-oauth-callback'
  return `${base}/functions/v1/${fn}`
}

/**
 * Cryptographically random URL-safe state token. 32 bytes of randomness
 * gives ~256 bits of entropy — well beyond brute-force.
 */
export function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return base64UrlEncode(bytes)
}

/**
 * Generate a PKCE verifier + challenge pair (S256). The verifier is
 * stored server-side in oauth_pending_states; the challenge goes to the
 * provider in the authorize URL.
 */
export async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(48))
  const verifier = base64UrlEncode(bytes)
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  )
  return { verifier, challenge: base64UrlEncode(digest) }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

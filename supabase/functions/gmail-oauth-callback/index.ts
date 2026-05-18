// gmail-oauth-callback Edge Function
//
// Receives Google's redirect after the user grants gmail.readonly +
// userinfo.email. Hands the heavy lifting off to runCallback in the
// shared module; only the Google-specific token exchange + email
// resolution lives here.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import {
  runCallback,
  type CallbackProviderHandlers,
  type TokenExchangeResult,
} from '../_shared/poInbox/callbackCommon.ts'
import { readEnv, sanitizeForLog } from '../_shared/poInbox/env.ts'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

async function exchangeGoogle(input: {
  code: string
  pkceVerifier: string | null
  redirectUri: string
}): Promise<TokenExchangeResult> {
  const clientId = readEnv('GMAIL_OAUTH_CLIENT_ID')
  const clientSecret = readEnv('GMAIL_OAUTH_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    throw new Error('GMAIL_OAUTH_CLIENT_ID/SECRET not configured')
  }

  const body = new URLSearchParams({
    code: input.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
  })
  if (input.pkceVerifier) body.set('code_verifier', input.pkceVerifier)

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  })
  const raw = await resp.text()
  if (!resp.ok) {
    throw new Error(`Google token endpoint ${resp.status}: ${sanitizeForLog(raw)}`)
  }
  let token: {
    access_token?: string
    refresh_token?: string
    id_token?: string
    scope?: string
  } = {}
  try {
    token = JSON.parse(raw)
  } catch {
    throw new Error('Google token endpoint returned non-JSON')
  }
  if (!token.refresh_token) {
    throw new Error('Google did not return a refresh_token (prompt=consent missing?)')
  }
  if (!token.access_token) {
    throw new Error('Google did not return an access_token')
  }

  // Resolve email via the OIDC userinfo endpoint. We could decode the
  // id_token's `email` claim, but a separate API call avoids JWT parsing
  // in the Edge Function and confirms the token actually works.
  const userResp = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!userResp.ok) {
    throw new Error(`userinfo ${userResp.status}: ${sanitizeForLog(await userResp.text())}`)
  }
  const userInfo = (await userResp.json()) as { email?: string }
  if (!userInfo.email) {
    throw new Error('Google userinfo did not return an email address')
  }

  return {
    refreshToken: token.refresh_token,
    email: userInfo.email,
  }
}

const handlers: CallbackProviderHandlers = {
  provider: 'gmail',
  exchange: exchangeGoogle,
}

serve(async (req: Request) => {
  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  return await runCallback(req, handlers)
})

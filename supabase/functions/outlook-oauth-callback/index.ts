// outlook-oauth-callback Edge Function
//
// Receives Microsoft's redirect after the user grants Mail.Read + offline_access.
// Microsoft rotates the refresh token on every exchange — runCallback
// stores whichever refresh_token comes back, which on first exchange is
// the long-lived one. Subsequent rotations happen inside poll-inbox
// and update email_accounts again.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import {
  runCallback,
  type CallbackProviderHandlers,
  type TokenExchangeResult,
} from '../_shared/poInbox/callbackCommon.ts'
import { readEnv, sanitizeForLog } from '../_shared/poInbox/env.ts'

const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName'

async function exchangeMicrosoft(input: {
  code: string
  pkceVerifier: string | null
  redirectUri: string
}): Promise<TokenExchangeResult> {
  const clientId = readEnv('OUTLOOK_OAUTH_CLIENT_ID')
  const clientSecret = readEnv('OUTLOOK_OAUTH_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    throw new Error('OUTLOOK_OAUTH_CLIENT_ID/SECRET not configured')
  }

  // Note: `scope` is intentionally omitted from the code-exchange body.
  // RFC 6749 §4.1.3 and Microsoft's docs say it's ignored — the scopes
  // are already bound to the authorization code via the authorize URL.
  // Keeping the body minimal avoids any future scope-expansion surprises.
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
    throw new Error(`Microsoft token endpoint ${resp.status}: ${sanitizeForLog(raw)}`)
  }
  let token: { access_token?: string; refresh_token?: string } = {}
  try {
    token = JSON.parse(raw)
  } catch {
    throw new Error('Microsoft token endpoint returned non-JSON')
  }
  if (!token.refresh_token) {
    throw new Error('Microsoft did not return a refresh_token (offline_access missing?)')
  }
  if (!token.access_token) {
    throw new Error('Microsoft did not return an access_token')
  }

  // Resolve email via Graph /me. Personal accounts use `mail`; corp
  // accounts often have `mail` null and the address lives on `userPrincipalName`.
  const meResp = await fetch(GRAPH_ME_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!meResp.ok) {
    throw new Error(`Graph /me ${meResp.status}: ${sanitizeForLog(await meResp.text())}`)
  }
  const me = (await meResp.json()) as {
    mail?: string | null
    userPrincipalName?: string | null
  }
  const email = me.mail ?? me.userPrincipalName ?? null
  if (!email) {
    throw new Error('Graph /me did not return a usable email address')
  }

  return {
    refreshToken: token.refresh_token,
    email,
  }
}

const handlers: CallbackProviderHandlers = {
  provider: 'outlook',
  exchange: exchangeMicrosoft,
}

serve(async (req: Request) => {
  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  return await runCallback(req, handlers)
})

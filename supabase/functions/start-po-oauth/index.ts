// start-po-oauth Edge Function
//
// Admin/Manager-only. Generates a CSRF state token, persists it (and a
// PKCE verifier) into oauth_pending_states, then returns the provider's
// authorize URL for the React UI to redirect the browser to. The matching
// {provider}-oauth-callback function consumes the state row on the
// inbound side of the redirect.
//
// Why a separate function instead of building the URL in React:
//   * The state row write needs service_role (oauth_pending_states has
//     no INSERT policy for authenticated users).
//   * Client secrets and PKCE verifiers must never reach the browser.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { corsHeadersFor } from '../_shared/cors.ts'
import { EdgeFunctionError, errorResponse } from '../_shared/errors.ts'
import { requireAuth } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import {
  buildAuthorizeUrl,
  buildCallbackUri,
  generatePkce,
  randomState,
  type Provider,
} from '../_shared/poInbox/oauthUrls.ts'
import { requireModule } from '../_shared/modules.ts'

interface StartOAuthRequest {
  provider: Provider
}

interface StartOAuthResponse {
  authorizeUrl: string
}

const STATE_TTL_MINUTES = 10

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') {
    return errorResponse('INVALID_INPUT', 'POST only', undefined, 405, req)
  }

  try {
    requireModule('sales_orders')
    const ctx = await requireAuth(req, { allowedRoles: ['Admin', 'Manager'] })

    const rl = await checkRateLimit(`start-po-oauth:${ctx.userId}`, {
      windowMs: 60_000,
      max: 10,
    })
    if (!rl.ok) {
      return errorResponse(
        'TOO_MANY_REQUESTS',
        'Slow down on connect attempts',
        undefined,
        429,
        req,
      )
    }

    let body: StartOAuthRequest
    try {
      body = await req.json()
    } catch {
      throw new EdgeFunctionError('INVALID_INPUT', 'Body must be JSON')
    }

    if (body.provider !== 'gmail' && body.provider !== 'outlook') {
      throw new EdgeFunctionError('INVALID_INPUT', 'provider must be gmail or outlook')
    }

    const clientIdEnv = body.provider === 'gmail'
      ? 'GMAIL_OAUTH_CLIENT_ID'
      : 'OUTLOOK_OAUTH_CLIENT_ID'
    const clientId = Deno.env.get(clientIdEnv)
    if (!clientId) {
      throw new EdgeFunctionError('INTERNAL', `${clientIdEnv} not set on the server`)
    }

    const state = randomState()
    // Microsoft requires PKCE for some confidential-client SPA flows;
    // Google accepts it as an additional CSRF layer. We always generate.
    const pkce = await generatePkce()
    const expiresAt = new Date(Date.now() + STATE_TTL_MINUTES * 60 * 1000).toISOString()

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    })

    const { error: insertError } = await serviceClient
      .from('oauth_pending_states')
      .insert({
        state,
        provider: body.provider,
        pkce_verifier: pkce.verifier,
        requested_by: ctx.userId,
        expires_at: expiresAt,
      })
    if (insertError) {
      console.warn('[start-po-oauth] failed to insert pending state:', insertError.message)
      throw new EdgeFunctionError('INTERNAL', 'Failed to start OAuth flow')
    }

    const authorizeUrl = buildAuthorizeUrl({
      provider: body.provider,
      clientId,
      redirectUri: buildCallbackUri(supabaseUrl, body.provider),
      state,
      codeChallenge: pkce.challenge,
    })

    // State + expiresAt are NOT returned to the browser — keeping them
    // server-only narrows the live-state exposure window if the admin
    // page is ever compromised by XSS.
    const response: StartOAuthResponse = { authorizeUrl }
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (err instanceof EdgeFunctionError) return err.toResponse(req)
    console.warn('[start-po-oauth] unexpected error:', err)
    return errorResponse('INTERNAL', 'Unexpected error', undefined, 500, req)
  }
})

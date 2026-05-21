// log-client-error Edge Function
//
// Captures uncaught client-side errors (React error-boundary catches,
// window.onerror, unhandledrejection) and writes them to `client_errors`.
//
// Distinct from the privileged mutate-* functions: this one accepts both
// authenticated and anonymous callers because errors can happen before the
// user signs in. We resolve actor_id from the JWT when present and leave it
// null otherwise. The endpoint is intentionally permissive — any client can
// POST here. Abuse risk is bounded by per-payload size limits and by the
// fact that the table is admin-read-only.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { errorResponse } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit, clientIp } from '../_shared/rateLimit.ts'

// Hard caps to keep the table healthy and prevent abuse:
//   - message:        4 KB (typical Error.message is short)
//   - stack:         16 KB (stack traces are long but bounded)
//   - componentStack: 8 KB (React's componentStack)
//   - url:            2 KB
//   - user_agent:     1 KB
//   - metadata:       8 KB (serialized)
const inputSchema = z.object({
  message: z.string().min(1).max(4096),
  stack: z.string().max(16384).optional(),
  componentStack: z.string().max(8192).optional(),
  url: z.string().max(2048).optional(),
  userAgent: z.string().max(1024).optional(),
  metadata: z.record(z.unknown()).optional(),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (req.method !== 'POST') {
    return errorResponse('INVALID_INPUT', 'Method not allowed', undefined, 405, req)
  }

  // Rate limit by IP — log-client-error accepts unauthenticated callers, so
  // a malicious site could otherwise spam the table. 30 req/min is enough
  // for a frontend that genuinely dedups by stack signature.
  const ip = clientIp(req)
  const rl = await checkRateLimit(`log-client-error:${ip}`, { windowMs: 60_000, max: 30 })
  if (!rl.ok) {
    return errorResponse('TOO_MANY_REQUESTS', 'Rate limit exceeded', undefined, 429, req)
  }

  try {
    const body = await req.json().catch(() => null)
    if (!body) {
      return errorResponse('INVALID_INPUT', 'Request body must be valid JSON', undefined, undefined, req)
    }

    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse('INVALID_INPUT', 'Invalid error payload', parsed.error.flatten(), undefined, req)
    }
    const input = parsed.data

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    // Best-effort actor resolution: if the caller passed a JWT, look up their
    // profile to grab role. Failures fall through silently — we still log
    // the error with actor_id=null.
    let actorId: string | null = null
    let actorRole: string | null = null
    const authHeader = req.headers.get('Authorization')
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
          auth: { persistSession: false },
        })
        const { data: authUser } = await userClient.auth.getUser()
        if (authUser?.user) {
          actorId = authUser.user.id
          const { data: profile } = await userClient
            .from('profiles')
            .select('role')
            .eq('id', actorId)
            .single()
          if (profile && typeof (profile as any).role === 'string') {
            actorRole = (profile as { role: string }).role
          }
        }
      } catch (_) {
        // ignore — actor_id stays null
      }
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    })

    const { error: insertError } = await admin.from('client_errors').insert({
      actor_id: actorId,
      actor_role: actorRole,
      message: input.message,
      stack: input.stack ?? null,
      component_stack: input.componentStack ?? null,
      url: input.url ?? null,
      user_agent: input.userAgent ?? null,
      metadata: input.metadata ?? {},
    })

    if (insertError) {
      // Don't echo DB errors back to the client; just log.
      console.error('client_errors insert failed:', insertError.message)
      return errorResponse('INTERNAL', 'Failed to log error', undefined, undefined, req)
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

// mutate-scoring-profile Edge Function
//
// Admin-only tuning of a warehouse's WIE scoring weights. The six factor weights
// (travelDistance, capacityFit, grouping, zonePreference, congestion,
// velocityMatch) override DEFAULT_WEIGHTS for recommend-putaway / re-slotting at
// that warehouse. Stored one row per warehouse in wie_scoring_profiles (PK
// warehouse_id); direct writes from `authenticated` are RLS-blocked.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin']

// Each factor weight is a non-negative fraction 0..1. We don't force the six to
// sum to 1 — the engine normalizes contributions across the candidate set, so
// relative magnitudes are what matter.
const weight = z.number().min(0).max(1)
const weightsSchema = z.object({
  travelDistance: weight,
  capacityFit: weight,
  grouping: weight,
  zonePreference: weight,
  congestion: weight,
  velocityMatch: weight,
}).strict()

const inputSchema = z.object({
  warehouse_id: z.number().int().positive(),
  weights: weightsSchema,
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`mutate-scoring-profile:${auth.userId}`, { windowMs: 60_000, max: 30 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { warehouse_id, weights } = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    // The target must be an actual WAREHOUSE-kind location.
    const { data: wh, error: whErr } = await admin.from('locations')
      .select('id, kind').eq('id', warehouse_id).single()
    if (whErr || !wh || (wh as any).kind !== 'WAREHOUSE') {
      throw new EdgeFunctionError('INVALID_INPUT', 'warehouse_id must reference a WAREHOUSE location')
    }

    const { data: profile, error: upErr } = await admin.from('wie_scoring_profiles').upsert({
      warehouse_id,
      weights,
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    } as any, { onConflict: 'warehouse_id' }).select().single()
    if (upErr) throw new EdgeFunctionError('INTERNAL', `failed to save scoring profile: ${upErr.message}`)

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'wie_scoring_profiles',
      resourceId: String(warehouse_id), after: profile as Record<string, unknown>,
      metadata: { weights },
    })

    return new Response(JSON.stringify({ ok: true, profile }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

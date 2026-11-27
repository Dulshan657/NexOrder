// Edge Function: check-putaway-location (NX-0049)
//
// GET ?recommendationId=&locationCode=
//   -> { ok: true, refusal: string | null }
//
// Would this putaway line be refused at this location? The Walk card asks it
// at the LOCATION scan, so the walker reads "{code} already holds ..." or
// "Put this in its home location ..." before counting, not after Confirm.
//
// It asks wie_home_block (mig 00151): the home rule, then the one-product-per-
// location rule -- the same question every putaway transaction asks again
// under its row lock, so this answer is advice and the completion stays the
// authority. Read-only: wie_home_block writes nothing.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { requireModule } from '../_shared/modules.ts'
import { normalizeScan } from '../_shared/scanNormalize.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

/** One per location scan on the Walk. */
const RATE = { windowMs: 60_000, max: 120 }

const CHECK_FAILED = 'Could not check that location, try again.'

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    if (req.method !== 'GET') throw new EdgeFunctionError('INVALID_INPUT', 'Use GET')

    const params = new URL(req.url).searchParams
    const rawId = params.get('recommendationId') ?? ''
    if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(Number(rawId)) || Number(rawId) <= 0) {
      throw new EdgeFunctionError('INVALID_INPUT', 'recommendationId must be a positive whole number')
    }
    const recommendationId = Number(rawId)
    const code = normalizeScan(params.get('locationCode') ?? '')
    if (!code || code.length > 200) throw new EdgeFunctionError('INVALID_INPUT', 'locationCode is required')

    const rl = await checkRateLimit(`check-putaway-location:${auth.userId}`, RATE)
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const { data: rec, error: recError } = await admin.from('wie_putaway_recommendations')
      .select('id, warehouse_id').eq('id', recommendationId).maybeSingle()
    if (recError) {
      console.error('[check-putaway-location] line read failed', recError)
      throw new EdgeFunctionError('INTERNAL', CHECK_FAILED)
    }
    if (!rec) throw new EdgeFunctionError('NOT_FOUND', `Putaway task ${recommendationId} not found`)
    if (auth.role === 'Warehouse' && auth.profile.home_warehouse_id !== (rec as any).warehouse_id) {
      throw new EdgeFunctionError('FORBIDDEN', 'You can only put away stock at your own warehouse')
    }

    // locations.code is globally unique (mig 00027), as complete-putaway reads it.
    // The code is a value, not a pattern: LIKE's metacharacters are escaped.
    const { data: loc, error: locError } = await admin.from('locations')
      .select('id, is_active').ilike('code', code.replace(/[\\%_]/g, (c) => '\\' + c)).maybeSingle()
    if (locError) {
      console.error('[check-putaway-location] location read failed', locError)
      throw new EdgeFunctionError('INTERNAL', CHECK_FAILED)
    }
    if (!loc) throw new EdgeFunctionError('NOT_FOUND', `No location has the code ${code}`)
    // Only a location this line could go to is judged, so the answer never
    // names what another site holds (same checks and words as complete-putaway).
    if (!(loc as any).is_active) {
      throw new EdgeFunctionError('CONFLICT', 'That location is no longer active — choose another')
    }
    const { data: root, error: rootErr } = await admin.rpc('inv_root_warehouse', { p_location_id: (loc as any).id })
    if (rootErr) {
      console.error('[check-putaway-location] warehouse resolution failed', rootErr)
      throw new EdgeFunctionError('INTERNAL', CHECK_FAILED)
    }
    if (root !== (rec as any).warehouse_id) {
      throw new EdgeFunctionError('INVALID_INPUT', 'That location is not inside this warehouse')
    }

    const { data, error } = await admin.rpc('wie_home_block', {
      p_rec_id: recommendationId,
      p_to_location_id: (loc as any).id,
    })
    if (error) {
      console.error(`[check-putaway-location] wie_home_block ${recommendationId} -> ${(loc as any).id}: ${error.message}`)
      throw new EdgeFunctionError('INTERNAL', CHECK_FAILED)
    }
    const refusal = typeof data === 'string' && data.length > 0 ? data : null

    return new Response(JSON.stringify({ ok: true, refusal }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    console.error('[check-putaway-location] unexpected', e)
    return errorResponse('INTERNAL', CHECK_FAILED, undefined, undefined, req)
  }
})

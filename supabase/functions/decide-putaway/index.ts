// decide-putaway Edge Function
//
// Close out a putaway recommendation: accept the suggested bin or override to
// another, then move the received stock from the warehouse ROOT (un-put-away
// staging) into the chosen bin via the existing inv_transfer_stock RPC. The
// recommendation row is marked accepted/overridden for the audit trail. Re-
// evaluation (picking a fresh recommendation that excludes a bin) is done by
// simply calling recommend-putaway again, so this function stays focused on the
// commit step.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  recommendation_id: z.number().int().positive(),
  decision: z.enum(['accept', 'override']),
  chosen_location_id: z.number().int().positive().optional(),
}).refine((d) => d.decision !== 'override' || d.chosen_location_id !== undefined, {
  message: 'override requires chosen_location_id',
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`decide-putaway:${auth.userId}`, { windowMs: 60_000, max: 120 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { recommendation_id, decision, chosen_location_id } = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const { data: rec, error: rErr } = await admin.from('wie_putaway_recommendations')
      .select('*').eq('id', recommendation_id).single()
    if (rErr || !rec) throw new EdgeFunctionError('NOT_FOUND', `Recommendation ${recommendation_id} not found`)
    if ((rec as any).status !== 'suggested') {
      throw new EdgeFunctionError('CONFLICT', `Recommendation already ${(rec as any).status}`)
    }

    const warehouseId = (rec as any).warehouse_id as number
    if (auth.role === 'Warehouse' && auth.profile.home_warehouse_id !== warehouseId) {
      throw new EdgeFunctionError('FORBIDDEN', 'You can only put away stock at your own warehouse')
    }

    const chosen = decision === 'accept' ? ((rec as any).recommended_location_id as number | null) : chosen_location_id!
    if (chosen == null) {
      throw new EdgeFunctionError('INVALID_INPUT', 'No recommended bin to accept — choose a bin instead')
    }

    // The chosen bin must be active and belong to this warehouse.
    const { data: binRow, error: binErr } = await admin.from('locations')
      .select('id, is_active').eq('id', chosen).single()
    if (binErr || !binRow) throw new EdgeFunctionError('NOT_FOUND', `Bin ${chosen} not found`)
    if (!(binRow as any).is_active) {
      throw new EdgeFunctionError('CONFLICT', 'That bin is no longer active — re-run the recommendation')
    }
    const { data: root, error: rootErr } = await admin.rpc('inv_root_warehouse', { p_location_id: chosen })
    if (rootErr) throw new EdgeFunctionError('INTERNAL', `warehouse resolution failed: ${rootErr.message}`)
    if (root !== warehouseId) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Chosen bin is not inside this warehouse')
    }

    // Guard against acting on a stale recommendation: the warehouse must still be
    // on the layout this recommendation was computed for (a republish invalidates
    // older suggestions, which could otherwise strand stock in a removed bin).
    const { data: whRow } = await admin.from('locations')
      .select('active_layout_id').eq('id', warehouseId).single()
    if ((whRow as any)?.active_layout_id !== (rec as any).layout_id) {
      throw new EdgeFunctionError('CONFLICT', 'The layout changed since this recommendation — re-run it')
    }

    // Claim the recommendation BEFORE moving stock so concurrent accepts can't
    // double-transfer. The status guard makes the claim atomic; only the winner
    // proceeds to the (irreversible) move.
    const { data: claimed, error: claimErr } = await admin.from('wie_putaway_recommendations').update({
      status: decision === 'accept' ? 'accepted' : 'overridden',
      chosen_location_id: chosen,
      decided_at: new Date().toISOString(),
      actor_id: auth.userId,
    }).eq('id', recommendation_id).eq('status', 'suggested').select().single()
    if (claimErr || !claimed) {
      throw new EdgeFunctionError('CONFLICT', 'Recommendation already decided')
    }

    // Move stock from the warehouse root (staging) into the chosen bin. If the
    // move fails, release the claim so the operator can retry.
    const { data: moved, error: mErr } = await admin.rpc('inv_transfer_stock', {
      p_product_id: (rec as any).product_id,
      p_from_loc: warehouseId,
      p_to_loc: chosen,
      p_qty: (rec as any).quantity,
      p_actor: auth.userId,
      p_reason: `putaway:${decision}`,
    })
    if (mErr) {
      await admin.from('wie_putaway_recommendations').update({
        status: 'suggested', chosen_location_id: null, decided_at: null,
      }).eq('id', recommendation_id)
      throw new EdgeFunctionError('INTERNAL', `putaway move failed: ${mErr.message}`)
    }
    const updated = claimed

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'wie_putaway_recommendations',
      resourceId: String(recommendation_id), after: updated as Record<string, unknown>,
      metadata: { decision, chosen_location_id: chosen, moved },
    })

    return new Response(JSON.stringify({ ok: true, moved, recommendation: updated }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

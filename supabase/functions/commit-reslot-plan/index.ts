// commit-reslot-plan Edge Function
//
// Turn an operator-approved re-slot plan (from plan-reslot, possibly with per-line
// overrides) into a relocation worklist. Called AFTER the new layout is published
// (publish-now-move-after): it writes each approved move as a wie_slotting_suggestions
// row tagged origin='reslot' under one plan_batch. Staff then execute them in the
// existing Slotting queue, where Accept physically moves the stock (old bin → new
// bin) via decide-slotting-suggestion → inv_transfer_stock.
//
// Persists suggestions only; moves NO stock here. Idempotent: the partial unique
// index on open (warehouse, product, from, to) skips duplicates, so a retry after a
// partial failure is safe. Admin/Manager only.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

const moveSchema = z.object({
  product_id: z.number().int().positive(),
  from_location_id: z.number().int().positive(),
  to_location_id: z.number().int().positive(),
  qty: z.number().positive(),
})

const inputSchema = z.object({
  layout_id: z.number().int().positive(),
  moves: z.array(moveSchema).min(1).max(2000),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`commit-reslot-plan:${auth.userId}`, { windowMs: 60_000, max: 20 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => { throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON') })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { layout_id, moves } = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const { data: layout, error: lErr } = await admin.from('warehouse_layouts')
      .select('id, warehouse_id, status').eq('id', layout_id).single()
    if (lErr || !layout) throw new EdgeFunctionError('NOT_FOUND', `Layout ${layout_id} not found`)
    if ((layout as any).status !== 'published') {
      throw new EdgeFunctionError('CONFLICT', 'Layout must be published before its relocation worklist is created')
    }
    const warehouseId = (layout as any).warehouse_id as number

    // Destinations must be bins placed in the now-published layout.
    const { data: placeRows } = await admin.from('layout_placements').select('location_id').eq('layout_id', layout_id)
    const placedIds = new Set(((placeRows ?? []) as any[]).map((p) => p.location_id as number))

    const planBatch = crypto.randomUUID()
    let created = 0
    let skipped = 0
    for (const m of moves) {
      if (m.from_location_id === m.to_location_id) { skipped++; continue }
      if (!placedIds.has(m.to_location_id)) { skipped++; continue }
      const { error: insErr } = await admin.from('wie_slotting_suggestions').insert({
        warehouse_id: warehouseId, product_id: m.product_id,
        from_location_id: m.from_location_id, to_location_id: m.to_location_id, qty: m.qty,
        expected_gain_m: 0, reason: { source: 'reslot', plan_batch: planBatch },
        origin: 'reslot', plan_batch: planBatch, status: 'suggested',
      } as any)
      if (insErr) { skipped++; continue } // 23505 open-dup or any insert error → skip, keep going
      created++
    }

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'create', resource: 'wie_slotting_suggestions',
      resourceId: null, metadata: { warehouse_id: warehouseId, layout_id, plan_batch: planBatch, created, skipped },
    })

    return new Response(JSON.stringify({ ok: true, created, skipped, plan_batch: planBatch }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

// mutate-product-home-bin Edge Function
//
// Admin/Manager set or clear a product's default put-away bin for a racked
// warehouse (mig 00039 product_home_bins). The home bin is the first suggestion
// when putting stock away. Validates the bin sits inside the given (racked)
// warehouse. Direct writes to product_home_bins are RLS-blocked.
//
// Since mig 00082 the row is also the REPLENISHMENT config: min/max in base
// units, and a flag that turns the detector on for this slot. Enabling it
// requires a pick-zone level -- re-checked here so the operator gets a readable
// error, though the real enforcement is the table's trigger (service_role
// bypasses RLS but not triggers).
//
// `purpose` distinguishes several slots for one SKU in one warehouse; every
// existing caller means 'primary', which is the column default.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

const inputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set'),
    productId: z.number().int().positive(),
    warehouseId: z.number().int().positive(),
    binId: z.number().int().positive(),
    purpose: z.string().min(1).max(32).optional(),
    // Base units. null clears the figure; omitted leaves it untouched.
    minQty: z.number().nonnegative().nullable().optional(),
    maxQty: z.number().nonnegative().nullable().optional(),
    replenEnabled: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('clear'),
    productId: z.number().int().positive(),
    warehouseId: z.number().int().positive(),
    purpose: z.string().min(1).max(32).optional(),
  }),
])

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // Per-user rate limit: 30/min/user. Matches other admin mutate functions.
    const rl = await checkRateLimit(`mutate-product-home-bin:${auth.userId}`, {
      windowMs: 60_000,
      max: 30,
    })
    if (!rl.ok) {
      throw new EdgeFunctionError(
        'TOO_MANY_REQUESTS',
        `Rate limit exceeded; try again in ${Math.ceil(rl.resetMs / 1000)}s`,
      )
    }
    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const input = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    if (input.action === 'clear') {
      await admin.from('product_home_bins').delete()
        .eq('product_id', input.productId).eq('warehouse_id', input.warehouseId)
        .eq('purpose', input.purpose ?? 'primary')
      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'delete', resource: 'product_home_bins',
        resourceId: `${input.productId}:${input.warehouseId}`, after: null,
      })
      return new Response(JSON.stringify({ ok: true, cleared: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Validate the bin lives inside the (racked) warehouse via materialized_path.
    const { data: wh } = await admin.from('locations').select('materialized_path, location_type').eq('id', input.warehouseId).eq('kind', 'WAREHOUSE').single()
    if (!wh) throw new EdgeFunctionError('NOT_FOUND', 'Warehouse not found')
    if ((wh as any).location_type !== 'racked') throw new EdgeFunctionError('CONFLICT', 'Home bins apply only to racked warehouses')

    const { data: bin } = await admin.from('locations').select('id, materialized_path').eq('id', input.binId).single()
    if (!bin) throw new EdgeFunctionError('NOT_FOUND', 'Bin not found')
    const whPath = (wh as any).materialized_path as string
    if (!String((bin as any).materialized_path).startsWith(`${whPath}/`)) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Bin is not inside the given warehouse')
    }

    // Replenishment needs a pick-zone level as its destination. The trigger on
    // the table refuses this anyway; checking first turns a raw plpgsql string
    // into something an operator can act on.
    if (input.replenEnabled) {
      const { data: pickZone } = await admin
        .from('locations')
        .select('id, code, level_role, level_roles!inner(is_pick_zone, is_active)')
        .eq('id', input.binId)
        .maybeSingle()
      const role = (pickZone as any)?.level_roles
      if (!role?.is_pick_zone || !role?.is_active) {
        throw new EdgeFunctionError(
          'CONFLICT',
          'Replenishment refills a pick zone, so the home bin has to be a pick-zone level. ' +
            'Choose a pick-zone level, or change the role on this one first.',
          { reason: 'not_pick_zone' },
        )
      }
    }

    const row: Record<string, unknown> = {
      product_id: input.productId,
      warehouse_id: input.warehouseId,
      bin_id: input.binId,
      purpose: input.purpose ?? 'primary',
      updated_by: auth.userId,
    }
    if (input.minQty !== undefined) row.min_qty = input.minQty
    if (input.maxQty !== undefined) row.max_qty = input.maxQty
    if (input.replenEnabled !== undefined) row.replen_enabled = input.replenEnabled

    const { data: upserted, error } = await admin
      .from('product_home_bins')
      .upsert(row as any, { onConflict: 'product_id,warehouse_id,purpose' })
      .select()
      .single()
    if (error || !upserted) {
      const msg = error?.message ?? 'Failed to set home bin'
      // The table's CHECKs and its pick-zone trigger surface here.
      if (/INVALID_BIN|product_home_bins_(minmax|replen_config)_check/.test(msg)) {
        throw new EdgeFunctionError(
          'CONFLICT',
          msg.includes('INVALID_BIN')
            ? 'Replenishment needs a pick-zone level as its home bin.'
            : 'Replenishment needs a minimum and a maximum, with the maximum higher than the minimum.',
        )
      }
      throw new EdgeFunctionError('INTERNAL', msg)
    }

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'product_home_bins',
      resourceId: `${input.productId}:${input.warehouseId}`, after: upserted as Record<string, unknown>,
    })
    return new Response(JSON.stringify({ ok: true, homeBin: upserted }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

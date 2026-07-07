// mutate-product-home-bin Edge Function
//
// Admin/Manager set or clear a product's default put-away bin for a racked
// warehouse (mig 00039 product_home_bins). The home bin is the first suggestion
// when putting stock away. Validates the bin sits inside the given (racked)
// warehouse. Direct writes to product_home_bins are RLS-blocked.

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
  }),
  z.object({
    action: z.literal('clear'),
    productId: z.number().int().positive(),
    warehouseId: z.number().int().positive(),
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
      await admin.from('product_home_bins').delete().eq('product_id', input.productId).eq('warehouse_id', input.warehouseId)
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

    const { data: upserted, error } = await admin
      .from('product_home_bins')
      .upsert({ product_id: input.productId, warehouse_id: input.warehouseId, bin_id: input.binId }, { onConflict: 'product_id,warehouse_id' })
      .select()
      .single()
    if (error || !upserted) throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to set home bin')

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

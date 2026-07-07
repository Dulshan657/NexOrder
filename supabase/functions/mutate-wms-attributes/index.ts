// mutate-wms-attributes Edge Function
//
// Admin/Manager upsert of a product's WMS attributes (hazard class, temperature
// window, shelf-life policy, handling, weight/volume/dims, custom). Feeds the
// engine's rules + future velocity/handling logic. Direct writes to
// product_wms_attributes are RLS-blocked.

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

const inputSchema = z.object({
  product_id: z.number().int().positive(),
  hazard_class: z.string().max(60).nullable().optional(),
  temp_min: z.number().nullable().optional(),
  temp_max: z.number().nullable().optional(),
  shelf_life_policy: z.enum(['FEFO', 'FIFO']).nullable().optional(),
  stackable: z.boolean().nullable().optional(),
  handling_type: z.string().max(60).nullable().optional(),
  weight_kg: z.number().nonnegative().nullable().optional(),
  volume_l: z.number().nonnegative().nullable().optional(),
  dims: z.record(z.unknown()).nullable().optional(),
  custom: z.record(z.unknown()).optional(),
}).refine(
  (d) => d.temp_min == null || d.temp_max == null || d.temp_min <= d.temp_max,
  { message: 'temp_min must be ≤ temp_max' },
)

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`mutate-wms-attributes:${auth.userId}`, { windowMs: 60_000, max: 120 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const input = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const { data: product } = await admin.from('products').select('id').eq('id', input.product_id).maybeSingle()
    if (!product) throw new EdgeFunctionError('NOT_FOUND', `Product ${input.product_id} not found`)

    // Only write columns the caller actually sent, so a partial save doesn't null
    // out fields it never touched (e.g. weight/volume set elsewhere).
    const row: Record<string, unknown> = { product_id: input.product_id, updated_at: new Date().toISOString() }
    for (const k of ['hazard_class', 'temp_min', 'temp_max', 'shelf_life_policy', 'stackable', 'handling_type', 'weight_kg', 'volume_l', 'dims', 'custom'] as const) {
      if (k in input) row[k] = (input as any)[k] ?? null
    }
    const { data: saved, error } = await admin.from('product_wms_attributes')
      .upsert(row as any, { onConflict: 'product_id' }).select().single()
    if (error || !saved) throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to save attributes')

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'product_wms_attributes',
      resourceId: String(input.product_id), after: saved as Record<string, unknown>,
    })

    return new Response(JSON.stringify({ ok: true, attributes: saved }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

// detect-replenishment Edge Function
//
// Runs the min/max detector (wie_replen_detect, mig 00082) on demand — the
// Replenishment page's mount and its "Scan for shortfalls" button. The same RPC
// also runs advisorily inside record-pick and complete-putaway; this is the
// operator-triggered path.
//
// Read-mostly: it raises task rows but moves no stock.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  warehouse_id: z.number().int().positive(),
  product_id: z.number().int().positive().optional(),
  dry_run: z.boolean().optional(),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`detect-replenishment:${auth.userId}`, { windowMs: 60_000, max: 30 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { warehouse_id, product_id, dry_run } = parsed.data

    if (auth.role === 'Warehouse' && auth.profile.home_warehouse_id !== warehouse_id) {
      throw new EdgeFunctionError('FORBIDDEN', 'You can only replenish at your own warehouse')
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const { data, error } = await admin.rpc('wie_replen_detect', {
      p_warehouse_id: warehouse_id,
      p_product_id: product_id ?? null,
      p_actor: auth.userId,
      p_dry_run: dry_run ?? false,
    })
    if (error) throw new EdgeFunctionError('INTERNAL', `replenishment scan failed: ${error.message}`)

    return new Response(JSON.stringify({ ok: true, result: data }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

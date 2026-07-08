// recommend-putaway Edge Function
//
// Given received lines for a warehouse, return a scored, explained bin
// recommendation per line using the WIE engine, and (unless dry_run) persist the
// tasks to wie_putaway_recommendations so the operator can accept/override them
// (decide-putaway). The actual load→score→persist work lives in the shared
// generatePutawayTasks helper, which every stock-arrival path calls so putaway
// tasks are produced no matter how stock lands (receiving, CSV import, found-
// stock adjustment, transfer-in). Warehouses without a published layout fall back
// to legacy mode (the caller keeps today's home-bin behavior).

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { generatePutawayTasks } from '../_shared/putawayTasks.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  warehouse_id: z.number().int().positive(),
  goods_receipt_id: z.number().int().positive().optional(),
  // Read-only preview (Warehouse viewer test bench): score + explain but DON'T
  // persist a wie_putaway_recommendations row, so nothing leaks into the
  // operational Putaway queue and no stock can ever be moved from it.
  dry_run: z.boolean().optional(),
  lines: z.array(z.object({
    product_id: z.number().int().positive(),
    quantity: z.number().positive(),
  })).min(1).max(200),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`recommend-putaway:${auth.userId}`, { windowMs: 60_000, max: 60 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { warehouse_id, goods_receipt_id, dry_run, lines } = parsed.data

    if (auth.role === 'Warehouse' && auth.profile.home_warehouse_id !== warehouse_id) {
      throw new EdgeFunctionError('FORBIDDEN', 'You can only put away stock at your own warehouse')
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    let result
    try {
      result = await generatePutawayTasks(admin, {
        warehouseId: warehouse_id,
        lines,
        actorId: auth.userId,
        goodsReceiptId: goods_receipt_id,
        dryRun: dry_run,
      })
    } catch (e) {
      throw new EdgeFunctionError('INTERNAL', e instanceof Error ? e.message : 'putaway generation failed')
    }

    if (result.mode === 'legacy') {
      return new Response(JSON.stringify({ ok: true, mode: 'legacy' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true, mode: 'engine', layout_id: result.layoutId, recommendations: result.recommendations }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

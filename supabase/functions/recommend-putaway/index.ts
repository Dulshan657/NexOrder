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
import { requireModule } from '../_shared/modules.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  warehouse_id: z.number().int().positive(),
  goods_receipt_id: z.number().int().positive().optional(),
  // Read-only preview (Warehouse viewer test bench): score + explain but DON'T
  // persist a wie_putaway_recommendations row, so nothing leaks into the
  // operational Putaway queue and no stock can ever be moved from it.
  dry_run: z.boolean().optional(),
  // Re-run: the pending recommendation these new lines replace. It is expired
  // as part of the same request so a re-run can never leave two live rows
  // competing to move the same stock off the dock.
  replaces_recommendation_id: z.number().int().positive().optional(),
  lines: z.array(z.object({
    product_id: z.number().int().positive(),
    quantity: z.number().positive(),
  })).min(1).max(200),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`recommend-putaway:${auth.userId}`, { windowMs: 60_000, max: 60 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { warehouse_id, goods_receipt_id, dry_run, lines, replaces_recommendation_id } = parsed.data
    if (replaces_recommendation_id !== undefined && dry_run) {
      throw new EdgeFunctionError('INVALID_INPUT', 'A dry run cannot replace a recommendation')
    }

    if (auth.role === 'Warehouse' && auth.profile.home_warehouse_id !== warehouse_id) {
      throw new EdgeFunctionError('FORBIDDEN', 'You can only put away stock at your own warehouse')
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    // Expire the row being replaced BEFORE generating, so the queue is never
    // briefly showing both. If generation then fails we put it back — the same
    // compensating pattern decide-putaway used before mig 00071 folded its two
    // steps into one transaction.
    if (replaces_recommendation_id !== undefined) {
      const { data: claimed, error: claimErr } = await admin.from('wie_putaway_recommendations')
        .update({ status: 'expired', decided_at: new Date().toISOString(), actor_id: auth.userId })
        .eq('id', replaces_recommendation_id)
        .eq('warehouse_id', warehouse_id)
        .eq('status', 'suggested')
        .select('id').maybeSingle()
      if (claimErr) throw new EdgeFunctionError('INTERNAL', `re-run claim failed: ${claimErr.message}`)
      if (!claimed) {
        throw new EdgeFunctionError('CONFLICT', 'That recommendation is no longer pending — refresh the queue')
      }
    }

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
      if (replaces_recommendation_id !== undefined) {
        await admin.from('wie_putaway_recommendations')
          .update({ status: 'suggested', decided_at: null })
          .eq('id', replaces_recommendation_id)
      }
      throw new EdgeFunctionError('INTERNAL', e instanceof Error ? e.message : 'putaway generation failed')
    }

    if (result.mode === 'legacy') {
      // No published layout (it was archived since the row was created). Legacy
      // mode persists nothing, so expiring the old row would silently drop work
      // off the queue — put it back and say why.
      if (replaces_recommendation_id !== undefined) {
        await admin.from('wie_putaway_recommendations')
          .update({ status: 'suggested', decided_at: null })
          .eq('id', replaces_recommendation_id)
        throw new EdgeFunctionError('CONFLICT', 'This warehouse has no published layout — nothing to re-run against')
      }
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

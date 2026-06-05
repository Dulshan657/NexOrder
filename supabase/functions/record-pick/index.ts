// record-pick Edge Function
//
// A warehouse worker (or Admin/Manager) confirms picking a quantity of one
// order line. Delegates the atomic decrement (on_hand-- and allocated-- across
// FIFO batches, plus the pick_progress row) to the inv_pick_order_line RPC.
// When every line of the order is fully picked, advances the order to 'picked'.

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
  orderItemId: z.number().int().positive(),
  pickedQty: z.number().positive(),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    const rl = await checkRateLimit(`record-pick:${auth.userId}`, { windowMs: 60_000, max: 120 })
    if (!rl.ok) {
      throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded — too many picks in a short period')
    }

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    }
    const { orderItemId, pickedQty } = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    const { data: pickResult, error: rpcError } = await admin.rpc('inv_pick_order_line', {
      p_order_item_id: orderItemId,
      p_picked_qty: pickedQty,
      p_actor: auth.userId,
    })
    if (rpcError) {
      const msg = rpcError.message ?? 'pick failed'
      // OVER_PICK (line exceeds ordered qty) / INSUFFICIENT_STOCK (not enough
      // physical on_hand to pick) bubble up as P0001 — both are 409 conflicts.
      const conflict = /OVER_PICK|INSUFFICIENT_STOCK/.test(msg)
      throw new EdgeFunctionError(conflict ? 'CONFLICT' : 'INTERNAL', `pick failed: ${msg}`)
    }

    const result = pickResult as { line_fully_picked: boolean; order_fully_picked: boolean }

    // Resolve the parent order for status advance + audit.
    const { data: itemRow } = await admin
      .from('order_items')
      .select('order_id')
      .eq('id', orderItemId)
      .single()
    const orderId = (itemRow as { order_id: string } | null)?.order_id ?? null

    // When the whole order is picked, advance it to 'picked' (forward-only).
    if (result.order_fully_picked && orderId) {
      const { data: order } = await admin
        .from('orders')
        .select('status, status_history')
        .eq('id', orderId)
        .single()
      const current = (order as any)?.status as string | undefined
      if (current === 'processed') {
        const history = Array.isArray((order as any)?.status_history) ? (order as any).status_history : []
        await admin
          .from('orders')
          .update({
            status: 'picked',
            status_history: [
              ...history,
              { status: 'picked', timestamp: new Date().toISOString(), actor: auth.userId, note: 'All lines picked' },
            ],
          })
          .eq('id', orderId)
      }
    }

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'update',
      resource: 'pick_progress',
      resourceId: orderId,
      after: { orderItemId, pickedQty, ...result },
    })

    return new Response(
      JSON.stringify({ ok: true, ...result }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

// record-pick Edge Function
//
// A warehouse worker (or Admin/Manager) confirms picking a quantity of one
// order line AT A SPECIFIC WAREHOUSE. Delegates the atomic decrement (on_hand--
// and allocated-- across FIFO batches at that location, plus the pick_progress
// row) to the inv_pick_order_line RPC. When the warehouse's portion of the order
// is fully picked, advances that order_fulfillments row to 'picked' and
// recomputes the derived orders.status. Legacy orders (no fulfilments) keep the
// order-level "advance to picked when fully picked" behaviour.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { isLocationFullyPicked, recomputeOrderStatus } from '../_shared/fulfillment.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  orderItemId: z.number().int().positive(),
  pickedQty: z.number().positive(),
  locationId: z.number().int().positive().optional(),
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

    // Resolve the warehouse this pick happens at: explicit > the picker's home
    // warehouse > the default warehouse. Warehouse staff may only pick at their
    // own site.
    let locationId = parsed.data.locationId ?? auth.profile.home_warehouse_id ?? null
    if (auth.role === 'Warehouse' && parsed.data.locationId && parsed.data.locationId !== auth.profile.home_warehouse_id) {
      throw new EdgeFunctionError('FORBIDDEN', 'You can only pick at your own warehouse')
    }
    if (locationId == null) {
      const { data: def } = await admin
        .from('locations')
        .select('id')
        .eq('kind', 'WAREHOUSE')
        .eq('is_active', true)
        .order('id')
        .limit(1)
        .maybeSingle()
      locationId = (def as any)?.id ?? null
    }

    const { data: pickResult, error: rpcError } = await admin.rpc('inv_pick_order_line', {
      p_order_item_id: orderItemId,
      p_picked_qty: pickedQty,
      p_location_id: locationId,
      p_actor: auth.userId,
    })
    if (rpcError) {
      const msg = rpcError.message ?? 'pick failed'
      const conflict = /OVER_PICK|INSUFFICIENT_STOCK/.test(msg)
      throw new EdgeFunctionError(conflict ? 'CONFLICT' : 'INTERNAL', `pick failed: ${msg}`)
    }

    const result = pickResult as { line_fully_picked: boolean; order_fully_picked: boolean }

    const { data: itemRow } = await admin
      .from('order_items')
      .select('order_id')
      .eq('id', orderItemId)
      .single()
    const orderId = (itemRow as { order_id: string } | null)?.order_id ?? null

    if (orderId) {
      const nowIso = new Date().toISOString()
      // A pick may land on a bin (racked); the fulfilment is keyed by the bin's
      // root warehouse. Resolve it (mig 00040) so we advance the right fulfilment.
      const { data: rootData } = await admin.rpc('inv_root_warehouse', { p_location_id: locationId })
      const warehouseId = (typeof rootData === 'number' ? rootData : null) ?? locationId!

      // Fulfilment model: advance this warehouse's fulfilment to 'picked' once its
      // portion is fully picked, then recompute the derived order status.
      const { data: ful } = await admin
        .from('order_fulfillments')
        .select('id, status, status_history')
        .eq('order_id', orderId)
        .eq('location_id', warehouseId)
        .maybeSingle()

      if (ful) {
        if ((ful as any).status === 'processed' && (await isLocationFullyPicked(admin, orderId, warehouseId))) {
          const hist = Array.isArray((ful as any).status_history) ? (ful as any).status_history : []
          await admin
            .from('order_fulfillments')
            .update({
              status: 'picked',
              status_history: [...hist, { status: 'picked', timestamp: nowIso, actor: auth.userId, note: 'All lines picked at this warehouse' }],
            })
            .eq('id', (ful as any).id)
        }
        await recomputeOrderStatus(admin, orderId, auth.userId, nowIso)
      } else if (result.order_fully_picked) {
        // Legacy order (no fulfilments): advance the order to 'picked'.
        const { data: order } = await admin
          .from('orders')
          .select('status, status_history')
          .eq('id', orderId)
          .single()
        if ((order as any)?.status === 'processed') {
          const history = Array.isArray((order as any)?.status_history) ? (order as any).status_history : []
          await admin
            .from('orders')
            .update({
              status: 'picked',
              status_history: [...history, { status: 'picked', timestamp: nowIso, actor: auth.userId, note: 'All lines picked' }],
            })
            .eq('id', orderId)
        }
      }
    }

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'update',
      resource: 'pick_progress',
      resourceId: orderId,
      after: { orderItemId, pickedQty, locationId, ...result },
    })

    return new Response(JSON.stringify({ ok: true, locationId, ...result }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

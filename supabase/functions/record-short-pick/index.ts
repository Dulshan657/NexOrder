// record-short-pick Edge Function
//
// A warehouse worker (or Admin/Manager) finishes an open line of an imported order
// with what was really found, including nothing. Delegates to inv_close_line_short
// (mig 00140), which records one difference and gives back the line's open units
// without touching on-hand: only a count changes on-hand. A retry adds nothing. The
// order then advances as it does after a pick (record-pick), because closing a line
// can be what finishes a warehouse's portion.
//
// locationId is optional and is NOT defaulted: a bin that was checked is flagged for a
// recount, and a product never counted has no bin to flag.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError, type ErrorCode } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { isLocationFullyPicked, recomputeOrderStatus } from '../_shared/fulfillment.ts'
import { setOrderStatus } from '../_shared/orderStatus.ts'
import { requireModule } from '../_shared/modules.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  orderItemId: z.number().int().positive(),
  locationId: z.number().int().positive().optional(),
})

/** inv_close_line_short's refusals, in what an operator standing at the rack is told. */
const REFUSALS: Record<string, { code: ErrorCode; message: string }> = {
  ORDER_ITEM_NOT_FOUND: { code: 'NOT_FOUND', message: 'This order line no longer exists. Refresh and try again.' },
  NOT_IMPORTED: { code: 'CONFLICT', message: 'Only an order imported from an invoice can be finished short.' },
  ORDER_CANCELLED: { code: 'CONFLICT', message: 'This order was cancelled. Stop picking it and put anything already taken back.' },
  INVALID_STATUS: { code: 'CONFLICT', message: 'This order is not being picked any more, so a line cannot be finished short.' },
  BAD_LOCATION: { code: 'INVALID_INPUT', message: 'That bin is not in an active warehouse.' },
}

interface CloseResult {
  status: 'closed' | 'already_closed' | 'already_picked'
  line_closed?: boolean
  order_fully_resolved?: boolean
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    const rl = await checkRateLimit(`record-short-pick:${auth.userId}`, { windowMs: 60_000, max: 120 })
    if (!rl.ok) {
      throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded — too many requests in a short period')
    }

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    }
    const { orderItemId, locationId } = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    const { data: itemRow } = await admin
      .from('order_items')
      .select('order_id')
      .eq('id', orderItemId)
      .maybeSingle()
    const orderId = (itemRow as { order_id: string } | null)?.order_id ?? null

    // Warehouse staff may only act at their own site. A bin resolves to its ROOT
    // warehouse first (mig 00040), as in record-pick. With no bin to go on, the order
    // must have a fulfilment at their warehouse.
    if (auth.role === 'Warehouse') {
      if (locationId) {
        const { data: rootData } = await admin.rpc('inv_root_warehouse', { p_location_id: locationId })
        const warehouseId = typeof rootData === 'number' ? rootData : locationId
        if (warehouseId !== auth.profile.home_warehouse_id) {
          throw new EdgeFunctionError('FORBIDDEN', 'You can only pick at your own warehouse')
        }
      } else if (orderId) {
        const { data: sites } = await admin
          .from('order_fulfillments')
          .select('location_id')
          .eq('order_id', orderId)
        const list = (sites ?? []) as Array<{ location_id: number }>
        if (list.length > 0 && !list.some((s) => s.location_id === auth.profile.home_warehouse_id)) {
          throw new EdgeFunctionError('FORBIDDEN', 'You can only pick at your own warehouse')
        }
      }
    }

    const { data: closeResult, error: rpcError } = await admin.rpc('inv_close_line_short', {
      p_order_item_id: orderItemId,
      p_location_id: locationId ?? null,
      p_actor: auth.userId,
    })
    if (rpcError) {
      const msg = rpcError.message ?? 'close failed'
      const reason = /^([A-Z_]+):/.exec(msg)?.[1] ?? ''
      const refusal = REFUSALS[reason]
      if (refusal) throw new EdgeFunctionError(refusal.code, refusal.message, { reason })
      throw new EdgeFunctionError('INTERNAL', `close failed: ${msg}`)
    }
    const result = closeResult as CloseResult

    // The same advance as record-pick, for each warehouse: a retry must still finish
    // what a request that died after the RPC left undone, so this runs whatever the
    // status. Every 'processed' site is checked rather than only the caller's, because
    // closing the last open line can leave another site with nothing to do, and with no
    // pick left to come there, nothing else would ever advance it.
    if (orderId) {
      const nowIso = new Date().toISOString()
      const { data: fulfilments } = await admin
        .from('order_fulfillments')
        .select('id, location_id, status, status_history')
        .eq('order_id', orderId)
      const rows = (fulfilments ?? []) as any[]

      if (rows.length > 0) {
        for (const ful of rows) {
          if (ful.status === 'processed' && (await isLocationFullyPicked(admin, orderId, ful.location_id))) {
            const hist = Array.isArray(ful.status_history) ? ful.status_history : []
            await admin
              .from('order_fulfillments')
              .update({
                status: 'picked',
                status_history: [...hist, { status: 'picked', timestamp: nowIso, actor: auth.userId, note: 'All lines picked or closed short at this warehouse' }],
              })
              .eq('id', ful.id)
              // A concurrent advance already moved it on; don't overwrite its history.
              .eq('status', 'processed')
          }
        }
        await recomputeOrderStatus(admin, orderId, auth.userId, nowIso)
      } else if (result.order_fully_resolved) {
        // Legacy order (no fulfilments), as in record-pick: the line is already closed,
        // so a refusal is logged, not returned as an error.
        const verdict = await setOrderStatus(admin, {
          orderId,
          from: ['processed'],
          to: 'picked',
          entry: { status: 'picked', timestamp: nowIso, actor: auth.userId, note: 'All lines picked or closed short' },
        })
        if (!verdict.ok && verdict.code !== 'CONFLICT') {
          console.warn(`[record-short-pick] order ${orderId} not advanced to picked: ${verdict.code}`)
        }
      }
    }

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'update',
      resource: 'pick_differences',
      resourceId: orderId,
      after: { orderItemId, locationId: locationId ?? null, ...result },
    })

    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

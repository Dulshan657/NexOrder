// adjust-stock Edge Function
//
// Manual stock adjustments (shrinkage, damage, found stock) and stocktake
// variances. Admin, Manager, and Warehouse roles may adjust a product's
// on-hand quantity at a location — Warehouse staff are restricted to their own
// `home_warehouse_id` subtree. Two modes:
//   - 'delta'     — caller supplies a signed quantity to add/remove directly
//                   (defaults to movement_type 'adjustment').
//   - 'set_count' — caller supplies the freshly counted total; the server
//                   loads the current on_hand for that exact (product,
//                   location, batch) slot and computes the delta, always
//                   recording it as 'stocktake_variance'.
// Delegates the atomic balance/ledger/cache write to the inv_adjust_stock
// Postgres RPC (service_role-only EXECUTE). Direct writes to
// inventory_balances / inventory_movements are RLS-blocked.

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

const inputSchema = z
  .object({
    productId: z.number().int().positive(),
    locationId: z.number().int().positive(),
    batchId: z.number().int().positive().nullable().optional(),
    mode: z.enum(['delta', 'set_count']),
    qtyDelta: z.number().refine((v) => v !== 0, 'qtyDelta must be non-zero').optional(),
    newCount: z.number().min(0, 'newCount cannot be negative').optional(),
    reason: z.string().trim().min(1, 'A reason is required').max(500),
    movementType: z.enum(['adjustment', 'stocktake_variance']).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === 'delta' && data.qtyDelta === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'qtyDelta is required in delta mode', path: ['qtyDelta'] })
    }
    if (data.mode === 'set_count' && data.newCount === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'newCount is required in set_count mode', path: ['newCount'] })
    }
  })

// Errors raised by inv_adjust_stock as ERRCODE P0001 — mapped to 4xx responses
// rather than a generic 500 so the UI can show a specific, actionable message.
function mapRpcError(message: string): EdgeFunctionError {
  if (/ADJUSTMENT_BELOW_ALLOCATED/.test(message)) {
    return new EdgeFunctionError('CONFLICT', message)
  }
  if (/INVALID_ADJUSTMENT/.test(message)) {
    return new EdgeFunctionError('INVALID_INPUT', message)
  }
  return new EdgeFunctionError('INTERNAL', `adjustment failed: ${message}`)
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // 30 adjustments/min/user — matches receive-stock's throttle.
    const rl = await checkRateLimit(`adjust-stock:${auth.userId}`, { windowMs: 60_000, max: 30 })
    if (!rl.ok) {
      throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded — too many adjustments in a short period')
    }

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })

    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    }
    const { productId, locationId, batchId, mode, qtyDelta, newCount, reason, movementType } = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    // Warehouse-role staff may only adjust stock within their own warehouse
    // subtree — resolve the target location's root warehouse and compare.
    if (auth.role === 'Warehouse') {
      const { data: rootWarehouseId, error: rootErr } = await admin.rpc('inv_root_warehouse', {
        p_location_id: locationId,
      })
      if (rootErr) {
        throw new EdgeFunctionError('INTERNAL', `location lookup failed: ${rootErr.message}`)
      }
      if (!rootWarehouseId || rootWarehouseId !== auth.profile.home_warehouse_id) {
        throw new EdgeFunctionError('FORBIDDEN', 'You can only adjust stock within your own warehouse')
      }
    }

    let effectiveDelta: number
    let effectiveMovementType: 'adjustment' | 'stocktake_variance'
    let beforeOnHand: number | null = null

    if (mode === 'set_count') {
      // Load the current on_hand for this EXACT (product, location, batch)
      // slot — a missing row means 0 on hand there today.
      let query = admin
        .from('inventory_balances')
        .select('on_hand')
        .eq('product_id', productId)
        .eq('location_id', locationId)
      query = batchId != null ? query.eq('batch_id', batchId) : query.is('batch_id', null)
      const { data: balanceRow, error: balanceErr } = await query.maybeSingle()
      if (balanceErr) {
        throw new EdgeFunctionError('INTERNAL', `balance lookup failed: ${balanceErr.message}`)
      }
      beforeOnHand = Number((balanceRow as { on_hand: number } | null)?.on_hand ?? 0)
      effectiveDelta = newCount! - beforeOnHand
      if (effectiveDelta === 0) {
        throw new EdgeFunctionError('INVALID_INPUT', 'Counted total matches the current on-hand — nothing to adjust')
      }
      // set_count always records a stocktake variance, regardless of what the
      // caller passed for movementType.
      effectiveMovementType = 'stocktake_variance'
    } else {
      effectiveDelta = qtyDelta!
      effectiveMovementType = movementType ?? 'adjustment'
    }

    const { data: result, error: rpcError } = await admin.rpc('inv_adjust_stock', {
      p_product_id: productId,
      p_location_id: locationId,
      p_qty_delta: effectiveDelta,
      p_reason: reason,
      p_actor: auth.userId,
      p_batch_id: batchId ?? null,
      p_movement_type: effectiveMovementType,
    })
    if (rpcError) {
      throw mapRpcError(rpcError.message ?? 'inventory adjustment failed')
    }

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'update',
      resource: 'inventory_adjustment',
      resourceId: String(productId),
      before: { onHand: beforeOnHand ?? (result as any)?.before_on_hand ?? null },
      after: { onHand: (result as any)?.after_on_hand ?? null },
      reason,
      metadata: { locationId, batchId: batchId ?? null, mode, movementType: effectiveMovementType, qtyDelta: effectiveDelta },
    })

    return new Response(
      JSON.stringify({ ok: true, result }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

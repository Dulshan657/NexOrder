// transfer-stock Edge Function
//
// Move available (unreserved) stock from one location to another. Covers
// inter-warehouse (DC -> DC) transfers; within-warehouse bin re-slotting for the
// Warehouse role lands in a later phase. Delegates the atomic out+in legs to the
// inv_transfer_stock RPC (service_role-only EXECUTE). Direct ledger writes are
// RLS-blocked.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { generatePutawayTasks } from '../_shared/putawayTasks.ts'
import { requireModule } from '../_shared/modules.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

const inputSchema = z.object({
  productId: z.number().int().positive(),
  fromLocationId: z.number().int().positive(),
  toLocationId: z.number().int().positive(),
  qty: z.number().positive(),
  reason: z.string().max(500).optional(),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    const rl = await checkRateLimit(`transfer-stock:${auth.userId}`, { windowMs: 60_000, max: 60 })
    if (!rl.ok) {
      throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded — too many transfers in a short period')
    }

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    }
    const { productId, fromLocationId, toLocationId, qty, reason } = parsed.data

    if (fromLocationId === toLocationId) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Source and destination must differ')
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    const { data: result, error: rpcError } = await admin.rpc('inv_transfer_stock', {
      p_product_id: productId,
      p_from_loc: fromLocationId,
      p_to_loc: toLocationId,
      p_qty: qty,
      p_actor: auth.userId,
      p_reason: reason ?? null,
    })
    if (rpcError) {
      const msg = rpcError.message ?? 'transfer failed'
      // INSUFFICIENT_STOCK / INVALID_TRANSFER / INVALID_QTY bubble up as P0001 conflicts.
      const conflict = /INSUFFICIENT_STOCK|INVALID_TRANSFER|INVALID_QTY/.test(msg)
      throw new EdgeFunctionError(conflict ? 'CONFLICT' : 'INTERNAL', `transfer failed: ${msg}`)
    }

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'update',
      resource: 'inventory_transfer',
      resourceId: String(productId),
      after: { productId, fromLocationId, toLocationId, qty, reason: reason ?? null },
      metadata: { result },
    })

    // A transfer INTO a racked warehouse root (e.g. DC→DC) leaves stock at
    // staging and needs putting away. generatePutawayTasks self-skips when
    // toLocationId is a specific bin (within-warehouse re-slotting) or a non-
    // racked warehouse. Advisory: never fail the transfer on a putaway error.
    try {
      await generatePutawayTasks(admin, {
        warehouseId: toLocationId,
        lines: [{ product_id: productId, quantity: qty }],
        actorId: auth.userId,
      })
    } catch (_e) {
      // Advisory — swallow.
    }

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

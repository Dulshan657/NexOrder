// order-pick-tasks Edge Function
//
// Directed picking (P2 fix): returns the ACTIONABLE per-bin pick tasks for one
// order — the same allocation netting the route (recommend-pick-route) and the
// pick slip (generate-pick-slip) now read, so all three name the same bins.
// Read-only: it loads wie_order_pick_tasks (raw per-bin allocation) plus this
// order's lines and recorded picks, and runs them through the pure
// buildPickTasks helper (_shared/wie/pickTasks.ts) to split allocation-per-bin
// into pick-per-order-line-per-bin tasks with a `remaining` qty.
//
// Any warehouse's tasks are returned — the caller (PickWorkspaceModal) disables
// buttons for bins outside a Warehouse-role user's home site, mirroring the
// server-side guard record-pick enforces on the actual write.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { buildPickTasks, type AllocBin, type OrderLine, type PickRecord } from '../_shared/wie/pickTasks.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  orderId: z.string().min(1).max(120),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`order-pick-tasks:${auth.userId}`, { windowMs: 60_000, max: 120 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { orderId } = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const { data: binRows, error: binErr } = await admin.rpc('wie_order_pick_tasks', { p_order_id: orderId })
    if (binErr) throw new EdgeFunctionError('INTERNAL', `allocation load failed: ${binErr.message}`)

    const { data: lineRows, error: lineErr } = await admin
      .from('order_items')
      .select('id, product_id, quantity, pack_size')
      .eq('order_id', orderId)
    if (lineErr) throw new EdgeFunctionError('INTERNAL', `order lines load failed: ${lineErr.message}`)

    const { data: pickRows, error: pickErr } = await admin
      .from('pick_progress')
      .select('order_item_id, location_id, picked_qty')
      .eq('order_id', orderId)
    if (pickErr) throw new EdgeFunctionError('INTERNAL', `pick progress load failed: ${pickErr.message}`)

    const allocBins: AllocBin[] = ((binRows ?? []) as any[]).map((r) => ({
      productId: r.product_id,
      warehouseId: r.warehouse_id,
      warehouseCode: r.warehouse_code,
      locationId: r.location_id,
      code: r.code,
      graphNodeId: r.graph_node_id ?? null,
      qtyBase: Number(r.qty_base) || 0,
    }))

    const orderLines: OrderLine[] = ((lineRows ?? []) as any[]).map((r) => ({
      orderItemId: r.id,
      productId: r.product_id,
      quantity: Number(r.quantity) || 0,
      packSize: Number(r.pack_size) || 1,
    }))

    const picks: PickRecord[] = ((pickRows ?? []) as any[]).map((r) => ({
      orderItemId: r.order_item_id,
      locationId: r.location_id,
      pickedQty: Number(r.picked_qty) || 0,
    }))

    const tasks = buildPickTasks(allocBins, orderLines, picks)

    return new Response(JSON.stringify({ ok: true, tasks }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

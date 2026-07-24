// recommend-pick-route Edge Function
//
// Given one or more orders at a racked warehouse, return a shortest-travel pick
// walk: the order's ALLOCATED bins (wie_order_pick_stops), sequenced by the WIE
// engine (picking.ts, Dijkstra over the layout's walkway skeleton) starting from
// the dock. One order → a single route; multiple orders → a batch route over the
// merged stops. Warehouses without a published layout return {mode:'legacy'} so
// the caller keeps today's per-line pick flow. Read-only: it computes and returns
// a route, it does not record picks.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { loadWalkGraph } from '../_shared/loadWalkGraph.ts'
import { sequencePickRoute, sequenceBatchRoute, type PickStop } from '../_shared/wie/picking.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  warehouse_id: z.number().int().positive(),
  order_ids: z.array(z.string().min(1).max(120)).min(1).max(50),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`recommend-pick-route:${auth.userId}`, { windowMs: 60_000, max: 60 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { warehouse_id, order_ids } = parsed.data

    if (auth.role === 'Warehouse' && auth.profile.home_warehouse_id !== warehouse_id) {
      throw new EdgeFunctionError('FORBIDDEN', 'You can only pick at your own warehouse')
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    // Shared with recommend-putaway-route, so the two can never disagree about
    // what counts as a 'legacy' site or which node a walk starts from.
    const graphResult = await loadWalkGraph(admin, warehouse_id)
    if (graphResult.mode === 'legacy') {
      return new Response(JSON.stringify({ ok: true, mode: 'legacy', note: graphResult.note }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { graph, dockNodeId } = graphResult

    // Load each order's allocated bins as stops.
    const stopsByOrder: Record<string, PickStop[]> = {}
    for (const orderId of order_ids) {
      const { data: stopRows, error: sErr } = await admin.rpc('wie_order_pick_stops', {
        p_order_id: orderId, p_warehouse_id: warehouse_id,
      })
      if (sErr) throw new EdgeFunctionError('INTERNAL', `pick-stop load failed: ${sErr.message}`)
      stopsByOrder[orderId] = ((stopRows ?? []) as any[]).map((r) => ({
        locationId: r.location_id,
        graphNodeId: r.graph_node_id ?? null,
        accessOffsetM: Number(r.access_offset_m) || 0,
        meta: {
          orderId,
          orderItemId: r.order_item_id ?? null,
          productId: r.product_id,
          code: r.code,
          qtyBase: Number(r.qty_base) || 0,
        },
      }))
    }

    const route = order_ids.length === 1
      ? sequencePickRoute(graph, dockNodeId, stopsByOrder[order_ids[0]])
      : sequenceBatchRoute(graph, dockNodeId, stopsByOrder)

    const stops = route.stops.map((s) => ({
      sequence: s.sequence,
      locationId: s.locationId,
      code: (s.meta?.code as string) ?? null,
      productId: (s.meta?.productId as number) ?? null,
      orderItemId: (s.meta?.orderItemId as number) ?? null,
      orderId: (s.meta?.orderId as string) ?? null,
      qtyBase: (s.meta?.qtyBase as number) ?? 0,
      legDistanceM: s.legDistanceM,
    }))

    return new Response(JSON.stringify({
      ok: true, mode: 'engine',
      route: { stops, totalDistanceM: route.totalDistanceM, unreachableCount: route.unreachable.length },
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

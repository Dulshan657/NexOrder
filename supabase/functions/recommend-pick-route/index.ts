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
import { sequencePickRoute, sequenceBatchRoute, type PickStop } from '../_shared/wie/picking.ts'
import type { GraphEdge, GraphNode, WarehouseGraph } from '../_shared/wie/types.ts'

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

    const { data: wh, error: whErr } = await admin.from('locations')
      .select('id, kind, location_type, active_layout_id').eq('id', warehouse_id).single()
    if (whErr || !wh || (wh as any).kind !== 'WAREHOUSE') {
      throw new EdgeFunctionError('INVALID_INPUT', 'warehouse_id must reference a WAREHOUSE location')
    }
    const layoutId = (wh as any).active_layout_id as number | null
    if ((wh as any).location_type !== 'racked' || !layoutId) {
      return new Response(JSON.stringify({ ok: true, mode: 'legacy' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Rebuild the layout's walkway graph in memory (real DB node ids).
    const { data: nodeRows, error: nErr } = await admin.from('layout_graph_nodes')
      .select('id, floor, x, y, node_type').eq('layout_id', layoutId).order('id')
    if (nErr) throw new EdgeFunctionError('INTERNAL', `graph nodes load failed: ${nErr.message}`)
    const { data: edgeRows, error: eErr } = await admin.from('layout_graph_edges')
      .select('from_node, to_node, weight_m, bidirectional').eq('layout_id', layoutId)
    if (eErr) throw new EdgeFunctionError('INTERNAL', `graph edges load failed: ${eErr.message}`)

    const nodes: GraphNode[] = ((nodeRows ?? []) as any[]).map((n) => ({
      id: n.id, floor: n.floor, x: n.x, y: n.y, nodeType: n.node_type,
    }))
    const edges: GraphEdge[] = ((edgeRows ?? []) as any[]).map((e) => ({
      fromNode: e.from_node, toNode: e.to_node, weightM: Number(e.weight_m), bidirectional: e.bidirectional,
    }))
    const graph: WarehouseGraph = { nodes, edges }

    const dock = nodes.find((n) => n.nodeType === 'dock')
    if (!dock) {
      return new Response(JSON.stringify({ ok: true, mode: 'legacy', note: 'no dock in layout' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

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
      ? sequencePickRoute(graph, dock.id, stopsByOrder[order_ids[0]])
      : sequenceBatchRoute(graph, dock.id, stopsByOrder)

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

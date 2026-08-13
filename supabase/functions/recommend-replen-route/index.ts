// recommend-replen-route Edge Function
//
// The replenishment walk. Given a racked warehouse, return its ASSIGNED
// replenishment tasks (wie_replen_stops, mig 00082) sequenced into a
// shortest-travel round from the dock by the same engine that routes pickers.
//
// Sequencing is anchored on the SOURCE bin, one stop per task, and that is
// deliberate. Each task has two locations, but they are not two independently
// schedulable stops: the walker must pull before they can place. Emitting both
// and letting sequencePickRoute order them would be a bug — it is a
// nearest-neighbour tour over independent stops and would happily schedule
// "place" before "pull". The source→destination leg is instead added as a fixed
// per-stop adder, which is ZERO for the common same-rack case (every level of a
// rack shares one graph node, mig 00072).
//
// Warehouses without a published layout return {mode:'legacy'}: the caller shows
// the assigned tasks as a plain list, which is what a bulk site wants.
//
// Read-only. Completing a stop is complete-replenishment's job.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { loadWalkGraph } from '../_shared/loadWalkGraph.ts'
import { sequencePickRoute, type PickStop } from '../_shared/wie/picking.ts'
import { requireModule } from '../_shared/modules.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  warehouse_id: z.number().int().positive(),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`recommend-replen-route:${auth.userId}`, { windowMs: 60_000, max: 60 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { warehouse_id } = parsed.data

    if (auth.role === 'Warehouse' && auth.profile.home_warehouse_id !== warehouse_id) {
      throw new EdgeFunctionError('FORBIDDEN', 'You can only replenish at your own warehouse')
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    // Stops load first: an empty walk is the common case and answering it costs
    // one cheap query instead of a whole graph rebuild.
    const { data: stopRows, error: sErr } = await admin.rpc('wie_replen_stops', {
      p_warehouse_id: warehouse_id,
    })
    if (sErr) throw new EdgeFunctionError('INTERNAL', `replenishment-stop load failed: ${sErr.message}`)
    const rows = (stopRows ?? []) as any[]
    if (rows.length === 0) {
      return new Response(JSON.stringify({
        ok: true, mode: 'engine',
        route: { stops: [], totalDistanceM: 0, unreachableCount: 0 },
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const graphResult = await loadWalkGraph(admin, warehouse_id)
    if (graphResult.mode === 'legacy') {
      return new Response(JSON.stringify({ ok: true, mode: 'legacy', note: graphResult.note }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const stops: PickStop[] = rows.map((r) => ({
      locationId: r.location_id,
      graphNodeId: r.graph_node_id ?? null,
      accessOffsetM: Number(r.access_offset_m) || 0,
      meta: {
        taskId: Number(r.task_id),
        productId: r.product_id,
        code: r.code,
        toLocationId: r.to_location_id,
        toCode: r.to_code,
        toAccessOffsetM: Number(r.to_access_offset_m) || 0,
        sameNode: Boolean(r.same_node),
        qtyBase: Number(r.qty_base) || 0,
        huCode: r.hu_code ?? null,
        huType: r.hu_type ?? null,
        sku: r.sku ?? null,
        productName: r.product_name ?? null,
      },
    }))

    const route = sequencePickRoute(graphResult.graph, graphResult.dockNodeId, stops)

    // The pull→place leg, priced per stop. Zero when both levels share a graph
    // node, which is every same-rack replenishment; otherwise read straight out
    // of layout_travel_distances, which is keyed node-to-node so it needs no
    // dock anchoring.
    const legPairs = rows
      .filter((r) => !r.same_node && r.graph_node_id != null && r.to_graph_node_id != null)
      .map((r) => ({ from: r.graph_node_id as number, to: r.to_graph_node_id as number }))
    const placeLegByTask = new Map<number, number>()
    if (legPairs.length > 0) {
      const { data: distRows } = await admin
        .from('layout_travel_distances')
        .select('from_node_id, to_node_id, distance_m')
        .eq('layout_id', graphResult.layoutId)
        .in('from_node_id', [...new Set(legPairs.map((p) => p.from))])
        .in('to_node_id', [...new Set(legPairs.map((p) => p.to))])
      const distByPair = new Map<string, number>()
      for (const d of (distRows ?? []) as any[]) {
        distByPair.set(`${d.from_node_id}:${d.to_node_id}`, Number(d.distance_m) || 0)
      }
      for (const r of rows) {
        if (r.same_node || r.graph_node_id == null || r.to_graph_node_id == null) continue
        const m = distByPair.get(`${r.graph_node_id}:${r.to_graph_node_id}`)
        if (m != null) placeLegByTask.set(Number(r.task_id), m)
      }
    }

    const withLeg = (s: any, reachable: boolean, sequence: number) => {
      const meta = s.meta as Record<string, unknown>
      const placeLegM = placeLegByTask.get(meta.taskId as number) ?? 0
      return {
        sequence,
        locationId: s.locationId,
        legDistanceM: reachable ? s.legDistanceM : 0,
        placeLegM,
        reachable,
        ...meta,
      }
    }

    // Unreachable stops (a bin missing from the published layout) are returned
    // too, unsequenced — the walker still has to move that stock, and hiding it
    // would silently drop work off the run.
    const sequenced = route.stops.map((s) => withLeg(s, true, s.sequence))
    const stranded = route.unreachable.map((s, i) => withLeg(s, false, sequenced.length + i + 1))

    const placeTotal = [...sequenced, ...stranded].reduce((sum, s) => sum + (s.placeLegM ?? 0), 0)

    return new Response(JSON.stringify({
      ok: true, mode: 'engine',
      route: {
        stops: [...sequenced, ...stranded],
        totalDistanceM: route.totalDistanceM + placeTotal,
        unreachableCount: route.unreachable.length,
      },
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

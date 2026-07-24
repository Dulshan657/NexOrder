// recommend-putaway-route Edge Function
//
// The walk. Given a racked warehouse, return its ASSIGNED putaway tasks
// (wie_putaway_stops, mig 00080) sequenced into a shortest-travel round from the
// dock by the same WIE engine that routes pickers — picking.ts is generic over
// stops, so putaway needs no engine of its own.
//
// Warehouses without a published layout return {mode:'legacy'}: the caller then
// shows the assigned tasks as a plain list, in receipt order, which is exactly
// what a bulk site wants.
//
// Read-only. It computes an order to walk in; completing a stop is
// complete-putaway's job.

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

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  warehouse_id: z.number().int().positive(),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`recommend-putaway-route:${auth.userId}`, { windowMs: 60_000, max: 60 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { warehouse_id } = parsed.data

    if (auth.role === 'Warehouse' && auth.profile.home_warehouse_id !== warehouse_id) {
      throw new EdgeFunctionError('FORBIDDEN', 'You can only put away stock at your own warehouse')
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    // Stops load first: an empty walk is the common case (nothing assigned yet)
    // and answering it costs one cheap query instead of a whole graph rebuild.
    const { data: stopRows, error: sErr } = await admin.rpc('wie_putaway_stops', {
      p_warehouse_id: warehouse_id,
    })
    if (sErr) throw new EdgeFunctionError('INTERNAL', `putaway-stop load failed: ${sErr.message}`)
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
        recId: Number(r.rec_id),
        productId: r.product_id,
        code: r.code,
        qtyBase: Number(r.qty_base) || 0,
        huCode: r.hu_code ?? null,
        huType: r.hu_type ?? null,
        sku: r.sku ?? null,
        productName: r.product_name ?? null,
      },
    }))

    const route = sequencePickRoute(graphResult.graph, graphResult.dockNodeId, stops)

    // Unreachable stops (a bin missing from the published layout) are returned
    // too, unsequenced — the walker still has to place them, and hiding them
    // would silently drop work off the run.
    const sequenced = route.stops.map((s) => ({
      sequence: s.sequence,
      locationId: s.locationId,
      legDistanceM: s.legDistanceM,
      reachable: true,
      ...(s.meta as Record<string, unknown>),
    }))
    const stranded = route.unreachable.map((s, i) => ({
      sequence: sequenced.length + i + 1,
      locationId: s.locationId,
      legDistanceM: 0,
      reachable: false,
      ...(s.meta as Record<string, unknown>),
    }))

    return new Response(JSON.stringify({
      ok: true, mode: 'engine',
      route: {
        stops: [...sequenced, ...stranded],
        totalDistanceM: route.totalDistanceM,
        unreachableCount: route.unreachable.length,
      },
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

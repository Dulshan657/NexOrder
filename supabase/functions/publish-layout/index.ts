// publish-layout Edge Function
//
// Promotes a draft layout to 'published' — the heavy transition that turns the
// drawn grid into a routable digital twin. Steps: build the walkway skeleton from
// walkway/dock objects (WIE engine), snap storage placements onto it, precompute
// dock->node travel distances, validate reachability, then hand everything to the
// atomic wie_publish_layout_tx RPC (graph write + status flip + racked opt-in in
// one transaction). Validation failures return a structured rejection list and
// nothing is published.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import {
  buildWalkGraph,
  computeAnchorDistances,
  snapPlacementToNode,
} from '../_shared/wie/graph.ts'
import {
  buildWalkableCells,
  evaluatePublishReadiness,
  type ReadinessObject,
  type ReadinessPlacement,
} from '../_shared/wie/publishReadiness.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin']

const inputSchema = z.object({ layout_id: z.number().int().positive() })

interface Rejection {
  code: string
  message: string
  locationIds?: number[]
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`publish-layout:${auth.userId}`, { windowMs: 60_000, max: 20 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { layout_id } = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const { data: layout, error: lErr } = await admin.from('warehouse_layouts').select('*').eq('id', layout_id).single()
    if (lErr || !layout) throw new EdgeFunctionError('NOT_FOUND', `Layout ${layout_id} not found`)
    if ((layout as any).status !== 'draft') {
      throw new EdgeFunctionError('CONFLICT', `Layout is ${(layout as any).status}; only drafts can be published`)
    }

    const cellSize = Number((layout as any).cell_size_m) || 1
    const warehouseId = (layout as any).warehouse_id as number

    const { data: objects } = await admin.from('layout_objects').select('*').eq('layout_id', layout_id)
    const { data: placements } = await admin.from('layout_placements').select('*').eq('layout_id', layout_id)

    // ── Validate via the shared readiness module (same checks the designer's
    //    live checklist runs, off the same messages) ──────────────────────────
    const readinessObjects: ReadinessObject[] = ((objects ?? []) as any[]).map((o) => ({
      objectType: o.object_type, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h,
    }))
    const readinessPlacements: ReadinessPlacement[] = ((placements ?? []) as any[]).map((p) => ({
      id: String(p.location_id), floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h,
    }))

    const readiness = evaluatePublishReadiness({
      objects: readinessObjects, placements: readinessPlacements, cellSizeM: cellSize,
    })
    if (!readiness.ready) {
      const rejections: Rejection[] = readiness.checks
        .filter((c) => c.status === 'fail')
        .map((c) => ({
          code: c.code,
          message: c.message,
          ...(c.code === 'unreachable_bins' ? { locationIds: readiness.unreachableIds.map(Number) } : {}),
        }))
      return new Response(JSON.stringify({ ok: false, rejections }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Build graph + anchors + snaps for the atomic commit ──────────────────
    // Readiness passed, so every placement snaps to a dock-reachable node. Rebuild
    // the skeleton from the same shared cell set the check used.
    const { cells } = buildWalkableCells(readinessObjects, readinessPlacements)
    const graph = buildWalkGraph(cells, cellSize)
    const anchorIds = graph.nodes.filter((n) => n.nodeType === 'dock').map((n) => n.id)
    const distanceRows = computeAnchorDistances(graph, anchorIds)

    const snaps: Array<{ location_id: number; node_local_id: number; access_offset_m: number }> = []
    for (const p of placements as any[]) {
      const snap = snapPlacementToNode(
        { locationId: p.location_id, floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h },
        graph.nodes,
        cellSize,
      )
      // graphNodeId is non-null: reachability was already validated above.
      snaps.push({ location_id: p.location_id, node_local_id: snap.graphNodeId!, access_offset_m: snap.accessOffsetM })
    }

    // Phase 1 does NOT auto-retire bins on publish: deactivating "unplaced" active
    // bins would wrongly disable the ZONE/RACK ancestors of placed bins and any
    // pre-existing empty bin the admin simply hasn't drawn yet. Removing a
    // draft-created bin already deletes it (mutate-layout GC). Bin retirement with
    // proper UX is a Phase 2 concern; the RPC still guards stock-in-removed-bin.
    const toDeactivate: number[] = []

    // ── Payloads for the atomic publish RPC ──────────────────────────────────
    const nodePayload = graph.nodes.map((n) => ({ local_id: n.id, floor: n.floor, x: n.x, y: n.y, node_type: n.nodeType }))
    const edgePayload = graph.edges.map((e) => ({ from_local: e.fromNode, to_local: e.toNode, weight_m: e.weightM, bidirectional: e.bidirectional }))
    const distancePayload = distanceRows.map((r) => ({ from_local: r.fromNodeId, to_local: r.toNodeId, distance_m: r.distanceM }))
    // A draft-created staging location isn't a placement (it's linked via
    // layout_objects.staging_location_id), so it needs its own activation entry
    // or it would stay inactive forever after publish.
    const stagingLocationIds = [
      ...new Set(((objects ?? []) as any[]).map((o) => o.staging_location_id).filter((id): id is number => id != null)),
    ]
    const toActivate = [...(placements as any[]).map((p) => p.location_id), ...stagingLocationIds]

    const { data: result, error: rpcErr } = await admin.rpc('wie_publish_layout_tx', {
      p_layout_id: layout_id,
      p_nodes: nodePayload,
      p_edges: edgePayload,
      p_snaps: snaps,
      p_distances: distancePayload,
      p_activate: toActivate,
      p_deactivate: toDeactivate,
      p_actor: auth.userId,
    })
    if (rpcErr) throw new EdgeFunctionError('INTERNAL', `publish failed: ${rpcErr.message}`)

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'warehouse_layouts',
      resourceId: String(layout_id), after: { published: true }, metadata: { result },
    })

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

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
import type { WalkCell } from '../_shared/wie/types.ts'

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

    const rejections: Rejection[] = []

    // ── Build walkable cells from walkway + dock objects ─────────────────────
    const cellMap = new Map<string, WalkCell>()
    const addCell = (floor: number, x: number, y: number, isDock: boolean, isLift: boolean): void => {
      const key = `${floor}:${x}:${y}`
      const existing = cellMap.get(key)
      if (existing) { existing.isDock = existing.isDock || isDock; existing.isLift = existing.isLift || isLift }
      else cellMap.set(key, { x, y, floor, isDock, isLift })
    }
    let hasDock = false
    for (const o of (objects ?? []) as any[]) {
      // walkway / dock / lift are all walkable; lift cells also connect floors.
      if (o.object_type !== 'walkway' && o.object_type !== 'dock' && o.object_type !== 'lift') continue
      const isDock = o.object_type === 'dock'
      const isLift = o.object_type === 'lift'
      if (isDock) hasDock = true
      for (let dy = 0; dy < o.h; dy++) {
        for (let dx = 0; dx < o.w; dx++) addCell(o.floor, o.x + dx, o.y + dy, isDock, isLift)
      }
    }

    // Walls and storage footprints are NOT walkable — subtract them so routes
    // can't pass through a rack or a wall even if a walkway was painted over them.
    const removeCell = (floor: number, x: number, y: number): void => { cellMap.delete(`${floor}:${x}:${y}`) }
    for (const o of (objects ?? []) as any[]) {
      if (o.object_type !== 'wall') continue
      for (let dy = 0; dy < o.h; dy++) {
        for (let dx = 0; dx < o.w; dx++) removeCell(o.floor, o.x + dx, o.y + dy)
      }
    }
    for (const p of (placements ?? []) as any[]) {
      for (let dy = 0; dy < p.h; dy++) {
        for (let dx = 0; dx < p.w; dx++) removeCell(p.floor, p.x + dx, p.y + dy)
      }
    }

    if (!hasDock) rejections.push({ code: 'no_dock', message: 'Add at least one dock — putaway routes start from a dock.' })
    if (cellMap.size === 0) {
      rejections.push({ code: 'no_walkways', message: 'Draw walkways connecting docks to your storage.' })
    }
    if (!placements || placements.length === 0) {
      rejections.push({ code: 'no_bins', message: 'Place at least one storage bin before publishing.' })
    }

    if (rejections.length > 0) {
      return new Response(JSON.stringify({ ok: false, rejections }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Build graph + anchors (dock nodes) ───────────────────────────────────
    const cells = [...cellMap.values()]
    const graph = buildWalkGraph(cells, cellSize)
    const anchorIds = graph.nodes.filter((n) => n.nodeType === 'dock').map((n) => n.id)

    // ── Snap placements + reachability check ─────────────────────────────────
    const distanceRows = computeAnchorDistances(graph, anchorIds)
    const reachable = new Set(distanceRows.map((r) => r.toNodeId))

    const snaps: Array<{ location_id: number; node_local_id: number; access_offset_m: number }> = []
    const unreachable: number[] = []
    for (const p of placements as any[]) {
      const snap = snapPlacementToNode(
        { locationId: p.location_id, floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h },
        graph.nodes,
        cellSize,
      )
      if (snap.graphNodeId === null || !reachable.has(snap.graphNodeId)) {
        unreachable.push(p.location_id)
        continue
      }
      snaps.push({ location_id: p.location_id, node_local_id: snap.graphNodeId, access_offset_m: snap.accessOffsetM })
    }
    if (unreachable.length > 0) {
      rejections.push({
        code: 'unreachable_bins',
        message: `${unreachable.length} bin(s) have no walkway route from a dock. Connect them and republish.`,
        locationIds: unreachable,
      })
    }

    // Phase 1 does NOT auto-retire bins on publish: deactivating "unplaced" active
    // bins would wrongly disable the ZONE/RACK ancestors of placed bins and any
    // pre-existing empty bin the admin simply hasn't drawn yet. Removing a
    // draft-created bin already deletes it (mutate-layout GC). Bin retirement with
    // proper UX is a Phase 2 concern; the RPC still guards stock-in-removed-bin.
    const toDeactivate: number[] = []

    if (rejections.length > 0) {
      return new Response(JSON.stringify({ ok: false, rejections }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Payloads for the atomic publish RPC ──────────────────────────────────
    const nodePayload = graph.nodes.map((n) => ({ local_id: n.id, floor: n.floor, x: n.x, y: n.y, node_type: n.nodeType }))
    const edgePayload = graph.edges.map((e) => ({ from_local: e.fromNode, to_local: e.toNode, weight_m: e.weightM, bidirectional: e.bidirectional }))
    const distancePayload = distanceRows.map((r) => ({ from_local: r.fromNodeId, to_local: r.toNodeId, distance_m: r.distanceM }))
    const toActivate = (placements as any[]).map((p) => p.location_id)

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

// wie-simulate Edge Function
//
// Score a layout (DRAFT or published) against recent real demand and diff it
// against the warehouse's active layout. Replays the last N days of order picks
// (wie_simulation_pick_history) through the target layout's walkway graph via the
// engine's simulate.ts, rolling up travel / utilization / congestion KPIs.
//
// A draft has no persisted graph (that's built at publish), so we build it
// IN-MEMORY here from the draft's walkway/dock objects + placements — the same
// pure engine functions publish-layout uses — which is what lets an operator
// score a draft BEFORE publishing. Published layouts use their persisted graph.
//
// Purely analytical: reads history, computes numbers, persists to wie_simulations;
// never moves stock or changes a layout. Admin/Manager only.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { buildWalkGraph, snapPlacementToNode } from '../_shared/wie/graph.ts'
import { simulateLayout, diffKpis, type SimBin, type SimOrder, type SimStop } from '../_shared/wie/simulate.ts'
import type { GraphEdge, GraphNode, WalkCell, WarehouseGraph } from '../_shared/wie/types.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']
const PAGE = 1000

const inputSchema = z.object({
  layout_id: z.number().int().positive(),
  days: z.number().int().min(1).max(365).optional(),
})

/** Page through a table read so the Data API's 1000-row cap can't silently
 *  truncate (and throw on any error rather than swallow it). */
async function fetchAll(build: (from: number, to: number) => any, label: string): Promise<any[]> {
  const all: any[] = []
  let from = 0
  for (;;) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new EdgeFunctionError('INTERNAL', `${label} load failed: ${error.message}`)
    const rows = (data ?? []) as any[]
    all.push(...rows)
    if (rows.length < PAGE) break
    from += PAGE
  }
  return all
}

interface LayoutContext {
  graph: WarehouseGraph
  dockNodeId: number | null
  placementByLocation: Map<number, { nodeId: number | null; offset: number }>
  bins: SimBin[]
}

/** Current fill (slots) per placed bin, chunked so a big IN() list stays legal. */
async function loadUsedSlots(admin: any, locIds: number[]): Promise<Map<number, number>> {
  const used = new Map<number, number>()
  for (let i = 0; i < locIds.length; i += 300) {
    const chunk = locIds.slice(i, i + 300)
    const rows = await fetchAll(
      (f, t) => admin.from('inventory_balances')
        .select('location_id, on_hand, products(size_factor)').gt('on_hand', 0).in('location_id', chunk).range(f, t),
      'inventory_balances',
    )
    for (const b of rows) {
      const slots = Number(b.on_hand) * (Number(b.products?.size_factor) || 1)
      used.set(b.location_id, (used.get(b.location_id) ?? 0) + slots)
    }
  }
  return used
}

async function buildLayoutContext(admin: any, layoutId: number, cellSizeM: number): Promise<LayoutContext> {
  const nodeRows = await fetchAll(
    (f, t) => admin.from('layout_graph_nodes').select('id, floor, x, y, node_type').eq('layout_id', layoutId).order('id').range(f, t),
    'layout_graph_nodes',
  )

  const placementByLocation = new Map<number, { nodeId: number | null; offset: number }>()
  let graph: WarehouseGraph
  let dockNodeId: number | null
  let binSource: Array<{ location_id: number; capacity_slots: number | null }>

  if (nodeRows.length > 0) {
    // Published layout — use the persisted graph (real DB node ids).
    const edgeRows = await fetchAll(
      (f, t) => admin.from('layout_graph_edges').select('from_node, to_node, weight_m, bidirectional').eq('layout_id', layoutId).range(f, t),
      'layout_graph_edges',
    )
    const nodes: GraphNode[] = nodeRows.map((n) => ({ id: n.id, floor: n.floor, x: n.x, y: n.y, nodeType: n.node_type }))
    const edges: GraphEdge[] = edgeRows.map((e) => ({ fromNode: e.from_node, toNode: e.to_node, weightM: Number(e.weight_m), bidirectional: e.bidirectional }))
    graph = { nodes, edges }
    dockNodeId = nodes.find((n) => n.nodeType === 'dock')?.id ?? null

    const placeRows = await fetchAll(
      (f, t) => admin.from('layout_placements').select('location_id, graph_node_id, access_offset_m, locations(capacity_slots)').eq('layout_id', layoutId).not('graph_node_id', 'is', null).range(f, t),
      'layout_placements',
    )
    for (const p of placeRows) placementByLocation.set(p.location_id, { nodeId: p.graph_node_id ?? null, offset: Number(p.access_offset_m) || 0 })
    binSource = placeRows.map((p) => ({ location_id: p.location_id, capacity_slots: p.locations?.capacity_slots != null ? Number(p.locations.capacity_slots) : null }))
  } else {
    // Draft layout — build the graph in memory from its objects + placements, the
    // same way publish-layout does, so a draft can be scored before publishing.
    const objRows = await fetchAll(
      (f, t) => admin.from('layout_objects').select('object_type, floor, x, y, w, h').eq('layout_id', layoutId).range(f, t),
      'layout_objects',
    )
    const placeRows = await fetchAll(
      (f, t) => admin.from('layout_placements').select('location_id, floor, x, y, w, h, locations(capacity_slots)').eq('layout_id', layoutId).range(f, t),
      'layout_placements',
    )

    const cellMap = new Map<string, WalkCell>()
    const add = (floor: number, x: number, y: number, isDock: boolean, isLift: boolean) => {
      const key = `${floor}:${x}:${y}`
      const ex = cellMap.get(key)
      if (ex) { ex.isDock = ex.isDock || isDock; ex.isLift = ex.isLift || isLift }
      else cellMap.set(key, { x, y, floor, isDock, isLift })
    }
    for (const o of objRows) {
      if (o.object_type !== 'walkway' && o.object_type !== 'dock' && o.object_type !== 'lift') continue
      const isDock = o.object_type === 'dock'
      const isLift = o.object_type === 'lift'
      for (let dy = 0; dy < o.h; dy++) for (let dx = 0; dx < o.w; dx++) add(o.floor, o.x + dx, o.y + dy, isDock, isLift)
    }
    const remove = (floor: number, x: number, y: number) => cellMap.delete(`${floor}:${x}:${y}`)
    for (const o of objRows) if (o.object_type === 'wall') for (let dy = 0; dy < o.h; dy++) for (let dx = 0; dx < o.w; dx++) remove(o.floor, o.x + dx, o.y + dy)
    for (const p of placeRows) for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) remove(p.floor, p.x + dx, p.y + dy)

    graph = buildWalkGraph([...cellMap.values()], cellSizeM)
    dockNodeId = graph.nodes.find((n) => n.nodeType === 'dock')?.id ?? null

    for (const p of placeRows) {
      const snap = snapPlacementToNode({ locationId: p.location_id, floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h }, graph.nodes, cellSizeM)
      placementByLocation.set(p.location_id, { nodeId: snap.graphNodeId, offset: snap.accessOffsetM })
    }
    binSource = placeRows.map((p) => ({ location_id: p.location_id, capacity_slots: p.locations?.capacity_slots != null ? Number(p.locations.capacity_slots) : null }))
  }

  const usedByLoc = await loadUsedSlots(admin, binSource.map((b) => b.location_id))
  const bins: SimBin[] = binSource.map((b) => ({
    locationId: b.location_id,
    graphNodeId: placementByLocation.get(b.location_id)?.nodeId ?? null,
    capacitySlots: b.capacity_slots,
    usedSlots: usedByLoc.get(b.location_id) ?? 0,
  }))

  return { graph, dockNodeId, placementByLocation, bins }
}

function buildOrders(historyByOrder: Map<string, number[]>, ctx: LayoutContext): SimOrder[] {
  const orders: SimOrder[] = []
  for (const [orderId, locIds] of historyByOrder) {
    const stops: SimStop[] = locIds.map((loc) => {
      const p = ctx.placementByLocation.get(loc)
      return { locationId: loc, graphNodeId: p?.nodeId ?? null, accessOffsetM: p?.offset ?? 0 }
    })
    orders.push({ orderId, stops })
  }
  return orders
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`wie-simulate:${auth.userId}`, { windowMs: 60_000, max: 20 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { layout_id, days = 30 } = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const { data: layout, error: lErr } = await admin.from('warehouse_layouts')
      .select('id, warehouse_id, cell_size_m').eq('id', layout_id).single()
    if (lErr || !layout) throw new EdgeFunctionError('NOT_FOUND', `Layout ${layout_id} not found`)
    const warehouseId = (layout as any).warehouse_id as number
    const cellSizeM = Number((layout as any).cell_size_m) || 1

    const { data: whRow, error: whErr } = await admin.from('locations').select('active_layout_id').eq('id', warehouseId).single()
    if (whErr || !whRow) throw new EdgeFunctionError('INTERNAL', 'Could not load the warehouse')
    const activeLayoutId = (whRow as any).active_layout_id as number | null

    // Historical demand (distinct order→bin picks in the window), paginated.
    const histRows = await fetchAll(
      (f, t) => admin.rpc('wie_simulation_pick_history', { p_warehouse_id: warehouseId, p_days: days }).range(f, t),
      'pick history',
    )
    const historyByOrder = new Map<string, number[]>()
    for (const r of histRows) {
      const list = historyByOrder.get(r.order_id) ?? []
      list.push(r.location_id)
      historyByOrder.set(r.order_id, list)
    }

    // Target layout (draft graph built in memory if unpublished).
    const targetCtx = await buildLayoutContext(admin, layout_id, cellSizeM)
    if (targetCtx.dockNodeId === null) {
      throw new EdgeFunctionError('CONFLICT', 'Layout has no dock/walkways to route from — draw them before simulating')
    }
    const targetKpis = simulateLayout(targetCtx.graph, targetCtx.dockNodeId, buildOrders(historyByOrder, targetCtx), targetCtx.bins)

    // Baseline = the active layout (skip when the target IS the active layout).
    let baselineKpis = null
    let diff: (ReturnType<typeof diffKpis> & { coverageWarning: boolean }) | null = null
    if (activeLayoutId && activeLayoutId !== layout_id) {
      const baseCtx = await buildLayoutContext(admin, activeLayoutId, cellSizeM)
      if (baseCtx.dockNodeId !== null) {
        baselineKpis = simulateLayout(baseCtx.graph, baseCtx.dockNodeId, buildOrders(historyByOrder, baseCtx), baseCtx.bins)
        // Coverage warning: if the target leaves MORE stops unreachable than the
        // baseline, its lower travel is partly an artefact of not serving those
        // bins — the diff isn't apples-to-apples, so flag it.
        diff = { ...diffKpis(baselineKpis, targetKpis), coverageWarning: targetKpis.unreachableStops > baselineKpis.unreachableStops }
      }
    }

    const params = { days, orderCount: historyByOrder.size }
    const { data: saved, error: sErr } = await admin.from('wie_simulations').insert({
      warehouse_id: warehouseId, layout_id, baseline_layout_id: activeLayoutId,
      params, kpis: targetKpis, baseline_kpis: baselineKpis, diff, created_by: auth.userId,
    } as any).select('id').single()
    if (sErr) throw new EdgeFunctionError('INTERNAL', `failed to persist simulation: ${sErr.message}`)

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'create', resource: 'wie_simulations',
      resourceId: String((saved as any).id), metadata: { layout_id, warehouse_id: warehouseId, days },
    })

    return new Response(JSON.stringify({
      ok: true, simulationId: (saved as any).id, params, kpis: targetKpis, baselineKpis, diff,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

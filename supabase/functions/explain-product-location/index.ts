// explain-product-location Edge Function (NX-0039)
//
// "Where is this product, and how do I walk it?" for one product at one
// warehouse: its home bin, every location holding it (home / off home / at the
// dock), where a NEW delivery would go and why, and two walks from the dock —
// the putaway walk to that bin and the pick walk to the stock.
//
// Read-only, and it decides nothing of its own:
//   - where a delivery goes is generatePutawayTasks in DRY RUN — the very path
//     receiving takes, so the normal putaway rules (wie_rules, category
//     compatibility, hold zones, home first, overflow nearest home) answer, and
//     nothing is written;
//   - which bins hold the stock is inventory_balances over
//     inv_warehouse_draw_locations, the one definition of "this warehouse";
//   - both walks are sequencePickRoute + legPaths over loadWalkGraph, exactly as
//     recommend-pick-route draws an order's walk.
// Sites with no published layout get the summary and mode 'legacy' (no walks).

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { loadWalkGraph } from '../_shared/loadWalkGraph.ts'
import { generatePutawayTasks } from '../_shared/putawayTasks.ts'
import { loadHomeBins } from '../_shared/putawayHome.ts'
import { assertMayActAtWarehouse } from '../_shared/receiveDestination.ts'
import { requireModule } from '../_shared/modules.ts'
import { sequencePickRoute, legPaths, simplifyPath, type PickStop } from '../_shared/wie/picking.ts'
import type { WarehouseGraph } from '../_shared/wie/types.ts'
import {
  productWhereabouts,
  newDeliveryReason,
  pickWalkStops,
  walkSummary,
  describePlace,
  type PlacementRef,
  type PlaceKind,
} from '../_shared/wie/productWhereabouts.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  warehouse_id: z.number().int().positive(),
  product_id: z.number().int().positive(),
})

type PathPoint = { floor: number; x: number; y: number }

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new EdgeFunctionError('INTERNAL', `${what} load failed: ${res.error.message}`)
  return res.data
}

/** Node ids → corner points; an id the graph does not know drops the path (straight leg). */
function toPathPoints(ids: number[] | null, nodeById: Map<number, PathPoint>): PathPoint[] | undefined {
  if (!ids) return undefined
  const points: PathPoint[] = []
  for (const id of ids) {
    const n = nodeById.get(id)
    if (!n) return undefined
    points.push({ floor: n.floor, x: n.x, y: n.y })
  }
  return simplifyPath(points)
}

interface LocRow { id: number; kind: PlaceKind; code: string; name: string | null; parent_id: number | null }

/**
 * Code and readable place label (describePlace) for each location: its parent
 * says "which rack", and the nearest ZONE among its ancestors says "which area".
 * Three short reads (the locations, their parents, the grandparents) cover a
 * rack level under a rack under a zone.
 */
async function loadPlaces(admin: any, ids: number[], warehouseId: number) {
  const byId = new Map<number, LocRow>()
  let want = [...new Set(ids)]
  for (let depth = 0; depth < 3 && want.length; depth++) {
    const rows = (must(
      await admin.from('locations').select('id, kind, code, name, parent_id').in('id', want) as any,
      'locations',
    ) ?? []) as LocRow[]
    for (const r of rows) byId.set(Number(r.id), { ...r, id: Number(r.id) })
    want = [...new Set(rows.map((r) => r.parent_id).filter((x): x is number => x != null && !byId.has(Number(x))))]
  }
  const zoneOf = (loc: LocRow): string | null => {
    let cur = loc.parent_id != null ? byId.get(Number(loc.parent_id)) : undefined
    for (let i = 0; cur && i < 3; i++) {
      if (cur.kind === 'ZONE') return cur.name ?? cur.code
      cur = cur.parent_id != null ? byId.get(Number(cur.parent_id)) : undefined
    }
    return null
  }
  const out = new Map<number, { code: string; place: string }>()
  for (const id of ids) {
    const loc = byId.get(id)
    if (!loc) { out.set(id, { code: String(id), place: String(id) }); continue }
    const parent = loc.parent_id != null ? byId.get(Number(loc.parent_id)) ?? null : null
    out.set(id, {
      code: loc.code,
      place: describePlace({
        isRoot: id === warehouseId,
        kind: loc.kind,
        code: loc.code,
        name: loc.name,
        parent: parent ? { kind: parent.kind, code: parent.code, name: parent.name } : null,
        zoneName: zoneOf(loc),
      }),
    })
  }
  return out
}

/** Sequence stops from the dock and shape them like recommend-pick-route's stops. */
function buildWalk(graph: WarehouseGraph, dockNodeId: number, stops: PickStop[], productId: number) {
  const route = sequencePickRoute(graph, dockNodeId, stops)
  const nodeById = new Map(graph.nodes.map((n) => [n.id, { floor: n.floor, x: n.x, y: n.y }]))
  const paths = legPaths(graph, dockNodeId, route.stops)
  const shaped = route.stops.map((s, i) => ({
    sequence: s.sequence,
    locationId: s.locationId,
    code: (s.meta?.code as string) ?? null,
    place: (s.meta?.place as string) ?? null,
    productId,
    orderItemId: null,
    orderId: null,
    qtyBase: (s.meta?.qtyBase as number) ?? 0,
    legDistanceM: s.legDistanceM,
    path: toPathPoints(paths[i], nodeById),
  }))
  const summary = walkSummary(shaped)
  return {
    stops: shaped,
    totalDistanceM: route.totalDistanceM,
    unreachableCount: route.unreachable.length,
    steps: summary.steps,
  }
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`explain-product-location:${auth.userId}`, { windowMs: 60_000, max: 60 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { warehouse_id, product_id } = parsed.data

    assertMayActAtWarehouse(
      { role: auth.role, homeWarehouseId: auth.profile.home_warehouse_id },
      warehouse_id,
      'You can only look up stock at your own warehouse',
    )

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const product = must(
      await admin.from('products').select('id, name').eq('id', product_id).maybeSingle() as any,
      'product',
    ) as any
    if (!product) throw new EdgeFunctionError('NOT_FOUND', 'No such product')

    // This warehouse's locations: the one definition (racked ⇒ root + descendants).
    const drawRows = must(
      await admin.rpc('inv_warehouse_draw_locations', { p_warehouse_id: warehouse_id }) as any,
      'warehouse locations',
    ) as any[]
    const inWarehouse = new Set<number>((drawRows ?? []).map((r: any) => Number(r.location_id)))
    inWarehouse.add(warehouse_id)

    // One product's balances are few; filter to the warehouse here rather than
    // sending thousands of location ids in a URL.
    const balanceRows = (must(
      await admin.from('inventory_balances')
        .select('location_id, on_hand, available').eq('product_id', product_id)
        .gt('on_hand', 0).limit(5000) as any,
      'balances',
    ) ?? []) as any[]
    const ours = balanceRows.filter((b) => inWarehouse.has(Number(b.location_id)))

    // The home putaway fills: the PRIMARY slot, read by the very helper
    // putaway uses, so this answer and the putaway answer cannot disagree.
    const homeBinId: number | null = (await loadHomeBins(admin, warehouse_id)).get(product_id)?.binId ?? null

    // A new delivery: one CASE (the smallest receivable unit above the base
    // unit) received loose, as a carton line arrives at receiving, through the
    // NORMAL putaway rules in dry run. A pallet is a unit load and is planned
    // differently (straight to reserve), so it is not what this asks.
    const uoms = (must(
      await admin.from('product_uoms').select('factor_to_base, is_receivable').eq('product_id', product_id) as any,
      'units',
    ) ?? []) as any[]
    const caseSizes = uoms
      .filter((u) => u.is_receivable)
      .map((u) => Number(u.factor_to_base) || 0)
      .filter((f) => f > 1)
    const deliveryQty = caseSizes.length ? Math.min(...caseSizes) : 1

    // A read-only lookup: if the putaway rules cannot be read, still show the
    // stock and say so, rather than failing the whole answer.
    let putaway: Awaited<ReturnType<typeof generatePutawayTasks>> | null = null
    let putawayError: string | null = null
    try {
      putaway = await generatePutawayTasks(admin, {
        warehouseId: warehouse_id,
        lines: [{ product_id, quantity: deliveryQty }],
        actorId: auth.userId,
        dryRun: true,
      })
    } catch (e) {
      console.error('[explain-product-location] putaway dry run failed', e)
      putawayError = 'The putaway rules could not be read just now, so there is no new-delivery answer.'
    }
    const recs = putaway?.mode === 'engine' ? putaway.recommendations : []

    // Code and place label for every location mentioned.
    const ids = new Set<number>([
      ...ours.map((b) => Number(b.location_id)),
      ...recs.map((r) => r.recommendedLocationId).filter((x): x is number => x != null),
      ...(homeBinId != null ? [homeBinId] : []),
    ])
    const places = ids.size ? await loadPlaces(admin, [...ids], warehouse_id) : new Map<number, { code: string; place: string }>()
    const codeOf = (id: number) => places.get(id)?.code ?? String(id)
    const placeOf = (id: number) => places.get(id)?.place ?? String(id)

    const where = productWhereabouts({
      warehouseId: warehouse_id,
      homeBinId,
      balances: ours.map((b) => ({
        locationId: Number(b.location_id),
        code: codeOf(Number(b.location_id)),
        onHand: Number(b.on_hand) || 0,
        available: Number(b.available) || 0,
      })),
    })
    const homeBin = homeBinId != null
      ? { locationId: homeBinId, code: codeOf(homeBinId), place: placeOf(homeBinId) }
      : null
    const newDelivery = putaway?.mode === 'engine'
      ? {
        ...newDeliveryReason(
          recs.map((r) => ({
            locationId: r.recommendedLocationId,
            place: r.recommendedLocationId != null ? placeOf(r.recommendedLocationId) : null,
            quantity: r.quantity,
            source: r.suggestionSource,
          })),
          homeBin,
        ),
        quantity: deliveryQty,
      }
      : null
    const newDeliveryOut = newDelivery
      ? { ...newDelivery, code: newDelivery.locationId != null ? codeOf(newDelivery.locationId) : null }
      : null

    const base = {
      ok: true,
      product: { id: product.id, name: product.name },
      homeBin,
      stock: where.stock.map((s) => ({ ...s, place: placeOf(s.locationId) })),
      homeQty: where.homeQty,
      offHomeQty: where.offHomeQty,
      atDockQty: where.atDockQty,
      newDelivery: newDeliveryOut,
      newDeliveryNote: putawayError,
    }

    const graphResult = await loadWalkGraph(admin, warehouse_id)
    if (graphResult.mode === 'legacy') {
      return new Response(JSON.stringify({ ...base, mode: 'legacy', putawayWalk: null, pickWalk: null }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { graph, dockNodeId, layoutId } = graphResult

    // Walk-graph anchors for every bin either walk may visit.
    const putawayBins = [...new Set(recs.map((r) => r.recommendedLocationId).filter((x): x is number => x != null))]
    const walkIds = [...new Set([...where.stock.map((s) => s.locationId), ...putawayBins])]
    const placementRows = walkIds.length
      ? (must(
        await admin.from('layout_placements').select('location_id, graph_node_id, access_offset_m')
          .eq('layout_id', layoutId).in('location_id', walkIds) as any,
        'placements',
      ) ?? []) as any[]
      : []
    const placements = new Map<number, PlacementRef>(placementRows.map((p) => [
      Number(p.location_id),
      { graphNodeId: p.graph_node_id ?? null, accessOffsetM: Number(p.access_offset_m) || 0 },
    ]))

    const putawayStops: PickStop[] = putawayBins.map((id) => ({
      locationId: id,
      graphNodeId: placements.get(id)?.graphNodeId ?? null,
      accessOffsetM: placements.get(id)?.accessOffsetM ?? 0,
      meta: {
        code: codeOf(id),
        place: placeOf(id),
        qtyBase: recs.filter((r) => r.recommendedLocationId === id).reduce((t, r) => t + r.quantity, 0),
      },
    }))

    return new Response(JSON.stringify({
      ...base,
      mode: 'engine',
      putawayWalk: putawayStops.length ? buildWalk(graph, dockNodeId, putawayStops, product_id) : null,
      pickWalk: buildWalk(
        graph, dockNodeId,
        pickWalkStops(where.stock, placements).map((st) => ({ ...st, meta: { ...st.meta, place: placeOf(st.locationId) } })),
        product_id,
      ),
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

// plan-reslot Edge Function
//
// Dry-run planner for "re-allocate existing stock into a DRAFT layout before
// publishing". Given a draft layout, it:
//   1. builds the draft's walkway graph IN-MEMORY (same pure primitives as
//      publish-layout / wie-simulate) and computes dock→bin distances — the
//      persisted wie_putaway_candidates RPC only works AFTER publish;
//   2. reads the warehouse's stock and splits it into "stays" (already in a bin the
//      new layout keeps) vs "must move" (in an old bin the new layout drops);
//   3. runs the multi-SKU allocator (_shared/wie/reslot.ts) — full putaway scoring,
//      capacity-aware splitting — to place the movable stock into the new bins;
//   4. returns the proposed moves + capacity feasibility. Persists NOTHING and
//      moves NO stock (the operator reviews/overrides, then commit-reslot-plan
//      writes the relocation worklist after publish).
//
// Only AVAILABLE (unreserved) stock is planned; the reserved remainder is reported
// as "stays in place". Admin/Manager only.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { buildWalkGraph, computeAnchorDistances, snapPlacementToNode } from '../_shared/wie/graph.ts'
import { buildWalkableCells } from '../_shared/wie/publishReadiness.ts'
import { planReslot, warehouseStockScope, type ReslotDemand } from '../_shared/wie/reslot.ts'
import { DEFAULT_WEIGHTS } from '../_shared/wie/types.ts'
import { positionsUsed, type OccupancyRow } from '../_shared/wie/capacity.ts'
import type { CandidateBin, CompatibilityRule, RuleDefinition, ScoringWeights, SkuProfile } from '../_shared/wie/types.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

const inputSchema = z.object({ layout_id: z.number().int().positive() })

function toRuleDefinition(row: any): RuleDefinition | null {
  const def = row.definition
  if (!def || !Array.isArray(def.conditions) || !def.action) return null
  return {
    id: row.id, name: row.name, enforcement: row.enforcement, priority: row.priority ?? 100,
    conditions: def.conditions, conditionLogic: def.conditionLogic === 'or' ? 'or' : 'and', action: def.action,
  }
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`plan-reslot:${auth.userId}`, { windowMs: 60_000, max: 20 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => { throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON') })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { layout_id } = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const { data: layout, error: lErr } = await admin.from('warehouse_layouts')
      .select('id, warehouse_id, status, cell_size_m').eq('id', layout_id).single()
    if (lErr || !layout) throw new EdgeFunctionError('NOT_FOUND', `Layout ${layout_id} not found`)
    const warehouseId = (layout as any).warehouse_id as number
    const cellSize = Number((layout as any).cell_size_m) || 1

    // ── Draft geometry → in-memory graph + dock distances ────────────────────
    const { data: objRows } = await admin.from('layout_objects')
      .select('object_type, floor, x, y, w, h').eq('layout_id', layout_id)
    const { data: placeRows } = await admin.from('layout_placements')
      .select('location_id, floor, x, y, w, h').eq('layout_id', layout_id)
    const placements = (placeRows ?? []) as any[]

    const { cells } = buildWalkableCells(
      ((objRows ?? []) as any[]).map((o) => ({ objectType: o.object_type, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h })),
      placements.map((p) => ({ id: String(p.location_id), floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h })),
    )
    const graph = buildWalkGraph(cells, cellSize)
    const dockIds = graph.nodes.filter((n) => n.nodeType === 'dock').map((n) => n.id)
    const distRows = computeAnchorDistances(graph, dockIds)
    const nodeDist = new Map<number, number>()
    for (const r of distRows) {
      const cur = nodeDist.get(r.toNodeId)
      if (cur === undefined || r.distanceM < cur) nodeDist.set(r.toNodeId, r.distanceM)
    }

    const candidateLocIds = placements.map((p) => p.location_id as number)
    const snapByLoc = new Map<number, { nodeId: number | null; offset: number; dist: number | null }>()
    for (const p of placements) {
      const snap = snapPlacementToNode({ locationId: p.location_id, floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h }, graph.nodes, cellSize)
      const dist = snap.graphNodeId !== null ? (nodeDist.get(snap.graphNodeId) ?? null) : null
      snapByLoc.set(p.location_id, { nodeId: snap.graphNodeId, offset: snap.accessOffsetM, dist })
    }

    // ── Candidate bin metadata (capacity, zone, code) ────────────────────────
    const { data: binRows } = candidateLocIds.length
      ? await admin.from('locations')
          .select('id, code, capacity_slots, slot_kind, weight_capacity_kg, materialized_path')
          .in('id', candidateLocIds)
      : { data: [] as any[] }
    const binById = new Map<number, any>()
    for (const b of (binRows ?? []) as any[]) binById.set(b.id, b)

    // A BIN'S ZONE COMES FROM ITS ANCESTRY, NOT FROM A COLUMN ON THE BIN.
    //
    // This read used to be `.eq(bin.zone_profile_id)`, which is a column nothing
    // has ever written on a bin — `resolveZone` sets it on the ZONE row it
    // creates, never on the bins beneath. So every reslot plan ran zone-blind:
    // zoneTag, zoneType, the priority weight and the allowed-category filter were
    // NULL for every candidate, silently.
    //
    // wie_putaway_candidates has always derived it the other way, by
    // prefix-matching the bin's materialized_path against kind='ZONE' rows and
    // taking the DEEPEST match. This is that same rule, in TypeScript, so the
    // planner and the engine finally agree about what a bin is. Binding (00096)
    // is what makes either of them return anything at all.
    const { data: zoneLocRows } = await admin.from('locations')
      .select('id, name, materialized_path, zone_profile_id')
      .eq('kind', 'ZONE')
      .not('zone_profile_id', 'is', null)
    // Deepest path first — the LATERAL's ORDER BY length(z.materialized_path) DESC.
    const zoneLocs = ((zoneLocRows ?? []) as any[])
      .map((z) => ({
        id: Number(z.id),
        name: String(z.name ?? ''),
        path: String(z.materialized_path ?? ''),
        profileId: Number(z.zone_profile_id),
      }))
      .sort((a, b) => b.path.length - a.path.length)

    const zoneForBin = (locId: number): { id: number; name: string; profileId: number } | null => {
      const path = binById.get(locId)?.materialized_path as string | undefined
      if (!path) return null
      const hit = zoneLocs.find((z) => z.path && path.startsWith(`${z.path}/`))
      return hit ? { id: hit.id, name: hit.name, profileId: hit.profileId } : null
    }

    const zoneProfileIds = [...new Set(
      candidateLocIds.map((id) => zoneForBin(id)?.profileId).filter((z): z is number => z != null),
    )]
    const zoneById = new Map<number, any>()
    if (zoneProfileIds.length) {
      const { data: zoneRows } = await admin.from('zone_profiles')
        .select('id, zone_type, priority_weight, allowed_categories, max_utilization_pct').in('id', zoneProfileIds)
      for (const z of (zoneRows ?? []) as any[]) zoneById.set(z.id, z)
    }

    // ── Warehouse stock: descendants of the warehouse, current fill + movable ─
    const { data: whRow } = await admin.from('locations').select('id, materialized_path').eq('id', warehouseId).single()
    const path = (whRow as any)?.materialized_path as string | undefined
    const { data: descRows } = path
      ? await admin.from('locations').select('id').like('materialized_path', `${path}/%`)
      : { data: [] as any[] }
    // Include the warehouse root: bulk / not-yet-racked stock sits ON the root
    // location, so a strict-descendant scan drops it and the planner would report
    // nothing to move. Mirrors the client gate's [warehouseId, ...descendants].
    const descIds = warehouseStockScope(warehouseId, ((descRows ?? []) as any[]).map((d) => d.id as number))

    const { data: balRows } = descIds.length
      ? await admin.from('inventory_balances')
          .select('product_id, location_id, on_hand, allocated, available, handling_unit_id, products(sku, name, category, size_factor), handling_units(hu_type)')
          .in('location_id', descIds)
          .gt('on_hand', 0)
      : { data: [] as any[] }
    const balances = (balRows ?? []) as any[]

    // Bulk-load per-SKU WMS attributes (incl. weight) for every product in stock —
    // used both to enrich demand SKUs and to compute kept-bin weight fill. One
    // query instead of N per-product round-trips.
    const stockProductIds = [...new Set(balances.map((b) => b.product_id as number))]
    const { data: attrRows } = stockProductIds.length
      ? await admin.from('product_wms_attributes')
          .select('product_id, weight_kg, hazard_class, temp_min, temp_max, handling_type, stackable')
          .in('product_id', stockProductIds)
      : { data: [] as any[] }
    const attrByProduct = new Map<number, any>()
    const weightByProduct = new Map<number, number>()
    for (const a of (attrRows ?? []) as any[]) {
      attrByProduct.set(a.product_id, a)
      if (a.weight_kg != null) weightByProduct.set(a.product_id, Number(a.weight_kg))
    }

    const candidateSet = new Set(candidateLocIds)

    // Current fill (slots + weight) + occupants of the KEPT (candidate) bins.
    const usedByBin = new Map<number, number>()
    const usedWeightByBin = new Map<number, number>()
    const occByBin = new Map<number, Set<string>>()
    const productsInBin = new Map<number, Set<number>>()
    // Occupancy rows per kept bin, converted with the bin's own denomination
    // (mig 00078) once every row is in hand — a mixed pallet must count once.
    const occupancyByBin = new Map<number, OccupancyRow[]>()
    for (const b of balances) {
      if (!candidateSet.has(b.location_id)) continue
      const occ = occupancyByBin.get(b.location_id) ?? []
      occ.push({
        onHand: Number(b.on_hand),
        sizeFactor: Number(b.products?.size_factor) || 1,
        huId: b.handling_unit_id != null ? Number(b.handling_unit_id) : null,
        huType: b.handling_units?.hu_type ?? null,
      })
      occupancyByBin.set(b.location_id, occ)
      const w = weightByProduct.get(b.product_id) ?? 0
      usedWeightByBin.set(b.location_id, (usedWeightByBin.get(b.location_id) ?? 0) + Number(b.on_hand) * w)
      const cat = b.products?.category
      if (cat) { const s = occByBin.get(b.location_id) ?? new Set(); s.add(cat); occByBin.set(b.location_id, s) }
      const ps = productsInBin.get(b.location_id) ?? new Set<number>(); ps.add(b.product_id); productsInBin.set(b.location_id, ps)
    }
    for (const [locationId, occ] of occupancyByBin) {
      usedByBin.set(locationId, positionsUsed(binById.get(locationId)?.slot_kind ?? null, occ))
    }

    // Movable stock = AVAILABLE units in bins the new layout does NOT keep.
    // Demand is aggregated PER PRODUCT across source bins, so plate identity is
    // lost by design here — a reslot decants a layout, it does not carry named
    // pallets. Its slot demand therefore stays qty × size_factor even into a
    // pallet bay, which OVER-charges (never under-charges) against the
    // per-plate occupancy above, so a plan can be pessimistic but never
    // over-fills a bay.
    const demandByProduct = new Map<number, ReslotDemand>()
    const reserved: Array<{ productId: number; productCode: string; productName: string; qty: number; locationId: number }> = []
    for (const b of balances) {
      if (candidateSet.has(b.location_id)) continue // stays put
      const avail = Number(b.available) || 0
      const alloc = Number(b.allocated) || 0
      const sku: SkuProfile = {
        productId: b.product_id, code: b.products?.sku ?? String(b.product_id), name: b.products?.name ?? `#${b.product_id}`,
        sizeFactor: Number(b.products?.size_factor) || 1, weightKg: weightByProduct.get(b.product_id) ?? null,
        category: b.products?.category ?? null,
        hazardClass: null, tempMin: null, tempMax: null, handlingType: null, stackable: null, velocityClass: null,
      }
      if (avail > 0) {
        const d = demandByProduct.get(b.product_id) ?? { sku, sources: [] }
        d.sources.push({ locationId: b.location_id, qty: avail })
        demandByProduct.set(b.product_id, d)
      }
      if (alloc > 0) {
        reserved.push({ productId: b.product_id, productCode: sku.code, productName: sku.name, qty: alloc, locationId: b.location_id })
      }
    }

    // Enrich each demand's SKU with the prefetched WMS attrs + velocity.
    for (const [productId, demand] of demandByProduct) {
      const attrs = attrByProduct.get(productId)
      const { data: velRow } = await admin.from('wie_product_velocity')
        .select('velocity_class').eq('warehouse_id', warehouseId).eq('product_id', productId).maybeSingle()
      demand.sku.hazardClass = attrs?.hazard_class ?? null
      demand.sku.tempMin = attrs?.temp_min != null ? Number(attrs.temp_min) : null
      demand.sku.tempMax = attrs?.temp_max != null ? Number(attrs.temp_max) : null
      demand.sku.handlingType = attrs?.handling_type ?? null
      demand.sku.stackable = attrs?.stackable ?? null
      demand.sku.velocityClass = (velRow as any)?.velocity_class ?? null
    }

    // ── Build CandidateBin[] for the draft (per product for hasSameProduct) ──
    const buildCandidates = (productId: number): CandidateBin[] =>
      candidateLocIds.map((locId) => {
        const bin = binById.get(locId)
        const snap = snapByLoc.get(locId)
        const zoneLoc = zoneForBin(locId)
        const zone = zoneLoc ? zoneById.get(zoneLoc.profileId) : null
        return {
          locationId: locId,
          code: bin?.code ?? String(locId),
          zoneId: zoneLoc?.id ?? null,
          // lower(zone.name), matching wie_putaway_candidates' projection — NOT
          // zone_type, which is what this used to send. `zoneTag` is the field an
          // operator's wie_rules row matches on, so the two engines have to agree
          // on what the string IS or the same rule fires in putaway and not here.
          zoneTag: zoneLoc ? zoneLoc.name.toLowerCase() : null,
          capacitySlots: bin?.capacity_slots != null ? Number(bin.capacity_slots) : null,
          slotKind: bin?.slot_kind ?? null,
          usedSlots: usedByBin.get(locId) ?? 0,
          weightCapacityKg: bin?.weight_capacity_kg != null ? Number(bin.weight_capacity_kg) : null,
          usedWeightKg: usedWeightByBin.get(locId) ?? 0,
          graphNodeId: snap?.nodeId ?? null,
          accessOffsetM: snap?.offset ?? 0,
          hasSameProduct: productsInBin.get(locId)?.has(productId) ?? false,
          distanceFromDockM: snap?.dist ?? null,
          zoneType: zone?.zone_type ?? null,
          zonePriorityWeight: zone?.priority_weight != null ? Number(zone.priority_weight) : null,
          zoneAllowedCategories: Array.isArray(zone?.allowed_categories) ? zone.allowed_categories : null,
          zoneMaxUtilizationPct: zone?.max_utilization_pct != null ? Number(zone.max_utilization_pct) : null,
          occupantCategories: [...(occByBin.get(locId) ?? new Set<string>())],
          pickVisits30d: 0, // draft has no graph traffic history
        }
      })

    // Load safety gates once (rules + compatibility fail closed; weights fail open).
    const { data: ruleRows } = await admin.from('wie_rules').select('*')
      .eq('is_active', true).eq('rule_type', 'putaway')
      .or(`warehouse_id.eq.${warehouseId},warehouse_id.is.null`)
    const rules = ((ruleRows ?? []) as any[]).map(toRuleDefinition).filter((r): r is RuleDefinition => r !== null)
    const { data: compatRows } = await admin.from('category_compatibility').select('category_a, category_b, level')
    const compatibility: CompatibilityRule[] = ((compatRows ?? []) as any[]).map((c) => ({ categoryA: c.category_a, categoryB: c.category_b, level: c.level }))
    const { data: profileRow } = await admin.from('wie_scoring_profiles').select('weights').eq('warehouse_id', warehouseId).maybeSingle()
    const rawWeights = ((profileRow as any)?.weights ?? {}) as Record<string, unknown>
    const weights = { ...DEFAULT_WEIGHTS } as ScoringWeights
    for (const k of Object.keys(DEFAULT_WEIGHTS) as (keyof ScoringWeights)[]) {
      const v = Number(rawWeights[k]); if (Number.isFinite(v)) weights[k] = v
    }

    // The allocator scores each demand against the SAME live candidate set; we pass
    // per-product candidates (hasSameProduct differs) but a shared usedSlots seed by
    // reconstructing candidates fresh inside the loop is unnecessary — planReslot
    // consumes capacity across demands using the candidates' usedSlots as the seed,
    // so we hand it one candidate array (product-agnostic hasSameProduct=false is
    // acceptable; grouping only rewards, never gates). Use the first product's build
    // for the shared array and let planReslot manage fill.
    const demands = [...demandByProduct.values()]
    const sharedCandidates = buildCandidates(-1) // hasSameProduct=false baseline

    const plan = planReslot({ demands, candidates: sharedCandidates, rules, compatibility, weights })

    const providedTotalSlots = sharedCandidates.reduce((s, c) => s + (c.capacitySlots ?? 0), 0)
    const sufficient = plan.hasUncapped || plan.overflow.length === 0

    return new Response(JSON.stringify({
      ok: true,
      layoutId: layout_id,
      hasStock: balances.length > 0,
      capacity: {
        requiredSlots: plan.requiredSlots,
        providedFreeSlots: plan.providedFreeSlots,
        providedTotalSlots,
        hasUncapped: plan.hasUncapped,
        sufficient,
      },
      moves: plan.moves,
      overflow: plan.overflow,
      reserved,
      bins: sharedCandidates.map((c) => ({ locationId: c.locationId, code: c.code, capacitySlots: c.capacitySlots })),
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

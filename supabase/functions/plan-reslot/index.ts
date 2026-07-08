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
import { planReslot, type ReslotDemand } from '../_shared/wie/reslot.ts'
import { DEFAULT_WEIGHTS } from '../_shared/wie/types.ts'
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
          .select('id, code, capacity_slots, zone_profile_id')
          .in('id', candidateLocIds)
      : { data: [] as any[] }
    const binById = new Map<number, any>()
    for (const b of (binRows ?? []) as any[]) binById.set(b.id, b)

    const zoneProfileIds = [...new Set(((binRows ?? []) as any[]).map((b) => b.zone_profile_id).filter((z) => z != null))]
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
    const descIds = ((descRows ?? []) as any[]).map((d) => d.id as number)

    const { data: balRows } = descIds.length
      ? await admin.from('inventory_balances')
          .select('product_id, location_id, on_hand, allocated, available, products(sku, name, category, size_factor)')
          .in('location_id', descIds)
          .gt('on_hand', 0)
      : { data: [] as any[] }
    const balances = (balRows ?? []) as any[]

    const candidateSet = new Set(candidateLocIds)

    // Current fill + occupants of the KEPT (candidate) bins — stock that stays.
    const usedByBin = new Map<number, number>()
    const occByBin = new Map<number, Set<string>>()
    const productsInBin = new Map<number, Set<number>>()
    for (const b of balances) {
      if (!candidateSet.has(b.location_id)) continue
      const sizeFactor = Number(b.products?.size_factor) || 1
      usedByBin.set(b.location_id, (usedByBin.get(b.location_id) ?? 0) + Number(b.on_hand) * sizeFactor)
      const cat = b.products?.category
      if (cat) { const s = occByBin.get(b.location_id) ?? new Set(); s.add(cat); occByBin.set(b.location_id, s) }
      const ps = productsInBin.get(b.location_id) ?? new Set<number>(); ps.add(b.product_id); productsInBin.set(b.location_id, ps)
    }

    // Movable stock = AVAILABLE units in bins the new layout does NOT keep.
    const demandByProduct = new Map<number, ReslotDemand>()
    const reserved: Array<{ productId: number; productCode: string; productName: string; qty: number; locationId: number }> = []
    for (const b of balances) {
      if (candidateSet.has(b.location_id)) continue // stays put
      const avail = Number(b.available) || 0
      const alloc = Number(b.allocated) || 0
      const sku: SkuProfile = {
        productId: b.product_id, code: b.products?.sku ?? String(b.product_id), name: b.products?.name ?? `#${b.product_id}`,
        sizeFactor: Number(b.products?.size_factor) || 1, category: b.products?.category ?? null,
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

    // Enrich each demand's SKU with WMS attrs + velocity (rules/scoring inputs).
    for (const [productId, demand] of demandByProduct) {
      const { data: attrs } = await admin.from('product_wms_attributes')
        .select('hazard_class, temp_min, temp_max, handling_type, stackable').eq('product_id', productId).maybeSingle()
      const { data: velRow } = await admin.from('wie_product_velocity')
        .select('velocity_class').eq('warehouse_id', warehouseId).eq('product_id', productId).maybeSingle()
      demand.sku.hazardClass = (attrs as any)?.hazard_class ?? null
      demand.sku.tempMin = (attrs as any)?.temp_min != null ? Number((attrs as any).temp_min) : null
      demand.sku.tempMax = (attrs as any)?.temp_max != null ? Number((attrs as any).temp_max) : null
      demand.sku.handlingType = (attrs as any)?.handling_type ?? null
      demand.sku.stackable = (attrs as any)?.stackable ?? null
      demand.sku.velocityClass = (velRow as any)?.velocity_class ?? null
    }

    // ── Build CandidateBin[] for the draft (per product for hasSameProduct) ──
    const buildCandidates = (productId: number): CandidateBin[] =>
      candidateLocIds.map((locId) => {
        const bin = binById.get(locId)
        const snap = snapByLoc.get(locId)
        const zone = bin?.zone_profile_id != null ? zoneById.get(bin.zone_profile_id) : null
        return {
          locationId: locId,
          code: bin?.code ?? String(locId),
          zoneId: null,
          zoneTag: zone?.zone_type ?? null,
          capacitySlots: bin?.capacity_slots != null ? Number(bin.capacity_slots) : null,
          usedSlots: usedByBin.get(locId) ?? 0,
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

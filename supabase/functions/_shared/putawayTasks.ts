// Shared putaway-task generator.
//
// Turns "stock just landed at a warehouse root" into scored, explained putaway
// tasks (wie_putaway_recommendations rows), so ANY arrival path — the receiving
// screen, the CSV opening-stock import, a found-stock adjustment, a transfer-in —
// produces the same queue rows. Previously only ReceiveStockView chained this on
// the client, so every other path left stock at root with an empty queue.
//
// Impure (DB I/O) so it lives OUTSIDE _shared/wie/ (which is pure). It loads the
// candidates/rules/weights and calls the pure planPutaway engine, then persists
// one row per allocation. A line too big for one bin is split across bins
// (multi-bin placement); a residual no bin can hold persists as a null-bin
// "needs manual placement" task.
//
// Self-guards: returns { mode: 'legacy' } for anything that isn't the root of a
// racked, published warehouse — so callers can invoke it unconditionally after a
// stock-in and bins / bulk warehouses simply no-op.

// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { planPutaway } from './wie/putawayPlan.ts'
import { DEFAULT_WEIGHTS } from './wie/types.ts'
import type { CandidateBin, LevelRole, RuleDefinition, ScoringWeights, SkuProfile } from './wie/types.ts'

// wie_putaway_candidates is ordered by dock distance with p_limit as a hard
// cutoff — a layout with more placements than this silently hides its
// farthest bays from the engine. MAIN alone is 189 bays; levelled at 5
// levels/rack that's 945 locations, so 200 (the old default) would have
// hidden the far half of the warehouse again. See
// memory/main-warehouse-slotting-2026-07.md.
const CANDIDATE_LIMIT = 2000

export interface PutawayLineInput {
  product_id: number
  quantity: number
}

export interface GeneratePutawayArgs {
  /** The location stock landed in — expected to be a WAREHOUSE-kind root. */
  warehouseId: number
  lines: PutawayLineInput[]
  actorId: string
  goodsReceiptId?: number
  /** Score + explain but persist nothing (Warehouse-viewer test bench). */
  dryRun?: boolean
}

export interface PutawayTaskResult {
  recommendationId: number
  productId: number
  quantity: number
  recommendedLocationId: number | null
  alternatives: unknown[]
  explanation: unknown
}

export type GeneratePutawayResult =
  | { mode: 'legacy'; recommendations: [] }
  | { mode: 'engine'; layoutId: number; recommendations: PutawayTaskResult[] }

/** Parse a wie_rules row into the engine's RuleDefinition, tolerating malformed
 *  JSON by skipping the rule rather than failing the whole request. */
function toRuleDefinition(row: any): RuleDefinition | null {
  const def = row.definition
  if (!def || !Array.isArray(def.conditions) || !def.action) return null
  return {
    id: row.id,
    name: row.name,
    enforcement: row.enforcement,
    priority: row.priority ?? 100,
    conditions: def.conditions,
    conditionLogic: def.conditionLogic === 'or' ? 'or' : 'and',
    action: def.action,
  }
}

/**
 * Generate (and, unless dryRun, persist) putaway tasks for freshly-arrived lines.
 * Non-racked / non-root / unpublished warehouses return { mode: 'legacy' }.
 *
 * Throws on a genuine data-load/persist failure so a DIRECT caller
 * (recommend-putaway) surfaces it; incidental callers (receive/adjust/transfer)
 * should wrap this in try/catch since putaway is advisory.
 */
export async function generatePutawayTasks(
  admin: SupabaseClient,
  args: GeneratePutawayArgs,
): Promise<GeneratePutawayResult> {
  const { warehouseId, lines, actorId, goodsReceiptId, dryRun } = args

  const { data: wh } = await admin.from('locations')
    .select('id, kind, location_type, active_layout_id').eq('id', warehouseId).maybeSingle()
  const layoutId = (wh as any)?.active_layout_id as number | null
  if (!wh || (wh as any).kind !== 'WAREHOUSE' || (wh as any).location_type !== 'racked' || !layoutId) {
    return { mode: 'legacy', recommendations: [] }
  }

  // Active putaway rules (this warehouse or global) — SAFETY gates, fail closed.
  const { data: ruleRows, error: ruleErr } = await admin.from('wie_rules').select('*')
    .eq('is_active', true).eq('rule_type', 'putaway')
    .or(`warehouse_id.eq.${warehouseId},warehouse_id.is.null`)
    .order('priority', { ascending: false }).order('id', { ascending: true })
  if (ruleErr) throw new Error(`rule load failed: ${ruleErr.message}`)
  const rules = ((ruleRows ?? []) as any[]).map(toRuleDefinition).filter((r): r is RuleDefinition => r !== null)

  // Global category-compatibility matrix — fail closed.
  const { data: compatRows, error: compatErr } = await admin.from('category_compatibility')
    .select('category_a, category_b, level')
  if (compatErr) throw new Error(`compatibility load failed: ${compatErr.message}`)
  const compatibility = ((compatRows ?? []) as any[]).map((c) => ({
    categoryA: c.category_a, categoryB: c.category_b, level: c.level,
  }))

  // Per-warehouse scoring weights — NOT a safety gate, fail OPEN to defaults.
  const { data: profileRow } = await admin.from('wie_scoring_profiles')
    .select('weights').eq('warehouse_id', warehouseId).maybeSingle()
  const rawWeights = ((profileRow as any)?.weights ?? {}) as Record<string, unknown>
  const weights = { ...DEFAULT_WEIGHTS } as ScoringWeights
  for (const k of Object.keys(DEFAULT_WEIGHTS) as (keyof ScoringWeights)[]) {
    const v = Number(rawWeights[k])
    if (Number.isFinite(v)) weights[k] = v
  }

  // Running fill overlay so multiple lines of the same product don't over-fill a
  // shared bin: each line's candidates are loaded fresh from the snapshot, then
  // adjusted by what earlier lines in THIS receipt already placed.
  const overlay = new Map<number, { slots: number; weight: number }>()
  const recommendations: PutawayTaskResult[] = []

  for (const line of lines) {
    const { data: product, error: pErr } = await admin.from('products')
      .select('id, sku, name, size_factor, category').eq('id', line.product_id).single()
    if (pErr || !product) throw new Error(`Product ${line.product_id} not found`)

    const { data: attrs } = await admin.from('product_wms_attributes')
      .select('hazard_class, temp_min, temp_max, handling_type, stackable, weight_kg, allowed_level_roles')
      .eq('product_id', line.product_id).maybeSingle()

    const { data: velRow } = await admin.from('wie_product_velocity')
      .select('velocity_class')
      .eq('warehouse_id', warehouseId).eq('product_id', line.product_id).maybeSingle()

    // NULL / no product_wms_attributes row at all = unconstrained (any level
    // role) — this is what keeps every pre-existing SKU putting away exactly
    // as it did before mig 00072.
    const rawRoles = (attrs as any)?.allowed_level_roles
    const allowedLevelRoles: LevelRole[] | null = Array.isArray(rawRoles) && rawRoles.length > 0 ? rawRoles : null

    const sku: SkuProfile = {
      productId: (product as any).id,
      code: (product as any).sku,
      name: (product as any).name,
      sizeFactor: Number((product as any).size_factor) || 1,
      weightKg: (attrs as any)?.weight_kg != null ? Number((attrs as any).weight_kg) : null,
      category: (product as any).category ?? null,
      hazardClass: (attrs as any)?.hazard_class ?? null,
      tempMin: (attrs as any)?.temp_min != null ? Number((attrs as any).temp_min) : null,
      tempMax: (attrs as any)?.temp_max != null ? Number((attrs as any).temp_max) : null,
      handlingType: (attrs as any)?.handling_type ?? null,
      stackable: (attrs as any)?.stackable ?? null,
      velocityClass: (velRow as any)?.velocity_class ?? null,
      allowedLevelRoles,
    }

    const { data: candRows, error: cErr } = await admin.rpc('wie_putaway_candidates', {
      p_layout_id: layoutId, p_product_id: line.product_id, p_limit: CANDIDATE_LIMIT, p_roles: allowedLevelRoles,
    })
    if (cErr) throw new Error(`candidate load failed: ${cErr.message}`)

    const candidates: CandidateBin[] = ((candRows ?? []) as any[]).map((r) => {
      const pending = overlay.get(r.location_id)
      return {
        locationId: r.location_id,
        code: r.code,
        zoneId: r.zone_id ?? null,
        zoneTag: r.zone_tag ?? null,
        capacitySlots: r.capacity_slots != null ? Number(r.capacity_slots) : null,
        usedSlots: (Number(r.used_slots) || 0) + (pending?.slots ?? 0),
        weightCapacityKg: r.weight_capacity_kg != null ? Number(r.weight_capacity_kg) : null,
        usedWeightKg: (Number(r.used_weight_kg) || 0) + (pending?.weight ?? 0),
        graphNodeId: r.graph_node_id ?? null,
        accessOffsetM: Number(r.access_offset_m) || 0,
        hasSameProduct: !!r.has_same_product,
        distanceFromDockM: r.distance_from_dock_m != null ? Number(r.distance_from_dock_m) : null,
        zoneType: r.zone_type ?? null,
        zonePriorityWeight: r.zone_priority_weight != null ? Number(r.zone_priority_weight) : null,
        zoneAllowedCategories: Array.isArray(r.zone_allowed_categories) ? r.zone_allowed_categories : null,
        zoneMaxUtilizationPct: r.zone_max_utilization_pct != null ? Number(r.zone_max_utilization_pct) : null,
        occupantCategories: Array.isArray(r.bin_categories) ? r.bin_categories.filter((c: unknown): c is string => typeof c === 'string') : [],
        pickVisits30d: r.pick_visits_30d != null ? Number(r.pick_visits_30d) : 0,
        levelRole: r.level_role ?? null,
        levelIndex: r.level_index != null ? Number(r.level_index) : null,
      }
    })

    const plan = planPutaway({
      layoutId, warehouseId, sku, quantity: line.quantity,
      candidates, rules, compatibility, weights,
    })

    for (const alloc of plan.allocations) {
      // Fold this placement into the overlay so later lines see the bin as fuller.
      if (alloc.locationId !== null) {
        const prev = overlay.get(alloc.locationId) ?? { slots: 0, weight: 0 }
        overlay.set(alloc.locationId, {
          slots: prev.slots + alloc.quantity * sku.sizeFactor,
          weight: prev.weight + alloc.quantity * (sku.weightKg ?? 0),
        })
      }

      let recommendationId = 0
      if (!dryRun) {
        const { data: recRow, error: rErr } = await admin.from('wie_putaway_recommendations').insert({
          warehouse_id: warehouseId, layout_id: layoutId, product_id: line.product_id, quantity: alloc.quantity,
          goods_receipt_id: goodsReceiptId ?? null,
          recommended_location_id: alloc.locationId,
          alternatives: alloc.alternatives, explanation: alloc.explanation,
          engine_version: (alloc.explanation as any).engineVersion, actor_id: actorId,
        } as any).select('id').single()
        if (rErr) throw new Error(`failed to persist recommendation: ${rErr.message}`)
        recommendationId = (recRow as any).id
      }

      recommendations.push({
        recommendationId,
        productId: line.product_id,
        quantity: alloc.quantity,
        recommendedLocationId: alloc.locationId,
        alternatives: alloc.alternatives,
        explanation: alloc.explanation,
      })
    }
  }

  return { mode: 'engine', layoutId, recommendations }
}

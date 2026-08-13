// wie-batch-reoptimize Edge Function
//
// Scan a racked warehouse's currently-stocked bins and, for each (product, bin),
// propose moving the AVAILABLE stock to a closer-to-dock bin when the travel
// saving is meaningful. It NEVER moves stock — it only inserts reviewable rows
// into wie_slotting_suggestions (a human commits them via decide-slotting-
// suggestion). Destination candidates are run through the SAME engine filter as
// recommend-putaway (Stage-1: hard rules, category compatibility, zone allow-list,
// capacity), so a suggested move can never violate a placement constraint the rest
// of the system fails closed on. Safe to run manually (Admin/Manager) or from cron.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { filterCandidates } from '../_shared/wie/scoring.ts'
import type { CandidateBin, CompatibilityRule, LevelRole, RuleDefinition, SkuProfile } from '../_shared/wie/types.ts'
import { requireModule } from '../_shared/modules.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']
/** Floor on how much travel a re-slot must save before it's worth suggesting.
 *  See minGainFor — this is the absolute-metres half of the rule. */
const MIN_GAIN_M = 1.0

/**
 * A suggestion must save at least a metre AND at least one whole cell.
 *
 * MIN_GAIN_M alone was written when every layout was 1.0 m/cell, where the two
 * conditions happened to be the same sentence. They aren't: at 3 m/cell a bare
 * 1.0 m floor admits a move worth a third of a cell, and the queue fills with
 * suggestions that don't relocate a pallet so much as jiggle it. At 0.25 m/cell
 * it would swing the other way and suppress genuine four-cell wins.
 */
function minGainFor(cellSizeM: number): number {
  return Math.max(MIN_GAIN_M, cellSizeM)
}
const MAX_SUGGESTIONS = 50
// Wide enough that a stocked bin's own row is present so we can measure its dock
// distance even when it's far from the dock (the exact case worth re-slotting).
// Raised alongside putawayTasks.ts's CANDIDATE_LIMIT (mig 00072): a levelled
// MAIN is 945 locations, so this must stay above that or reslotting silently
// stops seeing the far half of the warehouse. See
// memory/main-warehouse-slotting-2026-07.md.
const CANDIDATE_LIMIT = 2000

const inputSchema = z.object({ warehouse_id: z.number().int().positive() })

function toRuleDefinition(row: any): RuleDefinition | null {
  const def = row.definition
  if (!def || !Array.isArray(def.conditions) || !def.action) return null
  return {
    id: row.id, name: row.name, enforcement: row.enforcement, priority: row.priority ?? 100,
    conditions: def.conditions, conditionLogic: def.conditionLogic === 'or' ? 'or' : 'and', action: def.action,
  }
}

function toCandidateBin(r: any): CandidateBin {
  return {
    locationId: r.location_id,
    code: r.code,
    zoneId: r.zone_id ?? null,
    zoneTag: r.zone_tag ?? null,
    capacitySlots: r.capacity_slots != null ? Number(r.capacity_slots) : null,
    // What capacity/fill are denominated in (mig 00078).
    slotKind: r.slot_kind ?? null,
    usedSlots: Number(r.used_slots) || 0,
    weightCapacityKg: r.weight_capacity_kg != null ? Number(r.weight_capacity_kg) : null,
    usedWeightKg: Number(r.used_weight_kg) || 0,
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
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`wie-batch-reoptimize:${auth.userId}`, { windowMs: 60_000, max: 6 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { warehouse_id } = parsed.data

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
      return new Response(JSON.stringify({ ok: true, considered: 0, suggested: 0, note: 'not a layout warehouse' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // The layout's resolution sets the gain floor (see minGainFor).
    const { data: layoutRow } = await admin.from('warehouse_layouts')
      .select('cell_size_m').eq('id', layoutId).single()
    const minGainM = minGainFor(Number((layoutRow as any)?.cell_size_m) || 1)

    // Safety gates (same as recommend-putaway) — a suggestion must survive these.
    const { data: ruleRows, error: ruleErr } = await admin.from('wie_rules').select('*')
      .eq('is_active', true).eq('rule_type', 'putaway')
      .or(`warehouse_id.eq.${warehouse_id},warehouse_id.is.null`)
    if (ruleErr) throw new EdgeFunctionError('INTERNAL', `rule load failed: ${ruleErr.message}`)
    const rules = ((ruleRows ?? []) as any[]).map(toRuleDefinition).filter((r): r is RuleDefinition => r !== null)

    const { data: compatRows, error: compatErr } = await admin.from('category_compatibility')
      .select('category_a, category_b, level')
    if (compatErr) throw new EdgeFunctionError('INTERNAL', `compatibility load failed: ${compatErr.message}`)
    const compatibility: CompatibilityRule[] = ((compatRows ?? []) as any[]).map((c) => ({
      categoryA: c.category_a, categoryB: c.category_b, level: c.level,
    }))

    // Placed bins → available stock sitting in them (only AVAILABLE is movable).
    const { data: placements, error: plErr } = await admin.from('layout_placements')
      .select('location_id').eq('layout_id', layoutId).not('graph_node_id', 'is', null)
    if (plErr) throw new EdgeFunctionError('INTERNAL', `placement load failed: ${plErr.message}`)
    const placedBinIds = ((placements ?? []) as any[]).map((p) => p.location_id as number)
    if (placedBinIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, considered: 0, suggested: 0 }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: balances, error: balErr } = await admin.from('inventory_balances')
      .select('product_id, location_id, available').gt('available', 0).in('location_id', placedBinIds)
    if (balErr) throw new EdgeFunctionError('INTERNAL', `balance load failed: ${balErr.message}`)
    const stockRows = ((balances ?? []) as any[]).map((b) => ({
      productId: b.product_id as number,
      locationId: b.location_id as number,
      available: Number(b.available) || 0,
    }))

    // Per-product SKU profile + candidate cache (candidates depend only on layout+product).
    const skuCache = new Map<number, SkuProfile>()
    const candCache = new Map<number, any[]>()

    const loadSku = async (productId: number): Promise<SkuProfile | null> => {
      if (skuCache.has(productId)) return skuCache.get(productId)!
      const { data: p } = await admin.from('products').select('id, sku, name, size_factor, category').eq('id', productId).single()
      if (!p) return null
      const { data: attrs } = await admin.from('product_wms_attributes')
        .select('hazard_class, temp_min, temp_max, handling_type, stackable, weight_kg, allowed_level_roles').eq('product_id', productId).maybeSingle()
      // NULL / no attributes row = unconstrained (any level role) — a re-slot
      // suggestion must never violate the same hard gate putaway enforces.
      const rawRoles = (attrs as any)?.allowed_level_roles
      const allowedLevelRoles: LevelRole[] | null = Array.isArray(rawRoles) && rawRoles.length > 0 ? rawRoles : null
      const sku: SkuProfile = {
        productId, code: (p as any).sku, name: (p as any).name,
        sizeFactor: Number((p as any).size_factor) || 1,
        weightKg: (attrs as any)?.weight_kg != null ? Number((attrs as any).weight_kg) : null,
        category: (p as any).category ?? null,
        hazardClass: (attrs as any)?.hazard_class ?? null,
        tempMin: (attrs as any)?.temp_min != null ? Number((attrs as any).temp_min) : null,
        tempMax: (attrs as any)?.temp_max != null ? Number((attrs as any).temp_max) : null,
        handlingType: (attrs as any)?.handling_type ?? null,
        stackable: (attrs as any)?.stackable ?? null,
        velocityClass: null, // filtering doesn't use velocity (scoring does)
        allowedLevelRoles,
      }
      skuCache.set(productId, sku)
      return sku
    }

    const loadCands = async (productId: number, roles: LevelRole[] | null): Promise<any[]> => {
      if (candCache.has(productId)) return candCache.get(productId)!
      const { data, error } = await admin.rpc('wie_putaway_candidates', {
        p_layout_id: layoutId, p_product_id: productId, p_limit: CANDIDATE_LIMIT, p_roles: roles,
      })
      const rows = error ? [] : ((data ?? []) as any[])
      candCache.set(productId, rows)
      return rows
    }

    let considered = 0
    let suggested = 0

    for (const row of stockRows) {
      if (suggested >= MAX_SUGGESTIONS) break
      considered++

      const sku = await loadSku(row.productId)
      if (!sku) continue
      const candRows = await loadCands(row.productId, sku.allowedLevelRoles ?? null)
      if (candRows.length === 0) continue

      const currentRow = candRows.find((c) => c.location_id === row.locationId)
      if (!currentRow || currentRow.distance_from_dock_m == null) continue
      const currentDist = Number(currentRow.distance_from_dock_m)

      // Run destinations through the Stage-1 engine filter (rules + compatibility +
      // zone + capacity for THIS quantity). Only survivors are safe to suggest.
      const valid = filterCandidates({
        layoutId, warehouseId: warehouse_id, sku, quantity: row.available,
        candidates: candRows.map(toCandidateBin), rules, compatibility,
        weights: { travelDistance: 0, capacityFit: 0, grouping: 0, zonePreference: 0, congestion: 0, velocityMatch: 0 },
      }).valid

      let best: CandidateBin | null = null
      for (const c of valid) {
        if (c.locationId === row.locationId || c.distanceFromDockM == null) continue
        if (best === null || c.distanceFromDockM < best.distanceFromDockM!) best = c
      }
      if (!best || best.distanceFromDockM == null) continue
      if (best.distanceFromDockM >= currentDist - minGainM) continue

      const { error: insErr } = await admin.from('wie_slotting_suggestions').insert({
        warehouse_id, product_id: row.productId, from_location_id: row.locationId,
        to_location_id: best.locationId, qty: row.available,
        expected_gain_m: currentDist - best.distanceFromDockM,
        reason: { factor: 'travel', from_m: currentDist, to_m: best.distanceFromDockM }, status: 'suggested',
      } as any)
      if (insErr) continue // 23505 (open dup) or any insert error: skip, keep going
      suggested++
    }

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'create', resource: 'wie_slotting_suggestions',
      resourceId: null, metadata: { warehouse_id, layout_id: layoutId, considered, suggested },
    })

    return new Response(JSON.stringify({ ok: true, considered, suggested }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

// recommend-putaway Edge Function
//
// Given received lines for a warehouse, return a scored, explained bin
// recommendation per line using the WIE engine. Stage-1 candidate filtering runs
// in SQL (wie_putaway_candidates → top-N by dock distance); stage-2 scoring +
// explainability run in the pure engine (_shared/wie). Each recommendation is
// persisted to wie_putaway_recommendations so the operator can accept/override it
// (decide-putaway) and so we keep an audit trail. Warehouses without a published
// layout fall back to legacy mode (the caller keeps today's home-bin behavior).

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { recommendPutaway } from '../_shared/wie/putaway.ts'
import { DEFAULT_WEIGHTS } from '../_shared/wie/types.ts'
import type { CandidateBin, RuleDefinition, ScoringWeights, SkuProfile } from '../_shared/wie/types.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  warehouse_id: z.number().int().positive(),
  goods_receipt_id: z.number().int().positive().optional(),
  // Read-only preview (Warehouse viewer test bench): score + explain but DON'T
  // persist a wie_putaway_recommendations row, so nothing leaks into the
  // operational Putaway queue and no stock can ever be moved from it.
  dry_run: z.boolean().optional(),
  lines: z.array(z.object({
    product_id: z.number().int().positive(),
    quantity: z.number().positive(),
  })).min(1).max(200),
})

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

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`recommend-putaway:${auth.userId}`, { windowMs: 60_000, max: 60 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { warehouse_id, goods_receipt_id, dry_run, lines } = parsed.data

    if (auth.role === 'Warehouse' && auth.profile.home_warehouse_id !== warehouse_id) {
      throw new EdgeFunctionError('FORBIDDEN', 'You can only put away stock at your own warehouse')
    }

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
      return new Response(JSON.stringify({ ok: true, mode: 'legacy' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Active putaway rules scoped to this warehouse or global. These are SAFETY
    // gates — fail closed on a load error rather than silently dropping them.
    const { data: ruleRows, error: ruleErr } = await admin.from('wie_rules').select('*')
      .eq('is_active', true).eq('rule_type', 'putaway')
      .or(`warehouse_id.eq.${warehouse_id},warehouse_id.is.null`)
      .order('priority', { ascending: false }).order('id', { ascending: true })
    if (ruleErr) throw new EdgeFunctionError('INTERNAL', `rule load failed: ${ruleErr.message}`)
    const rules = ((ruleRows ?? []) as any[]).map(toRuleDefinition).filter((r): r is RuleDefinition => r !== null)

    // Global category-compatibility matrix (empty ⇒ no gating). Fail closed too.
    const { data: compatRows, error: compatErr } = await admin.from('category_compatibility')
      .select('category_a, category_b, level')
    if (compatErr) throw new EdgeFunctionError('INTERNAL', `compatibility load failed: ${compatErr.message}`)
    const compatibility = ((compatRows ?? []) as any[]).map((c) => ({
      categoryA: c.category_a, categoryB: c.category_b, level: c.level,
    }))

    // Per-warehouse scoring weights (Phase 4). This is NOT a safety gate — fail
    // OPEN to DEFAULT_WEIGHTS on error / missing profile so scoring still runs.
    const { data: profileRow } = await admin.from('wie_scoring_profiles')
      .select('weights').eq('warehouse_id', warehouse_id).maybeSingle()
    // Merge over defaults and drop any non-finite value, so a malformed/partial
    // saved profile can never inject NaN/undefined into the weighted score.
    const rawWeights = ((profileRow as any)?.weights ?? {}) as Record<string, unknown>
    const weights = { ...DEFAULT_WEIGHTS } as ScoringWeights
    for (const k of Object.keys(DEFAULT_WEIGHTS) as (keyof ScoringWeights)[]) {
      const v = Number(rawWeights[k])
      if (Number.isFinite(v)) weights[k] = v
    }

    const recommendations: unknown[] = []
    for (const line of lines) {
      const { data: product, error: pErr } = await admin.from('products')
        .select('id, sku, name, size_factor, category').eq('id', line.product_id).single()
      if (pErr || !product) throw new EdgeFunctionError('NOT_FOUND', `Product ${line.product_id} not found`)

      // Optional WMS attributes (Phase 3) — hazard/temp/handling feed the rules.
      const { data: attrs } = await admin.from('product_wms_attributes')
        .select('hazard_class, temp_min, temp_max, handling_type, stackable')
        .eq('product_id', line.product_id).maybeSingle()

      // ABC pick-velocity class for this SKU at this warehouse (Phase 4);
      // null when no history — feeds the velocity_match scoring factor.
      const { data: velRow } = await admin.from('wie_product_velocity')
        .select('velocity_class')
        .eq('warehouse_id', warehouse_id).eq('product_id', line.product_id).maybeSingle()

      const sku: SkuProfile = {
        productId: (product as any).id,
        code: (product as any).sku,
        name: (product as any).name,
        sizeFactor: Number((product as any).size_factor) || 1,
        category: (product as any).category ?? null,
        hazardClass: (attrs as any)?.hazard_class ?? null,
        tempMin: (attrs as any)?.temp_min != null ? Number((attrs as any).temp_min) : null,
        tempMax: (attrs as any)?.temp_max != null ? Number((attrs as any).temp_max) : null,
        handlingType: (attrs as any)?.handling_type ?? null,
        stackable: (attrs as any)?.stackable ?? null,
        velocityClass: (velRow as any)?.velocity_class ?? null,
      }

      const { data: candRows, error: cErr } = await admin.rpc('wie_putaway_candidates', {
        p_layout_id: layoutId, p_product_id: line.product_id, p_limit: 200,
      })
      if (cErr) throw new EdgeFunctionError('INTERNAL', `candidate load failed: ${cErr.message}`)

      const candidates: CandidateBin[] = ((candRows ?? []) as any[]).map((r) => ({
        locationId: r.location_id,
        code: r.code,
        zoneId: r.zone_id ?? null,
        zoneTag: r.zone_tag ?? null,
        capacitySlots: r.capacity_slots != null ? Number(r.capacity_slots) : null,
        usedSlots: Number(r.used_slots) || 0,
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
      }))

      const result = recommendPutaway({
        layoutId, warehouseId: warehouse_id, sku, quantity: line.quantity,
        candidates, rules, compatibility, weights,
      })

      // Dry-run previews are never persisted: recommendationId 0 signals "not a
      // real task" (decide-putaway rejects it) so the queue stays clean.
      let recommendationId = 0
      if (!dry_run) {
        const { data: recRow, error: rErr } = await admin.from('wie_putaway_recommendations').insert({
          warehouse_id, layout_id: layoutId, product_id: line.product_id, quantity: line.quantity,
          goods_receipt_id: goods_receipt_id ?? null,
          recommended_location_id: result.recommendedLocationId,
          alternatives: result.alternatives, explanation: result.explanation,
          engine_version: result.explanation.engineVersion, actor_id: auth.userId,
        } as any).select('id').single()
        if (rErr) throw new EdgeFunctionError('INTERNAL', `failed to persist recommendation: ${rErr.message}`)
        recommendationId = (recRow as any).id
      }

      recommendations.push({
        recommendationId,
        productId: line.product_id,
        quantity: line.quantity,
        recommendedLocationId: result.recommendedLocationId,
        alternatives: result.alternatives,
        explanation: result.explanation,
      })
    }

    return new Response(JSON.stringify({ ok: true, mode: 'engine', layout_id: layoutId, recommendations }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

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
import { DEFAULT_WEIGHTS, PUTAWAY_CANDIDATE_LIMIT } from './wie/types.ts'
import { positionsRequired } from './wie/capacity.ts'
import { ENGINE_VERSION } from './wie/version.ts'
import { resolveRolesForPutaway, rolesForHuType } from './wie/levelRoles.ts'
import { loadLevelRoles } from './levelRoleLookup.ts'
import { loadWarehouseSlotting, loadSlottingProduct, contextFor, priorityLocationsFor } from './slottingLoad.ts'
import { resolveSlotting } from './wie/slotting.ts'
import { planHomeFirst, type SuggestionSource } from './wie/homeFirst.ts'
import { loadHomeBins, loadHomeSlotUsage } from './putawayHome.ts'
import type { LevelRoleRecord } from './wie/levelRoles.ts'
import type { CandidateBin, LevelRole, RuleDefinition, ScoringWeights, SkuProfile } from './wie/types.ts'

// The candidate ceiling now lives in the pure engine module so the layout
// designer can warn as a site approaches it, reading the same number this
// passes. See PUTAWAY_CANDIDATE_LIMIT's comment for why 200 was not enough.
const CANDIDATE_LIMIT = PUTAWAY_CANDIDATE_LIMIT

export interface PutawayLineInput {
  product_id: number
  quantity: number
  /** The plate this quantity arrived on (mig 00075). Routes the line to the
   *  level roles that suit the physical unit: a pallet belongs in bulk/reserve,
   *  a carton on a pick face. Omitted = unconstrained, exactly as before. */
  hu_type?: 'pallet' | 'carton'
  /** WHICH plate (handling_units.id), when the caller knows it. Copied onto
   *  every task so the plate drains as its contents are put away. A MIXED
   *  pallet is several lines on ONE plate; since NX-0006 each of its products
   *  is planned on its own (to its own home), because the plate is broken down
   *  at putaway — it no longer travels to one bin as a unit. */
  hu_id?: number
  /**
   * Route this line into a HOLD zone instead of ordinary storage (mig 00101).
   *
   * Per LINE, not per receipt, and that is what makes "flag the whole delivery,
   * with a per-line override" a UI concern rather than a precedence puzzle here:
   * the checkbox writes the flag onto every line, and unticking one line clears
   * it. The server never has to decide which of two answers wins.
   *
   * It flips `wie_putaway_candidates`' `p_hold_only`, so a quarantined line can
   * ONLY be offered a hold bin and an ordinary line can never be offered one.
   */
  quarantine?: boolean
  /**
   * Opaque caller tag, copied verbatim onto every result this line produces.
   *
   * `recommendations` is a FLAT array and one line can produce several
   * allocations (multi-bin placement), so without this a caller cannot tell
   * which of its inputs an entry came from. Matching on product_id does not
   * work when several lines share a SKU -- which is exactly the shape a pallet
   * break-down has, every portion being the same product.
   *
   * The alternative, one call per line, would lose the greedy `overlay` that
   * makes later lines see a bin the earlier ones just filled, and two portions
   * would be offered the same pick bay.
   */
  ref?: string
}

/**
 * Combine the SKU's own level-role rule with the plate's preferred roles.
 *
 * Until mig 00081 the plate preference was a hardcoded map here
 * (`pallet -> ['bulk','reserve']`, `carton -> ['pick']`). It now arrives as
 * data: each level_roles row lists the handling-unit types that belong on it,
 * so adding a role — or deciding that pallets may sit on a pick zone — is an
 * operator edit rather than a deploy.
 *
 * The SKU rule (product_wms_attributes.allowed_level_roles) is a HARD rule
 * enforced in wie_putaway_candidates' WHERE clause; the plate type is a
 * preference. So they are intersected — but if the intersection is EMPTY the
 * SKU rule wins alone, because letting a plate preference empty the candidate
 * set would wedge the queue with nowhere to put the stock, which is the failure
 * mode mig 00072's role gate already had to grow an override for.
 *
 * NULL means unconstrained. Note that bins with a NULL level_role (every legacy
 * bin) stay eligible regardless — that predicate lives in the RPC.
 */
export function resolvePutawayRoles(
  skuRoles: LevelRole[] | null,
  huType: 'pallet' | 'carton' | undefined,
  roles: readonly LevelRoleRecord[],
): LevelRole[] | null {
  return resolveRolesForPutaway(skuRoles, rolesForHuType(roles, huType))
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
  /** The originating line's `ref`, when it carried one. */
  ref?: string
  productId: number
  quantity: number
  recommendedLocationId: number | null
  alternatives: unknown[]
  explanation: unknown
  /** Why this bin (NX-0006): the product's home, near its home, or the plain engine. */
  suggestionSource: SuggestionSource
  /** The product has no home bin yet; the operator may make the chosen bin its home. */
  suggestMakeHome: boolean
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

  // The operator-managed role vocabulary (mig 00081) — read ONCE per call, then
  // threaded into the pure engine as data. This load lives here rather than in
  // _shared/wie/levelRoles.ts because that module is inside the purity contract
  // and may not perform I/O.
  const levelRoles = await loadLevelRoles(admin)

  // Slotting rules (mig 00115) — which blocks each product belongs in, and
  // which blocks are held empty for somebody else. A SAFETY gate like the two
  // above, so it fails CLOSED: a `hard` rule that silently vanished on a
  // transient read error would send a pallet to the wrong aisle and nobody
  // would find out until they went looking for it.
  const slotting = await loadWarehouseSlotting(admin, warehouseId)

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
  // Quantity of each product this call has already sent to its home bin, so a
  // second line of the same SKU sees the max_qty headroom the first one used.
  const homeQtyPlaced = new Map<number, number>()
  const homes = await loadHomeBins(admin, warehouseId)
  // A plate carrying more than one line is a MIXED pallet: broken down at
  // putaway, each product planned loose to its own home (NX-0006).
  const linesPerPlate = new Map<number, number>()
  for (const l of lines) {
    if (l.hu_id != null) linesPerPlate.set(l.hu_id, (linesPerPlate.get(l.hu_id) ?? 0) + 1)
  }
  const recommendations: PutawayTaskResult[] = []

  for (const line of lines) {
    const { data: product, error: pErr } = await admin.from('products')
      .select('id, sku, name, size_factor, category, brand').eq('id', line.product_id).single()
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

    // Slotting for THIS line, resolved BEFORE the SkuProfile so the profile can
    // be built complete rather than patched afterwards. Skipped entirely when
    // the site has no rules, which keeps a site that has never opened the
    // feature on exactly the code path it ran before mig 00115 -- no extra
    // query, no context, and `request.slotting` undefined into the engine.
    const slotProduct = slotting.empty ? null : await loadSlottingProduct(admin, {
      id: (product as any).id,
      brand: (product as any).brand ?? null,
      category: (product as any).category ?? null,
    })
    const slotContext = slotProduct ? contextFor(slotting, slotProduct) : undefined
    // Resolving the winner here is only to name the bins that must survive the
    // candidate LIMIT. The ladder still has exactly one definition -- this
    // calls it rather than restating it, and the SQL is told which ids matter
    // rather than deciding anything.
    const priorityLocations = slotProduct
      ? priorityLocationsFor(slotting, resolveSlotting(slotting.rules, slotProduct).homeBlockIds)
      : null

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
      brand: (product as any).brand ?? null,
      supplierIds: slotProduct?.supplierIds ?? [],
    }

    // Plates are steered to the level roles that claim their handling-unit type
    // (by default pallets to bulk/reserve, cartons to the pick zone), without
    // ever overriding the SKU's own hard role rule. Which roles claim which
    // plate type is operator-configured since mig 00081.
    const mixedPlate = line.hu_id != null && (linesPerPlate.get(line.hu_id) ?? 0) > 1
    const planHu = mixedPlate ? undefined : line.hu_type
    const effectiveRoles = resolvePutawayRoles(allowedLevelRoles, planHu, levelRoles)
    const home = homes.get(line.product_id) ?? null

    const { data: candRows, error: cErr } = await admin.rpc('wie_putaway_candidates', {
      p_layout_id: layoutId, p_product_id: line.product_id, p_limit: CANDIDATE_LIMIT, p_roles: effectiveRoles,
      // A switch, not a filter to relax: a held line may ONLY be offered a hold
      // bin, and an ordinary one may never be (mig 00101).
      p_hold_only: line.quarantine === true,
      // A priority, not a filter (mig 00116): everything still arrives, but
      // this product's own home bins can never be the rows the LIMIT cuts off.
      // The home bin must survive the LIMIT too, or a big site could hide the
      // one bin the owner chose.
      p_priority_locations: home
        ? [...(priorityLocations ?? []), home.binId]
        : priorityLocations,
      // NX-0006: rank by closeness to the home bin (same_rack, anchor_distance_m).
      p_anchor_location_id: home?.binId ?? null,
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
        // What capacity/fill are denominated in (mig 00078) — 'pallet' means a
        // plate consumes one whole position rather than qty × size_factor.
        slotKind: r.slot_kind ?? null,
        // Three things occupy a bay, and all three must be charged or the
        // planner hands the same space out twice:
        //   used_slots     stock that is physically in it (v_bin_fill)
        //   pending_slots  OPEN putaway tasks that already name it (mig 00123) —
        //                  two-stage putaway moves no stock at assign, so
        //                  without this a bay promised to three plates still
        //                  reads empty
        //   overlay        lines of THIS receipt placed earlier in this loop
        usedSlots: (Number(r.used_slots) || 0)
          + (Number(r.pending_slots) || 0)
          + (pending?.slots ?? 0),
        weightCapacityKg: r.weight_capacity_kg != null ? Number(r.weight_capacity_kg) : null,
        usedWeightKg: (Number(r.used_weight_kg) || 0)
          + (Number(r.pending_weight_kg) || 0)
          + (pending?.weight ?? 0),
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
        blockIds: Array.isArray(r.block_ids) ? r.block_ids.map(Number) : [],
        isHold: r.is_hold === true,
      }
    })

    // Held bins come from the candidates themselves rather than a second query:
    // `p_hold_only` already decided which kind of bin this line may see, and
    // is_hold (mig 00116) is how that decision reaches the engine at all.
    const heldLocationIds = new Set(
      candidates.filter((c) => c.isHold).map((c) => c.locationId),
    )

    const base = {
      layoutId, warehouseId, sku, huType: planHu,
      rules, compatibility, weights,
      slotting: slotContext
        ? { ...slotContext, heldLocationIds }
        : undefined,
    }

    // ── Home first (NX-0006) ──────────────────────────────────────────────
    const homeCand = home ? candidates.find((c) => c.locationId === home.binId) : undefined
    const usage = home && homeCand && home.maxQty !== null
      ? await loadHomeSlotUsage(admin, { warehouseId, productId: line.product_id, binId: home.binId })
      : { onHand: 0, pendingQty: 0 }
    const homePlan = planHomeFirst({
      quantity: line.quantity,
      sizeFactor: sku.sizeFactor,
      unitLoad: planHu === 'pallet',
      // A home the candidate query did not return (inactive, a hold bin, a level
      // role this product may not use) is not a usable home for this line; the
      // remainder still ranks by closeness to it.
      home: home && homeCand
        ? {
          locationId: home.binId,
          maxQty: home.maxQty,
          onHand: usage.onHand,
          pendingQty: usage.pendingQty + (homeQtyPlaced.get(line.product_id) ?? 0),
          capacitySlots: homeCand.capacitySlots,
          usedSlots: homeCand.usedSlots,
        }
        : null,
      candidates: ((candRows ?? []) as any[]).map((r) => ({
        locationId: r.location_id,
        sameRack: r.same_rack === true,
        anchorDistanceM: r.anchor_distance_m != null ? Number(r.anchor_distance_m) : null,
      })),
    })
    // An unusable home must not offer "make this the home bin": there is one.
    const suggestMakeHome = home === null
    const remainderSource: SuggestionSource = home ? 'overflow' : 'engine'

    const tagged: Array<{ alloc: ReturnType<typeof planPutaway>['allocations'][number]; source: SuggestionSource }> = []
    let remainder = home && homeCand ? homePlan.remainder : line.quantity

    if (homeCand && homePlan.homeQty > 0) {
      // Planned through the engine on the home bin alone, so the safety rules
      // (hazard, compatibility, held bins) still apply to the owner's choice.
      const homeAttempt = planPutaway({ ...base, quantity: homePlan.homeQty, candidates: [homeCand] })
      for (const alloc of homeAttempt.allocations) {
        if (alloc.locationId === null) {
          remainder += alloc.quantity
        } else {
          tagged.push({ alloc, source: 'home' })
          homeQtyPlaced.set(line.product_id, (homeQtyPlaced.get(line.product_id) ?? 0) + alloc.quantity)
        }
      }
    }

    if (remainder > 0) {
      const rest = planPutaway({
        ...base,
        quantity: remainder,
        candidates,
        anchorOrder: home ? homePlan.overflowOrder : undefined,
        excludeLocationIds: home ? [home.binId] : undefined,
      })
      for (const alloc of rest.allocations) tagged.push({ alloc, source: remainderSource })
    }

    const binByLocation = new Map(candidates.map((c) => [c.locationId, c]))

    for (const { alloc, source } of tagged) {
      // Fold this placement into the overlay so later lines see the bin as fuller.
      if (alloc.locationId !== null) {
        const bin = binByLocation.get(alloc.locationId)
        const prev = overlay.get(alloc.locationId) ?? { slots: 0, weight: 0 }
        overlay.set(alloc.locationId, {
          // One position for a unit load, qty × size_factor otherwise — the
          // same conversion the bin's own fill uses.
          slots: prev.slots + positionsRequired(bin?.slotKind, alloc.quantity, sku.sizeFactor, planHu),
          weight: prev.weight + alloc.quantity * (sku.weightKg ?? 0),
        })
      }

      let recommendationId = 0
      if (!dryRun) {
        const { data: recRow, error: rErr } = await admin.from('wie_putaway_recommendations').insert({
          warehouse_id: warehouseId, layout_id: layoutId, product_id: line.product_id, quantity: alloc.quantity,
          goods_receipt_id: goodsReceiptId ?? null,
          recommended_location_id: alloc.locationId,
          handling_unit_id: line.hu_id ?? null,
          alternatives: alloc.alternatives, explanation: alloc.explanation,
          engine_version: (alloc.explanation as any).engineVersion, actor_id: actorId,
          // Columns, not JSONB: a badge must not require parsing `explanation`.
          off_home: alloc.offHome === true,
          slotting_rule_id: alloc.slotting?.ruleId ?? null,
          suggestion_source: source,
        } as any).select('id').single()
        if (rErr) throw new Error(`failed to persist recommendation: ${rErr.message}`)
        recommendationId = (recRow as any).id
      }

      recommendations.push({
        recommendationId,
        ref: line.ref,
        productId: line.product_id,
        quantity: alloc.quantity,
        recommendedLocationId: alloc.locationId,
        alternatives: alloc.alternatives,
        explanation: alloc.explanation,
        suggestionSource: source,
        suggestMakeHome,
      })
    }
  }

  return { mode: 'engine', layoutId, recommendations }
}

/**
 * Slotting Rules — which product belongs in which block of the warehouse.
 *
 * PURE. No Deno, no I/O, no supabase-js. The loader lives beside this file at
 * _shared/slottingLoad.ts, and `lib/slotting.ts` re-exports this module so the
 * browser evaluates the SAME decision the server does. That is the point: the
 * map panel's preview IS the engine's answer, not a second implementation of
 * it. (The `wie/zoneBinding.ts` + `zoneResolve.ts` split, again.)
 *
 * THE ONE THING TO UNDERSTAND BEFORE EDITING: this module decides ORDER, never
 * HEADROOM. It is quantity-independent on purpose, and that is not an
 * optimisation — it is a correctness requirement forced by a real caller.
 * `reslot.ts` deliberately calls `filterCandidates` with a FALSIFIED
 * `quantity: 1` while passing the real quantity only to `scoreCandidates`
 * (see its comment about the nominal single-unit need). A tier decision that
 * asked "does this tier have room for this line" would read that 1, conclude
 * tier 1 fits, and collapse every reslot plan to the primary block — dumping
 * the remainder into `overflow`, which carries NO reason field and therefore
 * surfaces to an operator as "could not be placed anywhere (capacity
 * exhausted)" with nothing anywhere pointing at slotting.
 *
 * So the division of labour is:
 *   - here:            which bins are LEGAL, and in what PREFERENCE ORDER
 *   - putawayPlan.ts:  which of them actually has room, walking that order
 * The greedy fill already spills to the next bin when one is full. Give it a
 * tier-ordered list and "ranked homes, then anywhere" falls out with no
 * fallback branch anywhere in this file.
 */

// Deliberately imports NOTHING. types.ts imports the specs from here, so a
// dependency in this direction would be a cycle — and the only thing this
// module needs from a candidate is its id and its code.

// ── Model ────────────────────────────────────────────────────────────────────

/** The slice of a CandidateBin this module reads. Structural, so a full
 *  CandidateBin satisfies it without any conversion at the call site. */
export interface SlottingCandidate {
  locationId: number
  code: string
}

export type SlottingEnforcement = 'hard' | 'soft'

/** A rule as the engine sees it. `blockIds` is in OPERATOR RANK ORDER — the
 *  array position IS the rank, so a reorder is a full replace and there is no
 *  rank integer on the wire to disagree with the ordering (the `paint_areas`
 *  doctrine). `specificity` is the generated bitmask from mig 00115; this
 *  module never recomputes it, so the ladder has exactly one definition. */
export interface SlottingRuleSpec {
  id: number
  name: string
  specificity: number
  matchProductId: number | null
  matchBrand: string | null
  matchCategory: string | null
  matchSupplierId: number | null
  enforcement: SlottingEnforcement
  reserveEmpty: boolean
  blockIds: readonly number[]
}

/** The product side of a match. `supplierIds` comes from `product_suppliers`
 *  (mig 00070) and NEVER from the legacy `products.supplier_id` column: using
 *  one in one engine and the other elsewhere would make putaway, reslot and
 *  batch-reoptimize disagree about the same rule. */
export interface SlottingProduct {
  productId: number
  brand: string | null
  category: string | null
  supplierIds: readonly number[]
}

export interface SlottingResolution {
  /** The governing rule, or null when nothing claims this product. */
  rule: SlottingRuleSpec | null
  /** The winner's blocks, in rank order. Empty when unruled. */
  homeBlockIds: readonly number[]
  enforcement: SlottingEnforcement | null
  /** Every matching rule, most-specific first — for the "why" panel and the
   *  settings table. Only the winner's blocks apply; this is display only. */
  matched: readonly SlottingRuleSpec[]
}

export type SlottingStatus =
  | 'unruled'   // no rule claims this product
  | 'home'      // inside one of the winner's ranked blocks
  | 'off_home'  // legal, but outside them
  | 'held'      // a quarantine bin — slotting has no opinion (see below)

export interface SlottingExclusion {
  locationId: number
  code: 'slotting_hard' | 'slotting_reserved'
  ruleId: number
  ruleName: string
  reason: string
}

export interface SlottingPlan {
  resolution: SlottingResolution
  /** Bins this plan refuses. Empty for a `soft` rule with no reservations. */
  excluded: readonly SlottingExclusion[]
  /** locationId -> tier. 0..n-1 are the ranked homes; `offHomeTier` is
   *  everything legal but elsewhere. A held bin is pinned at tier 0. */
  tierByLocation: ReadonlyMap<number, number>
  offHomeTier: number
  blockNameById: ReadonlyMap<number, string>
  /** True when this plan changes nothing — no rule matched and nothing is
   *  reserved. Callers may skip the sort entirely. */
  inert: boolean
}

export interface SlottingInput {
  product: SlottingProduct
  /** EVERY active rule at this warehouse, not just the matching ones —
   *  reservation is decided by rules that do NOT match this product. */
  rules: readonly SlottingRuleSpec[]
  blockNames: ReadonlyMap<number, string>
  /** locationId -> the blocks that bin belongs to (from wie_putaway_candidates'
   *  `block_ids`, which expands v_slotting_block_bins). */
  candidates: readonly SlottingCandidate[]
  blockIdsByLocation: ReadonlyMap<number, readonly number[]>
  /** Bins in a hold/quarantine zone. Slotting has NO OPINION on these — see
   *  `planSlotting`. */
  heldLocationIds?: ReadonlySet<number>
}

// ── Matching ─────────────────────────────────────────────────────────────────

/**
 * Case- and space-folded comparison key, or null for "no value".
 *
 * Deliberately NOT `String.prototype.trim()`. Postgres' `btrim(x)` with no
 * second argument strips ASCII SPACES ONLY, while JS `trim()` also strips tabs,
 * newlines and Unicode whitespace — so a brand stored as "\tMilwaukee" would
 * fold to "milwaukee" here and "\tmilwaukee" in SQL, and the two runtimes would
 * disagree about whether a rule matches. Matching btrim exactly costs one regex
 * and removes a whole class of "it works on my side" bug.
 *
 * `products.brand` and `products.category` both carry a
 * `char_length(btrim(...)) BETWEEN 1 AND 60` CHECK, so a stored value can never
 * be blank-after-folding; the empty-string guard here is for rule input that
 * has not reached the database yet.
 */
export function foldMatch(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const folded = value.replace(/^ +| +$/g, '').toLowerCase()
  return folded.length === 0 ? null : folded
}

/** Every non-null axis must hold (AND). A rule with no axes at all cannot exist
 *  — mig 00115's `slotting_rules_needs_an_axis` CHECK refuses it — but this
 *  returns false for one rather than matching everything, because a rule that
 *  silently claimed the whole catalogue would be the worst possible failure. */
export function ruleMatchesProduct(rule: SlottingRuleSpec, product: SlottingProduct): boolean {
  let axes = 0

  if (rule.matchProductId !== null) {
    if (rule.matchProductId !== product.productId) return false
    axes++
  }
  if (rule.matchBrand !== null) {
    const want = foldMatch(rule.matchBrand)
    if (want === null || want !== foldMatch(product.brand)) return false
    axes++
  }
  if (rule.matchCategory !== null) {
    const want = foldMatch(rule.matchCategory)
    if (want === null || want !== foldMatch(product.category)) return false
    axes++
  }
  if (rule.matchSupplierId !== null) {
    if (!product.supplierIds.includes(rule.matchSupplierId)) return false
    axes++
  }

  return axes > 0
}

/**
 * The ladder: most specific wins, ties broken by id.
 *
 * ONLY THE WINNER'S BLOCKS APPLY — never the union of every matching rule. A
 * SKU-level exception exists precisely to override its brand's rule, and
 * unioning them would make the exception additive instead, quietly leaving the
 * product homed in both places.
 */
export function resolveSlotting(
  rules: readonly SlottingRuleSpec[],
  product: SlottingProduct,
): SlottingResolution {
  const matched = rules
    .filter((r) => ruleMatchesProduct(r, product))
    .sort((a, b) => (b.specificity - a.specificity) || (a.id - b.id))

  const rule = matched.length > 0 ? matched[0] : null
  return {
    rule,
    homeBlockIds: rule ? rule.blockIds : [],
    enforcement: rule ? rule.enforcement : null,
    matched,
  }
}

// ── The decision ─────────────────────────────────────────────────────────────

/**
 * Turn a candidate set into a tier ordering plus a refusal list.
 *
 * QUARANTINE IS EXEMPT, AND THIS IS NOT AN EDGE CASE — it is the normal path
 * for every held receipt. `quarantine` is a call argument that never becomes a
 * stored fact: it enters at receive-stock, becomes `p_hold_only`, and dies
 * there. Because `p_hold_only` is a SWITCH rather than a filter to relax, a
 * held line's candidate set is hold bins EXCLUSIVELY — and a hold bay is by
 * construction outside any operator-brushed block. Without this exemption every
 * quarantined receipt of a slotted product would be flagged off-home, raise
 * tidy-up work proposing to move quarantined stock OUT of quarantine, and under
 * a hard rule be refused at the very bin the engine itself recommended.
 *
 * A held bin is therefore pinned at tier 0 (no penalty, so the stable sort
 * leaves the score ranking untouched) and can never be excluded.
 */
export function planSlotting(input: SlottingInput): SlottingPlan {
  const { product, rules, blockNames, candidates, blockIdsByLocation } = input
  const held = input.heldLocationIds ?? new Set<number>()

  const resolution = resolveSlotting(rules, product)
  const homeBlockIds = resolution.homeBlockIds
  const offHomeTier = homeBlockIds.length

  // Rank lookup: block id -> its position in the winner's ordered list.
  const rankOfBlock = new Map<number, number>()
  homeBlockIds.forEach((blockId, index) => {
    if (!rankOfBlock.has(blockId)) rankOfBlock.set(blockId, index)
  })

  // Reservation needs the rules that do NOT match this product, so it is built
  // from the whole rule set. A bin is HELD EMPTY iff any rule targeting it sets
  // reserveEmpty; it ADMITS a product iff any rule targeting it matches that
  // product. OR for "is it reserved", UNION for "who may use it" — the
  // alternative (only the reserving rule's products may enter) would make a
  // second rule's products off-home in a block they are explicitly homed in.
  const reservingByBlock = new Map<number, SlottingRuleSpec>()
  const admittingBlocks = new Set<number>()
  for (const rule of rules) {
    const matches = ruleMatchesProduct(rule, product)
    for (const blockId of rule.blockIds) {
      if (rule.reserveEmpty && !reservingByBlock.has(blockId)) reservingByBlock.set(blockId, rule)
      if (matches) admittingBlocks.add(blockId)
    }
  }

  const tierByLocation = new Map<number, number>()
  const excluded: SlottingExclusion[] = []

  for (const bin of candidates) {
    if (held.has(bin.locationId)) {
      tierByLocation.set(bin.locationId, 0)
      continue
    }

    const binBlocks = blockIdsByLocation.get(bin.locationId) ?? []

    // Reservation first: being inside somebody else's held-empty block is a
    // fact about the bin, true whether or not this product has a home at all.
    let refused = false
    for (const blockId of binBlocks) {
      const reserver = reservingByBlock.get(blockId)
      if (reserver && !admittingBlocks.has(blockId)) {
        excluded.push({
          locationId: bin.locationId,
          code: 'slotting_reserved',
          ruleId: reserver.id,
          ruleName: reserver.name,
          reason: `${blockNames.get(blockId) ?? 'this block'} is held for ${reserver.name}`,
        })
        refused = true
        break
      }
    }
    if (refused) continue

    // Best (lowest) rank among the blocks this bin belongs to.
    let tier = offHomeTier
    for (const blockId of binBlocks) {
      const rank = rankOfBlock.get(blockId)
      if (rank !== undefined && rank < tier) tier = rank
    }

    if (tier === offHomeTier && resolution.rule && resolution.enforcement === 'hard') {
      const where = homeBlockIds.map((b) => blockNames.get(b) ?? `block ${b}`).join(' or ')
      excluded.push({
        locationId: bin.locationId,
        code: 'slotting_hard',
        ruleId: resolution.rule.id,
        ruleName: resolution.rule.name,
        reason: `${resolution.rule.name} requires ${where || 'an assigned block'}`,
      })
      continue
    }

    tierByLocation.set(bin.locationId, tier)
  }

  return {
    resolution,
    excluded,
    tierByLocation,
    offHomeTier,
    blockNameById: blockNames,
    inert: resolution.rule === null && excluded.length === 0,
  }
}

/** Preference tier for a bin, for the stable sort in putawayPlan/reslot. An
 *  unknown bin sorts with the off-home group rather than ahead of everything. */
export function tierOf(plan: SlottingPlan, locationId: number): number {
  const tier = plan.tierByLocation.get(locationId)
  return tier === undefined ? plan.offHomeTier : tier
}

/** Whether a chosen bin is outside the product's assigned blocks. False for an
 *  unruled product and false for a held bin — neither is "misplaced". */
export function isOffHome(plan: SlottingPlan, locationId: number): boolean {
  if (plan.resolution.rule === null) return false
  return tierOf(plan, locationId) === plan.offHomeTier
}

export interface BinVerdict {
  status: SlottingStatus
  /** 1-based rank as an operator counts it; null when off-home or unruled. */
  rank: number | null
  blockName: string | null
  /** One operator-facing sentence. */
  text: string
}

/**
 * The single source of the words an operator reads about a bin — used by the
 * putaway task card, the client-side guard warning and the bin-picker badge, so
 * all three necessarily say the same thing rather than three paraphrases that
 * drift.
 */
export function describeBin(plan: SlottingPlan, locationId: number): BinVerdict {
  const rule = plan.resolution.rule
  if (!rule) return { status: 'unruled', rank: null, blockName: null, text: '' }

  const tier = tierOf(plan, locationId)
  if (tier === plan.offHomeTier) {
    const where = plan.resolution.homeBlockIds
      .map((b) => plan.blockNameById.get(b) ?? `block ${b}`)
      .join(' or ')
    return {
      status: 'off_home',
      rank: null,
      blockName: null,
      text: where
        ? `Off-home — ${rule.name} assigns this to ${where}`
        : `Off-home — outside ${rule.name}`,
    }
  }

  const blockId = plan.resolution.homeBlockIds[tier]
  const blockName = plan.blockNameById.get(blockId) ?? null
  const rank = tier + 1
  return {
    status: 'home',
    rank,
    blockName,
    text: rank === 1
      ? `${blockName ?? 'Assigned block'} — ${rule.name}`
      : `${blockName ?? 'Assigned block'} — ${rule.name}, overflow ${rank - 1}`,
  }
}

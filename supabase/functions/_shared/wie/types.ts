// Warehouse Intelligence Engine — shared data model.
//
// PURITY CONTRACT: every file under _shared/wie/ is pure TypeScript — no Deno
// globals, no URL/npm imports, no I/O. The engine takes plain data in and returns
// plain data out; loading that data (SQL, edge-function env) is the caller's job.
// This lets the same code run inside Deno edge functions AND the Vite frontend.
// The rule is enforced by __tests__/wie/purity.test.ts.

import type { HuType, SlotKind } from './capacity.ts'

export type { HuType, SlotKind }

// ── Spatial primitives ───────────────────────────────────────────────────────

export type GraphNodeType = 'walk' | 'junction' | 'dock' | 'lift'

/** A node in a warehouse's walkway skeleton. At build time `id` is a 0-based
 *  local index; the publish pipeline maps it to a real DB id. */
export interface GraphNode {
  id: number
  floor: number
  x: number
  y: number
  nodeType: GraphNodeType
}

export interface GraphEdge {
  fromNode: number
  toNode: number
  weightM: number
  bidirectional: boolean
}

export interface WarehouseGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** A single walkable grid cell fed to the skeleton builder at publish time. */
export interface WalkCell {
  x: number
  y: number
  floor: number
  isDock: boolean
  /** A lift/stairs cell — connects vertically to a lift cell directly above/below
   *  it on the adjacent floor, so routes can cross floors (Phase 8 multi-floor). */
  isLift?: boolean
}

/** A storage footprint (rack/bin) to snap onto the nearest walkway node. */
export interface PlacementFootprint {
  locationId: number
  floor: number
  x: number
  y: number
  w: number
  h: number
}

// ── Inventory / SKU model ────────────────────────────────────────────────────

/** What a rack level is used for (mig 00072). Drives the HARD putaway gate —
 *  a SKU may only be placed on a level whose role it allows. The role filter
 *  itself runs in SQL (wie_putaway_candidates' p_roles argument); this type
 *  just carries the value through for explainability + UI display. `null` on
 *  a location/CandidateBin means unconstrained — every legacy bin (and every
 *  level with no explicit role) stays eligible for any SKU.
 *
 *  Since mig 00081 the vocabulary is operator-managed (`level_roles`), so this
 *  is a bare string: 'pick'/'reserve'/'bulk' are the seeded keys, not the only
 *  legal ones. The engine never branches on the value — see levelRoles.ts for
 *  the semantic flags, which arrive as data. */
export type LevelRole = string

/** The SKU being put away, plus the attributes the rule/scoring layers read.
 *  Phase-3 attributes (hazard/temp) are optional and null until that phase. */
export interface SkuProfile {
  productId: number
  code: string
  name: string
  /** Slots consumed per base unit (products.size_factor). */
  sizeFactor: number
  /** Weight per base unit in kg (product_wms_attributes.weight_kg); null when
   *  unset — the weight gate then fails open for this SKU. */
  weightKg: number | null
  category: string | null
  // Phase-3 attributes (from product_wms_attributes); null when unset.
  hazardClass: string | null
  tempMin: number | null
  tempMax: number | null
  handlingType: string | null
  stackable: boolean | null
  /** ABC pick-velocity class for this SKU at this warehouse (Phase 4); null when
   *  no history. Drives velocity_match (A-movers near the dock, C-movers away). */
  velocityClass: 'A' | 'B' | 'C' | null
  /** Which rack-level roles this SKU may occupy (mig 00072,
   *  product_wms_attributes.allowed_level_roles). `null` (or an empty array) =
   *  any role — this is also the value used when the SKU has no
   *  product_wms_attributes row at all, so every pre-existing SKU keeps
   *  working unchanged. Optional so pre-existing call sites/tests that build
   *  a SkuProfile literal without it keep compiling. */
  allowedLevelRoles?: LevelRole[] | null
}

/** A candidate storage location (bin), pre-loaded with everything the two-stage
 *  optimizer needs. Distances are precomputed at publish time (dock→node) and
 *  arrive here via SQL — the runtime recommend path does no pathfinding. */
export interface CandidateBin {
  locationId: number
  code: string
  zoneId: number | null
  /** Operational zone tag, e.g. 'cold' | 'hazardous' | 'fast' (Phase 2 gives
   *  zones real semantics; Phase 1 reads an optional tag off the zone name). */
  zoneTag: string | null
  /** Soft capacity in slots (locations.capacity_slots); null = uncapped. */
  capacitySlots: number | null
  /** What `capacitySlots`/`usedSlots` are DENOMINATED in (locations.slot_kind).
   *  'pallet' ⇒ they count whole pallet positions and a plate consumes one of
   *  them whatever is on it (see capacity.ts); anything else ⇒ per-unit slots.
   *  Optional so pre-existing call sites/tests that build a CandidateBin
   *  literal without it keep compiling (they get the per-unit behaviour). */
  slotKind?: SlotKind
  /** Current fill: Σ(on_hand × size_factor), or the pallet count in a
   *  pallet-denominated bin (mig 00078). See capacity.ts `positionsUsed`. */
  usedSlots: number
  /** Weight limit in kg (locations.weight_capacity_kg); null = no limit. */
  weightCapacityKg: number | null
  /** Current weight in this bin, kg: Σ(on_hand × weight_kg) already stored. */
  usedWeightKg: number
  graphNodeId: number | null
  /** Perpendicular distance from the walkway node into the bin, plus a shelf
   *  height penalty — added to skeleton distance for the effective travel cost. */
  accessOffsetM: number
  /** Grouping hint: this bin already holds stock of the SKU being put away. */
  hasSameProduct: boolean
  /** Precomputed travel distance from the receiving dock to this bin's node.
   *  null ⇒ unreachable from any dock (hard-filtered out). */
  distanceFromDockM: number | null
  // Zone semantics (Phase 2) — inherited from the bin's ZONE ancestor's profile.
  zoneType: string | null
  /** 0..1 preference weight; null ⇒ no profile (treated as neutral 0.5). */
  zonePriorityWeight: number | null
  /** Hard allow-list of product categories, or null for any. */
  zoneAllowedCategories: string[] | null
  /** Soft fill-fraction target (0..1), or null for uncapped. */
  zoneMaxUtilizationPct: number | null
  /** Distinct product categories currently stored in this bin (Phase 3) — the
   *  compatibility gate checks the incoming SKU's category against these. */
  occupantCategories: string[]
  /** Pick visits to this bin's node in the last 30 days (Phase 4 congestion). */
  pickVisits30d: number
  /** This level's role (mig 00072); null on a RACK parent, a non-levelled bin,
   *  or a level with no explicit role — all unconstrained. The role GATE
   *  itself already ran in SQL before this bin ever reached the engine; this
   *  is carried through for display/explainability only. Optional so
   *  pre-existing call sites/tests that build a CandidateBin literal without
   *  it keep compiling. */
  levelRole?: LevelRole | null
  /** 1-based level number within its rack (mig 00072); null/undefined when
   *  this bin isn't a level. */
  levelIndex?: number | null
}

export type CompatibilityLevel = 'forbidden' | 'restricted' | 'allowed'

/** A normalized (categoryA ≤ categoryB) entry in the global compatibility matrix. */
export interface CompatibilityRule {
  categoryA: string
  categoryB: string
  level: CompatibilityLevel
}

// ── Rules (structured JSON, engine-evaluated) ────────────────────────────────

export type RuleOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'exists'
export type RuleSubject = 'product' | 'bin' | 'zone'
export type RuleEffect = 'require' | 'forbid' | 'boost' | 'penalty'
export type RuleEnforcement = 'hard' | 'soft'

export interface RuleCondition {
  subject: RuleSubject
  attr: string
  op: RuleOp
  value?: unknown
}

/** For hard rules (require/forbid) `target` is a predicate the winning bin must
 *  (require) or must not (forbid) satisfy. For soft rules (boost/penalty) `delta`
 *  adjusts the bin's score. */
export interface RuleTarget {
  scope: 'bin' | 'zone'
  attr: string
  op: RuleOp
  value?: unknown
}

export interface RuleAction {
  effect: RuleEffect
  target?: RuleTarget
  delta?: number
}

/** A rule as stored in wie_rules.definition (id/name/enforcement/priority live in
 *  columns; conditions + action live in the JSONB). `conditionLogic` combines the
 *  conditions ('and' = all, 'or' = any); defaults to 'and' for backward compat. */
export interface RuleDefinition {
  id: number
  name: string
  enforcement: RuleEnforcement
  priority: number
  conditions: RuleCondition[]
  conditionLogic?: 'and' | 'or'
  action: RuleAction
}

// ── Scoring ──────────────────────────────────────────────────────────────────

export type ScoringFactor =
  | 'travel_distance'
  | 'capacity_fit'
  | 'grouping'
  | 'zone_preference'
  | 'congestion'
  | 'velocity_match'

export interface ScoringWeights {
  travelDistance: number
  capacityFit: number
  grouping: number
  zonePreference: number
  congestion: number
  velocityMatch: number
}

/**
 * How many candidate bins the putaway engine loads per line.
 *
 * `wie_putaway_candidates` orders by dock distance and treats this as a HARD
 * cutoff, so a layout with more placements than this silently hides its
 * FARTHEST bays from the engine — stock is simply never recommended there, with
 * no error anywhere. It was 200 until mig 00072 raised it: MAIN alone is 189
 * bays, and levelled at 5 levels/rack that is 945 locations, so 200 hid the far
 * half of the warehouse.
 *
 * Lives here, in the pure engine module, so BOTH the impure task generator that
 * passes it and the designer warning that watches for it read one number.
 * _shared/putawayTasks.ts imports supabase-js from a URL, so the frontend
 * cannot import the constant from there.
 */
export const PUTAWAY_CANDIDATE_LIMIT = 2000

/** Default weights (Phase 4 — all six factors live). Per-warehouse
 *  wie_scoring_profiles override these. Sum ≈ 1.0. */
export const DEFAULT_WEIGHTS: ScoringWeights = {
  travelDistance: 0.3,
  capacityFit: 0.2,
  grouping: 0.1,
  zonePreference: 0.15,
  congestion: 0.1,
  velocityMatch: 0.15,
}

// ── Engine request / response ────────────────────────────────────────────────

export interface PutawayRequest {
  layoutId: number
  warehouseId: number
  sku: SkuProfile
  /** Quantity being put away, in BASE units. */
  quantity: number
  /** The handling unit this quantity arrived on (mig 00075). It describes the
   *  arriving LOAD, not the SKU, which is why it sits here rather than on
   *  SkuProfile — the same product can arrive as a pallet today and loose
   *  cartons tomorrow. A pallet going into a pallet-denominated bin consumes
   *  one whole position and becomes INDIVISIBLE in planPutaway. Undefined =
   *  loose/unknown, exactly the pre-00078 behaviour. */
  huType?: HuType
  candidates: CandidateBin[]
  rules: RuleDefinition[]
  /** Global category-compatibility matrix (Phase 3); empty ⇒ no gating. */
  compatibility: CompatibilityRule[]
  weights: ScoringWeights
}

// ── Explainability ───────────────────────────────────────────────────────────

export interface FactorBreakdown {
  factor: ScoringFactor
  weight: number
  rawValue: number
  /** 0..1 after normalization across the candidate set. */
  normalized: number
  /** Contribution to the total score (normalized × weight). */
  weighted: number
  detail: string
}

export interface RuleTrigger {
  ruleId: number
  name: string
  effect: 'boost' | 'penalty'
  delta: number
}

export interface CandidateBreakdown {
  locationId: number
  locationCode: string
  totalScore: number
  factors: FactorBreakdown[]
  ruleTriggers: RuleTrigger[]
}

export interface HardFilterReason {
  /** wie_rules.id when a user rule caused the rejection; null for built-ins. */
  ruleId: number | null
  code: string
  label: string
  rejectedCount: number
  sample: Array<{ locationId: number; code: string; reason: string }>
}

export interface PutawayExplanation {
  engineVersion: string
  layoutId: number
  candidatesConsidered: number
  hardFilters: HardFilterReason[]
  winner: CandidateBreakdown | null
  alternatives: CandidateBreakdown[]
  /** Set when the destination was decided WITHOUT scoring, so the operator is
   *  not shown an empty "no eligible bin" card. Today the only such case is a
   *  line riding on a plate an earlier line of the same receipt already placed
   *  (mig 00078) — a pallet goes to exactly one bin, so its lines follow it. */
  note?: string
}

export interface PutawayRecommendation {
  recommendedLocationId: number | null
  alternatives: CandidateBreakdown[]
  explanation: PutawayExplanation
}

/** One portion of a putaway plan: a quantity destined for a single bin, or the
 *  residual (locationId null) that no eligible bin could hold. A large line spans
 *  several allocations; a line that fits one bin yields exactly one. */
export interface PutawayAllocation {
  /** Target bin, or null for the residual left at root for manual placement. */
  locationId: number | null
  /** Quantity, in BASE units, going to this bin (or left unplaced). */
  quantity: number
  alternatives: CandidateBreakdown[]
  explanation: PutawayExplanation
  /** True only for the residual portion no bin had capacity for. */
  needsManualPlacement: boolean
}

/** A multi-bin putaway plan — the quantities in `allocations` sum to the
 *  requested quantity (placed portions + any residual). */
export interface PutawayPlan {
  allocations: PutawayAllocation[]
}

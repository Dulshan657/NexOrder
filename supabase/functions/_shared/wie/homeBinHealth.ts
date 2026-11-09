// Warehouse Intelligence Engine — home-bin health (NX-0032).
//
// A product's home bin is where putaway sends it first, and since NX-0032 it is
// where putaway MUST send it while it has room. That makes a home bin putaway
// cannot actually use a trap: the floor is told to put the stock there and the
// planner would never have offered it. This module answers one question for one
// home: what, if anything, stops putaway using it?
//
//   homeBinProblems(facts)       the problems, in a fixed order
//   homeBinReport(warehouse, f)  every home judged; the bad ones kept
//   homeBinFactsFromRow(row, w)  a wie_home_bin_facts row -> HomeBinFacts
//   slottingRefusalFor(...)      whether slotting excludes the home, in words
//
// NX-0033 asks the same question of a bin that is NOT yet a home: may a Manager
// give this product a home here?
//
//   homeBinCandidateFactsFromRow  a wie_home_bin_candidate_facts row -> facts
//   homeChoiceRefusal(facts)      why not, in words (another product's home first)
//   homeBinChoices(facts)         the bins that can be, in code order
//
// Every test below mirrors a test putaway itself makes:
//
//   inactive, hold_zone, level_role_not_allowed, carton_not_allowed, and the
//   level being a pick zone    wie_putaway_candidates (00135/00142) and the level
//                              roles it is called with (levelRoles.ts)
//   not_on_layout              the candidates come from layout_placements
//   no_dock_route              scoring.ts rejects a bin with no dock distance
//   zone_category              scoring.ts' zone allow-list
//   slotting_refused           planSlotting's hard and held-empty exclusions
//   full                       wie_home_block's room, through homeHeadroom
//
// A BIN WITH NO LEVEL ROLE passes every level test. wie_putaway_candidates keeps
// a NULL level_role eligible (`l.level_role IS NULL OR …`) and so does
// wie_home_block, so reporting such a home as "not a pick level" would claim
// putaway cannot use a bin it uses every day.
//
// Pure: no I/O. The facts come from wie_home_bin_facts (mig 00142); the one fact
// that needs the slotting rules, `slottingRefusal`, is worked out by the caller
// with `slottingRefusalFor` after loading them (_shared/homeBinHealthLoad.ts).

import { homeHeadroom } from './homeFirst.ts'
import { describeBin, planSlotting, type SlottingInput } from './slotting.ts'

export type HomeBinProblemCode =
  | 'inactive'
  | 'hold_zone'
  | 'not_pick_level'
  | 'carton_not_allowed'
  | 'level_role_not_allowed'
  | 'not_on_layout'
  | 'no_dock_route'
  | 'zone_category'
  | 'slotting_refused'
  | 'full'
  | 'other_warehouse'

export interface HomeBinProblem {
  code: HomeBinProblemCode
  message: string
}

/** One primary home, as wie_home_bin_facts returns it, camelCased. */
export interface HomeBinFacts {
  productId: number
  sku: string
  binId: number
  binCode: string
  /** The warehouse the home row belongs to (product_home_bins.warehouse_id). */
  warehouseId: number
  /** The warehouse that actually contains the bin; null if none does. */
  binWarehouseId: number | null
  isActive: boolean
  /** The bin's nearest ZONE ancestor is a hold zone. */
  isHold: boolean
  levelRole: string | null
  /** The level's role is an active pick zone. False for a bin with no role. */
  isPickZone: boolean
  /** Handling-unit types the level's role claims. Empty for a bin with no role. */
  levelHuTypes: string[]
  /** The product's own level-role rule; empty = unrestricted. */
  allowedLevelRoles: string[]
  inActiveLayout: boolean
  hasDockRoute: boolean
  /** The zone's category allow-list; null or empty = any category. */
  zoneAllowedCategories: string[] | null
  category: string | null
  /** Blank = unlimited. */
  capacitySlots: number | null
  usedSlots: number
  /** Slots promised to open putaway tasks (mig 00123). */
  pendingSlots: number
  sizeFactor: number
  /** Blank = no replenishment max. */
  maxQty: number | null
  onHandAtHome: number
  /** Base units of THIS product that open putaway tasks already send here. */
  pendingQty: number
  /** Why slotting excludes this bin for this product, or null. Set by the caller. */
  slottingRefusal: string | null
}

/** One home that has problems, as the home-bin-health function returns it. */
export interface HomeBinProblemRow {
  productId: number
  sku: string
  binId: number
  binCode: string
  problems: HomeBinProblem[]
}

/** The whole answer for one warehouse: every home checked, and the bad ones. */
export interface HomeBinHealthReport {
  warehouseId: number
  /** Homes looked at, healthy or not. */
  checked: number
  rows: HomeBinProblemRow[]
}

/** A wie_home_bin_facts row as the client hands it over. */
export interface HomeBinFactsRow {
  product_id: number
  sku: string
  bin_id: number
  bin_code: string
  bin_warehouse_id: number | null
  is_active: boolean
  is_hold: boolean
  level_role: string | null
  is_pick_zone: boolean
  level_hu_types: string[] | null
  allowed_level_roles: string[] | null
  in_active_layout: boolean
  has_dock_route: boolean
  zone_allowed_categories: string[] | null
  category: string | null
  capacity_slots: number | null
  used_slots: number | null
  pending_slots: number | null
  size_factor: number | null
  max_qty: number | null
  on_hand_at_home: number | null
  pending_qty: number | null
}

/**
 * A bin read as if it were a product's home (NX-0033), from
 * wie_home_bin_candidate_facts (mig 00143, 00144). The same facts as a real home, plus
 * the bin's name for the chooser and the OTHER products already homed there.
 */
export interface HomeBinCandidateFactsRow extends HomeBinFactsRow {
  bin_name: string | null
  /** Primary homes of other products at this bin, lowest product id first. */
  other_home_skus: string[] | null
}

export interface HomeBinCandidateFacts extends HomeBinFacts {
  binName: string | null
  otherHomeSkus: string[]
}

/** One bin a Manager may pick as a product's home. */
export interface HomeBinChoice {
  binId: number
  binCode: string
  binName: string | null
}

/** Float noise guard for the whole-unit rule, as planHomeFirst uses. */
const EPS = 1e-6

const num = (v: number | string | null | undefined): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
const numOrNull = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined ? null : num(v)

export function homeBinFactsFromRow(row: HomeBinFactsRow, warehouseId: number): HomeBinFacts {
  return {
    productId: row.product_id,
    sku: row.sku,
    binId: row.bin_id,
    binCode: row.bin_code,
    warehouseId,
    binWarehouseId: row.bin_warehouse_id ?? null,
    isActive: row.is_active === true,
    isHold: row.is_hold === true,
    levelRole: row.level_role ?? null,
    isPickZone: row.is_pick_zone === true,
    levelHuTypes: row.level_hu_types ?? [],
    allowedLevelRoles: row.allowed_level_roles ?? [],
    inActiveLayout: row.in_active_layout === true,
    hasDockRoute: row.has_dock_route === true,
    zoneAllowedCategories: row.zone_allowed_categories ?? null,
    category: row.category ?? null,
    capacitySlots: numOrNull(row.capacity_slots),
    usedSlots: num(row.used_slots),
    pendingSlots: num(row.pending_slots),
    sizeFactor: num(row.size_factor),
    maxQty: numOrNull(row.max_qty),
    onHandAtHome: num(row.on_hand_at_home),
    pendingQty: num(row.pending_qty),
    slottingRefusal: null,
  }
}

export function homeBinCandidateFactsFromRow(
  row: HomeBinCandidateFactsRow,
  warehouseId: number,
): HomeBinCandidateFacts {
  return {
    ...homeBinFactsFromRow(row, warehouseId),
    binName: row.bin_name ?? null,
    otherHomeSkus: row.other_home_skus ?? [],
  }
}

/**
 * No room for even one more base unit — the same test as wie_home_block's
 * `room = 0`, the point at which putaway may use another bin. homeHeadroom is
 * the one definition of the room, shared with planHomeFirst; SQL floors it to
 * whole units, so a fraction of a unit left is full.
 */
function isFull(f: HomeBinFacts): boolean {
  const room = homeHeadroom(
    {
      locationId: f.binId,
      maxQty: f.maxQty,
      onHand: f.onHandAtHome,
      pendingQty: f.pendingQty,
      capacitySlots: f.capacitySlots,
      // Stock in the bin AND space promised to open tasks, as putawayTasks reads it.
      usedSlots: f.usedSlots + f.pendingSlots,
    },
    f.sizeFactor,
  )
  return Math.floor(room + EPS) <= 0
}

export function homeBinProblems(f: HomeBinFacts): HomeBinProblem[] {
  const out: HomeBinProblem[] = []
  const add = (code: HomeBinProblemCode, message: string): void => {
    out.push({ code, message })
  }
  const bin = f.binCode

  if (!f.isActive) add('inactive', `Bin ${bin} is inactive, so putaway never offers it.`)
  if (f.isHold) add('hold_zone', `Bin ${bin} is in a hold zone, so ordinary stock is never put there.`)

  // A bin with no level role is legacy and putaway accepts it (see the header).
  if (f.levelRole !== null) {
    if (!f.isPickZone) {
      add('not_pick_level', `Bin ${bin} is on the ${f.levelRole} level, which is not a pick-zone level.`)
    }
    if (!f.levelHuTypes.includes('carton')) {
      add('carton_not_allowed', `Bin ${bin} is on the ${f.levelRole} level, which does not take cartons.`)
    }
    if (f.allowedLevelRoles.length > 0 && !f.allowedLevelRoles.includes(f.levelRole)) {
      add(
        'level_role_not_allowed',
        `${f.sku} may only go on the ${f.allowedLevelRoles.join(' or ')} level, but bin ${bin} is on the ${f.levelRole} level.`,
      )
    }
  }

  if (!f.inActiveLayout) add('not_on_layout', `Bin ${bin} is not on the published warehouse layout.`)
  if (!f.hasDockRoute) add('no_dock_route', `Bin ${bin} has no walking route from a dock.`)

  if (
    f.zoneAllowedCategories !== null && f.zoneAllowedCategories.length > 0 &&
    f.category !== null && !f.zoneAllowedCategories.includes(f.category)
  ) {
    add('zone_category', `The zone around bin ${bin} does not accept ${f.category}.`)
  }

  if (f.slottingRefusal !== null) {
    add('slotting_refused', `Slotting rules refuse bin ${bin} for ${f.sku}: ${f.slottingRefusal}`)
  }

  if (isFull(f)) add('full', `Bin ${bin} is full: it has no room left for ${f.sku}.`)

  if (f.binWarehouseId !== f.warehouseId) {
    add('other_warehouse', `Bin ${bin} is not in the warehouse this home is set for.`)
  }

  return out
}

/**
 * Why this bin cannot be the product's home, in words, or null when it can
 * (NX-0033). Another product's home is named first: it is the plainest thing to
 * tell a Manager, and wie_home_block step 2 refuses to put a different product
 * in a home bin. Otherwise the first thing homeBinProblems finds, because a
 * bin putaway would never offer is no home. Reads the bin as the product's home,
 * so `full` means no room for even one unit and a bin that is empty passes.
 */
export function homeChoiceRefusal(f: HomeBinCandidateFacts): string | null {
  if (f.otherHomeSkus.length > 0) {
    return `${f.binCode} is the home bin of ${f.otherHomeSkus[0]}; choose another bin.`
  }
  return homeBinProblems(f)[0]?.message ?? null
}

/** The bins a product can be given as its home, in code order. */
export function homeBinChoices(facts: readonly HomeBinCandidateFacts[]): HomeBinChoice[] {
  return facts
    .filter((f) => homeChoiceRefusal(f) === null)
    .map((f) => ({ binId: f.binId, binCode: f.binCode, binName: f.binName }))
    .sort((a, b) => a.binCode.localeCompare(b.binCode, 'en-AU'))
}

/** Judge every home in a warehouse and keep the ones with problems. */
export function homeBinReport(warehouseId: number, facts: readonly HomeBinFacts[]): HomeBinHealthReport {
  const rows = facts
    .map((f) => ({
      productId: f.productId,
      sku: f.sku,
      binId: f.binId,
      binCode: f.binCode,
      problems: homeBinProblems(f),
    }))
    .filter((r) => r.problems.length > 0)
  return { warehouseId, checked: facts.length, rows }
}

/**
 * Why slotting would exclude `binId` for the product in `input`, or null.
 *
 * Only an EXCLUSION is a refusal: a hard rule whose blocks leave the bin out, or
 * a block held empty for another rule. A soft rule that ranks the bin low still
 * lets putaway use it, and a hold bin is never excluded (planSlotting pins it).
 *
 * The words for a hard rule are describeBin's, the same sentence the putaway task
 * card shows. describeBin has none for a held-empty block (it reports the bin as
 * merely off-home, or says nothing for an unruled product), so those use the
 * exclusion's own reason.
 */
export function slottingRefusalFor(
  input: SlottingInput,
  binId: number,
  binCode: string,
): string | null {
  const plan = planSlotting({ ...input, candidates: [{ locationId: binId, code: binCode }] })
  const exclusion = plan.excluded.find((e) => e.locationId === binId)
  if (!exclusion) return null
  if (exclusion.code === 'slotting_hard') {
    const verdict = describeBin(plan, binId)
    if (verdict.text) return verdict.text
  }
  return exclusion.reason
}

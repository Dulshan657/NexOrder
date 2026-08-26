// Pallet break-down at putaway — the allocation rules, one definition, both
// runtimes.
//
// An operator on the putaway walk takes part of a pallet off it: four cartons
// for the pick face, a layer for the half-pallet bay, the rest stays on the
// plate. Each portion becomes a NEW handling unit with its own destination and
// its own walk stop. This module decides nothing about WHERE anything goes —
// that is the putaway engine's job — and everything about how much comes off
// and what container it becomes.
//
// WHY IT IS SHARED. `break-down-putaway` re-makes exactly this decision before
// it writes, so the sheet's running total and its inline refusals are not a
// second implementation of the server's answer, they ARE the server's answer,
// evaluated early. Same split and the same reason as _shared/binCount.ts.
//
// WHY IT DOES NOT KNOW WHAT A LAYER IS. Converting "2 layers" into base units
// needs the pallet geometry in lib/palletFit.ts, which is BROWSER-ONLY by
// deliberate decision (CLAUDE.md: "the server never computes a fit — it stores
// a factor the admin confirmed"). So the client converts before it sends, and
// the wire carries a base quantity plus the unit it was counted in. The unit
// survives for two reasons only: it decides the plate type, and it is worth
// having in the audit trail. The invariant that actually protects the ledger —
// nothing may be allocated that the pallet does not hold — is arithmetic on the
// base quantity, and is re-checked server-side and again under the row lock in
// wie_break_down_putaway_tx.
//
// PURITY: no Deno globals, no I/O, no imports. lib/palletBreakdown.ts re-exports
// it for the browser.

/** What the operator counted in. Not a UOM row: `layer` has no `product_uoms`
 *  entry and never will — it is derived from the pallet spec (mig 00125). */
export type CountedUnit = 'pallet' | 'layer' | 'carton' | 'base'

/** `handling_units.hu_type` (mig 00075). There are only two. */
export type BreakdownHuType = 'pallet' | 'carton'

/** Every unit the break-down sheet may offer, in the order it offers them.
 *  Exported so a test can assert the mapping below is total rather than
 *  spot-checking four literals. */
export const COUNTED_UNITS: readonly CountedUnit[] = ['pallet', 'layer', 'carton', 'base']

/**
 * The container a portion becomes, from the unit it was counted in.
 *
 * A layer lifted off a pallet is re-stacked on a pallet, so it is a pallet
 * plate; cartons and loose units are a carton plate. This matters well beyond
 * cosmetics: `hu_type` is what `rolesForHuType` (mig 00081) reads to route the
 * new task's engine suggestion — a carton portion is offered pick levels and a
 * pallet portion bulk/reserve — and it is what `v_bin_fill` (mig 00122) charges
 * one position for in a pallet-denominated bay.
 *
 * Deliberately a table and not a heuristic: changing the policy is an edit here
 * and nowhere else.
 */
export function huTypeForUnit(unit: CountedUnit): BreakdownHuType {
  return unit === 'pallet' || unit === 'layer' ? 'pallet' : 'carton'
}

/** One row of the break-down sheet, as it goes onto the wire. */
export interface BreakdownPortionInput {
  /** Base units. Already converted from whatever the operator counted in. */
  baseQty: number
  countedUnit: CountedUnit
  /** The confirmed destination bin. Null while the row is still incomplete. */
  locationId: number | null
}

/** Why a single row cannot be committed. Named, never a bare boolean, because
 *  each of these gets its own sentence next to the offending row. */
export type PortionRefusal = 'non_positive' | 'not_finite' | 'no_destination'

export interface PlannedPortion extends BreakdownPortionInput {
  huType: BreakdownHuType
  refusal: PortionRefusal | null
}

/** Why the sheet as a whole cannot be committed. */
export type BreakdownRefusal = 'nothing_allocated' | 'portion_invalid' | 'over_allocated'

/**
 * Flat, not a discriminated union, and that is on purpose.
 *
 * `strict` is off in this repo, which cripples union narrowing — see CLAUDE.md,
 * "tsconfig strict-off union narrowing". Every field here is meaningful in both
 * outcomes (a refused sheet still has to render its running total and its
 * per-row refusals), so a union would buy nothing and cost the caller a cast.
 */
export interface BreakdownPlan {
  ok: boolean
  portions: PlannedPortion[]
  /** Base units leaving the parent plate. */
  allocated: number
  /** What stays on it. NEGATIVE when over-allocated — never clamped, because a
   *  zero would hide the size of the mistake the operator has to undo. */
  remainder: number
  /** The parent plate ends up holding nothing: its task closes and hu_recompute
   *  marks the plate `empty`. A completely normal move — the pallet base goes
   *  back on the stack. */
  parentEmptied: boolean
  reason: BreakdownRefusal | null
  message: string | null
}

/** The ledger stores NUMERIC(14,3), so three decimals is the finest quantity
 *  that exists. Summing in thousandths keeps 0.1 + 0.2 off the answer. */
const SCALE = 1000

function round3(n: number): number {
  return Math.round(n * SCALE) / SCALE
}

function refusalFor(input: BreakdownPortionInput): PortionRefusal | null {
  if (!Number.isFinite(input.baseQty)) return 'not_finite'
  if (input.baseQty <= 0) return 'non_positive'
  if (input.locationId == null) return 'no_destination'
  return null
}

/**
 * Plan a break-down.
 *
 * Refusals are cumulative and reported per row: the sheet marks every offending
 * line at once rather than making the operator fix them one press at a time.
 * The over-allocation check runs on what is otherwise valid, so "you have asked
 * for 120 more than is on the pallet" is not withheld behind an unrelated typo.
 */
export function planBreakdown(args: {
  /** `wie_putaway_recommendations.quantity` on the task being broken down. */
  parentQty: number
  portions: readonly BreakdownPortionInput[]
}): BreakdownPlan {
  const portions: PlannedPortion[] = args.portions.map((p) => ({
    ...p,
    huType: huTypeForUnit(p.countedUnit),
    refusal: refusalFor(p),
  }))

  const allocatedThousandths = portions.reduce(
    (sum, p) => (p.refusal === null ? sum + Math.round(p.baseQty * SCALE) : sum),
    0,
  )
  const allocated = allocatedThousandths / SCALE
  const remainder = round3(args.parentQty - allocated)
  const parentEmptied = remainder === 0 && allocated > 0

  const base = { portions, allocated, remainder, parentEmptied }

  const nothingAllocated: BreakdownPlan = {
    ...base,
    ok: false,
    reason: 'nothing_allocated',
    message: 'Add at least one portion to take off this pallet.',
  }

  if (portions.length === 0) return nothingAllocated
  // A row that HAS a quantity but no bin yet is not "nothing allocated" — it is
  // a row that is not ready, and saying so is the difference between an
  // operator adding a portion they already added and one picking a bin.
  if (portions.some((p) => p.refusal !== null)) {
    return {
      ...base,
      ok: false,
      reason: 'portion_invalid',
      message: 'Some rows are not ready — each one needs a quantity and a bin.',
    }
  }
  if (allocated === 0) return nothingAllocated
  if (remainder < 0) {
    return {
      ...base,
      ok: false,
      reason: 'over_allocated',
      message:
        `That is ${round3(-remainder)} more than the ${round3(args.parentQty)} on this task. ` +
        'Reduce a portion, or break down what is actually on the pallet.',
    }
  }

  return { ...base, ok: true, reason: null, message: null }
}

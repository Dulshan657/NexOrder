// Warehouse Intelligence Engine — home bin first (NX-0006).
//
// A product's home bin (product_home_bins) is where the owner has decided it
// lives, so putaway sends it there before asking the scoring engine anything.
// This module answers only two questions:
//
//   1. How much of this line does the home bin take?
//      Up to the replenishment MAX when one is set (a pick face is filled to
//      max, not to the brim), and never past physical capacity either way.
//   2. In what order should the rest be offered bins?
//      Closest to home: same rack first, then walking distance from the home
//      bin -- the same ranking replenishment uses to pick a source (mig 00118),
//      so the reserve stock lands where the top-up will later be pulled from.
//
// A UNIT LOAD (a plated single-product pallet) never goes to its home bin: a
// pick face takes cartons, and replenishment breaks the pallet down later. It
// still gets the closest-to-home ordering for its reserve bin.
//
// The home bin is NEVER an overflow target, even when it is max_qty rather than
// capacity that stopped it -- otherwise the planner would quietly pour the
// remainder back into the slot the max exists to protect.
//
// Pure: no I/O. The caller (putawayTasks.ts) loads the home row and candidates,
// and the fill itself stays planPutaway's job.

const EPS = 1e-6

export interface HomeSlot {
  locationId: number
  /** Replenishment max for the slot, base units. Null = fill to capacity. */
  maxQty: number | null
  /** This product's on-hand in the home bin, base units. */
  onHand: number
  /** Open putaway quantity of this product already headed to the home bin. */
  pendingQty: number
  /** Physical capacity in slots. Null = unbounded. */
  capacitySlots: number | null
  /** Slots already used, INCLUDING space promised to open tasks (mig 00123). */
  usedSlots: number
}

export interface AnchorCandidate {
  locationId: number
  sameRack: boolean
  /** Walking distance from the home bin's graph node. Null = unknown, ranked last. */
  anchorDistanceM: number | null
}

export interface HomeFirstInput {
  quantity: number
  sizeFactor: number
  unitLoad: boolean
  home: HomeSlot | null
  candidates: ReadonlyArray<AnchorCandidate>
}

export type SuggestionSource = 'home' | 'overflow' | 'engine'

export interface HomeFirstPlan {
  homeLocationId: number | null
  homeQty: number
  remainder: number
  /** Where the remainder's suggestion comes from: near a home, or the plain engine. */
  remainderSource: Exclude<SuggestionSource, 'home'>
  /** Candidate ids, home excluded, closest to home first. Empty without a home. */
  overflowOrder: number[]
  /** No home yet: the operator is offered to make the chosen bin its home. */
  suggestMakeHome: boolean
}

/** Base units the home bin can still take, bounded by max_qty AND capacity. */
export function homeHeadroom(home: HomeSlot, sizeFactor: number): number {
  const factor = sizeFactor > 0 ? sizeFactor : 1
  const byMax = home.maxQty === null ? Infinity : home.maxQty - home.onHand - home.pendingQty
  const byCapacity = home.capacitySlots === null
    ? Infinity
    : (home.capacitySlots - home.usedSlots) / factor
  return Math.max(0, Math.min(byMax, byCapacity))
}

/** Same rack first, then nearest; unknown distances last; stable otherwise. */
export function orderByAnchor(
  candidates: ReadonlyArray<AnchorCandidate>,
  excludeLocationId: number | null,
): number[] {
  return candidates
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.locationId !== excludeLocationId)
    .sort((a, b) => {
      if (a.c.sameRack !== b.c.sameRack) return a.c.sameRack ? -1 : 1
      const da = a.c.anchorDistanceM ?? Infinity
      const db = b.c.anchorDistanceM ?? Infinity
      if (da !== db) return da - db
      return a.i - b.i
    })
    .map(({ c }) => c.locationId)
}

export function planHomeFirst(input: HomeFirstInput): HomeFirstPlan {
  const { quantity, sizeFactor, unitLoad, home, candidates } = input

  if (!home) {
    return {
      homeLocationId: null,
      homeQty: 0,
      remainder: quantity,
      remainderSource: 'engine',
      overflowOrder: [],
      suggestMakeHome: true,
    }
  }

  const overflowOrder = orderByAnchor(candidates, home.locationId)

  if (unitLoad) {
    return {
      homeLocationId: home.locationId,
      homeQty: 0,
      remainder: quantity,
      remainderSource: 'overflow',
      overflowOrder,
      suggestMakeHome: false,
    }
  }

  const room = homeHeadroom(home, sizeFactor)
  // Finishing the line takes the exact remainder; a partial fill takes whole
  // units only, so no sub-unit sliver is stranded (as planPutaway does).
  const homeQty = room + EPS >= quantity ? quantity : Math.floor(room + EPS)

  return {
    homeLocationId: home.locationId,
    homeQty,
    remainder: quantity - homeQty,
    remainderSource: 'overflow',
    overflowOrder,
    suggestMakeHome: false,
  }
}

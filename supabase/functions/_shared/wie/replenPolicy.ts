// Replenishment min/max — the policy, and the rules a row has to satisfy.
//
// Pure and IO-free, and it lives in _shared/wie/ so the Vite frontend imports the
// very module the Edge Function runs. The grid's live preview of a suggested
// min/max, and its inline "this row will be refused", are therefore not a second
// implementation of the server's decision — they ARE the server's decision,
// evaluated early. Same split as _shared/binCount.ts ↔ lib/binCount.ts and
// _shared/wie/levelRoles.ts ↔ lib/levelRoles.ts. Never fork it.
//
// WHAT A SUGGESTION IS MADE OF, AND WHY IT IS NOT DEMAND.
//
// The obvious source for a min/max is demand: min = daily sales × cover days.
// That is the right answer for a warehouse with a trading history and a useless
// one for the case this exists to serve — standing a site up, where there are no
// picks, often no orders, and frequently no stock in the building yet. Days of
// cover computed from three days of history is a fiction with a decimal point.
//
// So the suggestion is made of the one thing that is true on day one: how much
// of the SKU physically fits in the slot. Fill the pick face, and let a top-up
// be raised when it drops to a quarter of that. It is a coarse answer and it is
// honest about being one — the operator overrides freely, and the demand-derived
// tier arrives once the site has weeks of real picks behind it.
//
// CAPACITY IS NOT ALWAYS DERIVABLE, AND THEN THERE IS NO SUGGESTION.
// `capacity_slots` is denominated in the bin's `slot_kind` (see capacity.ts): a
// carton bay counts slots that a unit consumes `size_factor` of, a pallet bay
// counts POSITIONS. Turning positions into base units needs units-per-pallet,
// which the schema records in exactly one place — the product's largest UOM. No
// pallet UOM on a pallet-denominated bin means no suggestion at all. An invented
// number here becomes a replenishment task that moves the wrong quantity to a
// real rack, so it refuses rather than guesses.

/** A bin's capacity denomination (`locations.slot_kind`). */
export type ReplenSlotKind = 'pallet' | 'carton' | null | undefined

/** One row of `wie_replen_config_rows(...)->'rows'`. camelCase from SQL, so no
 *  adapter sits between the query and this module. */
export interface ReplenConfigRow {
  productId: number
  sku: string
  name: string
  category: string | null
  /** Slots one base unit consumes in a carton-denominated bin. */
  sizeFactor: number
  /** Base units per pack (the smallest UOM above base); null = base-only SKU. */
  packFactor: number | null
  /** Base units per unit load (the largest UOM), when there is one above pack. */
  palletFactor: number | null
  /** This site holds it, or has already named a slot for it. */
  stockedHere: boolean
  onHandHere: number
  /** Ranking only — never an input to a suggested figure. */
  demandQty: number
  homeBinId: number | null
  homeBinCode: string | null
  homeBinLevelRole: string | null
  homeBinCapacitySlots: number | null
  homeBinSlotKind: ReplenSlotKind
  minQty: number | null
  maxQty: number | null
  replenEnabled: boolean
  /** The pick-zone bin this SKU's stock is actually in, if any. */
  stockBinId: number | null
  stockBinCode: string | null
  stockBinLevelRole: string | null
  stockBinCapacitySlots: number | null
  stockBinSlotKind: ReplenSlotKind
}

/** One entry of `wie_replen_config_rows(...)->'freeBins'`: an active pick-zone
 *  bin holding nothing and claimed by nobody, nearest the dock first. */
export interface ReplenFreeBin {
  binId: number
  code: string
  name: string | null
  levelRole: string | null
  capacitySlots: number | null
  slotKind: ReplenSlotKind
  /** Metres from the nearest dock; null when the bin is off the travel graph. */
  distanceM: number | null
}

export interface ReplenConfigPayload {
  warehouseId: number
  layoutId: number | null
  productCount: number
  rows: ReplenConfigRow[]
  freeBins: ReplenFreeBin[]
}

/** How a slot's capacity becomes a min and a max. Stated once per warehouse and
 *  applied to every row the operator fills. */
export interface ReplenPolicy {
  /** Percent of the slot's capacity the max fills to. */
  maxFillPercent: number
  /** The min, as a percent of the max. */
  minPercentOfMax: number
  /** The min never falls below this many packs (base units on a base-only SKU). */
  minFloorPacks: number
  /** Round both figures to whole packs, or leave them in base units. */
  roundTo: 'pack' | 'base'
}

export const DEFAULT_REPLEN_POLICY: ReplenPolicy = {
  maxFillPercent: 100,
  minPercentOfMax: 25,
  minFloorPacks: 1,
  roundTo: 'pack',
}

/** The largest carried row count for one `bulkSet` call. Exported so the client
 *  chunks to the same number the Edge Function validates against. */
export const MAX_BULK_REPLEN_ROWS = 200

/** Base units in one pack, for the carton↔base display. 1 on a base-only SKU. */
export function packUnits(packFactor: number | null | undefined): number {
  const factor = Number(packFactor)
  return Number.isFinite(factor) && factor > 1 ? factor : 1
}

export function packsToBase(packs: number, packFactor: number | null | undefined): number {
  return packs * packUnits(packFactor)
}

export function baseToPacks(base: number, packFactor: number | null | undefined): number {
  return base / packUnits(packFactor)
}

/** What the operator types in. A pack when there is one; base units otherwise. */
export function entryUnitLabel(packFactor: number | null | undefined, plural = false): string {
  if (packUnits(packFactor) > 1) return plural ? 'packs' : 'pack'
  return plural ? 'units' : 'unit'
}

/**
 * A bin's capacity expressed in BASE UNITS of one product, or null when that
 * cannot be known.
 *
 * This inverts the occupancy rule in capacity.ts — do not restate that rule
 * anywhere else:
 *   * a carton-denominated bin charges `qty × sizeFactor` slots, so it holds
 *     `capacitySlots / sizeFactor` units;
 *   * a pallet-denominated bin charges ONE position per plate, so it holds
 *     `capacitySlots × unitsPerPallet` units — and `unitsPerPallet` is only ever
 *     the product's largest UOM. Without one, null.
 */
export function capacityBaseUnits(
  capacitySlots: number | null | undefined,
  slotKind: ReplenSlotKind,
  sizeFactor: number | null | undefined,
  palletFactor: number | null | undefined,
): number | null {
  const slots = Number(capacitySlots)
  if (!Number.isFinite(slots) || slots <= 0) return null

  if (slotKind === 'pallet') {
    const perPallet = Number(palletFactor)
    if (!Number.isFinite(perPallet) || perPallet <= 1) return null
    return slots * perPallet
  }

  const size = Number(sizeFactor)
  const perUnit = Number.isFinite(size) && size > 0 ? size : 1
  return slots / perUnit
}

/** The bin a suggestion is computed against — the home bin if one is set, else
 *  whatever the grid is proposing. */
export interface ReplenSuggestionInput {
  capacitySlots: number | null | undefined
  slotKind: ReplenSlotKind
  sizeFactor: number | null | undefined
  packFactor: number | null | undefined
  palletFactor: number | null | undefined
}

export interface ReplenSuggestion {
  /** Base units. Null whenever `basis` is 'none'. */
  minQty: number | null
  maxQty: number | null
  basis: 'capacity' | 'none'
  /** Why there is no suggestion — rendered as-is next to the row. */
  reason?: string
}

const NO_SUGGESTION = (reason: string): ReplenSuggestion => ({
  minQty: null,
  maxQty: null,
  basis: 'none',
  reason,
})

/**
 * Suggested min/max in BASE units for one slot.
 *
 * Both figures round DOWN to whole packs (a max above what fits would have
 * replenishment repeatedly trying to overfill the face), and the pair is always
 * either `max > min` or no suggestion at all — never something the database
 * CHECK would then reject.
 */
export function suggestMinMax(
  input: ReplenSuggestionInput,
  policy: ReplenPolicy = DEFAULT_REPLEN_POLICY,
): ReplenSuggestion {
  const capacity = capacityBaseUnits(
    input.capacitySlots, input.slotKind, input.sizeFactor, input.palletFactor,
  )
  if (capacity === null) {
    return NO_SUGGESTION(
      input.slotKind === 'pallet'
        ? 'This slot counts pallet positions and the product has no pallet UOM, so its capacity in units is unknown.'
        : 'This slot has no capacity recorded, so there is nothing to size against.',
    )
  }

  const unit = policy.roundTo === 'pack' ? packUnits(input.packFactor) : 1
  const floorToUnit = (value: number): number => Math.floor(value / unit) * unit

  const max = floorToUnit(capacity * (policy.maxFillPercent / 100))
  if (max <= 0) {
    return NO_SUGGESTION(
      `The slot holds less than one ${entryUnitLabel(input.packFactor)} at this fill, so it cannot be sized.`,
    )
  }

  const floor = Math.max(0, policy.minFloorPacks) * unit
  let min = Math.max(floorToUnit(max * (policy.minPercentOfMax / 100)), floor)

  // A slot that holds only one pack cannot carry both a minimum and a higher
  // maximum, so the minimum drops to zero: top it up when it runs out. `max` is
  // always a whole multiple of `unit` and at least one of them, so this can
  // never go negative — and `max > min` therefore always holds, which is exactly
  // what product_home_bins_minmax_check demands.
  if (min >= max) min = max - unit

  return { minQty: min, maxQty: max, basis: 'capacity' }
}

/** The bin a suggestion should be computed against for a row: the slot already
 *  chosen, else the one being proposed. Returns null when neither exists. */
export function suggestionInputFor(
  row: ReplenConfigRow,
  proposedBin?: { capacitySlots: number | null; slotKind: ReplenSlotKind } | null,
): ReplenSuggestionInput | null {
  const bin = row.homeBinId != null
    ? { capacitySlots: row.homeBinCapacitySlots, slotKind: row.homeBinSlotKind }
    : proposedBin ?? null
  if (!bin) return null
  return {
    capacitySlots: bin.capacitySlots,
    slotKind: bin.slotKind,
    sizeFactor: row.sizeFactor,
    packFactor: row.packFactor,
    palletFactor: row.palletFactor,
  }
}

// ── Home-bin proposals ───────────────────────────────────────────────────────

export interface ProposedHomeBin {
  binId: number
  code: string
  capacitySlots: number | null
  slotKind: ReplenSlotKind
  /** 'stock' — the SKU is already sitting there, so somebody chose it.
   *  'free'  — an unclaimed pick-zone bin, nearest the dock first. */
  source: 'stock' | 'free'
}

/**
 * Propose a home bin for every row that has none.
 *
 * Stock first: a bin the SKU is already in was chosen by a person on the floor,
 * and moving that decision would be a slotting change, not a configuration one.
 * Otherwise the nearest unclaimed free bin — which is what makes the tool usable
 * on a site set up BEFORE its opening count, where nothing is stocked anywhere.
 *
 * THE GREEDY WALK IS THE WHOLE REASON THIS IS NOT SQL. A free bin may be handed
 * out at most once; a per-row subquery would cheerfully give the same nearest
 * bin to every SKU in the catalogue. Rows are walked in descending demand so the
 * fast movers take the dock-adjacent slots, mirroring planPutaway's rule that
 * input order decides who gets the good bays.
 */
export function proposeHomeBins(
  rows: readonly ReplenConfigRow[],
  freeBins: readonly ReplenFreeBin[],
): Map<number, ProposedHomeBin> {
  const proposals = new Map<number, ProposedHomeBin>()

  // Stable ordering, independent of how the caller sorted its grid.
  const byDemand = [...rows].sort(
    (a, b) => (b.demandQty - a.demandQty) || a.sku.localeCompare(b.sku),
  )

  // Bins already spoken for by a row's existing home bin can never be offered.
  const claimed = new Set<number>()
  for (const row of rows) if (row.homeBinId != null) claimed.add(row.homeBinId)

  const queue = freeBins.filter((b) => !claimed.has(b.binId))
  let next = 0

  for (const row of byDemand) {
    if (row.homeBinId != null) continue

    if (row.stockBinId != null && !claimed.has(row.stockBinId)) {
      claimed.add(row.stockBinId)
      proposals.set(row.productId, {
        binId: row.stockBinId,
        code: row.stockBinCode ?? String(row.stockBinId),
        capacitySlots: row.stockBinCapacitySlots,
        slotKind: row.stockBinSlotKind,
        source: 'stock',
      })
      continue
    }

    while (next < queue.length && claimed.has(queue[next].binId)) next++
    if (next >= queue.length) continue

    const bin = queue[next]
    next++
    claimed.add(bin.binId)
    proposals.set(row.productId, {
      binId: bin.binId,
      code: bin.code,
      capacitySlots: bin.capacitySlots,
      slotKind: bin.slotKind,
      source: 'free',
    })
  }

  return proposals
}

// ── Validation ───────────────────────────────────────────────────────────────

/** What has to be known about a row to judge it. The Edge Function fills these
 *  from the database; the grid fills them from what it already loaded. */
export interface ReplenRowCandidate {
  binId: number | null
  /** The bin resolves inside the warehouse being configured. */
  binInWarehouse: boolean
  /** The bin is an active pick-zone level. */
  binIsPickZone: boolean
  /** Base units. */
  minQty: number | null
  maxQty: number | null
  /** Whether `replen_enabled` will be TRUE once this write lands — which for a
   *  numbers-only apply means whatever the row already had. */
  arming: boolean
}

/** Plain `{ ok, reason }` rather than a discriminated union on purpose: this
 *  tsconfig has `strict` off, so a union only ever narrows through
 *  `result.ok === false` and a bare `!result.ok` silently keeps the wide type. */
export interface ReplenRowVerdict {
  ok: boolean
  reason?: string
}

const OK: ReplenRowVerdict = { ok: true }

/**
 * The four rules, in the order an operator meets them. Both runtimes call this:
 * the grid to grey out a save and explain itself inline, the Edge Function to
 * decide what it will write.
 *
 * The server ALSO relies on this running before its upsert, because
 * product_home_bins' two CHECKs and its pick-zone trigger abort the whole
 * statement on one bad row — a batch of 200 would be lost to a single typo.
 */
export function validateReplenRow(candidate: ReplenRowCandidate): ReplenRowVerdict {
  if (candidate.binId == null) {
    return { ok: false, reason: 'No home bin chosen.' }
  }
  if (!candidate.binInWarehouse) {
    return { ok: false, reason: 'That bin is not in this warehouse.' }
  }

  const hasMin = candidate.minQty != null
  const hasMax = candidate.maxQty != null
  if (hasMin !== hasMax) {
    return { ok: false, reason: 'A slot needs both a minimum and a maximum, or neither.' }
  }

  if (hasMin && hasMax) {
    const min = Number(candidate.minQty)
    const max = Number(candidate.maxQty)
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { ok: false, reason: 'The minimum and maximum have to be numbers.' }
    }
    if (min < 0) return { ok: false, reason: 'The minimum cannot be negative.' }
    if (max <= min) return { ok: false, reason: 'The maximum has to be higher than the minimum.' }
  }

  if (candidate.arming) {
    if (!hasMin || !hasMax) {
      return { ok: false, reason: 'Replenishment needs a minimum and a maximum before it can be turned on.' }
    }
    if (!candidate.binIsPickZone) {
      return {
        ok: false,
        reason: 'Replenishment refills a pick zone, so the home bin has to be a pick-zone level.',
      }
    }
  }

  return OK
}

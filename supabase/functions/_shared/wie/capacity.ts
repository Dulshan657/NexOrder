// Warehouse Intelligence Engine — how much of a bin a quantity of stock consumes.
//
// A bin's `capacity_slots` is denominated in its `slot_kind`: a carton bay holds
// N cartons, a pallet bay holds N PALLET POSITIONS. Until mig 00078 every fill
// calculation in the system was `Σ(on_hand × size_factor)`, which is right for a
// carton bay and nonsense for a pallet bay — one pallet carrying 130 units read
// as 130 slots against a limit of 10, so the engine believed 17 of WIE-DEMO's 36
// bins were over capacity while each held exactly one pallet.
//
// Handling units (mig 00075) made the fix expressible: a plate's contents ARE
// its balance rows, so "how many pallets are in this bin" is a COUNT DISTINCT
// over handling_unit_id.
//
//   positions(bin, row) = 1 / (rows sharing this plate)   when bin.slotKind = 'pallet'
//                                                          AND hu.huType   = 'pallet'
//                       = onHand × sizeFactor              otherwise
//
// Gated on BOTH ends, deliberately:
//   * on the BIN, so a pallet decanted onto a carton shelf is still counted in
//     cartons — which is what leaves MAIN (entirely carton-denominated, the only
//     non-demo racked warehouse) bit-for-bit unchanged;
//   * on the PLATE, so loose/legacy stock (handling_unit_id NULL) and carton
//     plates degrade to exactly today's arithmetic. Carton plates are explicitly
//     NOT one-position objects: the 00076 backfill lumped ~46 cartons onto a
//     single 'carton' plate, so counting them as 1 would read MAIN as 1% full.
//
// Pure and IO-free, and it lives in _shared/wie/ so the Vite frontend imports
// the very module the Edge Functions run — the rule cannot drift between the
// putaway picker's warning and the engine's hard filter. SQL necessarily
// restates it (mig 00078's bin_fill CTE); nothing else may.

/** A location's capacity denomination (`locations.slot_kind`). */
export type SlotKind = 'pallet' | 'carton' | null | undefined

/** A handling unit's type (`handling_units.hu_type`); null = loose stock. */
export type HuType = 'pallet' | 'carton' | null | undefined

/** One balance row's contribution to a bin's occupancy. */
export interface OccupancyRow {
  onHand: number
  sizeFactor: number
  /** `inventory_balances.handling_unit_id`; null = loose stock. */
  huId: number | null
  huType: HuType
}

/**
 * True when this stock is a UNIT LOAD in a bin that counts unit loads — the one
 * case that consumes whole positions rather than per-unit slots.
 */
export function isUnitLoad(slotKind: SlotKind, huType: HuType): boolean {
  return slotKind === 'pallet' && huType === 'pallet'
}

/**
 * Positions consumed by everything currently in a bin.
 *
 * Unit loads are de-duplicated by plate, so a MIXED-SKU pallet (allowed by
 * design — several balance rows, one handling unit) totals 1 rather than one
 * per row. Rows with no plate id are counted individually even if flagged as a
 * pallet, since without an id they cannot be proven to be the same physical
 * object.
 */
export function positionsUsed(slotKind: SlotKind, rows: readonly OccupancyRow[]): number {
  const plates = new Set<number>()
  let total = 0
  for (const row of rows) {
    if (isUnitLoad(slotKind, row.huType) && row.huId !== null) {
      if (plates.has(row.huId)) continue
      plates.add(row.huId)
      total += 1
      continue
    }
    total += (Number(row.onHand) || 0) * (Number(row.sizeFactor) || 1)
  }
  return total
}

/**
 * Positions an incoming quantity consumes in a given bin.
 *
 * A unit load costs exactly ONE position however much is on it — which is also
 * why a pallet is indivisible in the planner: there is no meaningful way to put
 * "half a position" of it somewhere else.
 */
export function positionsRequired(
  slotKind: SlotKind,
  quantity: number,
  sizeFactor: number,
  huType: HuType,
): number {
  if (isUnitLoad(slotKind, huType)) return 1
  return (Number(quantity) || 0) * (Number(sizeFactor) || 1)
}

/** The unit `capacity_slots` is denominated in, for operator-facing copy. */
export function capacityUnitLabel(slotKind: SlotKind, plural = true): string {
  if (slotKind === 'pallet') return plural ? 'positions' : 'position'
  return plural ? 'slots' : 'slot'
}

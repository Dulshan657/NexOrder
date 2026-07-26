// Vertical reach cost for rack levels — one constant, both runtimes.
//
// A levelled rack's levels all share one graph node at one (floor, x, y): the
// only thing that separates them is access_offset_m, which prices the reach up.
// L1 carries the rack's own offset; each level above adds this step.
//
// It had drifted into two values. mutate-layout/index.ts and
// mutate-warehouse-location/index.ts used 0.3; mig 00072's
// wie_convert_rack_to_levels_tx and components/warehouse/levels/rackLevels.ts
// used 0.5. So a same-rack L5 reported 1.2 m or 2.0 m of reach depending on
// which code path built the levels — invisible until replenishment routing
// started reading access_offset_m to price a pull. Standardised on 0.5 (the
// value the migration and the frontend already agreed on) and hoisted here so it
// cannot drift again.
//
// It never changes WHICH stop a level is (all levels share a graph node), only
// the reported reach — so correcting existing 0.3-built placements is not
// required for correctness and is deliberately not attempted.

/** Metres of extra reach per level above L1. */
export const ACCESS_OFFSET_STEP_M = 0.5

/**
 * Access offset for a level, given its 1-based index and the rack's base offset.
 * L1 == the rack's own offset.
 */
export function accessOffsetForLevel(levelIndex: number, baseOffsetM = 0): number {
  return baseOffsetM + Math.max(0, levelIndex - 1) * ACCESS_OFFSET_STEP_M
}

// Floor-plan extraction — multi-pass ("high fidelity") merge.
//
// Pure, no I/O (per the _shared contract — this runs in both the Edge
// Function and, potentially, frontend tooling). High fidelity runs two model
// passes over the same image:
//   - pass 1 ("structure"): grid dimensions, objects (walls/docks/walkways/
//     lifts/conveyors/staging/obstacles), and zones. Authoritative for all of
//     these — pass 2 is told to return them empty.
//   - pass 2 ("detail"): grid dimensions are pinned to pass 1's values; the
//     model is given a text summary of pass 1's fixed cells and focuses only
//     on rackRows/palletAreas. Authoritative for those two fields.
//
// mergeExtractions folds the two responses into one FloorplanExtraction — the
// same shape a single standard-fidelity pass produces — so normalizeFloorplan
// doesn't need to know or care how many model calls produced it.

import type { FloorplanExtraction } from './extractionSchema.ts'

export type FidelityMode = 'standard' | 'high'

/**
 * Pass-3 reconciliation (a follow-up vision call that would re-check pass 2's
 * rackRows/palletAreas against pass 1's fixed structure for placement
 * conflicts) is designed but deliberately NOT wired up — it roughly doubles
 * the already-expensive high-fidelity cost/latency for a marginal accuracy
 * gain that normalizeFloorplan's blockedCellKeys drop already covers for the
 * common case (a rack/pallet cell landing on a wall/conveyor/obstacle).
 * Ships disabled; flip this on only after measuring real-world need.
 */
export const HIGH_FIDELITY_RECONCILE = false

/**
 * Merge a structure pass (grid/objects/zones authoritative) with a detail
 * pass (rackRows/palletAreas authoritative) into one extraction.
 * Confidence is the minimum of the two — the weaker pass caps overall trust.
 * Notes are joined with ' | ' so neither pass's caveats are lost.
 */
export function mergeExtractions(
  structure: FloorplanExtraction,
  detail: FloorplanExtraction,
): FloorplanExtraction {
  const notes = [structure.notes, detail.notes]
    .map((n) => (n ?? '').trim())
    .filter((n) => n.length > 0)
    .join(' | ')

  return {
    gridWidth: structure.gridWidth,
    gridHeight: structure.gridHeight,
    floors: structure.floors,
    objects: structure.objects,
    zones: structure.zones,
    rackRows: detail.rackRows ?? [],
    palletAreas: detail.palletAreas ?? [],
    confidence: Math.min(structure.confidence, detail.confidence),
    notes,
  }
}

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
//
// A pass-3 reconciliation step (re-checking the merged draft against the
// source image) is handled separately: it's client-driven (the client
// renders the draft and uploads it) and lives in extract-floorplan/index.ts's
// `reconcile` request branch + extractionSchema.ts's `floorplanReconcilePrompt`,
// not here. An earlier server-only stub for this (`HIGH_FIDELITY_RECONCILE`)
// shipped disabled and has been removed now that the client-driven version
// is wired up.

import type { FloorplanExtraction } from './extractionSchema.ts'

export type FidelityMode = 'standard' | 'high'

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
    // Real-world dimensions come from pass 1 (which reads the fixed structure,
    // dimension lines and scale bar included); pass 2 only looks at racking and
    // is told to echo the grid back, so it has nothing better to offer. `??`
    // rather than a bare read so a pass-1 null can still be rescued if pass 2
    // happened to spot the dimension string.
    floorWidthM: structure.floorWidthM ?? detail.floorWidthM ?? null,
    floorHeightM: structure.floorHeightM ?? detail.floorHeightM ?? null,
    floors: structure.floors,
    objects: structure.objects,
    zones: structure.zones,
    rackRows: detail.rackRows ?? [],
    palletAreas: detail.palletAreas ?? [],
    confidence: Math.min(structure.confidence, detail.confidence),
    notes,
  }
}

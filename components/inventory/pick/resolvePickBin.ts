// Turn a scanned string into the bin an unlisted pick will be recorded at.
//
// An imported order can have stock the system does not know about, so the picker
// may scan ANY bin, not only the ones a task directs them to (NX-0029). The code is
// resolved the way the rest of the app resolves one: against the locations the app
// already holds, through resolveScan, which is the one place that folds a scanned
// string and reports an ambiguous one rather than guessing.
//
// This is feedback, not the control. record-pick re-validates the bin
// (inv_assert_pick_location: an active warehouse) and a Warehouse user's home site,
// and its refusals are shown in the row; resolving here only spares the picker the
// round trip for a code that is plainly not a bin.

import { buildScanIndex, resolveScan, type ScanIndex, type ScanMatch } from '@/lib/scan/resolveScan'
import type { InventoryLocation } from '@/types'
import { isCountableLocation } from '../stocktake/CountLocationFinder'

export interface ResolvedPickBin {
  id: number
  code: string
  name: string
}

export type PickBinResolution =
  | { ok: true; location: ResolvedPickBin }
  | { ok: false; message: string }

/** The scan index over every location the app holds. Inactive bins stay in it on
 *  purpose, so a retired bin is named as retired rather than reported unknown. */
export function buildPickBinIndex(locations: readonly InventoryLocation[]): ScanIndex {
  return buildScanIndex({
    locations: locations.map((l) => ({ id: l.id, code: l.code, name: l.name, isActive: l.isActive })),
  })
}

export function resolvePickBin(
  raw: string,
  index: ScanIndex,
  locations: readonly InventoryLocation[],
): PickBinResolution {
  const result = resolveScan(raw, index)
  if (result.kind === 'empty') return { ok: false, message: 'Scan or type the bin code.' }
  if (result.kind === 'unknown') return { ok: false, message: `No bin matches ${result.normalized}.` }

  const candidates: readonly ScanMatch[] = result.kind === 'ambiguous' ? result.candidates : [result]
  const match = candidates.find((c) => c.kind === 'location')
  if (!match || match.kind !== 'location') {
    return { ok: false, message: 'That code names a product or a pallet. Scan a bin label instead.' }
  }

  const target = locations.find((l) => l.id === match.location.id)
  if (!target) return { ok: false, message: `No bin matches ${match.location.code}.` }
  if (!target.isActive) {
    return { ok: false, message: `${target.code} is not active, so nothing can be picked from it.` }
  }
  if (!isCountableLocation(target)) {
    return {
      ok: false,
      message: `${target.code} is a ${target.kind}: a container, not a place stock sits. Scan a bin or level inside it.`,
    }
  }
  return { ok: true, location: { id: target.id, code: target.code, name: target.name } }
}

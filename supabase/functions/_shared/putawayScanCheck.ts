// Server-side re-validation of a scan-confirmed putaway.
//
// The mirror of pickScanCheck, with one deliberate asymmetry: a bin that is not
// the assigned one is NOT an error here.
//
// In picking, the bin is where the stock provably is, so scanning a different
// bay means the operator is in the wrong place — full stop. In putaway, the bin
// is only where someone at a desk *intended* the stock to go. The walker
// standing in the aisle can see that the bay is full, blocked, or has a damaged
// beam, and putting the pallet in the next one along is the correct call. Refusing
// that would either strand the pallet or, far worse, teach operators to place it
// anyway and let the system stay wrong. So a bin mismatch reports
// `placedElsewhere` and the caller records where it actually went.
//
// A wrong PRODUCT or a wrong PLATE is still refused outright — those are
// genuine mis-identifications, not judgement calls, and no useful record can be
// made of them.
//
// Pure, so it can be exhaustively unit-tested without a database, and imported
// unchanged by the browser (components/inventory/putaway/PutawayStopCard.tsx)
// for instant feedback at the rack face.

import { codeMatchesProduct, normalizeScan } from './scanNormalize.ts'

export interface PutawayTaskContext {
  /** Code of the bin the desk assigned this line to. */
  assignedLocationCode: string
  /** The product on this putaway line. */
  product: { id: number; sku: string; name: string; barcode?: string | null }
  /** The plate this line is on, when it has one. NULL for legacy/loose stock. */
  huCode?: string | null
  /** Base units still to place on this task. */
  remainingQty: number
}

export interface PutawayScanEvidence {
  locationCode?: string | null
  productCode?: string | null
  handlingUnitCode?: string | null
}

export type PutawayScanVerdict =
  | {
      ok: true
      /** Both the place and the thing were confirmed by a scan. */
      verified: boolean
      /** A bin was scanned and it is NOT the assigned one. Allowed; record it. */
      placedElsewhere: boolean
      /** Normalised code of the bin actually scanned, when one was. */
      scannedLocationCode: string | null
    }
  | {
      ok: false
      code: 'WRONG_PRODUCT' | 'WRONG_PLATE' | 'INVALID_QTY'
      message: string
    }

/**
 * Decide whether a putaway may be committed.
 *
 * `verified` distinguishes "scanned and correct" from "no scan supplied". A
 * putaway with no evidence is still allowed — complete-putaway deploys before
 * the UI that sends scans, and the desk's one-step "Place now" path never scans
 * — but it is recorded as unverified so the two can be told apart later, and so
 * the decision to enforce hard can be made from real numbers.
 */
export function checkPutawayScan(
  task: PutawayTaskContext,
  evidence: PutawayScanEvidence,
  placedQty: number,
): PutawayScanVerdict {
  if (!(placedQty > 0)) {
    return { ok: false, code: 'INVALID_QTY', message: 'Enter how much you put away.' }
  }
  if (placedQty > task.remainingQty) {
    return {
      ok: false,
      code: 'INVALID_QTY',
      message: `That is more than this task has — ${task.remainingQty} left to place.`,
    }
  }

  const scannedLocation = normalizeScan(evidence.locationCode ?? '')
  const scannedProduct = normalizeScan(evidence.productCode ?? '')
  const scannedPlate = normalizeScan(evidence.handlingUnitCode ?? '')

  if (scannedProduct && !codeMatchesProduct(scannedProduct, task.product)) {
    return {
      ok: false,
      code: 'WRONG_PRODUCT',
      message: `That item is not ${task.product.sku} (${task.product.name}).`,
    }
  }

  // Only checkable when the line actually names a plate. A scanned plate on a
  // line that has none is not evidence of anything, so it is ignored rather
  // than refused — refusing would block every legacy/loose line the moment an
  // operator scanned the pallet label out of habit.
  if (scannedPlate && task.huCode) {
    if (scannedPlate !== normalizeScan(task.huCode)) {
      return {
        ok: false,
        code: 'WRONG_PLATE',
        message: `That is plate ${scannedPlate}, but this task is for ${task.huCode}.`,
      }
    }
  }

  const placedElsewhere = Boolean(
    scannedLocation && scannedLocation !== normalizeScan(task.assignedLocationCode),
  )

  // Verified means the place AND the thing were both confirmed. Either a plate
  // scan or a product scan satisfies "the thing": scanning the plate label is
  // the stronger evidence of the two, since a plate names this exact unit load
  // rather than merely the SKU.
  return {
    ok: true,
    verified: Boolean(scannedLocation && (scannedProduct || scannedPlate)),
    placedElsewhere,
    scannedLocationCode: scannedLocation || null,
  }
}

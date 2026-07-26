// Server-side re-validation of a scan-confirmed replenishment.
//
// Modelled on putawayScanCheck, but replenishment has TWO bins and they get
// opposite treatment. That asymmetry is the whole point of this module.
//
//   SOURCE  — allowed to differ. Same reasoning as putaway's destination: the
//             desk assigned a reserve bay, and the walker standing in the aisle
//             can see it is empty, blocked, or holds the wrong batch. Pulling
//             from the next bay along is the correct call, and refusing it would
//             either strand the task or teach operators to place stock anyway
//             and let the system stay wrong. Reported as `pulledElsewhere`; the
//             caller records where it actually came from.
//
//   DESTINATION — refused outright. Same posture as pickScanCheck. The task
//             exists because ONE pick slot is low; putting the stock anywhere
//             else leaves that slot exactly as empty as it was while reporting
//             the work as done, so the shortage becomes invisible. There is also
//             no judgement call available here — the destination is not a
//             choice, it is the task.
//
// A wrong PRODUCT or a wrong PLATE is refused, as in putaway: genuine
// mis-identifications, not judgement calls.
//
// Pure, so it can be exhaustively unit-tested without a database and imported
// unchanged by the browser for instant feedback at the rack face.

import { codeMatchesProduct, normalizeScan } from './scanNormalize.ts'

export interface ReplenTaskContext {
  /** Code of the bin the desk assigned as the source. */
  assignedFromCode: string
  /** Code of the pick slot this task refills. Not negotiable. */
  toCode: string
  /** The product on this task. */
  product: { id: number; sku: string; name: string; barcode?: string | null }
  /** The plate the detector expected to move, when it named one. */
  huCode?: string | null
  /** Base units still to move on this task. */
  remainingQty: number
}

export interface ReplenScanEvidence {
  fromLocationCode?: string | null
  toLocationCode?: string | null
  productCode?: string | null
  handlingUnitCode?: string | null
}

export type ReplenScanVerdict =
  | {
      ok: true
      /** Both bins and the thing were confirmed by a scan. */
      verified: boolean
      /** A source was scanned and it is NOT the assigned one. Allowed; record it. */
      pulledElsewhere: boolean
      scannedFromCode: string | null
      scannedToCode: string | null
    }
  | {
      ok: false
      code: 'WRONG_PRODUCT' | 'WRONG_PLATE' | 'WRONG_DESTINATION' | 'INVALID_QTY'
      message: string
    }

/**
 * Decide whether a replenishment may be committed.
 *
 * `verified` distinguishes "scanned and correct" from "no scan supplied". As in
 * putaway, a move with no evidence is still allowed at this layer — the UI is
 * what makes scanning mandatory — so the two can be told apart later and the
 * decision to enforce hard can be made from real numbers rather than optimism.
 */
export function checkReplenScan(
  task: ReplenTaskContext,
  evidence: ReplenScanEvidence,
  movedQty: number,
): ReplenScanVerdict {
  if (!(movedQty > 0)) {
    return { ok: false, code: 'INVALID_QTY', message: 'Enter how much you moved.' }
  }
  if (movedQty > task.remainingQty) {
    return {
      ok: false,
      code: 'INVALID_QTY',
      message: `That is more than this task has — ${task.remainingQty} left to move.`,
    }
  }

  const scannedFrom = normalizeScan(evidence.fromLocationCode ?? '')
  const scannedTo = normalizeScan(evidence.toLocationCode ?? '')
  const scannedProduct = normalizeScan(evidence.productCode ?? '')
  const scannedPlate = normalizeScan(evidence.handlingUnitCode ?? '')

  if (scannedProduct && !codeMatchesProduct(scannedProduct, task.product)) {
    return {
      ok: false,
      code: 'WRONG_PRODUCT',
      message: `That item is not ${task.product.sku} (${task.product.name}).`,
    }
  }

  // Only checkable when the task actually names a plate — and note it is only
  // meaningful when the walker pulled from the ASSIGNED source. Once they have
  // gone to a different bay, the plate the detector picked is by definition not
  // the one in their hands, so holding them to it would refuse every legitimate
  // source override.
  const pulledElsewhere = Boolean(scannedFrom && scannedFrom !== normalizeScan(task.assignedFromCode))
  if (scannedPlate && task.huCode && !pulledElsewhere) {
    if (scannedPlate !== normalizeScan(task.huCode)) {
      return {
        ok: false,
        code: 'WRONG_PLATE',
        message: `That is plate ${scannedPlate}, but this task is for ${task.huCode}.`,
      }
    }
  }

  // The destination is the task. A mismatch here is refused, not recorded.
  if (scannedTo && scannedTo !== normalizeScan(task.toCode)) {
    return {
      ok: false,
      code: 'WRONG_DESTINATION',
      message:
        `This replenishment refills ${task.toCode}, not ${scannedTo}. ` +
        `Placing it elsewhere would leave ${task.toCode} short.`,
    }
  }

  return {
    ok: true,
    verified: Boolean(scannedFrom && scannedTo && (scannedProduct || scannedPlate)),
    pulledElsewhere,
    scannedFromCode: scannedFrom || null,
    scannedToCode: scannedTo || null,
  }
}

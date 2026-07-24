// Server-side re-validation of a scan-confirmed pick.
//
// The client checks the scans too, so the operator gets instant feedback — but
// the client's check is a convenience, not a control. Anything can POST to
// record-pick. This module is the control, and it is deliberately pure so it can
// be exhaustively unit-tested without a database.
//
// Comparison is by CODE, not by id, which is safe precisely because
// locations.code is globally unique (00027) — so "the scanned code equals the
// task's bin code" and "the scanned location IS the task's bin" are the same
// statement, with no lookup required.

import { codeMatchesProduct, normalizeScan } from './scanNormalize.ts'

export interface PickTaskContext {
  /** Code of the bin the pick task directed the operator to. */
  taskLocationCode: string
  /** The product the order line is for. */
  product: { id: number; sku: string; name: string; barcode?: string | null }
  /** Base units still to pick on this task. */
  remainingQty: number
}

export interface PickScanEvidence {
  locationCode?: string | null
  productCode?: string | null
  handlingUnitCode?: string | null
}

export type PickScanVerdict =
  | { ok: true; verified: boolean }
  | { ok: false; code: 'WRONG_BIN' | 'WRONG_PRODUCT' | 'INVALID_QTY'; message: string }

/**
 * Decide whether a pick may proceed.
 *
 * `verified` distinguishes "scanned and correct" from "no scan supplied". A
 * pick with no evidence is still allowed — the Edge Function is deployed before
 * the UI that sends scans, and the CSV/legacy paths never scan — but it is
 * recorded as unverified in the audit trail so the two can be told apart later.
 * A scan that IS supplied and does NOT match is always refused.
 */
export function checkPickScan(
  task: PickTaskContext,
  evidence: PickScanEvidence,
  pickedQty: number,
): PickScanVerdict {
  if (!(pickedQty > 0)) {
    return { ok: false, code: 'INVALID_QTY', message: 'Enter how many you picked.' }
  }
  if (pickedQty > task.remainingQty) {
    return {
      ok: false,
      code: 'INVALID_QTY',
      message: `That is more than this task needs — ${task.remainingQty} left to pick.`,
    }
  }

  const scannedLocation = normalizeScan(evidence.locationCode ?? '')
  const scannedProduct = normalizeScan(evidence.productCode ?? '')

  if (scannedLocation) {
    if (scannedLocation !== normalizeScan(task.taskLocationCode)) {
      return {
        ok: false,
        code: 'WRONG_BIN',
        message: `That is ${scannedLocation}, but this line is picked from ${task.taskLocationCode}.`,
      }
    }
  }

  if (scannedProduct) {
    if (!codeMatchesProduct(scannedProduct, task.product)) {
      return {
        ok: false,
        code: 'WRONG_PRODUCT',
        message: `That item is not ${task.product.sku} (${task.product.name}).`,
      }
    }
  }

  // Verified only when BOTH the place and the thing were confirmed. A bin scan
  // alone proves the operator stood in the right aisle, not that they picked
  // the right SKU off it — which is the more common and more expensive error.
  return { ok: true, verified: Boolean(scannedLocation && scannedProduct) }
}

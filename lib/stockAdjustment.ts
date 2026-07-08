// Pure helpers for the stock-adjustment feature (AdjustStockModal +
// adjustStockService). Kept dependency-free so the delta/set-count math, input
// validation, and error-message mapping are trivially unit-testable without a
// rendered component or a network mock.

export type AdjustMode = 'delta' | 'set_count'
export type AdjustMovementType = 'adjustment' | 'stocktake_variance'

export interface AdjustStockFormInput {
  productId: number
  locationId: number
  batchId: number | null
  mode: AdjustMode
  /** Raw text from the quantity input — a signed delta in 'delta' mode, or the
   * freshly counted total in 'set_count' mode. */
  amountText: string
  reason: string
  /** Current on_hand for this exact (product, location, batch) slot, used to
   * compute the delta/preview. */
  currentOnHand: number
  /** Only consulted in 'delta' mode — 'set_count' always forces
   * 'stocktake_variance' server-side too, so we mirror that here. */
  movementType?: AdjustMovementType
}

export interface AdjustStockPayload {
  productId: number
  locationId: number
  batchId?: number | null
  mode: AdjustMode
  qtyDelta?: number
  newCount?: number
  reason: string
  movementType?: AdjustMovementType
}

export interface AdjustPreview {
  delta: number
  newOnHand: number
}

/**
 * Parses the amount field and computes the resulting on-hand + delta. Returns
 * null when the text doesn't parse to a usable number yet (empty/incomplete
 * input) — that's "nothing to preview", not a validation failure.
 */
export function computeAdjustPreview(
  mode: AdjustMode,
  amountText: string,
  currentOnHand: number,
): AdjustPreview | null {
  const trimmed = amountText.trim()
  if (trimmed === '') return null
  const amount = Number(trimmed)
  if (!Number.isFinite(amount)) return null

  if (mode === 'set_count') {
    return { delta: amount - currentOnHand, newOnHand: amount }
  }
  return { delta: amount, newOnHand: currentOnHand + amount }
}

/**
 * Validates the modal's current form state. Returns a single user-facing
 * message, or null when the input is ready to submit.
 */
export function validateAdjustInput(input: AdjustStockFormInput): string | null {
  if (!input.reason.trim()) {
    return 'A reason is required.'
  }

  const preview = computeAdjustPreview(input.mode, input.amountText, input.currentOnHand)
  if (!preview) {
    return input.mode === 'set_count' ? 'Enter the counted total.' : 'Enter a quantity to adjust by.'
  }
  if (preview.delta === 0) {
    return input.mode === 'set_count'
      ? 'Counted total matches the current on-hand — nothing to adjust.'
      : 'Enter a non-zero quantity.'
  }
  if (preview.newOnHand < 0) {
    return 'This adjustment would take on-hand below zero.'
  }
  return null
}

/**
 * Builds the exact request body adjustStockService sends to the adjust-stock
 * Edge Function. Assumes `validateAdjustInput` already passed for this input —
 * throws if called on invalid input so a bug can't silently ship a malformed
 * request.
 */
export function buildAdjustPayload(input: AdjustStockFormInput): AdjustStockPayload {
  const error = validateAdjustInput(input)
  if (error) throw new Error(error)

  const preview = computeAdjustPreview(input.mode, input.amountText, input.currentOnHand) as AdjustPreview
  const reason = input.reason.trim()

  if (input.mode === 'set_count') {
    return {
      productId: input.productId,
      locationId: input.locationId,
      batchId: input.batchId,
      mode: 'set_count',
      newCount: preview.newOnHand,
      reason,
      movementType: 'stocktake_variance',
    }
  }
  return {
    productId: input.productId,
    locationId: input.locationId,
    batchId: input.batchId,
    mode: 'delta',
    qtyDelta: preview.delta,
    reason,
    movementType: input.movementType ?? 'adjustment',
  }
}

/**
 * Maps a raw error message (surfaced from the Edge Function / inv_adjust_stock
 * RPC via extractFunctionErrorMessage) to a friendlier string for display.
 * Recognizes the P0001 error codes inv_adjust_stock raises; passes through
 * anything else unchanged.
 */
export function friendlyAdjustError(message: string): string {
  if (/ADJUSTMENT_BELOW_ALLOCATED/.test(message)) {
    return 'This would reduce on-hand below what is already reserved for orders. Release those reservations first, or reduce the adjustment.'
  }
  if (/INVALID_ADJUSTMENT/.test(message)) {
    return 'Invalid adjustment — check the quantity, reason, and location, then try again.'
  }
  return message
}

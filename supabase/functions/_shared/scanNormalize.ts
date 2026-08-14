// The ONE definition of how a scanned string is folded before comparison.
//
// Both runtimes import this: the browser resolver (lib/scan/resolveScan.ts) and
// the server-side pick validator (_shared/pickScanCheck.ts). They must agree
// exactly — if the client folds a code one way and the server another, a scan
// the operator was told is valid gets rejected at the till, or worse, a
// mismatch the client caught slips past the server.
//
// Pure: no Deno, no DOM, no imports.

/**
 * Fold a raw decoded string into its comparable form.
 *
 * Hardware reality this absorbs: keyboard-wedge scanner guns append a carriage
 * return or newline as their "send" key, camera decoders occasionally include a
 * trailing NUL, some QR payloads carry zero-width marks, and an operator typing
 * a code off a label will not match its capitalisation.
 */
export function normalizeScan(raw: string): string {
  return (raw ?? '')
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toUpperCase()
}

/** The lengths GS1 defines: GTIN-8, UPC-A, EAN-13, ITF-14. */
const GTIN_WIDTHS = [8, 12, 13, 14] as const

/**
 * The GTIN check digit for a run of data digits (the code WITHOUT its own check
 * digit).
 *
 * One formula serves GTIN-8, UPC-A, EAN-13 and GTIN-14: weight the digits from
 * the RIGHT, starting at 3 and alternating with 1, sum, and take the complement
 * mod 10.
 */
export function gtinCheckDigit(dataDigits: string): number {
  let sum = 0
  for (let i = 0; i < dataDigits.length; i++) {
    const digit = dataDigits.charCodeAt(dataDigits.length - 1 - i) - 48
    sum += i % 2 === 0 ? digit * 3 : digit
  }
  return (10 - (sum % 10)) % 10
}

/** True when a numeric code carries a valid GTIN check digit in its last position. */
export function hasValidGtinCheckDigit(code: string): boolean {
  if (!/^\d{8,14}$/.test(code)) return false
  return gtinCheckDigit(code.slice(0, -1)) === code.charCodeAt(code.length - 1) - 48
}

/**
 * The unit GTIN-13 that a GTIN-14 case code packs, and its indicator digit.
 *
 * An ITF-14 on an outer carton is `I` + the first 12 digits of the unit's
 * EAN-13 + a check digit recomputed over those thirteen. The unit's OWN check
 * digit does not appear, so recovering the EAN-13 means stripping the
 * indicator, dropping the last digit and RECOMPUTING — simply removing the
 * first digit yields an invalid code.
 *
 * Deliberately NOT used by `codeMatchesProduct`, and this is the important
 * part: a case of twelve and a single unit are different things. Folding them
 * to equal is exactly what destroys the quantity, and quantity is the whole
 * point of the per-pack-size barcodes this is groundwork for. Phase 2 should
 * use this to say "this carton is N of product X", never "this carton IS
 * product X".
 *
 * Returns null when `code` is not a valid 14-digit GTIN, or when its indicator
 * is `0` (which is not a case code at all — see `barcodeVariants`).
 */
export function gtin14Base(code: string): { base: string; indicator: number } | null {
  const normalized = normalizeScan(code)
  if (!/^\d{14}$/.test(normalized)) return null
  if (!hasValidGtinCheckDigit(normalized)) return null

  const indicator = normalized.charCodeAt(0) - 48
  if (indicator === 0) return null

  const twelve = normalized.slice(1, 13)
  return { base: twelve + String(gtinCheckDigit(twelve)), indicator }
}

/**
 * The alternate spellings of one numeric code that mean the SAME item.
 *
 * GTIN-8, UPC-A (12), EAN-13 and a GTIN-14 whose indicator digit is `0` are
 * literally the same number, zero-padded. That is not a convention — it falls
 * out of the arithmetic: the check digit weights digits from the right, so
 * prepending zeros leaves the weighted sum untouched and the check digit valid.
 * It is why GS1's "right-align in a 14-digit field" rule works at all.
 *
 * Which spelling a scanner reports depends on the device and its symbology
 * settings, so a barcode stored in any of these forms has to match a scan of
 * any other. Folding down to the shortest form and back up by zero-padding
 * meets in the middle no matter which side is which.
 *
 * A GTIN-14 with a NON-ZERO indicator is deliberately absent: that is a case
 * pack, a different item from the unit inside it, and `gtin14Base` is where
 * that relationship belongs. Nothing here may ever claim they are equal.
 */
export function barcodeVariants(normalized: string): string[] {
  if (!/^\d+$/.test(normalized)) return [normalized]

  // Strip to the significant digits, then re-pad to each standard GTIN width.
  // Two codes are the same item exactly when this produces overlapping sets,
  // so folding both sides meets in the middle whichever way round they arrive.
  const bare = normalized.replace(/^0+/, '') || '0'
  const variants = new Set<string>([normalized])
  for (const width of GTIN_WIDTHS) {
    if (bare.length <= width) variants.add(bare.padStart(width, '0'))
  }
  return [...variants]
}

/** True when a scanned code names this product, by SKU or by either barcode form. */
export function codeMatchesProduct(
  scanned: string,
  product: { sku: string; barcode?: string | null },
): boolean {
  const code = normalizeScan(scanned)
  if (!code) return false
  if (normalizeScan(product.sku) === code) return true
  if (!product.barcode) return false
  const stored = normalizeScan(product.barcode)
  return barcodeVariants(code).includes(stored) || barcodeVariants(stored).includes(code)
}

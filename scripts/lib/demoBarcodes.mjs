// Deterministic, check-digit-correct demo barcodes.
//
// Every demo product has `barcode = NULL`, which means the most intricate part
// of the scan resolver — `barcodeVariants`, and the GTIN folding that makes a
// UPC-A carton and its EAN-13 spelling the same item — has never once been
// exercised by a real beam. This module mints the numbers that fix that.
//
// ── WHY THE CHECK DIGIT IS RE-IMPLEMENTED HERE ──────────────────────────────
//
// `_shared/scanNormalize.ts` owns `gtinCheckDigit` and is the one definition
// the app uses. This is a `.mjs` script module and cannot import a `.ts` file
// without a build step, so the arithmetic appears twice — which is exactly the
// kind of duplication that rots.
//
// It is made safe by `__tests__/demoBarcodes.test.ts`, which imports THIS
// module and asserts every code it generates against the SHARED
// `hasValidGtinCheckDigit`. If the two ever disagree, that test fails. Do not
// remove it; it is the only thing making this copy legitimate.

/** GS1 prefix 93 is Australia — the right shape for an Australian distributor. */
const EAN_PREFIX = '9312'

/**
 * UPC-A number system 0 plus a plausible manufacturer block.
 *
 * The manufacturer digits are not decoration. A naive `0` + zero-padded id
 * gives something like `000000000048`, and `barcodeVariants` strips leading
 * zeros before re-padding — so its bare value would be `48`, which then folds
 * to an 8-digit GTIN as well and sits in the same keyspace as any other short
 * numeric code in the system. A non-zero manufacturer block keeps the bare
 * value 11 digits long, which is both realistic and collision-free.
 */
const UPC_PREFIX = '074250'

/**
 * Weight from the RIGHT, starting at 3 and alternating. One formula for every
 * GTIN width, which is why it is written against the data digits rather than a
 * fixed length.
 */
export function checkDigit(dataDigits) {
  let sum = 0
  for (let i = 0; i < dataDigits.length; i++) {
    const digit = dataDigits.charCodeAt(dataDigits.length - 1 - i) - 48
    sum += i % 2 === 0 ? digit * 3 : digit
  }
  return (10 - (sum % 10)) % 10
}

/** EAN-13 for a product id: 9312 + 8 deterministic digits + check. */
export function ean13For(productId) {
  const data = `${EAN_PREFIX}${String(productId).padStart(8, '0')}`
  return `${data}${checkDigit(data)}`
}

/**
 * UPC-A for a product id: 074250 + 5 deterministic digits + check.
 *
 * A quarter of the catalogue gets one of these ON PURPOSE. A UPC-A stored in
 * the database and scanned as its 13-digit spelling — or the reverse — is the
 * exact case `barcodeVariants` exists for, and it cannot be exercised by a real
 * beam with EAN-13 alone.
 */
export function upcAFor(productId) {
  const data = `${UPC_PREFIX}${String(productId).padStart(5, '0')}`
  return `${data}${checkDigit(data)}`
}

/**
 * Which products get which symbology.
 *
 * Deterministic on id, so re-running the seed produces identical numbers and
 * a sheet printed last week still scans against the database today. Every
 * fourth product gets a UPC-A.
 */
export function barcodeFor(productId) {
  return productId % 4 === 0 ? upcAFor(productId) : ean13For(productId)
}

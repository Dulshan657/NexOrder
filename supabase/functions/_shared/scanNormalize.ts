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

/**
 * UPC-A (12 digits) and EAN-13 (13 digits) are the same number: an EAN-13 is a
 * UPC-A with a leading zero. Which one a scanner reports depends on the device
 * and its symbology settings, so a barcode stored in either form has to match a
 * scan of the other. Returns the alternate encodings of a numeric code.
 */
export function barcodeVariants(normalized: string): string[] {
  if (!/^\d+$/.test(normalized)) return [normalized]
  const variants = new Set<string>([normalized])
  if (normalized.length === 12) variants.add(`0${normalized}`)
  if (normalized.length === 13 && normalized.startsWith('0')) variants.add(normalized.slice(1))
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

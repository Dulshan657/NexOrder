// What did the operator just scan?
//
// The QR payload is deliberately BARE TEXT — a locations.code, a product SKU, or
// a handling-unit code — with no URL wrapper and no namespace prefix, so a
// third-party scanner app reads something meaningful and so the same label works
// if this system is ever replaced. The cost of that choice is that one string
// could in principle name two different things, and this module is where that
// cost is paid: an ambiguous code returns `ambiguous` with every candidate, and
// the UI asks the operator. It never guesses.
//
// Pure — no I/O, no React, no Supabase. The caller supplies already-fetched
// rows; this only indexes and matches them.

export type ProductMatchSource = 'sku' | 'barcode' | 'batchBarcode'

export interface ScanLocation {
  id: number
  code: string
  name: string
  isActive: boolean
}

export interface ScanProduct {
  id: number
  sku: string
  name: string
  barcode?: string | null
}

export interface ScanBatch {
  id: number
  productId: number
  lotCode: string
  barcode?: string | null
}

export interface ScanHandlingUnit {
  id: number
  code: string
}

export type ScanMatch =
  | { kind: 'location'; location: ScanLocation }
  | { kind: 'handlingUnit'; handlingUnit: ScanHandlingUnit }
  | { kind: 'product'; product: ScanProduct; matchedOn: ProductMatchSource; batch?: ScanBatch }

export type ScanResult =
  | ScanMatch
  | { kind: 'empty' }
  | { kind: 'unknown'; raw: string; normalized: string }
  | { kind: 'ambiguous'; raw: string; normalized: string; candidates: ScanMatch[] }

export interface ScanIndexSources {
  locations?: readonly ScanLocation[]
  products?: readonly ScanProduct[]
  batches?: readonly ScanBatch[]
  handlingUnits?: readonly ScanHandlingUnit[]
}

/** Pre-built lookup maps, all keyed by normalized code. Build once per screen. */
export interface ScanIndex {
  locations: Map<string, ScanLocation>
  handlingUnits: Map<string, ScanHandlingUnit>
  productsBySku: Map<string, ScanProduct>
  productsByBarcode: Map<string, ScanProduct>
  batchesByBarcode: Map<string, ScanBatch>
  productsById: Map<number, ScanProduct>
}

/**
 * Fold a raw decoded string into its comparable form.
 *
 * Hardware reality this absorbs: keyboard-wedge scanner guns append a carriage
 * return or newline as their "send" key, camera decoders occasionally include a
 * trailing NUL, and an operator typing a code off a label will not match its
 * capitalisation. Zero-width characters ride along in some QR payloads.
 */
export function normalizeScan(raw: string): string {
  return (raw ?? '')
    // Control characters (the wedge's CR/LF/NUL) and zero-width marks.
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

export function buildScanIndex(sources: ScanIndexSources): ScanIndex {
  const index: ScanIndex = {
    locations: new Map(),
    handlingUnits: new Map(),
    productsBySku: new Map(),
    productsByBarcode: new Map(),
    batchesByBarcode: new Map(),
    productsById: new Map(),
  }

  for (const l of sources.locations ?? []) {
    const key = normalizeScan(l.code)
    // Inactive locations stay in the index on purpose: scanning a
    // decommissioned bin should say "that bin is inactive", not "unknown code".
    if (key) index.locations.set(key, l)
  }

  for (const hu of sources.handlingUnits ?? []) {
    const key = normalizeScan(hu.code)
    if (key) index.handlingUnits.set(key, hu)
  }

  for (const p of sources.products ?? []) {
    index.productsById.set(p.id, p)
    const sku = normalizeScan(p.sku)
    if (sku) index.productsBySku.set(sku, p)
    if (p.barcode) {
      for (const v of barcodeVariants(normalizeScan(p.barcode))) {
        if (v) index.productsByBarcode.set(v, p)
      }
    }
  }

  for (const b of sources.batches ?? []) {
    if (!b.barcode) continue
    for (const v of barcodeVariants(normalizeScan(b.barcode))) {
      if (v) index.batchesByBarcode.set(v, b)
    }
  }

  return index
}

/**
 * Resolve one decoded string against the index.
 *
 * Every namespace is checked — we do NOT stop at the first hit — because
 * stopping early is exactly how a collision becomes a silent mis-scan. Order
 * within the returned candidate list is the documented preference order
 * (location → handling unit → product), which only matters when the caller
 * chooses to accept an ambiguous result.
 */
export function resolveScan(raw: string, index: ScanIndex): ScanResult {
  const normalized = normalizeScan(raw)
  if (!normalized) return { kind: 'empty' }

  const candidates: ScanMatch[] = []

  const location = index.locations.get(normalized)
  if (location) candidates.push({ kind: 'location', location })

  const handlingUnit = index.handlingUnits.get(normalized)
  if (handlingUnit) candidates.push({ kind: 'handlingUnit', handlingUnit })

  // A product may be reached three ways. Only ONE product candidate is
  // contributed, in confidence order — a SKU match and a barcode match that
  // both point at the same product is not an ambiguity, and even when they
  // point at different products the SKU (our own identifier, printed on our own
  // label) is the more trustworthy of the two.
  const variants = barcodeVariants(normalized)
  const bySku = index.productsBySku.get(normalized)
  const byBarcode = variants.map((v) => index.productsByBarcode.get(v)).find(Boolean)
  const batch = variants.map((v) => index.batchesByBarcode.get(v)).find(Boolean)

  if (bySku) {
    candidates.push({ kind: 'product', product: bySku, matchedOn: 'sku' })
  } else if (byBarcode) {
    candidates.push({ kind: 'product', product: byBarcode, matchedOn: 'barcode' })
  } else if (batch) {
    const product = index.productsById.get(batch.productId)
    // A batch barcode without its product loaded is not a usable product
    // result — the caller needs the product to do anything with it.
    if (product) {
      candidates.push({ kind: 'product', product, matchedOn: 'batchBarcode', batch })
    }
  }

  if (candidates.length === 0) return { kind: 'unknown', raw, normalized }
  if (candidates.length === 1) return candidates[0]
  return { kind: 'ambiguous', raw, normalized, candidates }
}

/** Short human label for a match — used in the ambiguity prompt and toasts. */
export function describeScanMatch(match: ScanMatch): string {
  switch (match.kind) {
    case 'location':
      return `${match.location.code} · ${match.location.name}`
    case 'handlingUnit':
      return `${match.handlingUnit.code} · pallet/carton`
    case 'product':
      return `${match.product.sku} · ${match.product.name}`
  }
}

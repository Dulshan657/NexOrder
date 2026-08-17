// What did the operator just scan?
//
// The barcode payload is deliberately BARE TEXT — a locations.code, a product SKU, or
// a handling-unit code — with no URL wrapper and no namespace prefix, so a
// third-party scanner app reads something meaningful and so the same label works
// if this system is ever replaced. The cost of that choice is that one string
// could in principle name two different things, and this module is where that
// cost is paid: an ambiguous code returns `ambiguous` with every candidate, and
// the UI asks the operator. It never guesses.
//
// Pure — no I/O, no React, no Supabase. The caller supplies already-fetched
// rows; this only indexes and matches them.

// normalizeScan / barcodeVariants live in _shared so the browser resolver and
// the server-side pick validator (_shared/pickScanCheck.ts) fold codes
// IDENTICALLY. If they ever diverged, a scan the client accepted could be
// rejected by the server, or vice versa. Re-exported here so existing importers
// of this module are unaffected.
export {
  barcodeVariants,
  codeMatchesProduct,
  gtin14Base,
  gtinCheckDigit,
  hasValidGtinCheckDigit,
  normalizeScan,
} from '@/supabase/functions/_shared/scanNormalize'
import { barcodeVariants, normalizeScan } from '@/supabase/functions/_shared/scanNormalize'

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

/**
 * Pre-built lookup maps, all keyed by normalized code. Build once per screen.
 *
 * ── EVERY BUCKET IS A LIST, AND THAT IS THE POINT ───────────────────────────
 *
 * These were single-valued until 2026-08-17, which quietly broke the promise
 * made in this module's own header: `Map.set` is last-writer-wins, so two
 * products whose barcode variants collided simply overwrote each other and the
 * operator was confidently handed the wrong one. Ambiguity was only ever
 * detected ACROSS namespaces — a bin code that was also a SKU — and never
 * within one, which is where a collision is actually likely.
 *
 * The consequence to keep in mind: `barcodeVariants` zero-pads any numeric code
 * to all four GTIN widths without validating a check digit, so two short
 * internal numeric codes can genuinely collide. Reporting that is the whole
 * job. It also means a seeding bug shows up as a question to the operator
 * rather than as a mis-scan on the floor.
 */
export interface ScanIndex {
  locations: Map<string, readonly ScanLocation[]>
  handlingUnits: Map<string, readonly ScanHandlingUnit[]>
  productsBySku: Map<string, readonly ScanProduct[]>
  productsByBarcode: Map<string, readonly ScanProduct[]>
  batchesByBarcode: Map<string, readonly ScanBatch[]>
  productsById: Map<number, ScanProduct>
}

/** Append without mutating the list already in the map. */
function push<T>(map: Map<string, readonly T[]>, key: string, value: T): void {
  const existing = map.get(key)
  map.set(key, existing ? [...existing, value] : [value])
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
    if (key) push(index.locations, key, l)
  }

  for (const hu of sources.handlingUnits ?? []) {
    const key = normalizeScan(hu.code)
    if (key) push(index.handlingUnits, key, hu)
  }

  for (const p of sources.products ?? []) {
    index.productsById.set(p.id, p)
    const sku = normalizeScan(p.sku)
    if (sku) push(index.productsBySku, sku, p)
    if (p.barcode) {
      for (const v of barcodeVariants(normalizeScan(p.barcode))) {
        if (v) push(index.productsByBarcode, v, p)
      }
    }
  }

  for (const b of sources.batches ?? []) {
    if (!b.barcode) continue
    for (const v of barcodeVariants(normalizeScan(b.barcode))) {
      if (v) push(index.batchesByBarcode, v, b)
    }
  }

  return index
}

/** Every distinct value the variants of one scanned code reach. */
function collect<T>(map: Map<string, readonly T[]>, keys: readonly string[]): T[] {
  const seen = new Set<T>()
  for (const key of keys) {
    for (const value of map.get(key) ?? []) seen.add(value)
  }
  return [...seen]
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

  for (const location of index.locations.get(normalized) ?? []) {
    candidates.push({ kind: 'location', location })
  }

  for (const handlingUnit of index.handlingUnits.get(normalized) ?? []) {
    candidates.push({ kind: 'handlingUnit', handlingUnit })
  }

  // A product may be reached three ways, and the CONFIDENCE ORDER still holds:
  // if any SKU matches we contribute only SKU matches, and so on down. A SKU
  // match and a barcode match pointing at the same product is not an ambiguity,
  // and even pointing at different products the SKU — our own identifier, on
  // our own label — is the more trustworthy of the two.
  //
  // What changed is that ALL matches at the winning tier are contributed. Two
  // products behind one barcode is a real ambiguity and the operator gets asked.
  const variants = barcodeVariants(normalized)
  const bySku = collect(index.productsBySku, [normalized])
  const byBarcode = collect(index.productsByBarcode, variants)
  const batches = collect(index.batchesByBarcode, variants)

  if (bySku.length > 0) {
    for (const product of bySku) candidates.push({ kind: 'product', product, matchedOn: 'sku' })
  } else if (byBarcode.length > 0) {
    for (const product of byBarcode) {
      candidates.push({ kind: 'product', product, matchedOn: 'barcode' })
    }
  } else {
    for (const batch of batches) {
      const product = index.productsById.get(batch.productId)
      // A batch barcode without its product loaded is not a usable product
      // result — the caller needs the product to do anything with it.
      if (product) {
        candidates.push({ kind: 'product', product, matchedOn: 'batchBarcode', batch })
      }
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

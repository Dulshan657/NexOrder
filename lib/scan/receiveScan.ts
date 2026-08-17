// What a code means when it is scanned at the goods-in dock.
//
// Receiving is the one warehouse surface where all three namespaces turn up in
// the same minute: the carton in the operator's hands (a product), the site the
// pallet is going to (a warehouse), and — because people scan what is in front
// of them — the rack label on the wall behind them (a bin).
//
// Pure and DOM-free so it tests in node, and so the view, which is already 900
// lines, does not grow a fourth kind of resolution logic.
//
// ── A BIN IS REFUSED, AND THAT IS NOT A LIMITATION ──────────────────────────
//
// `receive-stock` takes a `location_id` that is a WAREHOUSE, not a bin. Passing
// a bin would also stamp `handling_units.warehouse_id` with a bin id, which is
// wrong in a way nothing downstream would notice. Stock reaches a bin through
// putaway and only through putaway. So a scanned bin code gets a specific
// sentence explaining where it does belong, rather than being silently accepted
// or lumped in with "unknown code".

import { normalizeScan, resolveScan, type ScanIndex, type ScanMatch } from './resolveScan'

export interface ReceiveScanProduct {
  readonly id: number
  readonly sku: string
  readonly name: string
}

export type ReceiveScanTarget =
  /** A carton in the operator's hands. */
  | { readonly kind: 'product'; readonly product: ReceiveScanProduct; readonly matchedOn: string }
  /** A site root — the legal destination for a receipt. */
  | { readonly kind: 'warehouse'; readonly warehouseId: number; readonly code: string }
  /** A rack label. Recognised, and refused for a reason worth stating. */
  | { readonly kind: 'bin'; readonly code: string }
  /** A pallet label. Nothing to receive onto — plates are minted BY the receipt. */
  | { readonly kind: 'handlingUnit'; readonly code: string }
  | { readonly kind: 'empty' }
  | { readonly kind: 'unknown'; readonly normalized: string }
  /** One string, several meanings, and no rule here picks a winner. */
  | { readonly kind: 'ambiguous'; readonly normalized: string; readonly candidates: readonly ScanMatch[] }

/**
 * Resolve one scanned code for the receiving screen.
 *
 * `warehouseIdByCode` is keyed by NORMALIZED code and holds site roots only.
 * Keeping it separate from the scan index is what lets a warehouse root be told
 * from a bin without a second query — both are `locations` rows and only the
 * caller knows which ids are sites.
 */
export function resolveReceiveScan(
  raw: string,
  index: ScanIndex,
  warehouseIdByCode: ReadonlyMap<string, number>,
): ReceiveScanTarget {
  const normalized = normalizeScan(raw)
  if (!normalized) return { kind: 'empty' }

  // A site root is checked FIRST and outside the index, because the index is
  // built from the product catalogue and the receipt's own rows — it may not
  // carry locations at all.
  const warehouseId = warehouseIdByCode.get(normalized)
  if (warehouseId != null) return { kind: 'warehouse', warehouseId, code: normalized }

  const result = resolveScan(raw, index)

  switch (result.kind) {
    case 'empty':
      return { kind: 'empty' }
    case 'unknown':
      return { kind: 'unknown', normalized: result.normalized }
    case 'product':
      return { kind: 'product', product: result.product, matchedOn: result.matchedOn }
    case 'location':
      return { kind: 'bin', code: result.location.code }
    case 'handlingUnit':
      return { kind: 'handlingUnit', code: result.handlingUnit.code }
    case 'ambiguous': {
      // A product candidate wins outright here. At a dock the overwhelmingly
      // likely reading of a scanned code is "this is the thing I am holding",
      // and every other candidate kind is refused on this screen anyway — so
      // preferring the product resolves the collision without ever choosing
      // between two things the operator could actually have meant.
      const product = result.candidates.find((c) => c.kind === 'product')
      if (product && product.kind === 'product') {
        return { kind: 'product', product: product.product, matchedOn: product.matchedOn }
      }
      return { kind: 'ambiguous', normalized: result.normalized, candidates: result.candidates }
    }
  }
}

/** The sentence to show the operator when a scan did not add a line. */
export function describeReceiveRefusal(target: ReceiveScanTarget): string | null {
  switch (target.kind) {
    case 'bin':
      return `${target.code} is a bin. Receipts land at the site — Putaway moves the stock to a bin afterwards.`
    case 'handlingUnit':
      return `${target.code} is a pallet label. Receiving creates the pallet; it is not scanned in.`
    case 'unknown':
      return `Nothing in the catalogue matches ${target.normalized}. Search by name, or add the barcode to the product first.`
    case 'ambiguous':
      return `${target.normalized} matches more than one thing. Search by name instead.`
    default:
      return null
  }
}

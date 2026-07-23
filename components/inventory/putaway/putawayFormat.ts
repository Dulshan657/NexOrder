// Display helpers shared by the putaway row and the bin picker. Pure, so the
// "48 each · 4 cartons" arithmetic is unit-testable on its own.

import type { Product, ProductUom } from '@/types'
import { deriveDefaultUoms, receivableUoms, baseUom } from '@/lib/uom'
import { decomposeToUoms, formatBreakdown } from '@/lib/uomDecompose'

/** The product's own UOM ladder, or the base+carton default synthesised from its
 *  legacy fields. Same fallback ReceiveStockView uses, so the two screens always
 *  offer the operator the same units. */
export function uomsForProduct(product: Product | null | undefined): ProductUom[] {
  if (!product) return []
  const own = receivableUoms(product.uoms)
  if (own.length > 0) return own
  return receivableUoms(deriveDefaultUoms(product.unit, product.price, product.cartonSize))
}

/** The base unit's label ('each', 'jar', …), for "36 jars". */
export function baseUnitLabel(product: Product | null | undefined): string {
  if (!product) return 'units'
  return baseUom(uomsForProduct(product))?.code ?? product.unit ?? 'units'
}

/**
 * A quantity in base units, plus a pack breakdown when there is a larger unit
 * to express it in: `{ primary: '48 jars', secondary: '4 cartons' }`. The
 * secondary is omitted when the breakdown is only the base tier, so a loose
 * 5-unit line doesn't render "5 jars · 5 jars".
 */
export function describeQuantity(
  baseQty: number,
  product: Product | null | undefined,
): { primary: string; secondary: string | null } {
  const unit = baseUnitLabel(product)
  const primary = `${trimNumber(baseQty)} ${unit}`

  const uoms = uomsForProduct(product)
  const breakdown = decomposeToUoms(baseQty, uoms)
  const onlyBaseTier = breakdown.every((b) => b.factorToBase === 1)
  if (breakdown.length === 0 || onlyBaseTier) return { primary, secondary: null }

  return { primary, secondary: formatBreakdown(breakdown) }
}

/** Base units for `count` of `uom` — the conversion the picker commits with. */
export function toBaseQty(count: number, uom: ProductUom | undefined): number {
  const factor = uom && !uom.isBase ? uom.factorToBase : 1
  return (Number(count) || 0) * (Number(factor) || 1)
}

/** Drop a trailing `.000` from the NUMERIC(14,3) quantities the ledger stores,
 *  while keeping a genuinely fractional quantity legible. */
export function trimNumber(n: number): string {
  const value = Number(n) || 0
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000)
}

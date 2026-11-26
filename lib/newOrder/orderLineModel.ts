// The New Order screen's lines: what a line means in base units, whether the
// order can be placed against the stock on hand, and what is sent.
//
// A line is a quantity IN ITS CHOSEN UNIT (3 cartons), and it is sent that way:
// `place-order` already resolves `uomId` against the product's own UOM rows,
// prices it as the Shop does (carton discount included) and records the unit on
// `order_items`. Base units exist here only for the stock check, because stock
// is counted in base units. Pre-multiplying to 36 eaches would price the line
// differently from the same order placed through the Shop.
//
// Pure: no React, no fetching.

import type { Product, ProductUom } from '../../types'
import type { DraftLine } from '../../supabase/functions/_shared/orderDraftPayload'

export type { DraftLine } from '../../supabase/functions/_shared/orderDraftPayload'

/** The units a line may be ordered in, base first. Empty when the product
 *  carries no UOM rows (read before mig 00067); the line is then base-only. */
export function orderableUoms(product: Product): ProductUom[] {
  return [...(product.uoms ?? [])]
    .filter((u) => u.isOrderable || u.isBase)
    .sort((a, b) => Number(b.isBase) - Number(a.isBase) || a.sortOrder - b.sortOrder)
}

/** Base units per one of this line's unit. An unknown uomId counts as base,
 *  which is also what `place-order` does with one. */
export function unitFactor(line: Pick<DraftLine, 'uomId'>, product: Product | undefined): number {
  if (line.uomId == null || !product) return 1
  const uom = product.uoms?.find((u) => u.id === line.uomId)
  return uom ? uom.factorToBase : 1
}

export function lineBaseQuantity(line: DraftLine, product: Product | undefined): number {
  return line.quantity * unitFactor(line, product)
}

export const sameLine = (a: Pick<DraftLine, 'productId' | 'uomId'>, b: Pick<DraftLine, 'productId' | 'uomId'>) =>
  a.productId === b.productId && (a.uomId ?? null) === (b.uomId ?? null)

/** Add lines, folding a repeated product-and-unit into the line that exists.
 *  Returns new arrays and objects; neither input is touched. */
export function mergeLines(current: readonly DraftLine[], incoming: readonly DraftLine[]): DraftLine[] {
  return incoming.reduce<DraftLine[]>((acc, line) => {
    const at = acc.findIndex((l) => sameLine(l, line))
    if (at === -1) return [...acc, { ...line, uomId: line.uomId ?? null }]
    return acc.map((l, i) => (i === at ? { ...l, quantity: l.quantity + line.quantity } : l))
  }, current.map((l) => ({ ...l })))
}

export interface StockShortfall {
  requested: number
  available: number
}

/**
 * Products whose lines together ask for more base units than `available`.
 * Summed per product because two lines of one product (cartons and eaches)
 * draw on the same stock — as `place-order`'s own check does.
 *
 * `available` is the product cache across all warehouses, so the server may
 * still refuse an order this passes (stock in a warehouse it will not draw
 * from); it will never accept one this refuses.
 */
export function overStockByProduct(
  lines: readonly DraftLine[],
  products: readonly Product[],
): Map<number, StockShortfall> {
  const byId = new Map(products.map((p): [number, Product] => [p.id, p]))
  const requested = new Map<number, number>()
  for (const line of lines) {
    requested.set(line.productId, (requested.get(line.productId) ?? 0) + lineBaseQuantity(line, byId.get(line.productId)))
  }
  const over = new Map<number, StockShortfall>()
  for (const [productId, qty] of requested) {
    const available = Math.max(0, byId.get(productId)?.available ?? 0)
    if (qty > available) over.set(productId, { requested: qty, available })
  }
  return over
}

export const isValidQuantity = (quantity: number) => Number.isInteger(quantity) && quantity >= 1

/** The `items` of a `place-order` request: each line in its own unit. */
export function toPlaceOrderItems(lines: readonly DraftLine[]): Array<{ productId: number; quantity: number; uomId: number | null }> {
  return lines.map((l) => ({ productId: l.productId, quantity: l.quantity, uomId: l.uomId ?? null }))
}

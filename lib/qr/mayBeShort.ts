// "This order may be short": the question a kitchen is asked at submit, before an
// approver is the first to find out.
//
// A kitchen (QR Staff) never sees a stock figure -- they have no Stock tab, and a
// number would invite them to second-guess a call that belongs to the approver --
// so the answer is NAMES ONLY. Nothing here, or built on it, may return, format
// or log how much is in stock.
//
// It is the server's own arithmetic, not a copy of it. A line's unit of measure
// is resolved by `normalizeOrderItems`, base units are summed per product by
// `baseUnitsByProduct` and `stockPositions` makes the call -- the same three
// functions `place-order` and the approval preview run (`_shared/orderPricing.ts`,
// pure, so the browser imports the very module). "The client's preview IS the
// server's decision, evaluated early" is what keeps a warning from contradicting
// the answer the approver then gets.
//
// SOFT, by design. `available` is the reservable cache (on_hand - allocated), a
// moment old and not the warehouse's last word. The warning never blocks a
// submit; it only lets the kitchen choose to change the order first.

import {
  baseUnitsByProduct,
  normalizeOrderItems,
  stockPositions,
  type OrderLineInput,
  type PricedProduct,
} from '@/supabase/functions/_shared/orderPricing'
import type { OrderItem, Product, ProductUom } from '@/types'

/** One line of an order, as it is filed (and as the server reads it). */
export type MayBeShortLine = OrderLineInput

/** The part of a product this needs: a name to report, stock to compare, UOMs to convert. */
export interface MayBeShortProduct {
  id: Product['id']
  name: Product['name']
  /** The reservable cache: on-hand less what is already allocated. Base units. */
  available: Product['available']
  uoms?: readonly Pick<ProductUom, 'id' | 'factorToBase' | 'isBase'>[]
}

/** Cart lines in the shape a held request is filed in (see `OrderContext.runSubmitForApproval`). */
export function toShortLines(items: readonly Pick<OrderItem, 'id' | 'quantity' | 'packSize' | 'uomId'>[]): MayBeShortLine[] {
  return items.map((item) => ({
    productId: item.id,
    quantity: item.quantity,
    packSize: item.packSize ?? null,
    uomId: item.uomId ?? null,
  }))
}

/**
 * Names of the products whose total need, in base units, exceeds what is
 * available. In the order the lines first mention them, each once. A product the
 * catalogue does not hold is ignored (the server answers that one on its own),
 * and taking exactly what is available is not short.
 */
export function mayBeShort(
  lines: readonly MayBeShortLine[],
  products: readonly MayBeShortProduct[],
): string[] {
  // `normalizeOrderItems` reads only `uoms`; the server's `PricedProduct` also
  // names price, sku and category, which nothing here has a use for.
  const byId = new Map<number, PricedProduct>(
    products.map((p): [number, PricedProduct] => [p.id, { uoms: p.uoms ?? [] } as unknown as PricedProduct]),
  )
  const need = baseUnitsByProduct(normalizeOrderItems(lines, byId))
  const available = new Map<number, number>(products.map((p): [number, number] => [p.id, p.available]))
  const named = new Map<number, { name: string }>(products.map((p): [number, { name: string }] => [p.id, p]))

  return stockPositions(need, available, named)
    .filter((position) => position.short)
    .map((position) => position.productName)
}

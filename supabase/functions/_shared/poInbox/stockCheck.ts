// Stock-availability check for inbound-PO approval.
//
// Inventory semantics are defined by the authoritative place-order path:
// `products.inventory` is counted in SELLING UNITS — the same unit as an
// order line's `quantity`. `pack_size` is descriptive metadata (the carton
// size for a carton line, null for a single unit, see OrderItem.packSize in
// types.ts); it is stored on the order line but is NOT a multiplier on
// inventory. place-order both checks (`inventory < quantity`) and decrements
// (`inventory - quantity`) using `quantity` alone, so approve-po MUST do the
// same — otherwise the two ordering channels disagree about how much stock a
// line consumes, and a routine carton PO falsely trips a CONFLICT (409).

export interface StockLine {
  product_id: number
  quantity: number
}

export interface StockProduct {
  id: number
  name: string
  inventory: number
}

export interface StockShortage {
  product_id: number
  name: string
  available: number
  requested: number
}

/**
 * Sum requested quantity per product (duplicate product lines accumulate)
 * and return any products whose total requested quantity exceeds current
 * inventory. `quantity` is the selling-unit count; pack_size is intentionally
 * not part of the input — see the module header.
 *
 * Products absent from `products` are skipped; missing-product is a distinct
 * INVALID_INPUT condition validated by the caller before this runs.
 */
export function findStockShortages(
  lines: StockLine[],
  products: ReadonlyMap<number, StockProduct>,
): StockShortage[] {
  const requestedByProduct = new Map<number, number>()
  for (const line of lines) {
    requestedByProduct.set(
      line.product_id,
      (requestedByProduct.get(line.product_id) ?? 0) + line.quantity,
    )
  }

  const shortages: StockShortage[] = []
  for (const [productId, requested] of requestedByProduct) {
    const product = products.get(productId)
    if (!product) continue
    if (product.inventory < requested) {
      shortages.push({
        product_id: productId,
        name: product.name,
        available: product.inventory,
        requested,
      })
    }
  }
  return shortages
}

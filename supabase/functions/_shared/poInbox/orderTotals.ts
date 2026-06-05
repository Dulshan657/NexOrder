// Order-line + total computation for inbound-PO approval.
//
// Money semantics mirror the authoritative place-order path: a line costs
// `unit_price * quantity`, where `quantity` is the selling-unit count.
// `pack_size` is descriptive carton metadata (the carton size for a carton
// line, null for a single unit — see OrderItem.packSize in types.ts); it is
// stored on the order line but is NOT a multiplier on the line total. The
// stock check (stockCheck.ts) already treats it this way, and place-order
// prices by quantity alone (`s + i.unitPrice * i.quantity`). Multiplying the
// total by pack_size here inflated `orders.total` by the carton size — a
// carton PO showed a header total several times its real value.

export interface PricedLine {
  product_id: number
  quantity: number
  pack_size: number | null
}

export interface PricedProduct {
  name: string
  sku: string
  price: number
}

export interface OrderItemRow {
  product_id: number
  quantity: number
  pack_size: number | null
  unit_price: number
  product_name: string
  product_sku: string
}

/**
 * Build the order_items rows and the order total for a set of resolved lines.
 * Each line total is `product.price * quantity` — pack_size is preserved on the
 * row as metadata but never scales the money. Every line's product MUST be
 * present in `products` (the caller validates missing-product as INVALID_INPUT
 * before this runs).
 */
export function buildOrderItems(
  lines: PricedLine[],
  products: ReadonlyMap<number, PricedProduct>,
): { items: OrderItemRow[]; total: number } {
  let total = 0
  const items = lines.map(line => {
    const product = products.get(line.product_id)!
    total += product.price * line.quantity
    return {
      product_id: line.product_id,
      quantity: line.quantity,
      pack_size: line.pack_size,
      unit_price: product.price,
      product_name: product.name,
      product_sku: product.sku,
    }
  })
  return { items, total }
}

// Order-line + total computation for inbound-PO approval.
//
// Money semantics: a line costs `unit_price * quantity`, where `quantity` is the
// selling-unit count. Multiplying the total by pack_size here once inflated
// `orders.total` by the carton size — a carton PO showed a header total several
// times its real value.
//
// UNIT MODEL: the inventory ledger (inv_pick_order_line / inv_release_reservation,
// mig 00035) treats base_units = quantity * COALESCE(pack_size, 1). In the
// PO-inbox path `quantity` is ALREADY the selling-unit count, so order_items
// rows are written with pack_size = NULL — otherwise the pack-aware pick/release
// RPCs would scale a PO line by the carton size and over-deplete stock. The
// descriptive carton size, if needed for display, comes from products.cartonSize.
// (The web path place-order is the opposite: a carton line stores quantity =
// cartons + pack_size = carton size, so base = quantity * pack_size.)

export interface PricedLine {
  product_id: number
  quantity: number
  pack_size: number | null
  /**
   * Per-unit price extracted from the PO document, if any. Used only as a
   * FALLBACK when the matched product has no catalog price (price null/0) —
   * e.g. a freshly-seeded demo product. When the catalog price is present it
   * always wins, so existing pricing behaviour is unchanged.
   */
  extracted_unit_price?: number | null
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
 * Each line total is `unitPrice * quantity` — quantity is the selling-unit
 * count and never scaled by pack_size. order_items rows are written with
 * pack_size = NULL so the pack-aware inventory RPCs (mig 00035) keep their
 * factor at 1 for PO-inbox lines (see file header). Every line's product MUST be
 * present in `products` (the caller validates missing-product as INVALID_INPUT
 * before this runs).
 *
 * unitPrice = the product's catalog price, falling back to the line's
 * `extracted_unit_price` only when the catalog price is missing (null/0). This
 * keeps catalog pricing authoritative while letting an order still carry a
 * sensible price for products that have no catalog price yet.
 */
export function buildOrderItems(
  lines: PricedLine[],
  products: ReadonlyMap<number, PricedProduct>,
): { items: OrderItemRow[]; total: number } {
  let total = 0
  const items = lines.map(line => {
    const product = products.get(line.product_id)!
    const catalogPrice = Number.isFinite(product.price) && product.price > 0 ? product.price : 0
    const fallback =
      typeof line.extracted_unit_price === 'number' && line.extracted_unit_price > 0
        ? line.extracted_unit_price
        : 0
    const unitPrice = catalogPrice > 0 ? catalogPrice : fallback
    total += unitPrice * line.quantity
    return {
      product_id: line.product_id,
      quantity: line.quantity,
      pack_size: null,
      unit_price: unitPrice,
      product_name: product.name,
      product_sku: product.sku,
    }
  })
  return { items, total }
}

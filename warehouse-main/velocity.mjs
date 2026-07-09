// ABC velocity classification. Pure — no I/O.
//
// wie_refresh_velocity() reads the last 30 days of `pick` movements, of which
// this database has almost none, so it would stamp nearly every SKU class C and
// slotting would fall back to raw dock distance. Instead we rank SKUs by real
// demand from order history and classify by cumulative share of that demand.
//
// Standard ABC: the fastest 20% of SKUs are A, the next 30% B, the rest C.
// scoring.ts weights velocity_match at 0.15, so A-class SKUs are pulled into the
// dock-adjacent fast aisles.

export const A_SHARE = 0.2
export const B_SHARE = 0.3

/**
 * @param {Array<{productId:number, demand:number}>} rows One entry per product.
 *   Products absent from order history should be passed with demand 0.
 * @returns {Array<{productId:number, velocityClass:'A'|'B'|'C', demand:number}>}
 *   Sorted by descending demand.
 */
export function classifyAbc(rows) {
  // Descending demand; productId breaks ties so the classification is stable
  // across runs (Postgres row order is not).
  const ranked = [...rows].sort((a, b) => b.demand - a.demand || a.productId - b.productId)

  const aCutoff = Math.round(ranked.length * A_SHARE)
  const bCutoff = aCutoff + Math.round(ranked.length * B_SHARE)

  return ranked.map((row, i) => ({
    productId: row.productId,
    demand: row.demand,
    // Zero demand is never fast, however few SKUs the catalogue has.
    velocityClass: row.demand <= 0 ? 'C' : i < aCutoff ? 'A' : i < bCutoff ? 'B' : 'C',
  }))
}

/** Roll `order_items` rows up into one demand figure per product. */
export function demandByProduct(orderItems, allProductIds) {
  const totals = new Map(allProductIds.map((id) => [id, 0]))
  for (const item of orderItems) {
    if (!totals.has(item.product_id)) continue
    totals.set(item.product_id, totals.get(item.product_id) + Number(item.quantity ?? 0))
  }
  return [...totals].map(([productId, demand]) => ({ productId, demand }))
}

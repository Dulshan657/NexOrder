// Directed picking — per-bin pick task builder (Phase 5 follow-up, P2 fix).
//
// PURITY CONTRACT: this file lives under _shared/wie/ so it must stay pure
// TypeScript (no Deno globals, no URL/npm imports, no I/O) — enforced by
// __tests__/wie/purity.test.ts. It runs inside the order-pick-tasks Edge
// Function AND is unit-tested directly from Node/vitest.
//
// Allocation has no line grain: inventory_movements (and therefore
// wie_order_alloc_bins) is keyed (product_id, location_id) — never
// order_item_id — because a product can appear on two order lines (a unit
// line and a carton line; place-order aggregates the cart by
// product+pack_size). This module turns that per-(product, bin) allocation
// into per-(order_item, bin) pick tasks:
//   1. Attribute each bin's allocated BASE units across the product's order
//      lines, ascending order_item id, capping each line at its ordered qty.
//   2. Convert each (line, bin) attribution to LINE units via that line's
//      pack_size, then reconcile fractional cartons (see below).
//   3. Net off what's already been picked at that exact bin to get `remaining`.
//
// Fractional-carton edge case: inv_reserve_order's FIFO sweep draws BASE units
// batch-by-batch and can split a single carton's base units across two bins
// (e.g. bin A has 25 base units available of a 30-base-unit need, bin B
// supplies the other 5) — the per-bin line-unit amount then isn't a whole
// carton. Realistic B2B carton lines allocate on pack boundaries in practice;
// this is the uncommon path. Each bin is FLOORED to the whole cartons it
// physically holds and never rounded up: a bin can only yield whole cartons it
// actually contains, and directing a pick of more base units than the bin holds
// would throw INSUFFICIENT_STOCK (or silently draw another order's reserved
// stock). The straddling sub-carton remainder is therefore left un-tasked — the
// line simply can't fully pick, an honest signal of an awkward/partial
// reservation rather than a fabricated carton.

export interface AllocBin {
  productId: number
  warehouseId: number
  warehouseCode: string
  locationId: number
  code: string
  graphNodeId: number | null
  /** Net allocated (allocate − deallocate), BASE units. Always > 0 (the SQL
   *  netting already excludes net-zero/negative bins). */
  qtyBase: number
}

export interface OrderLine {
  orderItemId: number
  productId: number
  /** Ordered quantity, LINE units (e.g. cartons). */
  quantity: number
  /** Base units per line unit. Defaults to 1 (unit lines) when absent. */
  packSize: number
}

/** One raw pick_progress row (not pre-aggregated — this module sums matches). */
export interface PickRecord {
  orderItemId: number
  locationId: number
  /** LINE units, matching pick_progress.picked_qty. */
  pickedQty: number
}

export interface PickTask {
  orderItemId: number
  productId: number
  warehouseId: number
  warehouseCode: string
  locationId: number
  code: string
  graphNodeId: number | null
  /** LINE units attributed to this order line at this bin. */
  allocatedQty: number
  /** LINE units already picked for this order line at this bin. */
  pickedQty: number
  /** LINE units still to pick. Tasks with remaining <= 0 are not returned. */
  remaining: number
}

function attributionKey(binIndex: number, orderItemId: number): string {
  return `${binIndex}:${orderItemId}`
}

function pickKey(orderItemId: number, locationId: number): string {
  return `${orderItemId}:${locationId}`
}

/**
 * Build the actionable per-bin pick task list for one order from its netted
 * allocation, its order lines, and its recorded picks.
 */
export function buildPickTasks(
  allocBins: readonly AllocBin[],
  orderLines: readonly OrderLine[],
  picks: readonly PickRecord[],
): PickTask[] {
  const linesByProduct = new Map<number, OrderLine[]>()
  for (const line of orderLines) {
    const list = linesByProduct.get(line.productId)
    if (list) list.push(line)
    else linesByProduct.set(line.productId, [line])
  }
  for (const list of linesByProduct.values()) {
    list.sort((a, b) => a.orderItemId - b.orderItemId)
  }

  const pickedByKey = new Map<string, number>()
  for (const p of picks) {
    const key = pickKey(p.orderItemId, p.locationId)
    pickedByKey.set(key, (pickedByKey.get(key) ?? 0) + p.pickedQty)
  }

  const binsByProduct = new Map<number, AllocBin[]>()
  for (const bin of allocBins) {
    if (!(bin.qtyBase > 0)) continue // defensive: net-zero/negative excluded
    const list = binsByProduct.get(bin.productId)
    if (list) list.push(bin)
    else binsByProduct.set(bin.productId, [bin])
  }

  const tasks: PickTask[] = []

  for (const [productId, bins] of binsByProduct) {
    const lines = linesByProduct.get(productId)
    if (!lines || lines.length === 0) continue // no matching line — nothing to attribute to

    // Deterministic bin order: both the attribution walk and the largest-
    // remainder tie-break key off this ordering.
    const sortedBins = [...bins].sort((a, b) => a.locationId - b.locationId)

    // ── 1. Attribute each bin's base allocation across the product's lines,
    //       ascending order_item id, capping each line at its ordered qty. ──
    const remainingCapacityBase = new Map<number, number>(
      lines.map((l) => [l.orderItemId, l.quantity * (l.packSize || 1)]),
    )
    const attributedBase = new Map<string, number>()

    sortedBins.forEach((bin, binIndex) => {
      let remainingBin = bin.qtyBase
      for (const line of lines) {
        if (remainingBin <= 0) break
        const cap = remainingCapacityBase.get(line.orderItemId) ?? 0
        if (cap <= 0) continue
        const take = Math.min(remainingBin, cap)
        if (take <= 0) continue
        const key = attributionKey(binIndex, line.orderItemId)
        attributedBase.set(key, (attributedBase.get(key) ?? 0) + take)
        remainingCapacityBase.set(line.orderItemId, cap - take)
        remainingBin -= take
      }
      // Any remainingBin > 0 here means this bin holds more stock than the
      // product's lines ordered in total — shouldn't happen (reservation is
      // driven by order quantity) — the excess is dropped rather than
      // fabricating a task with no owning line.
    })

    // ── 2. Per line: convert each bin's attributed base to WHOLE line units by
    //       flooring that bin independently (see the module header on why a bin
    //       is never rounded up to reconcile the line total). ──
    for (const line of lines) {
      const packSize = line.packSize || 1
      sortedBins.forEach((_bin, binIndex) => {
        const base = attributedBase.get(attributionKey(binIndex, line.orderItemId)) ?? 0
        const allocatedQty = Math.floor(base / packSize + 1e-9)
        if (allocatedQty <= 0) return
        const bin = sortedBins[binIndex]
        const pickedQty = pickedByKey.get(pickKey(line.orderItemId, bin.locationId)) ?? 0
        const remaining = Math.max(allocatedQty - pickedQty, 0)
        if (remaining <= 0) return // fully picked at this bin — not actionable

        tasks.push({
          orderItemId: line.orderItemId,
          productId,
          warehouseId: bin.warehouseId,
          warehouseCode: bin.warehouseCode,
          locationId: bin.locationId,
          code: bin.code,
          graphNodeId: bin.graphNodeId,
          allocatedQty,
          pickedQty,
          remaining,
        })
      })
    }
  }

  return tasks
}

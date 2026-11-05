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
//
// Imported orders (qb_invoice_number set, NX-0029) can be picked beyond what was
// reserved: the invoice came from elsewhere, so the system's stock records may
// not match the shelf. buildFallbackTasks offers the part of a line that neither a
// reservation nor a pick covers at the bins that hold free stock of the product,
// and stockBinsInWarehouses turns raw balance rows into those bins.

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
  /** True for a task buildFallbackTasks offered: stock is there, but this order
   *  holds no reservation on it. Absent on every reserved task. */
  unreserved?: boolean
}

/** Free stock of one product in one bin, BASE units: what an imported order may
 *  pick beyond its reservation without touching another order's allocation. */
export interface StockBin {
  productId: number
  warehouseId: number
  warehouseCode: string
  locationId: number
  code: string
  graphNodeId: number | null
  /** On hand minus allocated, BASE units. Bins with nothing free are not listed. */
  qtyBase: number
}

/** One raw inventory_balances row (a bin holds one per batch and handling unit). */
export interface StockRow {
  productId: number
  locationId: number
  code: string
  graphNodeId: number | null
  /** BASE units. */
  onHand: number
  /** BASE units held by orders. */
  allocated: number
}

/** The locations stock may be drawn from at one fulfilment warehouse, as
 *  inv_warehouse_draw_locations returns them (never a path prefix rebuilt here). */
export interface WarehouseDraw {
  warehouseId: number
  warehouseCode: string
  locationIds: readonly number[]
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

/**
 * The unreserved part of an imported order's lines, offered at the bins that hold
 * free stock of the product. Returns ONLY the new tasks (each `unreserved: true`);
 * the caller appends them to the reserved ones. Nothing is mutated.
 *
 * A line's unreserved part, in LINE units, is what neither a task nor a pick covers:
 * ordered - every pick recorded for the line (at any bin) - the remaining of the
 * line's tasks. A task's `remaining` is its allocation net of the picks at its own
 * bin, so counting every pick once and every task's remaining once never counts a
 * unit twice.
 *
 * Offering rules, per line, in a stable order (warehouse, then bin):
 *  - a line closed short is offered nowhere, and a fully covered line has no part;
 *  - a bin offers the WHOLE cartons it holds (floored, as buildPickTasks floors a
 *    bin), never above the open amount;
 *  - each bin is offered up to the open amount on its own. They are alternatives,
 *    not a plan that sums to the line: records on an imported order are the thing in
 *    doubt, so a bin that turns out empty must not hide the capacity of the next.
 *    record-pick still refuses an over-pick;
 *  - a bin the line already has a task at is skipped, so a shelf is never listed
 *    twice for one line. Once the reserved part is picked there, the bin comes back
 *    as an unreserved offer on the next load.
 */
export function buildFallbackTasks(
  lines: readonly OrderLine[],
  tasks: readonly PickTask[],
  stockBins: readonly StockBin[],
  picks: readonly PickRecord[],
  shortLineIds: readonly number[],
): PickTask[] {
  const closed = new Set(shortLineIds)

  const pickedByLine = new Map<number, number>()
  for (const p of picks) pickedByLine.set(p.orderItemId, (pickedByLine.get(p.orderItemId) ?? 0) + p.pickedQty)

  const remainingByLine = new Map<number, number>()
  const taskBinsByLine = new Map<number, Set<number>>()
  for (const t of tasks) {
    remainingByLine.set(t.orderItemId, (remainingByLine.get(t.orderItemId) ?? 0) + t.remaining)
    const bins = taskBinsByLine.get(t.orderItemId)
    if (bins) bins.add(t.locationId)
    else taskBinsByLine.set(t.orderItemId, new Set([t.locationId]))
  }

  const binsByProduct = new Map<number, StockBin[]>()
  for (const bin of stockBins) {
    if (!(bin.qtyBase > 0)) continue
    const list = binsByProduct.get(bin.productId)
    if (list) list.push(bin)
    else binsByProduct.set(bin.productId, [bin])
  }
  for (const list of binsByProduct.values()) {
    list.sort((a, b) => a.warehouseId - b.warehouseId || a.locationId - b.locationId)
  }

  const out: PickTask[] = []
  for (const line of [...lines].sort((a, b) => a.orderItemId - b.orderItemId)) {
    if (closed.has(line.orderItemId)) continue
    const open = line.quantity - (pickedByLine.get(line.orderItemId) ?? 0) - (remainingByLine.get(line.orderItemId) ?? 0)
    if (!(open > 0)) continue

    const packSize = line.packSize || 1
    const taken = taskBinsByLine.get(line.orderItemId)
    for (const bin of binsByProduct.get(line.productId) ?? []) {
      if (taken?.has(bin.locationId)) continue
      const wholeCartons = Math.floor(bin.qtyBase / packSize + 1e-9)
      const offered = Math.min(open, wholeCartons)
      if (!(offered > 0)) continue
      out.push({
        orderItemId: line.orderItemId,
        productId: line.productId,
        warehouseId: bin.warehouseId,
        warehouseCode: bin.warehouseCode,
        locationId: bin.locationId,
        code: bin.code,
        graphNodeId: bin.graphNodeId,
        allocatedQty: offered,
        pickedQty: 0,
        remaining: offered,
        unreserved: true,
      })
    }
  }
  return out
}

/**
 * Free stock per (product, bin) from raw balance rows, keeping only bins the given
 * warehouses draw from, each tagged with its warehouse. A bin outside every draw,
 * such as another warehouse's, is never offered.
 *
 * Free is `onHand - allocated`, clamped at zero PER ROW before summing, because the
 * database holds allocated <= on_hand per row and one corrupt row must not cancel a
 * neighbour's real stock. Bins with nothing free are dropped. A bin that appears
 * under two draws goes to the first.
 */
export function stockBinsInWarehouses(
  rows: readonly StockRow[],
  draws: readonly WarehouseDraw[],
): StockBin[] {
  const warehouseOf = new Map<number, WarehouseDraw>()
  for (const draw of draws) {
    for (const id of draw.locationIds) if (!warehouseOf.has(id)) warehouseOf.set(id, draw)
  }

  const bins = new Map<string, StockBin>()
  for (const row of rows) {
    const warehouse = warehouseOf.get(row.locationId)
    if (!warehouse) continue
    const free = Math.max(row.onHand - row.allocated, 0)
    const key = `${row.productId}:${row.locationId}`
    const existing = bins.get(key)
    if (existing) {
      bins.set(key, { ...existing, qtyBase: existing.qtyBase + free })
    } else {
      bins.set(key, {
        productId: row.productId,
        warehouseId: warehouse.warehouseId,
        warehouseCode: warehouse.warehouseCode,
        locationId: row.locationId,
        code: row.code,
        graphNodeId: row.graphNodeId,
        qtyBase: free,
      })
    }
  }
  return [...bins.values()].filter((b) => b.qtyBase > 0)
}

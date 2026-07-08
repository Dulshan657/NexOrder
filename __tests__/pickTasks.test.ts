import { describe, it, expect } from 'vitest'
import { buildPickTasks, type AllocBin, type OrderLine } from '../supabase/functions/_shared/wie/pickTasks'

function bin(overrides: Partial<AllocBin> & { locationId: number }): AllocBin {
  return {
    productId: 1,
    warehouseId: 1,
    warehouseCode: 'MAIN',
    code: `B-${overrides.locationId}`,
    graphNodeId: null,
    qtyBase: 0,
    ...overrides,
  }
}

function line(overrides: Partial<OrderLine> & { orderItemId: number }): OrderLine {
  return {
    productId: 1,
    quantity: 0,
    packSize: 1,
    ...overrides,
  }
}

describe('buildPickTasks', () => {
  it('builds one task for a single-bin allocation', () => {
    const tasks = buildPickTasks(
      [bin({ locationId: 1, qtyBase: 5 })],
      [line({ orderItemId: 100, quantity: 5 })],
      [],
    )
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      orderItemId: 100,
      locationId: 1,
      allocatedQty: 5,
      pickedQty: 0,
      remaining: 5,
    })
  })

  it('splits one line across multiple bins', () => {
    const tasks = buildPickTasks(
      [bin({ locationId: 1, qtyBase: 3 }), bin({ locationId: 2, qtyBase: 2 })],
      [line({ orderItemId: 100, quantity: 5 })],
      [],
    )
    expect(tasks).toHaveLength(2)
    const byLoc = new Map(tasks.map((t) => [t.locationId, t]))
    expect(byLoc.get(1)).toMatchObject({ allocatedQty: 3, remaining: 3 })
    expect(byLoc.get(2)).toMatchObject({ allocatedQty: 2, remaining: 2 })
  })

  it('splits one line across multiple warehouses, tagging each task with its warehouse', () => {
    const tasks = buildPickTasks(
      [
        bin({ locationId: 1, warehouseId: 10, warehouseCode: 'SYD', qtyBase: 3 }),
        bin({ locationId: 2, warehouseId: 20, warehouseCode: 'MEL', qtyBase: 2 }),
      ],
      [line({ orderItemId: 100, quantity: 5 })],
      [],
    )
    expect(tasks).toHaveLength(2)
    const byLoc = new Map(tasks.map((t) => [t.locationId, t]))
    expect(byLoc.get(1)).toMatchObject({ warehouseId: 10, warehouseCode: 'SYD', allocatedQty: 3 })
    expect(byLoc.get(2)).toMatchObject({ warehouseId: 20, warehouseCode: 'MEL', allocatedQty: 2 })
  })

  it('converts base units to line units via pack_size', () => {
    const tasks = buildPickTasks(
      [bin({ locationId: 1, qtyBase: 24 })], // 2 cartons of 12
      [line({ orderItemId: 100, quantity: 2, packSize: 12 })],
      [],
    )
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ allocatedQty: 2, remaining: 2 })
  })

  it('excludes a bin whose allocate/deallocate legs net to zero (or negative)', () => {
    const tasks = buildPickTasks(
      [bin({ locationId: 1, qtyBase: 0 }), bin({ locationId: 2, qtyBase: -1 })],
      [line({ orderItemId: 100, quantity: 5 })],
      [],
    )
    expect(tasks).toHaveLength(0)
  })

  it('drops bins for a product with no matching order line rather than fabricating a task', () => {
    const tasks = buildPickTasks(
      [bin({ locationId: 1, productId: 999, qtyBase: 5 })],
      [line({ orderItemId: 100, productId: 1, quantity: 5 })],
      [],
    )
    expect(tasks).toHaveLength(0)
  })

  it('attributes a shared bin across two lines of the same product, ascending order_item id, capped at each line quantity', () => {
    // place-order aggregates by product+pack_size, so one product can have a
    // unit line and a carton line — allocation is per-product, per-bin, not
    // per-line, so this attribution has to happen here.
    const tasks = buildPickTasks(
      [bin({ locationId: 1, qtyBase: 4 })],
      [
        line({ orderItemId: 20, quantity: 3 }), // higher id, but line1 (id 10) must fill first
        line({ orderItemId: 10, quantity: 2 }),
      ],
      [],
    )
    expect(tasks).toHaveLength(2)
    const byItem = new Map(tasks.map((t) => [t.orderItemId, t]))
    // Line 10 (ascending id) is capped at its own quantity (2), not the bin's total (4).
    expect(byItem.get(10)).toMatchObject({ allocatedQty: 2, remaining: 2 })
    // Line 20 gets whatever the bin has left (4 - 2 = 2), not its full quantity (3).
    expect(byItem.get(20)).toMatchObject({ allocatedQty: 2, remaining: 2 })
  })

  it('splits a multi-carton line across bins that hold whole cartons', () => {
    // 3-carton line (pack_size 12 -> 36 base): bin A holds 2 cartons (24 base),
    // bin B holds 1 (12 base). The common multi-bin carton case — each bin
    // floors cleanly to whole cartons and the totals reconcile to 3.
    const tasks = buildPickTasks(
      [bin({ locationId: 1, qtyBase: 24 }), bin({ locationId: 2, qtyBase: 12 })],
      [line({ orderItemId: 100, quantity: 3, packSize: 12 })],
      [],
    )
    expect(tasks).toHaveLength(2)
    const byLoc = new Map(tasks.map((t) => [t.locationId, t]))
    expect(byLoc.get(1)?.allocatedQty).toBe(2)
    expect(byLoc.get(2)?.allocatedQty).toBe(1)
    expect(tasks.reduce((s, t) => s + t.allocatedQty, 0)).toBe(3)
  })

  it('floors an off-pack-boundary straddle per bin instead of over-asking a bin', () => {
    // FIFO allocation landed off pack boundaries: bin A got 25 base (2.08
    // cartons), bin B got 10 (0.83). A bin can only supply the WHOLE cartons it
    // physically holds, so A -> 2, B -> 0 (its sub-carton 10 base is not a
    // pickable whole carton). We must NOT round B up to 1: directing a 1-carton
    // (12-base) pick at a bin holding 10 base would throw INSUFFICIENT_STOCK or
    // draw another order's stock. The line stays short (2 pickable), honestly
    // surfacing the awkward reservation rather than fabricating a 3rd carton.
    const tasks = buildPickTasks(
      [bin({ locationId: 1, qtyBase: 25 }), bin({ locationId: 2, qtyBase: 10 })],
      [line({ orderItemId: 100, quantity: 3, packSize: 12 })],
      [],
    )
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ locationId: 1, allocatedQty: 2, remaining: 2 })
    expect(tasks.reduce((s, t) => s + t.allocatedQty, 0)).toBe(2)
  })

  it('nets off recorded picks to compute remaining, and drops fully-picked bins', () => {
    const tasks = buildPickTasks(
      [bin({ locationId: 1, qtyBase: 3 }), bin({ locationId: 2, qtyBase: 2 })],
      [line({ orderItemId: 100, quantity: 5 })],
      [{ orderItemId: 100, locationId: 1, pickedQty: 3 }],
    )
    // Bin 1 is fully picked (3/3) and drops out of the actionable list; bin 2
    // still has its full 2 remaining.
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ locationId: 2, allocatedQty: 2, pickedQty: 0, remaining: 2 })
  })

  it('ignores a pick recorded at a bin with no allocation (orphaned pick) without crashing', () => {
    const tasks = buildPickTasks(
      [bin({ locationId: 1, qtyBase: 5 })],
      [line({ orderItemId: 100, quantity: 5 })],
      [{ orderItemId: 100, locationId: 999, pickedQty: 1 }],
    )
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ locationId: 1, allocatedQty: 5, pickedQty: 0, remaining: 5 })
  })
})

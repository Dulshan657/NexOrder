import { describe, it, expect } from 'vitest'
import {
  buildFallbackTasks,
  stockBinsInWarehouses,
  type OrderLine,
  type PickRecord,
  type PickTask,
  type StockBin,
  type StockRow,
} from '../../supabase/functions/_shared/wie/pickTasks'

// All data here is made up: a tiny two-warehouse site with a unit line and a
// carton line. Nothing is taken from any real customer's catalogue or racking.

function line(overrides: Partial<OrderLine> & { orderItemId: number }): OrderLine {
  return { productId: 1, quantity: 0, packSize: 1, ...overrides }
}

function stock(overrides: Partial<StockBin> & { locationId: number }): StockBin {
  return {
    productId: 1,
    warehouseId: 1,
    warehouseCode: 'TST-A',
    code: `TST-A-B${overrides.locationId}`,
    graphNodeId: null,
    qtyBase: 0,
    ...overrides,
  }
}

function task(overrides: Partial<PickTask> & { orderItemId: number; locationId: number }): PickTask {
  return {
    productId: 1,
    warehouseId: 1,
    warehouseCode: 'TST-A',
    code: `TST-A-B${overrides.locationId}`,
    graphNodeId: null,
    allocatedQty: 0,
    pickedQty: 0,
    remaining: 0,
    ...overrides,
  }
}

function pick(orderItemId: number, locationId: number, pickedQty: number): PickRecord {
  return { orderItemId, locationId, pickedQty }
}

describe('buildFallbackTasks', () => {
  it('offers bins with stock for the unreserved part of a line', () => {
    const tasks = buildFallbackTasks(
      [line({ orderItemId: 100, quantity: 5 })],
      [],
      [stock({ locationId: 11, qtyBase: 3 }), stock({ locationId: 12, qtyBase: 20 })],
      [],
      [],
    )
    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toMatchObject({
      orderItemId: 100,
      productId: 1,
      warehouseId: 1,
      warehouseCode: 'TST-A',
      locationId: 11,
      code: 'TST-A-B11',
      allocatedQty: 3,
      pickedQty: 0,
      remaining: 3,
      unreserved: true,
    })
    // A bin with more than the line needs is offered up to the open amount, never above it.
    expect(tasks[1]).toMatchObject({ locationId: 12, allocatedQty: 5, remaining: 5, unreserved: true })
  })

  it('offers nothing for a line already closed short', () => {
    const tasks = buildFallbackTasks(
      [line({ orderItemId: 100, quantity: 5 }), line({ orderItemId: 101, productId: 2, quantity: 2 })],
      [],
      [stock({ locationId: 11, qtyBase: 50 }), stock({ productId: 2, locationId: 12, qtyBase: 50 })],
      [],
      [100],
    )
    expect(tasks.map((t) => t.orderItemId)).toEqual([101])
  })

  it('offers nothing for a line that is fully picked', () => {
    const tasks = buildFallbackTasks(
      [line({ orderItemId: 100, quantity: 5 })],
      [],
      [stock({ locationId: 11, qtyBase: 50 })],
      [pick(100, 99, 2), pick(100, 98, 3)],
      [],
    )
    expect(tasks).toEqual([])
  })

  it('offers nothing when the reservation already covers the line', () => {
    const tasks = buildFallbackTasks(
      [line({ orderItemId: 100, quantity: 5 })],
      [task({ orderItemId: 100, locationId: 11, allocatedQty: 5, remaining: 5 })],
      [stock({ locationId: 12, qtyBase: 50 })],
      [],
      [],
    )
    expect(tasks).toEqual([])
  })

  it('offers only the part a part-picked line has neither picked nor reserved', () => {
    // 10 ordered: 4 already picked at bin 13 (its task is gone), 3 still reserved at bin 11.
    // The unreserved part is 10 - 4 - 3 = 3.
    const tasks = buildFallbackTasks(
      [line({ orderItemId: 100, quantity: 10 })],
      [task({ orderItemId: 100, locationId: 11, allocatedQty: 3, remaining: 3 })],
      [stock({ locationId: 12, qtyBase: 40 })],
      [pick(100, 13, 4)],
      [],
    )
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ locationId: 12, remaining: 3, allocatedQty: 3 })
  })

  it('counts a pick at a task bin once, not twice', () => {
    // Bin 11 reserved 6, 2 picked there: task remaining 4. 10 - 2 picked - 4 open = 4 unreserved.
    const tasks = buildFallbackTasks(
      [line({ orderItemId: 100, quantity: 10 })],
      [task({ orderItemId: 100, locationId: 11, allocatedQty: 6, pickedQty: 2, remaining: 4 })],
      [stock({ locationId: 12, qtyBase: 40 })],
      [pick(100, 11, 2)],
      [],
    )
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ locationId: 12, remaining: 4 })
  })

  it('does not offer a bin the line already has a task at', () => {
    // One row per bin per line: a second row at the same bin would be the same shelf twice.
    const tasks = buildFallbackTasks(
      [line({ orderItemId: 100, quantity: 10 })],
      [task({ orderItemId: 100, locationId: 11, allocatedQty: 6, remaining: 6 })],
      [stock({ locationId: 11, qtyBase: 40 }), stock({ locationId: 12, qtyBase: 40 })],
      [],
      [],
    )
    expect(tasks.map((t) => t.locationId)).toEqual([12])
  })

  it('does not count another line\'s tasks or picks against this line', () => {
    const tasks = buildFallbackTasks(
      [line({ orderItemId: 100, quantity: 5 }), line({ orderItemId: 101, quantity: 5 })],
      [task({ orderItemId: 101, locationId: 11, allocatedQty: 5, remaining: 5 })],
      [stock({ locationId: 12, qtyBase: 40 })],
      [pick(101, 99, 1)],
      [],
    )
    expect(tasks.map((t) => [t.orderItemId, t.remaining])).toEqual([[100, 5]])
  })

  describe('carton sizes', () => {
    const cartonLine = line({ orderItemId: 200, quantity: 4, packSize: 12 })

    it('floors each bin to the whole cartons it can hold', () => {
      const tasks = buildFallbackTasks(
        [cartonLine],
        [],
        // 30 base = 2 whole cartons (and 6 loose); 35 base is still 2, never rounded up to 3.
        [stock({ locationId: 11, qtyBase: 30 }), stock({ locationId: 12, qtyBase: 35 })],
        [],
        [],
      )
      expect(tasks.map((t) => [t.locationId, t.remaining])).toEqual([[11, 2], [12, 2]])
    })

    it('offers nothing from a bin that holds less than one carton', () => {
      const tasks = buildFallbackTasks([cartonLine], [], [stock({ locationId: 11, qtyBase: 11 })], [], [])
      expect(tasks).toEqual([])
    })

    it('never offers more cartons than the line has open', () => {
      const tasks = buildFallbackTasks([cartonLine], [], [stock({ locationId: 11, qtyBase: 1200 })], [], [])
      expect(tasks).toHaveLength(1)
      expect(tasks[0].remaining).toBe(4)
      expect(tasks[0].allocatedQty).toBe(4)
    })

    it('measures the open amount in line units, so picked cartons come off whole', () => {
      const tasks = buildFallbackTasks([cartonLine], [], [stock({ locationId: 11, qtyBase: 1200 })], [pick(200, 99, 3)], [])
      expect(tasks[0].remaining).toBe(1)
    })

    it('treats a missing pack size as one', () => {
      const unit = { orderItemId: 300, productId: 1, quantity: 2 } as OrderLine
      const tasks = buildFallbackTasks([unit], [], [stock({ locationId: 11, qtyBase: 9 })], [], [])
      expect(tasks[0].remaining).toBe(2)
    })

    it('sizes a unit line and a carton line of one product separately', () => {
      const tasks = buildFallbackTasks(
        [line({ orderItemId: 100, quantity: 5 }), cartonLine],
        [],
        [stock({ locationId: 11, qtyBase: 30 })],
        [],
        [],
      )
      expect(tasks.map((t) => [t.orderItemId, t.remaining])).toEqual([[100, 5], [200, 2]])
    })
  })

  describe('which bins, and in what order', () => {
    it('offers only stock of the line\'s own product', () => {
      const tasks = buildFallbackTasks(
        [line({ orderItemId: 100, productId: 1, quantity: 5 })],
        [],
        [stock({ productId: 2, locationId: 11, qtyBase: 99 }), stock({ productId: 1, locationId: 12, qtyBase: 99 })],
        [],
        [],
      )
      expect(tasks.map((t) => t.locationId)).toEqual([12])
    })

    it('skips bins with no stock', () => {
      const tasks = buildFallbackTasks(
        [line({ orderItemId: 100, quantity: 5 })],
        [],
        [stock({ locationId: 11, qtyBase: 0 }), stock({ locationId: 12, qtyBase: -3 }), stock({ locationId: 13, qtyBase: 1 })],
        [],
        [],
      )
      expect(tasks.map((t) => t.locationId)).toEqual([13])
    })

    it('orders by warehouse then bin, whatever order the stock arrives in', () => {
      const bins = [
        stock({ locationId: 31, warehouseId: 2, warehouseCode: 'TST-B', qtyBase: 5 }),
        stock({ locationId: 12, qtyBase: 5 }),
        stock({ locationId: 11, qtyBase: 5 }),
      ]
      const forward = buildFallbackTasks([line({ orderItemId: 100, quantity: 5 })], [], bins, [], [])
      const reversed = buildFallbackTasks([line({ orderItemId: 100, quantity: 5 })], [], [...bins].reverse(), [], [])
      expect(forward.map((t) => t.locationId)).toEqual([11, 12, 31])
      expect(reversed).toEqual(forward)
    })

    it('serves lines in order-line order', () => {
      const tasks = buildFallbackTasks(
        [line({ orderItemId: 102, productId: 2, quantity: 1 }), line({ orderItemId: 100, quantity: 1 })],
        [],
        [stock({ locationId: 11, qtyBase: 5 }), stock({ productId: 2, locationId: 12, qtyBase: 5 })],
        [],
        [],
      )
      expect(tasks.map((t) => t.orderItemId)).toEqual([100, 102])
    })
  })

  it('returns new tasks and leaves every input untouched', () => {
    const lines = [line({ orderItemId: 100, quantity: 5 })]
    const tasks = [task({ orderItemId: 100, locationId: 11, allocatedQty: 2, remaining: 2 })]
    const bins = [stock({ locationId: 12, qtyBase: 9 }), stock({ locationId: 13, qtyBase: 9 })]
    const picks = [pick(100, 99, 1)]
    const shorts: number[] = []
    const before = JSON.stringify([lines, tasks, bins, picks, shorts])

    const deepFreeze = <T,>(v: T): T => {
      if (v && typeof v === 'object') Object.values(v).forEach(deepFreeze)
      return Object.freeze(v)
    }
    const out = buildFallbackTasks(deepFreeze(lines), deepFreeze(tasks), deepFreeze(bins), deepFreeze(picks), deepFreeze(shorts))

    expect(JSON.stringify([lines, tasks, bins, picks, shorts])).toBe(before)
    expect(out).toHaveLength(2)
    expect(tasks).toHaveLength(1)
    // Fresh objects: changing one must not reach the stock row it came from.
    expect(bins.some((b) => (b as unknown) === (out[0] as unknown))).toBe(false)
  })
})

describe('stockBinsInWarehouses', () => {
  const row = (overrides: Partial<StockRow> & { locationId: number }): StockRow => ({
    productId: 1,
    code: `TST-A-B${overrides.locationId}`,
    graphNodeId: null,
    onHand: 0,
    allocated: 0,
    ...overrides,
  })
  const draws = [{ warehouseId: 1, warehouseCode: 'TST-A', locationIds: [1, 11, 12] }]

  it('offers free stock, not what other orders hold', () => {
    const bins = stockBinsInWarehouses([row({ locationId: 11, onHand: 10, allocated: 4 })], draws)
    expect(bins).toEqual([
      { productId: 1, warehouseId: 1, warehouseCode: 'TST-A', locationId: 11, code: 'TST-A-B11', graphNodeId: null, qtyBase: 6 },
    ])
  })

  it('adds the batches of one product at one bin together', () => {
    const bins = stockBinsInWarehouses(
      [row({ locationId: 11, onHand: 5 }), row({ locationId: 11, onHand: 7, allocated: 2 })],
      draws,
    )
    expect(bins).toHaveLength(1)
    expect(bins[0].qtyBase).toBe(10)
  })

  it('does not offer another warehouse\'s stock', () => {
    const bins = stockBinsInWarehouses(
      [row({ locationId: 11, onHand: 5 }), row({ locationId: 31, onHand: 50 })],
      draws,
    )
    expect(bins.map((b) => b.locationId)).toEqual([11])
  })

  it('names the warehouse each bin belongs to when the order is fulfilled from two', () => {
    const bins = stockBinsInWarehouses(
      [row({ locationId: 11, onHand: 5 }), row({ locationId: 31, onHand: 5 })],
      [...draws, { warehouseId: 2, warehouseCode: 'TST-B', locationIds: [2, 31] }],
    )
    expect(bins.map((b) => [b.locationId, b.warehouseId, b.warehouseCode])).toEqual([
      [11, 1, 'TST-A'],
      [31, 2, 'TST-B'],
    ])
  })

  it('drops bins with nothing free', () => {
    const bins = stockBinsInWarehouses(
      [row({ locationId: 11, onHand: 5, allocated: 5 }), row({ locationId: 12, onHand: 0 })],
      draws,
    )
    expect(bins).toEqual([])
  })

  it('never offers a held location, whoever else has stock', () => {
    const bins = stockBinsInWarehouses(
      [row({ locationId: 11, onHand: 40 }), row({ locationId: 12, onHand: 4 })],
      draws,
      new Set([11]),
    )
    expect(bins.map((b) => b.locationId)).toEqual([12])
  })

  it('offers everything when nothing is held', () => {
    const rows = [row({ locationId: 11, onHand: 40 }), row({ locationId: 12, onHand: 4 })]
    expect(stockBinsInWarehouses(rows, draws, new Set())).toEqual(stockBinsInWarehouses(rows, draws))
  })

  it('never lets one over-allocated row cancel another\'s free stock', () => {
    const bins = stockBinsInWarehouses(
      [row({ locationId: 11, onHand: 5, allocated: 9 }), row({ locationId: 11, onHand: 6 })],
      draws,
    )
    expect(bins[0].qtyBase).toBe(6)
  })
})

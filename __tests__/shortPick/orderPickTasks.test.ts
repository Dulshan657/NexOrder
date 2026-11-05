import { describe, it, expect, vi } from 'vitest'
import { loadOrderPickTasks } from '../../supabase/functions/_shared/orderPickTasks'
import { buildPickTasks } from '../../supabase/functions/_shared/wie/pickTasks'

// order-pick-tasks, with the database faked. All rows are made up: two small
// warehouses (ids 1 and 2) and one more (id 3) the order is not fulfilled from.

type Row = Record<string, unknown>
interface Db {
  tables: Record<string, Row[]>
  rpc: Record<string, (args: Row) => Row[]>
  fail?: string
}

/** Just enough of a PostgREST query builder: filters, paging and an awaitable result. */
function fakeAdmin(db: Db) {
  const reads: string[] = []
  /** Every query, with the `in` filters it carried: what was asked of the database. */
  const calls: Array<{ table: string; in: Record<string, unknown[]> }> = []
  const from = (table: string) => {
    reads.push(table)
    const call = { table, in: {} as Record<string, unknown[]> }
    calls.push(call)
    let rows = [...(db.tables[table] ?? [])]
    const result = () =>
      db.fail === table
        ? { data: null, error: { message: `${table} is down` } }
        : { data: rows, error: null }
    const builder: Record<string, unknown> = {}
    const chain = (fn: () => void) => () => {
      fn()
      return builder
    }
    builder.select = chain(() => {})
    builder.order = chain(() => {})
    builder.eq = (col: string, v: unknown) => {
      rows = rows.filter((r) => r[col] === v)
      return builder
    }
    builder.in = (col: string, vs: unknown[]) => {
      call.in[col] = vs
      rows = rows.filter((r) => vs.includes(r[col]))
      return builder
    }
    builder.gt = (col: string, n: number) => {
      rows = rows.filter((r) => Number(r[col]) > n)
      return builder
    }
    builder.range = (a: number, b: number) => {
      rows = rows.slice(a, b + 1)
      return builder
    }
    builder.maybeSingle = async () => {
      const r = result()
      return r.error ? r : { data: (rows[0] as Row | undefined) ?? null, error: null }
    }
    builder.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(ok, bad)
    return builder
  }
  const rpc = vi.fn(async (name: string, args: Row) => {
    const fn = db.rpc[name]
    return fn ? { data: fn(args), error: null } : { data: null, error: { message: `no rpc ${name}` } }
  })
  return { admin: { from, rpc } as never, reads, rpc, calls }
}

const ORDER = 'ORD-TEST-1'
const ALLOC = (productId: number, warehouseId: number, locationId: number, qty: number) => ({
  product_id: productId,
  warehouse_id: warehouseId,
  warehouse_code: `TST-${warehouseId}`,
  location_id: locationId,
  code: `TST-${warehouseId}-B${locationId}`,
  graph_node_id: null,
  qty_base: qty,
})

function baseDb(over: { invoice?: string | null } = {}): Db {
  return {
    tables: {
      orders: [{ id: ORDER, qb_invoice_number: over.invoice === undefined ? 'INV-9001' : over.invoice }],
      order_items: [
        { id: 100, order_id: ORDER, product_id: 1, quantity: 5, pack_size: 1 },
        { id: 101, order_id: ORDER, product_id: 2, quantity: 3, pack_size: 1 },
      ],
      pick_progress: [],
      pick_differences: [],
      order_fulfillments: [
        { order_id: ORDER, location_id: 1 },
        { order_id: ORDER, location_id: 2 },
      ],
      locations: [
        { id: 1, code: 'TST-1' }, { id: 2, code: 'TST-2' }, { id: 3, code: 'TST-3' },
        { id: 11, code: 'TST-1-B11' }, { id: 12, code: 'TST-1-B12' },
        { id: 21, code: 'TST-2-B21' }, { id: 31, code: 'TST-3-B31' },
      ],
      inventory_balances: [],
    },
    rpc: {
      wie_order_pick_tasks: () => [],
      inv_warehouse_draw_locations: ({ p_warehouse_id }) =>
        ({ 1: [1, 11, 12], 2: [2, 21], 3: [3, 31] } as Record<number, number[]>)[p_warehouse_id as number].map(
          (location_id) => ({ location_id }),
        ),
    },
  }
}

const balance = (productId: number, locationId: number, onHand: number, allocated = 0) => ({
  product_id: productId, location_id: locationId, on_hand: onHand, allocated, id: productId * 1000 + locationId,
})

describe('loadOrderPickTasks: an order with no invoice number', () => {
  it('answers as before, plus imported:false and an empty list, and reads nothing else', async () => {
    const db = baseDb({ invoice: null })
    db.rpc.wie_order_pick_tasks = () => [ALLOC(1, 1, 11, 5)]
    db.tables.pick_differences = [{ order_id: ORDER, order_item_id: 100, kind: 'short' }]
    db.tables.inventory_balances = [balance(2, 12, 40)]
    const { admin, reads, rpc } = fakeAdmin(db)

    const body = await loadOrderPickTasks(admin, ORDER)

    const expected = buildPickTasks(
      [{ productId: 1, warehouseId: 1, warehouseCode: 'TST-1', locationId: 11, code: 'TST-1-B11', graphNodeId: null, qtyBase: 5 }],
      [
        { orderItemId: 100, productId: 1, quantity: 5, packSize: 1 },
        { orderItemId: 101, productId: 2, quantity: 3, packSize: 1 },
      ],
      [],
    )
    expect(body).toStrictEqual({ tasks: expected, imported: false, closedShortLineIds: [] })
    // The imported branch never ran: no differences, no fulfilments, no stock, no expansion.
    for (const table of ['pick_differences', 'order_fulfillments', 'inventory_balances']) {
      expect(reads).not.toContain(table)
    }
    expect(rpc).not.toHaveBeenCalledWith('inv_warehouse_draw_locations', expect.anything())
  })

  it('treats an order the database does not know as not imported', async () => {
    const db = baseDb()
    db.tables.orders = []
    const { admin } = fakeAdmin(db)
    expect((await loadOrderPickTasks(admin, ORDER)).imported).toBe(false)
  })
})

describe('loadOrderPickTasks: an imported order', () => {
  it('appends bins with stock for the unreserved part, beside the reserved tasks', async () => {
    const db = baseDb()
    db.rpc.wie_order_pick_tasks = () => [ALLOC(1, 1, 11, 2)] // 2 of line 100's 5 reserved at bin 11
    db.tables.inventory_balances = [balance(1, 12, 40), balance(2, 21, 1)]
    const { admin } = fakeAdmin(db)

    const body = await loadOrderPickTasks(admin, ORDER)

    expect(body.imported).toBe(true)
    expect(body.closedShortLineIds).toEqual([])
    const view = body.tasks.map((t) => [t.orderItemId, t.locationId, t.remaining, t.unreserved ?? false])
    expect(view).toEqual([
      [100, 11, 2, false], // reserved
      [100, 12, 3, true], // 5 - 2 reserved = 3 unreserved, from bin 12
      [101, 21, 1, true], // line 101 has nothing reserved: bin 21 holds 1
    ])
    const fallback = body.tasks.find((t) => t.locationId === 12)!
    expect(fallback).toMatchObject({ code: 'TST-1-B12', warehouseId: 1, warehouseCode: 'TST-1', productId: 1 })
  })

  it('never offers stock under a warehouse the order is not fulfilled from', async () => {
    const db = baseDb()
    db.tables.inventory_balances = [balance(1, 31, 99), balance(1, 12, 4)]
    const { admin } = fakeAdmin(db)

    const body = await loadOrderPickTasks(admin, ORDER)

    expect(body.tasks.map((t) => t.locationId)).toEqual([12])
  })

  it('offers free stock only: what other orders hold is not on offer', async () => {
    const db = baseDb()
    db.tables.inventory_balances = [balance(1, 11, 10, 10), balance(1, 12, 10, 7)]
    const { admin } = fakeAdmin(db)

    const body = await loadOrderPickTasks(admin, ORDER)

    expect(body.tasks.map((t) => [t.locationId, t.remaining])).toEqual([[12, 3]])
  })

  it('reports lines closed short and offers them nothing', async () => {
    const db = baseDb()
    db.tables.pick_differences = [{ order_id: ORDER, order_item_id: 100, kind: 'short' }]
    db.tables.pick_progress = [{ order_id: ORDER, order_item_id: 100, location_id: 11, picked_qty: 2 }]
    db.tables.inventory_balances = [balance(1, 12, 40), balance(2, 21, 40)]
    const { admin } = fakeAdmin(db)

    const body = await loadOrderPickTasks(admin, ORDER)

    expect(body.closedShortLineIds).toEqual([100])
    expect(body.tasks.map((t) => t.orderItemId)).toEqual([101])
  })

  it('ignores differences that are not a short close', async () => {
    const db = baseDb()
    db.tables.pick_differences = [{ order_id: ORDER, order_item_id: 100, kind: 'unrecorded_stock' }]
    const { admin } = fakeAdmin(db)
    expect((await loadOrderPickTasks(admin, ORDER)).closedShortLineIds).toEqual([])
  })

  it('returns the found quantity of every line, zero for a line nothing was picked on', async () => {
    const db = baseDb()
    db.tables.pick_progress = [
      { order_id: ORDER, order_item_id: 100, location_id: 11, picked_qty: 2 },
      { order_id: ORDER, order_item_id: 100, location_id: 12, picked_qty: 1 },
    ]
    const { admin } = fakeAdmin(db)

    const body = await loadOrderPickTasks(admin, ORDER)

    expect(body.foundByLine).toEqual({ '100': 3, '101': 0 })
  })

  it('keeps a line with no tasks and no stock: still reported, still open', async () => {
    const db = baseDb()
    const { admin } = fakeAdmin(db)

    const body = await loadOrderPickTasks(admin, ORDER)

    expect(body.tasks).toEqual([])
    expect(body.closedShortLineIds).toEqual([])
    expect(Object.keys(body.foundByLine ?? {}).sort()).toEqual(['100', '101'])
  })

  it('does not look for stock of a line that is already fully picked', async () => {
    const db = baseDb()
    db.tables.pick_progress = [{ order_id: ORDER, order_item_id: 100, location_id: 11, picked_qty: 5 }]
    db.tables.inventory_balances = [balance(1, 12, 40)]
    const { admin } = fakeAdmin(db)

    expect((await loadOrderPickTasks(admin, ORDER)).tasks).toEqual([])
  })

  it('offers nothing, and does not fail, when no warehouse is fulfilling the order yet', async () => {
    const db = baseDb()
    db.tables.order_fulfillments = []
    db.tables.inventory_balances = [balance(1, 12, 40)]
    const { admin } = fakeAdmin(db)

    const body = await loadOrderPickTasks(admin, ORDER)

    expect(body).toMatchObject({ imported: true, tasks: [], closedShortLineIds: [] })
  })

  it('reads every page of stock rows', async () => {
    const db = baseDb()
    db.tables.inventory_balances = [
      balance(1, 11, 1), balance(1, 12, 1), balance(2, 21, 1), balance(1, 31, 1), balance(2, 11, 1),
    ]
    const { admin } = fakeAdmin(db)

    const body = await loadOrderPickTasks(admin, ORDER, { pageSize: 2 })

    expect(body.tasks.map((t) => [t.orderItemId, t.locationId]).sort()).toEqual([
      [100, 11], [100, 12], [101, 11], [101, 21],
    ])
  })

  it('refuses to answer with half a picture when a read fails', async () => {
    const db = baseDb()
    db.fail = 'pick_differences'
    const { admin } = fakeAdmin(db)
    await expect(loadOrderPickTasks(admin, ORDER)).rejects.toMatchObject({ code: 'INTERNAL' })
  })
})

// ── review round: closed lines own no reservation, held stock is never offered ──

describe('loadOrderPickTasks: reserved tasks belong to open lines only', () => {
  // One product on two lines, 5 each. Line 10 was closed short, so it needs nothing; the
  // 5 still reserved at bin 7 are line 11's. Attributing by ascending line id without
  // dropping the closed line would hand them to line 10, which renders no tasks, and
  // leave line 11 with no bin at all.
  const twoLines = (): Db => {
    const db = baseDb()
    db.tables.order_items = [
      { id: 10, order_id: ORDER, product_id: 1, quantity: 5, pack_size: 1 },
      { id: 11, order_id: ORDER, product_id: 1, quantity: 5, pack_size: 1 },
    ]
    db.tables.pick_differences = [{ order_id: ORDER, order_item_id: 10, kind: 'short' }]
    db.tables.locations = [...(db.tables.locations as Row[]), { id: 7, code: 'TST-1-B7' }]
    db.rpc.wie_order_pick_tasks = () => [ALLOC(1, 1, 7, 5)]
    return db
  }

  it('gives the reserved bin to the open line and nothing to the closed one', async () => {
    const { admin } = fakeAdmin(twoLines())

    const body = await loadOrderPickTasks(admin, ORDER)

    expect(body.closedShortLineIds).toEqual([10])
    expect(body.tasks.map((t) => [t.orderItemId, t.locationId, t.remaining, t.unreserved ?? false])).toEqual([
      [11, 7, 5, false],
    ])
  })

  it('still does when the closed line had picked some before it was closed', async () => {
    // Line 10 found 2 at bin 7 and was closed, its other 3 released: 10 allocated, 3 given
    // back, 7 net at the bin = the 2 line 10 took plus the 5 line 11 still needs.
    const db = twoLines()
    db.rpc.wie_order_pick_tasks = () => [ALLOC(1, 1, 7, 7)]
    db.tables.pick_progress = [{ order_id: ORDER, order_item_id: 10, location_id: 7, picked_qty: 2 }]
    const { admin } = fakeAdmin(db)

    const body = await loadOrderPickTasks(admin, ORDER)

    expect(body.tasks.map((t) => [t.orderItemId, t.locationId, t.remaining])).toEqual([[11, 7, 5]])
    expect(body.foundByLine).toEqual({ '10': 2, '11': 0 })
  })

  it('leaves an ordinary order\'s attribution exactly as it was', async () => {
    // No differences exist for such an order, so nothing is dropped, and the lowest line
    // id still takes a bin first.
    const db = twoLines()
    db.tables.orders = [{ id: ORDER, qb_invoice_number: null }]
    const { admin } = fakeAdmin(db)

    const body = await loadOrderPickTasks(admin, ORDER)

    expect(body.tasks.map((t) => [t.orderItemId, t.locationId, t.remaining])).toEqual([[10, 7, 5]])
  })
})

describe('loadOrderPickTasks: held stock is never offered', () => {
  const heldDb = (): Db => {
    const db = baseDb()
    // Bin 11 sits under a quarantine zone: on hand, but not for sale. inv_reserve_order skips it.
    db.tables.v_held_locations = [{ location_id: 11 }]
    db.tables.inventory_balances = [balance(1, 11, 40), balance(1, 12, 4)]
    return db
  }

  it('skips a bin under a hold zone and offers the next', async () => {
    const { admin } = fakeAdmin(heldDb())

    const body = await loadOrderPickTasks(admin, ORDER)

    expect(body.tasks.map((t) => [t.locationId, t.remaining])).toEqual([[12, 4]])
  })

  it('reads the hold state from v_held_locations, the one definition allocation uses', async () => {
    const { admin, reads } = fakeAdmin(heldDb())
    await loadOrderPickTasks(admin, ORDER)
    expect(reads).toContain('v_held_locations')
  })

  it('offers nothing at all when every bin with stock is held', async () => {
    const db = heldDb()
    db.tables.v_held_locations = [{ location_id: 11 }, { location_id: 12 }]
    const { admin } = fakeAdmin(db)
    expect((await loadOrderPickTasks(admin, ORDER)).tasks).toEqual([])
  })

  it('fails closed: if the hold state cannot be read, nothing is offered by guesswork', async () => {
    const db = heldDb()
    db.fail = 'v_held_locations'
    const { admin } = fakeAdmin(db)
    await expect(loadOrderPickTasks(admin, ORDER)).rejects.toMatchObject({ code: 'INTERNAL' })
  })

  it('does not look at the hold view for an ordinary order', async () => {
    const db = heldDb()
    db.tables.orders = [{ id: ORDER, qb_invoice_number: null }]
    const { admin, reads } = fakeAdmin(db)
    await loadOrderPickTasks(admin, ORDER)
    expect(reads).not.toContain('v_held_locations')
  })
})

describe('loadOrderPickTasks: the stock read is scoped and says when it stops short', () => {
  it('asks only for the bins of the warehouses the order is fulfilled from', async () => {
    const db = baseDb()
    db.tables.inventory_balances = [balance(1, 12, 4), balance(1, 31, 99)]
    const { admin, calls } = fakeAdmin(db)

    await loadOrderPickTasks(admin, ORDER)

    const stock = calls.filter((c) => c.table === 'inventory_balances')
    const asked = new Set(stock.flatMap((c) => (c.in.location_id ?? []) as number[]))
    expect([...asked].sort((a, b) => a - b)).toEqual([1, 2, 11, 12, 21])
    expect(asked.has(31)).toBe(false)
    // Every stock query carries a location filter: none reads the whole table by product.
    expect(stock.every((c) => c.in.location_id)).toBe(true)
  })

  it('splits a long bin list across several queries and still finds all of it', async () => {
    const db = baseDb()
    db.tables.inventory_balances = [balance(1, 11, 2), balance(1, 12, 3), balance(2, 21, 1)]
    const { admin, calls } = fakeAdmin(db)

    const body = await loadOrderPickTasks(admin, ORDER, { chunkSize: 2 })

    const stock = calls.filter((c) => c.table === 'inventory_balances')
    expect(stock.length).toBeGreaterThan(1)
    expect(stock.every((c) => (c.in.location_id ?? []).length <= 2)).toBe(true)
    expect(body.tasks.map((t) => [t.orderItemId, t.locationId, t.remaining]).sort()).toEqual([
      [100, 11, 2], [100, 12, 3], [101, 21, 1],
    ])
  })

  it('logs, rather than silently truncating, when it stops at the page ceiling', async () => {
    const db = baseDb()
    db.tables.inventory_balances = [balance(1, 11, 1), balance(1, 12, 1), balance(2, 21, 1)]
    const { admin } = fakeAdmin(db)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    const body = await loadOrderPickTasks(admin, ORDER, { pageSize: 1, maxPages: 1, chunkSize: 100 })

    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0][0])).toMatch(/order-pick-tasks.*stock.*stopped.*page/i)
    // What it did read is still offered; the reserved tasks are never at risk.
    expect(body.imported).toBe(true)
    log.mockRestore()
  })

  it('stays quiet when the stock fits', async () => {
    const db = baseDb()
    db.tables.inventory_balances = [balance(1, 11, 1)]
    const { admin } = fakeAdmin(db)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await loadOrderPickTasks(admin, ORDER)
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })
})

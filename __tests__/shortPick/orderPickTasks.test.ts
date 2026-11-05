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
  const from = (table: string) => {
    reads.push(table)
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
  return { admin: { from, rpc } as never, reads, rpc }
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

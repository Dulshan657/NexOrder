/**
 * NX-0026 fix round: other orders' stock, input validation, fulfilments and prices,
 * against the live database. Rolled back like qbImportTx.integration.test.ts.
 *
 * Run with: `npx vitest run -c vitest.integration.config.ts qbImportTx`
 */
import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { expectRaise, withRollbackTx } from './support/pgTestClient'
import {
  allocatedAt,
  callImport,
  callUpdate,
  convertRack,
  fulfilmentsOf,
  importRow,
  itemsOf,
  line,
  netOf,
  newBatch,
  newInvoice,
  newPlate,
  newProduct,
  newWarehouse,
  onHandOf,
  orderRow,
  plainOrder,
  receive,
  seed,
  snapshot,
  type Scene,
} from './support/qbImportTxHelpers'

const UPDATE_SQL = `SELECT public.qb_update_invoice_tx($1, $2, '2026-10-01'::date, $3::jsonb, $4, $5::int[])`
const UNKNOWN_ACTOR = '00000000-0000-4000-8000-000000000000'

async function batchAllocated(client: pg.Client, productId: number, batchId: number): Promise<number> {
  const r = await client.query<{ q: number }>(
    'SELECT COALESCE(SUM(allocated),0)::numeric AS q FROM public.inventory_balances WHERE product_id=$1 AND batch_id=$2',
    [productId, batchId],
  )
  return r.rows[0].q
}

async function callWith(
  client: pg.Client,
  fn: string,
  args: [string, number | null, string | null, unknown, string | null, number[] | null],
  pattern: RegExp,
): Promise<void> {
  const [number, horeca, date, lines, actor, pref] = args
  await expectRaise(
    client,
    `SELECT public.${fn}($1, $2, $3::date, $4::jsonb, $5, $6::int[])`,
    [number, horeca, date, JSON.stringify(lines), actor, pref],
    pattern,
  )
}

/** Mark an order processed with a fulfilment at one warehouse, as Mode A would. */
async function markProcessed(
  client: pg.Client, s: Scene, orderId: string, warehouseId: number, status = 'processed',
): Promise<void> {
  await client.query("UPDATE public.orders SET status='processed' WHERE id=$1", [orderId])
  await client.query(
    `INSERT INTO public.order_fulfillments (order_id, location_id, status, status_history)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [orderId, warehouseId, status, JSON.stringify([{ status, timestamp: '2026-10-01T00:00:00.000Z', actor: s.actor }])],
  )
}

describe('NX-0026 import transactions: fix round (live RPCs, rollback-isolated)', () => {
  describe("another order's reservation", () => {
    it("raises when a third order's pick from the bin leaves too little for the order that did not move", async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 10)
        await receive(client, p, s.binB, 5)
        const z = await plainOrder(client, s, p, 5)
        const x = newInvoice()
        const xOrder = `QB-${x}`
        await callImport(client, s, x, [line(p, 5)])
        const y = await plainOrder(client, s, p, 5)
        expect(await netOf(client, z.orderId, p, s.binA)).toBe(5)
        expect(await netOf(client, xOrder, p, s.binA)).toBe(5)
        expect(await netOf(client, y.orderId, p, s.binB)).toBe(5)
        expect(await allocatedAt(client, p, s.binA)).toBe(10)

        // Y's reservation is in bin B, but it picks from bin A.
        await client.query('SELECT public.inv_pick_order_line($1, 5, $2, $3)', [y.itemId, s.binA, s.actor])
        expect(await allocatedAt(client, p, s.binA)).toBe(5)
        const before = await snapshot(client, xOrder, x, p)

        await expectRaise(
          client, UPDATE_SQL,
          [x, s.horecaId, JSON.stringify([line(p, 2)]), s.actor, [s.warehouseId]],
          /^QB_ALLOCATION_MISMATCH:/,
        )

        expect(await snapshot(client, xOrder, x, p)).toEqual(before)
        expect(await allocatedAt(client, p, s.binA)).toBe(5)
        expect(await netOf(client, z.orderId, p, s.binA)).toBe(5)
      })
    })

    it('does not raise where another order has finished an ordinary pick in the same bin', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 10)
        const done = await plainOrder(client, s, p, 5)
        const x = newInvoice()
        const xOrder = `QB-${x}`
        await callImport(client, s, x, [line(p, 5)])
        await client.query('SELECT public.inv_pick_order_line($1, 5, $2, $3)', [done.itemId, s.binA, s.actor])
        expect(await allocatedAt(client, p, s.binA)).toBe(5)

        expect((await callUpdate(client, s, x, [line(p, 2)])).status).toBe('updated')

        expect(await allocatedAt(client, p, s.binA)).toBe(2)
        expect(await netOf(client, xOrder, p)).toBe(2)
        expect(await onHandOf(client, p)).toBe(5)
      })
    })

    it('counts only the unpicked part of a partly picked order, and that part stays reserved', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 10)
        const part = await plainOrder(client, s, p, 5)
        const x = newInvoice()
        await callImport(client, s, x, [line(p, 5)])
        await client.query('SELECT public.inv_pick_order_line($1, 2, $2, $3)', [part.itemId, s.binA, s.actor])
        expect(await allocatedAt(client, p, s.binA)).toBe(8)

        expect((await callUpdate(client, s, x, [line(p, 1)])).status).toBe('updated')

        expect(await allocatedAt(client, p, s.binA)).toBe(4)
      })
    })

    it('does not count a dispatched order that was never released as still holding', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 10)
        const gone = await plainOrder(client, s, p, 5)
        const x = newInvoice()
        await callImport(client, s, x, [line(p, 5)])
        // A third order's pick removed the allocated count that `gone` still nets,
        // and `gone` has since left the building: it holds nothing now.
        const third = await plainOrder(client, s, p, 5, false)
        await client.query('SELECT public.inv_pick_order_line($1, 5, $2, $3)', [third.itemId, s.binA, s.actor])
        await client.query("UPDATE public.orders SET status='dispatched' WHERE id=$1", [gone.orderId])
        expect(await allocatedAt(client, p, s.binA)).toBe(5)

        expect((await callUpdate(client, s, x, [line(p, 2)])).status).toBe('updated')

        expect(await allocatedAt(client, p, s.binA)).toBe(2)
      })
    })
  })

  describe('the guard and the release work per product and bin', () => {
    it("raises after a rack conversion leaves another order's holding on a different ledger key in the bin", async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        const batch = await newBatch(client, p, '2030-01-01')
        await receive(client, p, s.binA, 15, { batchId: batch })
        const y = await plainOrder(client, s, p, 5)
        // Y's balance moves to level 1 on its batch; its ledger moves to the NULL-batch key.
        const l1 = await convertRack(client, s, s.binA)
        expect(await allocatedAt(client, p, l1)).toBe(5)
        expect(await netOf(client, y.orderId, p, l1)).toBe(5)

        const x = newInvoice()
        const xOrder = `QB-${x}`
        await callImport(client, s, x, [line(p, 5)])
        expect(await netOf(client, xOrder, p, l1)).toBe(5)
        expect(await allocatedAt(client, p, l1)).toBe(10)
        const z = await plainOrder(client, s, p, 5, false)
        await client.query('SELECT public.inv_pick_order_line($1, 5, $2, $3)', [z.itemId, l1, s.actor])
        expect(await allocatedAt(client, p, l1)).toBe(5)
        const before = await snapshot(client, xOrder, x, p)

        await expectRaise(
          client, UPDATE_SQL,
          [x, s.horecaId, JSON.stringify([line(p, 2)]), s.actor, [s.warehouseId]],
          /^QB_ALLOCATION_MISMATCH:/,
        )

        expect(await snapshot(client, xOrder, x, p)).toEqual(before)
        expect(await allocatedAt(client, p, l1)).toBe(5)
        expect(await netOf(client, y.orderId, p, l1)).toBe(5)
      })
    })

    it('updates an order whose own reservation went through a rack conversion', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        const batch = await newBatch(client, p, '2030-01-01')
        await receive(client, p, s.binA, 10, { batchId: batch })
        const x = newInvoice()
        const xOrder = `QB-${x}`
        await callImport(client, s, x, [line(p, 5)])
        const l1 = await convertRack(client, s, s.binA)

        expect((await callUpdate(client, s, x, [line(p, 2)])).status).toBe('updated')

        expect(await allocatedAt(client, p, l1)).toBe(2)
        expect(await netOf(client, xOrder, p)).toBe(2)
        expect(await onHandOf(client, p)).toBe(10)
      })
    })

    it('updates when a later order picked first from this order\'s batch, leaving the bin figures whole', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        const soon = await newBatch(client, p, '2030-01-01')
        const late = await newBatch(client, p, '2031-01-01')
        await receive(client, p, s.binA, 5, { batchId: soon })
        await receive(client, p, s.binA, 5, { batchId: late })
        const x = newInvoice()
        const xOrder = `QB-${x}`
        await callImport(client, s, x, [line(p, 5)])
        const y = await plainOrder(client, s, p, 5)
        // Picks draw by expiry, not by who reserved: Y takes X's batch.
        await client.query('SELECT public.inv_pick_order_line($1, 5, $2, $3)', [y.itemId, s.binA, s.actor])
        expect(await allocatedAt(client, p, s.binA)).toBe(5)

        expect((await callUpdate(client, s, x, [line(p, 3)])).status).toBe('updated')

        expect(await allocatedAt(client, p, s.binA)).toBe(3)
        expect(await netOf(client, xOrder, p, s.binA)).toBe(3)
        expect(await netOf(client, y.orderId, p, s.binA)).toBe(5)
        expect(await onHandOf(client, p)).toBe(5)
      })
    })

    it("keeps the unpicked part of a later order's reservation when it picked from this order's plate", async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        const first = await newPlate(client, s, s.binA)
        const second = await newPlate(client, s, s.binA)
        await receive(client, p, s.binA, 5, { huId: first })
        await receive(client, p, s.binA, 5, { huId: second })
        const x = newInvoice()
        const xOrder = `QB-${x}`
        await callImport(client, s, x, [line(p, 5)])
        const y = await plainOrder(client, s, p, 5)
        await client.query('SELECT public.inv_pick_order_line($1, 2, $2, $3)', [y.itemId, s.binA, s.actor])
        expect(await allocatedAt(client, p, s.binA)).toBe(8)

        expect((await callUpdate(client, s, x, [line(p, 1)])).status).toBe('updated')

        // Y still holds the 3 it has not picked, and X holds its new 1.
        expect(await allocatedAt(client, p, s.binA)).toBe(4)
        expect(await netOf(client, xOrder, p, s.binA)).toBe(1)
        expect(await onHandOf(client, p)).toBe(8)
      })
    })

    it("reverses this order's own rows by its own share, leaving other orders' rows as they were", async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        const late = await newBatch(client, p, '2031-01-01')
        const soon = await newBatch(client, p, '2030-01-01')
        // The late batch has the lower row id, so going by row id alone would start there.
        await receive(client, p, s.binA, 3, { batchId: late })
        await receive(client, p, s.binA, 3, { batchId: soon })
        const y = await plainOrder(client, s, p, 1)
        const x = newInvoice()
        await callImport(client, s, x, [line(p, 3)])
        const z = await plainOrder(client, s, p, 1)
        // soon: Y 1 + X 2. late: X 1 + Z 1.
        expect(await batchAllocated(client, p, soon)).toBe(3)
        expect(await batchAllocated(client, p, late)).toBe(2)

        // Moving X to another product shows where the release itself landed.
        const q = await newProduct(client, s.supplierId)
        await callUpdate(client, s, x, [line(q, 1)])

        expect(await batchAllocated(client, p, soon)).toBe(1)
        expect(await batchAllocated(client, p, late)).toBe(1)
        expect(await netOf(client, y.orderId, p)).toBe(1)
        expect(await netOf(client, z.orderId, p)).toBe(1)
        expect(await netOf(client, `QB-${x}`, p)).toBe(0)
      })
    })
  })

  describe('warehouse preference', () => {
    it('raises QB_BAD_LOCATION for a missing warehouse, a bin, an inactive warehouse and a NULL id', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 10)
        const inactive = await newWarehouse(client)
        await client.query('UPDATE public.locations SET is_active=false WHERE id=$1', [inactive.warehouseId])
        const x = newInvoice()
        const xOrder = `QB-${x}`
        await callImport(client, s, x, [line(p, 5)])
        const before = await snapshot(client, xOrder, x, p)

        for (const pref of [[999999999], [s.warehouseId, 999999999], [s.binA], [inactive.warehouseId]]) {
          await callWith(
            client, 'qb_import_invoice_tx',
            [newInvoice(), s.horecaId, '2026-10-01', [line(p, 1)], s.actor, pref], /^QB_BAD_LOCATION:/,
          )
          await callWith(
            client, 'qb_update_invoice_tx',
            [x, s.horecaId, '2026-10-01', [line(p, 1)], s.actor, pref], /^QB_BAD_LOCATION:/,
          )
        }
        await expectRaise(
          client,
          `SELECT public.qb_import_invoice_tx($1, $2, '2026-10-01'::date, $3::jsonb, $4, ARRAY[NULL]::int[])`,
          [newInvoice(), s.horecaId, JSON.stringify([line(p, 1)]), s.actor],
          /^QB_BAD_LOCATION:/,
        )

        expect(await snapshot(client, xOrder, x, p)).toEqual(before)
        expect(await allocatedAt(client, p)).toBe(5)
      })
    })

    it('uses the default warehouse for a NULL or empty preference', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        const def = await client.query<{ id: number }>('SELECT public.inv_default_location() AS id')
        await receive(client, p, def.rows[0].id, 10)

        expect((await callImport(client, s, newInvoice(), [line(p, 2)], '2026-10-01', null)).status).toBe('created')
        expect(await allocatedAt(client, p)).toBe(2)
        expect((await callImport(client, s, newInvoice(), [line(p, 3)], '2026-10-01', [])).status).toBe('created')
        expect(await allocatedAt(client, p)).toBe(5)
      })
    })

    it('still creates an order for a product with no stock at a real warehouse', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        expect((await callImport(client, s, newInvoice(), [line(p, 4)])).status).toBe('created')
        expect(await allocatedAt(client, p)).toBe(0)
      })
    })
  })

  describe('fulfilments', () => {
    it('moves a processed order to the warehouse now holding its reservation, in the same shape', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        const other = await newWarehouse(client)
        await receive(client, p, s.binA, 10)
        await receive(client, p, other.bin, 10)
        const x = newInvoice()
        const xOrder = `QB-${x}`
        await callImport(client, s, x, [line(p, 5)])
        await markProcessed(client, s, xOrder, s.warehouseId)

        expect((await callUpdate(client, s, x, [line(p, 4)], { pref: [other.warehouseId] })).status).toBe('updated')

        expect(await allocatedAt(client, p, other.bin)).toBe(4)
        expect(await allocatedAt(client, p, s.binA)).toBe(0)
        const rows = await fulfilmentsOf(client, xOrder)
        expect(rows.map((r) => [r.location_id, r.status])).toEqual([[other.warehouseId, 'processed']])
        expect(rows[0].status_history).toHaveLength(1)
        expect(Object.keys(rows[0].status_history[0]).sort()).toEqual(['actor', 'status', 'timestamp'])
        expect(rows[0].status_history[0].status).toBe('processed')
        expect(rows[0].status_history[0].actor).toBe(s.actor)
        expect((await orderRow(client, xOrder)).status).toBe('processed')
      })
    })

    it('adds a row for each newly allocated warehouse and keeps the existing row untouched', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        const other = await newWarehouse(client)
        await receive(client, p, s.binA, 2)
        await receive(client, p, other.bin, 10)
        const x = newInvoice()
        const xOrder = `QB-${x}`
        await callImport(client, s, x, [line(p, 2)])
        await markProcessed(client, s, xOrder, s.warehouseId)

        await callUpdate(client, s, x, [line(p, 5)], { pref: [s.warehouseId, other.warehouseId] })

        const rows = await fulfilmentsOf(client, xOrder)
        expect(rows.map((r) => r.location_id).sort((a, b) => a - b)).toEqual(
          [s.warehouseId, other.warehouseId].sort((a, b) => a - b),
        )
        const kept = rows.find((r) => r.location_id === s.warehouseId)
        expect(kept?.status_history[0].timestamp).toBe('2026-10-01T00:00:00.000Z')
      })
    })

    it('keeps an advanced fulfilment at a warehouse the reservation has left', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        const other = await newWarehouse(client)
        await receive(client, p, s.binA, 10)
        await receive(client, p, other.bin, 10)
        const x = newInvoice()
        const xOrder = `QB-${x}`
        await callImport(client, s, x, [line(p, 5)])
        await markProcessed(client, s, xOrder, s.warehouseId, 'picked')

        await callUpdate(client, s, x, [line(p, 5)], { pref: [other.warehouseId] })

        const rows = await fulfilmentsOf(client, xOrder)
        expect(rows.find((r) => r.location_id === s.warehouseId)?.status).toBe('picked')
        expect(rows.find((r) => r.location_id === other.warehouseId)?.status).toBe('processed')
      })
    })

    it('fully out of stock: keeps the rows it has and ensures the default warehouse, as update-order-status does', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        const empty = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 10)
        const x = newInvoice()
        const xOrder = `QB-${x}`
        await callImport(client, s, x, [line(p, 5)])
        await markProcessed(client, s, xOrder, s.warehouseId)

        await callUpdate(client, s, x, [line(empty, 3)])

        expect(await allocatedAt(client, p)).toBe(0)
        const def = await client.query<{ id: number }>(
          "SELECT id FROM public.locations WHERE kind='WAREHOUSE' AND is_active ORDER BY id LIMIT 1",
        )
        const rows = await fulfilmentsOf(client, xOrder)
        expect(rows.map((r) => r.location_id)).toContain(s.warehouseId)
        expect(rows.map((r) => r.location_id)).toContain(def.rows[0].id)
        expect(rows).toHaveLength(2)
      })
    })

    it('leaves a processing order with no fulfilments', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 10)
        const x = newInvoice()
        const xOrder = `QB-${x}`
        await callImport(client, s, x, [line(p, 5)])
        expect(await fulfilmentsOf(client, xOrder)).toEqual([])

        await callUpdate(client, s, x, [line(p, 4)])

        expect(await fulfilmentsOf(client, xOrder)).toEqual([])
      })
    })
  })

  describe('prices', () => {
    it('totals from the stored 2dp price and keeps the file value in the import row', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 500)
        const x = newInvoice()
        const xOrder = `QB-${x}`
        const lines = [line(p, 100, 1.235)]

        await callImport(client, s, x, lines)
        expect((await orderRow(client, xOrder)).total).toBe(124)
        expect((await itemsOf(client, xOrder))[0].unit_price).toBe(1.24)
        expect((await importRow(client, x)).lines).toEqual(lines)

        const changed = [line(p, 200, 1.235)]
        await callUpdate(client, s, x, changed)
        expect((await orderRow(client, xOrder)).total).toBe(248)
        expect((await importRow(client, x)).lines).toEqual(changed)
      })
    })
  })

  describe('coded errors', () => {
    it('names a bad customer, actor, date and price on both transactions', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        const good = [line(p, 1)]
        const pref = [s.warehouseId]
        const number = newInvoice()
        const cases: Array<[number | null, string | null, string | null, unknown, RegExp]> = [
          [2147483647, '2026-10-01', s.actor, good, /^QB_BAD_CUSTOMER:/],
          [null, '2026-10-01', s.actor, good, /^QB_BAD_CUSTOMER:/],
          [s.horecaId, '2026-10-01', UNKNOWN_ACTOR, good, /^QB_BAD_ACTOR:/],
          [s.horecaId, '2026-10-01', null, good, /^QB_BAD_ACTOR:/],
          [s.horecaId, null, s.actor, good, /^QB_BAD_DATE:/],
          // unit_price is NUMERIC(10,2): 99999999.99 is the largest, and this rounds past it.
          [s.horecaId, '2026-10-01', s.actor, [line(p, 1, 99999999.995)], /^QB_BAD_PRICE:/],
          [s.horecaId, '2026-10-01', s.actor, [line(p, 1, 100000000)], /^QB_BAD_PRICE:/],
          // Each price fits, but orders.total is NUMERIC(12,2).
          [s.horecaId, '2026-10-01', s.actor, [line(p, 2000, 9999999)], /^QB_BAD_PRICE:/],
        ]
        for (const fn of ['qb_import_invoice_tx', 'qb_update_invoice_tx']) {
          for (const [horeca, date, actor, lines, pattern] of cases) {
            await callWith(client, fn, [number, horeca, date, lines, actor, pref], pattern)
          }
        }
        expect(await importRow(client, number)).toBeUndefined()
      })
    })

    it('names an order id or invoice number that another order already holds', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        const byId = newInvoice()
        await client.query(
          `INSERT INTO public.orders (id, horeca_id, submitted_by, total) VALUES ($1, $2, $3, 0)`,
          [`QB-${byId}`, s.horecaId, s.actor],
        )
        await callWith(
          client, 'qb_import_invoice_tx',
          [byId, s.horecaId, '2026-10-01', [line(p, 1)], s.actor, [s.warehouseId]], /^QB_ORDER_ID_TAKEN:/,
        )
        const byNumber = newInvoice()
        await client.query(
          `INSERT INTO public.orders (id, horeca_id, submitted_by, total, qb_invoice_number) VALUES ($1, $2, $3, 0, $4)`,
          [`ORD-QBT-${byNumber}`, s.horecaId, s.actor, byNumber],
        )
        await callWith(
          client, 'qb_import_invoice_tx',
          [byNumber, s.horecaId, '2026-10-01', [line(p, 1)], s.actor, [s.warehouseId]], /^QB_ORDER_ID_TAKEN:/,
        )
        expect(await importRow(client, byId)).toBeUndefined()
        expect(await importRow(client, byNumber)).toBeUndefined()
      })
    })

    it('accepts the largest price the column can hold', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        const x = newInvoice()
        expect((await callImport(client, s, x, [line(p, 1, 99999999.99)])).status).toBe('created')
        expect((await orderRow(client, `QB-${x}`)).total).toBe(99999999.99)
      })
    })
  })
})

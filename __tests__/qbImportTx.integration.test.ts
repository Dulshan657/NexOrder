/**
 * NX-0025 — the QuickBooks import transactions against the live database (mig 00139).
 *
 * Every test runs inside BEGIN … ROLLBACK via `withRollbackTx`. If 00139 is not
 * applied yet, its text runs on the same client inside that same transaction, so
 * these work before and after it is applied and leave nothing behind.
 *
 * Run with: `npx vitest run -c vitest.integration.config.ts qbImportTx`
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { connect, expectRaise, hasDbCreds, withRollbackTx } from './support/pgTestClient'

const MIGRATION = join(process.cwd(), 'supabase', 'migrations', '00139_qb_invoice_import.sql')

let seq = 0
const uniq = (): string => `${Date.now()}-${++seq}`

interface Line {
  product_id: number
  quantity: number
  pack_size: number | null
  unit_price: number
  qb_product_name: string
}

interface Scene {
  actor: string
  horecaId: number
  otherHorecaId: number
  warehouseId: number
  supplierId: number
  binA: number
  binB: number
}

async function ensureMigration(client: pg.Client): Promise<void> {
  const r = await client.query<{ t: string | null }>("SELECT to_regclass('public.qb_product_map') AS t")
  if (r.rows[0].t === null) await client.query(readFileSync(MIGRATION, 'utf-8'))
}

async function newProduct(client: pg.Client, supplierId: number): Promise<number> {
  const token = uniq()
  const r = await client.query<{ id: number }>(
    `INSERT INTO public.products (id, sku, name, price, category, unit, carton_size, supplier_id, inventory, size_factor)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.products), $1, $2, 5, 'Other', 'EA', 12, $3, 0, 1)
     RETURNING id`,
    [`QBT-${token}`, `QB Test Product ${token}`, supplierId],
  )
  return r.rows[0].id
}

async function seed(client: pg.Client): Promise<Scene> {
  await ensureMigration(client)
  const token = uniq()
  const actor = await client.query<{ id: string }>('SELECT id FROM public.profiles LIMIT 1')
  const customer = async (name: string): Promise<number> => {
    const h = await client.query<{ id: number }>(
      "INSERT INTO public.horecas (name, address) VALUES ($1, '1 Test Street') RETURNING id",
      [`${name} ${token}`],
    )
    return h.rows[0].id
  }
  const supplier = await client.query<{ id: number }>(
    `INSERT INTO public.suppliers (id, name, contact_person, email, phone)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.suppliers), $1, '', $2, '') RETURNING id`,
    [`QB Test Supplier ${token}`, `qb-${token}@test.local`],
  )
  const whPath = `QBWH${token}`
  const wh = await client.query<{ id: number }>(
    `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, location_type)
     VALUES (NULL, 'WAREHOUSE', $1, $1, $2, true, 'racked') RETURNING id`,
    [`QBWH-${token}`, whPath],
  )
  const bin = async (suffix: string): Promise<number> => {
    const code = `QB-${suffix}-${token}`
    const b = await client.query<{ id: number }>(
      `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, capacity_slots)
       VALUES ($1, 'BIN', $2, $2, $3, true, 100) RETURNING id`,
      [wh.rows[0].id, code, `${whPath}/${code}`],
    )
    return b.rows[0].id
  }
  return {
    actor: actor.rows[0].id,
    horecaId: await customer('QB Test Cafe'),
    otherHorecaId: await customer('QB Test Bistro'),
    warehouseId: wh.rows[0].id,
    supplierId: supplier.rows[0].id,
    binA: await bin('A'),
    binB: await bin('B'),
  }
}

async function receive(
  client: pg.Client, productId: number, binId: number, qty: number,
  o: { batchId?: number; huId?: number } = {},
): Promise<void> {
  await client.query(
    `SELECT public.inv_apply_leg($1, $2, $3, $4, 0, 'receipt', NULL, 'test', NULL, NULL, NULL, $5)`,
    [productId, binId, o.batchId ?? null, qty, o.huId ?? null],
  )
}

const line = (productId: number, quantity: number, unitPrice = 10, packSize: number | null = null): Line => ({
  product_id: productId,
  quantity,
  pack_size: packSize,
  unit_price: unitPrice,
  qb_product_name: `QB name ${productId}`,
})

const newInvoice = (): string => `QBT-${uniq()}`

type Verdict = { status: string; order_id?: string; reason?: string }

const CALL_ARGS = '($1, $2, $3::date, $4::jsonb, $5, $6::int[]) AS r'

async function callImport(
  client: pg.Client, s: Scene, number: string, lines: unknown, date = '2026-10-01',
): Promise<Verdict> {
  const r = await client.query<{ r: Verdict }>(
    `SELECT public.qb_import_invoice_tx${CALL_ARGS}`,
    [number, s.horecaId, date, JSON.stringify(lines), s.actor, [s.warehouseId]],
  )
  return r.rows[0].r
}

async function callUpdate(
  client: pg.Client, s: Scene, number: string, lines: unknown,
  o: { horecaId?: number; date?: string } = {},
): Promise<Verdict> {
  const r = await client.query<{ r: Verdict }>(
    `SELECT public.qb_update_invoice_tx${CALL_ARGS}`,
    [number, o.horecaId ?? s.horecaId, o.date ?? '2026-10-01', JSON.stringify(lines), s.actor, [s.warehouseId]],
  )
  return r.rows[0].r
}

/** A plain order, as place-order would leave it, holding `qty` of a product if `reserve`. */
async function plainOrder(
  client: pg.Client, s: Scene, productId: number, qty: number, reserve = true,
): Promise<{ orderId: string; itemId: number }> {
  const orderId = `ORD-QBT-${uniq()}`
  await client.query(
    `INSERT INTO public.orders (id, horeca_id, submitted_by, total, status) VALUES ($1, $2, $3, 100, 'processing')`,
    [orderId, s.horecaId, s.actor],
  )
  const item = await client.query<{ id: number }>(
    `INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, product_name, product_sku)
     VALUES ($1, $2, $3, 10, 'Test', 'TEST') RETURNING id`,
    [orderId, productId, qty],
  )
  if (reserve) {
    await client.query('SELECT public.inv_reserve_order($1, $2::jsonb, $3::int[], $4, false)', [
      orderId, JSON.stringify([{ product_id: productId, quantity: qty }]), [s.warehouseId], s.actor,
    ])
  }
  return { orderId, itemId: item.rows[0].id }
}

async function allocatedAt(client: pg.Client, productId: number, binId?: number): Promise<number> {
  const r = await client.query<{ q: number }>(
    `SELECT COALESCE(SUM(allocated),0)::numeric AS q FROM public.inventory_balances
      WHERE product_id=$1 AND ($2::int IS NULL OR location_id=$2)`,
    [productId, binId ?? null],
  )
  return r.rows[0].q
}

async function onHandOf(client: pg.Client, productId: number): Promise<number> {
  const r = await client.query<{ q: number }>(
    'SELECT COALESCE(SUM(on_hand),0)::numeric AS q FROM public.inventory_balances WHERE product_id=$1',
    [productId],
  )
  return r.rows[0].q
}

/** What this order's own ledger nets to for a product, optionally in one bin. */
async function netOf(client: pg.Client, orderId: string, productId: number, binId?: number): Promise<number> {
  const r = await client.query<{ q: number }>(
    `SELECT COALESCE(SUM(qty_delta),0)::numeric AS q FROM public.inventory_movements
      WHERE ref_type='order' AND ref_id=$1 AND product_id=$2
        AND movement_type IN ('allocate','deallocate')
        AND ($3::int IS NULL OR location_id=$3)`,
    [orderId, productId, binId ?? null],
  )
  return r.rows[0].q
}

async function itemsOf(client: pg.Client, orderId: string): Promise<Array<Record<string, unknown>>> {
  const r = await client.query(
    `SELECT product_id, quantity, pack_size, unit_price, product_name, product_sku
       FROM public.order_items WHERE order_id=$1 ORDER BY product_id`,
    [orderId],
  )
  return r.rows
}

async function orderRow(client: pg.Client, orderId: string): Promise<Record<string, any>> {
  const r = await client.query('SELECT * FROM public.orders WHERE id=$1', [orderId])
  return r.rows[0]
}

async function importRow(client: pg.Client, number: string): Promise<Record<string, any>> {
  const r = await client.query(
    "SELECT *, invoice_date::text AS date_text FROM public.qb_invoice_imports WHERE invoice_number=$1",
    [number],
  )
  return r.rows[0]
}

/** Everything a refused call must leave alone, for a before-and-after comparison. */
async function snapshot(client: pg.Client, orderId: string, number: string, productId: number): Promise<unknown> {
  const balances = await client.query(
    'SELECT id, on_hand, allocated, updated_at FROM public.inventory_balances WHERE product_id=$1 ORDER BY id',
    [productId],
  )
  const movements = await client.query(
    'SELECT count(*)::int AS n FROM public.inventory_movements WHERE product_id=$1',
    [productId],
  )
  const items = await client.query('SELECT * FROM public.order_items WHERE order_id=$1 ORDER BY id', [orderId])
  return {
    order: await orderRow(client, orderId),
    importRow: await importRow(client, number),
    items: items.rows,
    balances: balances.rows,
    movements: movements.rows[0].n,
  }
}

describe('NX-0025 QuickBooks import transactions (live RPCs, rollback-isolated)', () => {
  it('has database credentials', () => {
    expect(hasDbCreds()).toBe(true)
  })

  describe('lockdown', () => {
    it('gives client roles nothing on the tables or functions, and service_role can execute', async () => {
      await withRollbackTx(async (client) => {
        await ensureMigration(client)
        for (const table of ['qb_product_map', 'qb_invoice_imports']) {
          for (const role of ['anon', 'authenticated']) {
            for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
              const r = await client.query<{ ok: boolean }>(
                'SELECT has_table_privilege($1, $2, $3) AS ok', [role, `public.${table}`, priv])
              expect(r.rows[0].ok, `${role} ${priv} ${table}`).toBe(false)
            }
          }
          const rls = await client.query<{ on: boolean; policies: number }>(
            `SELECT c.relrowsecurity AS on,
                    (SELECT count(*)::int FROM pg_policies p WHERE p.tablename = c.relname) AS policies
               FROM pg_class c WHERE c.oid = $1::regclass`,
            [`public.${table}`],
          )
          expect(rls.rows[0]).toEqual({ on: true, policies: 0 })
        }
        const fns = await client.query<{ sig: string }>(
          `SELECT p.oid::regprocedure::text AS sig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'qb\\_%'`,
        )
        expect(fns.rows.length).toBe(5)
        for (const { sig } of fns.rows) {
          for (const role of ['anon', 'authenticated']) {
            const r = await client.query<{ ok: boolean }>(
              "SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [role, sig])
            expect(r.rows[0].ok, `${role} ${sig}`).toBe(false)
          }
          const pub = await client.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = $1::regprocedure AND a.grantee = 0`, [sig])
          expect(pub.rows[0].n, `PUBLIC ${sig}`).toBe(0)
          const svc = await client.query<{ ok: boolean }>(
            "SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS ok", [sig])
          expect(svc.rows[0].ok, `service_role ${sig}`).toBe(true)
        }
      })
    })

    it('refuses a second order for one invoice number and a non-positive map pack size', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        const insert = `INSERT INTO public.orders (id, horeca_id, submitted_by, total, qb_invoice_number)
                        VALUES ($1, $2, $3, 0, 'QBT-SAME')`
        await client.query(insert, [`ORD-QBT-${uniq()}`, s.horecaId, s.actor])
        await expectRaise(client, insert, [`ORD-QBT-${uniq()}`, s.horecaId, s.actor], /idx_orders_qb_invoice_number/)
        await expectRaise(
          client,
          'INSERT INTO public.qb_product_map (qb_name, product_id, pack_size) VALUES ($1, $2, 0)',
          [`QB name ${uniq()}`, p],
          /pack_size/,
        )
      })
    })
  })

  describe('A12: importing', () => {
    it('creates an order at the file price with no invoice, reserving the 36 units there are of 5 cartons of 12', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 36)
        const number = newInvoice()
        const lines = [line(p, 5, 120.5, 12)]

        const res = await callImport(client, s, number, lines, '2026-10-02')
        const orderId = `QB-${number}`
        expect(res).toEqual({ status: 'created', order_id: orderId })

        const order = await orderRow(client, orderId)
        expect(order.total).toBe(602.5)
        expect(order.status).toBe('processing')
        expect(order.horeca_id).toBe(s.horecaId)
        expect(order.submitted_by).toBe(s.actor)
        expect(order.qb_invoice_number).toBe(number)
        expect(order.status_history).toHaveLength(1)
        expect(order.status_history[0].status).toBe('processing')
        expect(Object.keys(order.status_history[0]).sort()).toEqual(['status', 'timestamp'])
        expect(new Date(order.status_history[0].timestamp).toString()).not.toBe('Invalid Date')

        const invoices = await client.query('SELECT 1 FROM public.invoices WHERE order_id=$1', [orderId])
        expect(invoices.rowCount).toBe(0)

        const product = await client.query('SELECT name, sku FROM public.products WHERE id=$1', [p])
        expect(await itemsOf(client, orderId)).toEqual([{
          product_id: p, quantity: 5, pack_size: 12, unit_price: 120.5,
          product_name: product.rows[0].name, product_sku: product.rows[0].sku,
        }])

        expect(await allocatedAt(client, p)).toBe(36)
        expect(await onHandOf(client, p)).toBe(36)

        const imported = await importRow(client, number)
        expect(imported.order_id).toBe(orderId)
        expect(imported.date_text).toBe('2026-10-02')
        expect(imported.lines).toEqual(lines)
        expect(imported.flagged_change).toBeNull()
      })
    })

    it('reserves a carton line and a null-pack line in base units, and rounds the total to cents', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const carton = await newProduct(client, s.supplierId)
        const loose = await newProduct(client, s.supplierId)
        await receive(client, carton, s.binA, 100)
        await receive(client, loose, s.binA, 100)
        const number = newInvoice()

        await callImport(client, s, number, [line(carton, 2, 33.33, 12), line(loose, 7, 1.11, null)])

        expect(await allocatedAt(client, carton)).toBe(24)
        expect(await allocatedAt(client, loose)).toBe(7)
        const order = await orderRow(client, `QB-${number}`)
        expect(order.total).toBe(74.43)
        const items = await itemsOf(client, `QB-${number}`)
        expect(items.map((i) => i.pack_size)).toEqual([12, null])
      })
    })

    it('treats a missing pack size as units and accepts a free line at price zero', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 10)
        const number = newInvoice()
        await callImport(client, s, number, [{ product_id: p, quantity: 3, unit_price: 0, qb_product_name: 'Free' }])
        expect(await allocatedAt(client, p)).toBe(3)
        expect((await orderRow(client, `QB-${number}`)).total).toBe(0)
      })
    })

    it('still creates the order when nothing at all is available', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        const number = newInvoice()
        const res = await callImport(client, s, number, [line(p, 4)])
        expect(res.status).toBe('created')
        expect(await allocatedAt(client, p)).toBe(0)
        expect(await itemsOf(client, `QB-${number}`)).toHaveLength(1)
      })
    })

    it('raises a coded error and writes nothing for each kind of bad input, on both transactions', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        const good = newInvoice()
        const cases: Array<[string, unknown, RegExp]> = [
          ['A B', [line(p, 1)], /^QB_BAD_INVOICE_NUMBER:/],
          ['A--B', [line(p, 1)], /^QB_BAD_INVOICE_NUMBER:/],
          ['-AB', [line(p, 1)], /^QB_BAD_INVOICE_NUMBER:/],
          ['AB\n', [line(p, 1)], /^QB_BAD_INVOICE_NUMBER:/],
          [good, [], /^QB_BAD_LINES:/],
          [good, { lines: [] }, /^QB_BAD_LINES:/],
          [good, [7], /^QB_BAD_LINES:/],
          [good, [line(p, 0)], /^QB_BAD_QUANTITY:/],
          [good, [line(p, -1)], /^QB_BAD_QUANTITY:/],
          [good, [line(p, 1.5)], /^QB_BAD_QUANTITY:/],
          [good, [{ ...line(p, 1), quantity: '5' }], /^QB_BAD_QUANTITY:/],
          [good, [line(p, 1, -0.01)], /^QB_BAD_PRICE:/],
          [good, [{ ...line(p, 1), unit_price: null }], /^QB_BAD_PRICE:/],
          [good, [line(p, 1, 10, 0)], /^QB_BAD_PACK_SIZE:/],
          [good, [line(p, 1, 10, 2.5)], /^QB_BAD_PACK_SIZE:/],
          [good, [{ ...line(p, 1), pack_size: '12' }], /^QB_BAD_PACK_SIZE:/],
          [good, [line(p, 1), line(p, 2)], /^QB_DUPLICATE_PRODUCT:/],
          [good, [{ ...line(p, 1), product_id: 'x' }], /^QB_BAD_PRODUCT:/],
          [good, [line(2147483647, 1)], /^QB_PRODUCT_NOT_FOUND:/],
        ]
        for (const fn of ['qb_import_invoice_tx', 'qb_update_invoice_tx']) {
          for (const [number, lines, pattern] of cases) {
            await expectRaise(
              client,
              `SELECT public.${fn}($1, $2, '2026-10-01'::date, $3::jsonb, $4, $5::int[])`,
              [number, s.horecaId, JSON.stringify(lines), s.actor, [s.warehouseId]],
              pattern,
            )
          }
        }
        const orders = await client.query('SELECT 1 FROM public.orders WHERE qb_invoice_number=$1', [good])
        expect(orders.rowCount).toBe(0)
        expect(await importRow(client, good)).toBeUndefined()
      })
    })
  })

  describe('A13: importing the same number again', () => {
    it('returns already_imported and adds nothing, even when the second file differs', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 50)
        const number = newInvoice()
        const orderId = `QB-${number}`
        await callImport(client, s, number, [line(p, 5)])
        const before = await snapshot(client, orderId, number, p)

        expect(await callImport(client, s, number, [line(p, 5)])).toEqual({ status: 'already_imported', order_id: orderId })
        expect(await callImport(client, s, number, [line(p, 9, 99)])).toEqual({ status: 'already_imported', order_id: orderId })

        expect(await snapshot(client, orderId, number, p)).toEqual(before)
        const orders = await client.query('SELECT count(*)::int AS n FROM public.orders WHERE qb_invoice_number=$1', [number])
        expect(orders.rows[0].n).toBe(1)
        expect(await allocatedAt(client, p)).toBe(5)
      })
    })

    it('makes a second session wait: the per-invoice lock is held until the transaction ends', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        const number = newInvoice()
        // Takes a lock and writes nothing, so this second session leaves no trace.
        const other = await connect()
        const tryLock = async (): Promise<boolean> => {
          const r = await other.query<{ got: boolean }>(
            "SELECT pg_try_advisory_xact_lock(hashtext('qb_invoice:' || $1)) AS got", [number])
          return r.rows[0].got
        }
        try {
          expect(await tryLock()).toBe(true)
          await callImport(client, s, number, [line(p, 1)])
          expect(await tryLock()).toBe(false)
        } finally {
          await other.end()
        }
      })
    })
  })

  describe('A14: updates that are refused', () => {
    it('refuses once a pick is recorded, and changes nothing', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 20)
        const number = newInvoice()
        const orderId = `QB-${number}`
        await callImport(client, s, number, [line(p, 5)])
        const item = await client.query<{ id: number }>('SELECT id FROM public.order_items WHERE order_id=$1', [orderId])
        await client.query('SELECT public.inv_pick_order_line($1, 1, $2, $3)', [item.rows[0].id, s.binA, s.actor])
        const before = await snapshot(client, orderId, number, p)

        expect(await callUpdate(client, s, number, [line(p, 2, 50)], { horecaId: s.otherHorecaId }))
          .toEqual({ status: 'refused', reason: 'picking_started' })

        expect(await snapshot(client, orderId, number, p)).toEqual(before)
        expect(await allocatedAt(client, p)).toBe(4)
        const picks = await client.query('SELECT 1 FROM public.pick_progress WHERE order_id=$1', [orderId])
        expect(picks.rowCount).toBe(1)
      })
    })

    it('refuses a cancelled and a dispatched order, and changes nothing', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 20)
        const number = newInvoice()
        const orderId = `QB-${number}`
        await callImport(client, s, number, [line(p, 5)])

        await client.query("UPDATE public.orders SET status='dispatched' WHERE id=$1", [orderId])
        const dispatched = await snapshot(client, orderId, number, p)
        expect(await callUpdate(client, s, number, [line(p, 2, 50)])).toEqual({ status: 'refused', reason: 'order_closed' })
        expect(await snapshot(client, orderId, number, p)).toEqual(dispatched)

        await client.query(
          "UPDATE public.orders SET status='cancelled', cancelled_at=now(), cancel_reason='test' WHERE id=$1", [orderId])
        const cancelled = await snapshot(client, orderId, number, p)
        expect(await callUpdate(client, s, number, [line(p, 2, 50)])).toEqual({ status: 'refused', reason: 'order_closed' })
        expect(await snapshot(client, orderId, number, p)).toEqual(cancelled)
        expect(await allocatedAt(client, p)).toBe(5)
      })
    })

    it('answers not_found for an invoice that was never imported', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        expect(await callUpdate(client, s, newInvoice(), [line(p, 1)])).toEqual({ status: 'not_found' })
      })
    })
  })

  describe('A15: updates give back only this order', () => {
    /** Y holds all of bin A, X holds all of bin B and is 2 short of its 5. */
    async function partlyReserved(client: pg.Client, s: Scene): Promise<{
      p: number; x: string; xOrder: string; y: string; yOrder: string
    }> {
      const p = await newProduct(client, s.supplierId)
      await receive(client, p, s.binA, 3)
      await receive(client, p, s.binB, 3)
      const y = newInvoice()
      const x = newInvoice()
      await callImport(client, s, y, [line(p, 3)])
      await callImport(client, s, x, [line(p, 5)])
      const xOrder = `QB-${x}`
      const yOrder = `QB-${y}`
      expect(await netOf(client, yOrder, p, s.binA)).toBe(3)
      expect(await netOf(client, xOrder, p, s.binB)).toBe(3)
      return { p, x, xOrder, y, yOrder }
    }

    it('leaves another order every unit when the updated order was only partly reserved', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const { p, x, xOrder, yOrder } = await partlyReserved(client, s)

        expect(await callUpdate(client, s, x, [line(p, 5, 12)])).toEqual({ status: 'updated', order_id: xOrder })

        expect(await netOf(client, yOrder, p)).toBe(3)
        expect(await netOf(client, yOrder, p, s.binA)).toBe(3)
        expect(await netOf(client, xOrder, p)).toBe(3)
        expect(await netOf(client, xOrder, p, s.binB)).toBe(3)
        expect(await allocatedAt(client, p, s.binA)).toBe(3)
        expect(await allocatedAt(client, p, s.binB)).toBe(3)
        expect(await onHandOf(client, p)).toBe(6)
      })
    })

    it('frees stock on a lower quantity without touching the other order', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const { p, x, xOrder, yOrder } = await partlyReserved(client, s)

        await callUpdate(client, s, x, [line(p, 1)])

        expect(await netOf(client, xOrder, p)).toBe(1)
        expect(await netOf(client, yOrder, p, s.binA)).toBe(3)
        // A product-wide release would have emptied bin A first: it goes by row id.
        expect(await allocatedAt(client, p, s.binA)).toBe(3)
        expect(await allocatedAt(client, p, s.binB)).toBe(1)
        expect(await allocatedAt(client, p)).toBe(4)
        expect(await onHandOf(client, p)).toBe(6)
      })
    })

    it('reserves more when stock has arrived since, still in base units', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const { p, x, xOrder, yOrder } = await partlyReserved(client, s)
        await receive(client, p, s.binB, 30)

        await callUpdate(client, s, x, [line(p, 2, 10, 12)])

        expect(await netOf(client, xOrder, p)).toBe(24)
        expect(await netOf(client, yOrder, p)).toBe(3)
        expect(await allocatedAt(client, p)).toBe(27)
      })
    })

    it('releases the old product when the invoice moves to a different one', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const { p, x, xOrder, yOrder } = await partlyReserved(client, s)
        const q = await newProduct(client, s.supplierId)
        await receive(client, q, s.binA, 10)

        await callUpdate(client, s, x, [line(q, 4)])

        expect(await netOf(client, xOrder, p)).toBe(0)
        expect(await netOf(client, yOrder, p)).toBe(3)
        expect(await allocatedAt(client, p)).toBe(3)
        expect(await allocatedAt(client, q)).toBe(4)
        expect((await itemsOf(client, xOrder)).map((i) => i.product_id)).toEqual([q])
      })
    })

    it('keeps a non-QuickBooks order holding the same product whole', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 4)
        await receive(client, p, s.binB, 4)
        const plain = await plainOrder(client, s, p, 4)
        const x = newInvoice()
        const xOrder = `QB-${x}`
        await callImport(client, s, x, [line(p, 9)])
        expect(await netOf(client, xOrder, p)).toBe(4)

        await callUpdate(client, s, x, [line(p, 1)])

        expect(await netOf(client, plain.orderId, p, s.binA)).toBe(4)
        expect(await allocatedAt(client, p, s.binA)).toBe(4)
        expect(await netOf(client, xOrder, p)).toBe(1)
        expect(await allocatedAt(client, p)).toBe(5)
        expect(await onHandOf(client, p)).toBe(8)
      })
    })

    it('rewrites the items, total, customer, date and lines, keeps the status and notes the change', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 50)
        const number = newInvoice()
        const orderId = `QB-${number}`
        await callImport(client, s, number, [line(p, 5, 10)])
        await client.query("UPDATE public.orders SET status='processed' WHERE id=$1", [orderId])
        await client.query(
          `UPDATE public.qb_invoice_imports SET flagged_change='{"differences":["x"]}'::jsonb WHERE invoice_number=$1`,
          [number],
        )
        const lines = [line(p, 2, 7.5, 12)]

        const res = await callUpdate(client, s, number, lines, { horecaId: s.otherHorecaId, date: '2026-10-09' })
        expect(res).toEqual({ status: 'updated', order_id: orderId })

        const order = await orderRow(client, orderId)
        expect(order.total).toBe(15)
        expect(order.horeca_id).toBe(s.otherHorecaId)
        expect(order.status).toBe('processed')
        expect(order.qb_invoice_number).toBe(number)
        expect(order.status_history).toHaveLength(2)
        const entry = order.status_history[1]
        expect(entry.status).toBe('processed')
        expect(entry.actor).toBe(s.actor)
        expect(entry.note).toBe('QuickBooks invoice updated')

        const items = await itemsOf(client, orderId)
        expect(items).toHaveLength(1)
        expect(items[0].quantity).toBe(2)
        expect(items[0].pack_size).toBe(12)
        expect(items[0].unit_price).toBe(7.5)

        expect(await allocatedAt(client, p)).toBe(24)

        const imported = await importRow(client, number)
        expect(imported.lines).toEqual(lines)
        expect(imported.date_text).toBe('2026-10-09')
        expect(imported.flagged_change).toBeNull()

        const invoices = await client.query('SELECT 1 FROM public.invoices WHERE order_id=$1', [orderId])
        expect(invoices.rowCount).toBe(0)
      })
    })

    it('gives back the right rows when reservations sit on a batch and on a plate', async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        const batch = await client.query<{ id: number }>(
          `INSERT INTO public.batches (product_id, lot_code, expiry_date) VALUES ($1, $2, '2030-01-01') RETURNING id`,
          [p, `LOT-${uniq()}`],
        )
        const plate = await client.query<{ id: number }>(
          `INSERT INTO public.handling_units (hu_type, warehouse_id, location_id) VALUES ('pallet', $1, $2) RETURNING id`,
          [s.warehouseId, s.binA],
        )
        // One bin, three separate balance rows for one product.
        await receive(client, p, s.binA, 2, { batchId: batch.rows[0].id })
        await receive(client, p, s.binA, 2, { huId: plate.rows[0].id })
        await receive(client, p, s.binA, 2)
        const y = await plainOrder(client, s, p, 1)
        const x = newInvoice()
        const xOrder = `QB-${x}`
        await callImport(client, s, x, [line(p, 5)])
        expect(await netOf(client, xOrder, p)).toBe(5)
        const movementsBefore = await client.query<{ batch_id: number | null; handling_unit_id: number | null; net: number }>(
          `SELECT batch_id, handling_unit_id, SUM(qty_delta)::numeric AS net FROM public.inventory_movements
            WHERE ref_type='order' AND ref_id=$1 AND movement_type IN ('allocate','deallocate')
            GROUP BY 1, 2`, [xOrder])
        expect(movementsBefore.rows.length).toBeGreaterThan(1)

        await callUpdate(client, s, x, [line(p, 1)])

        expect(await netOf(client, xOrder, p)).toBe(1)
        expect(await netOf(client, y.orderId, p)).toBe(1)
        expect(await allocatedAt(client, p)).toBe(2)
        expect(await onHandOf(client, p)).toBe(6)
        const rows = await client.query<{ on_hand: number; allocated: number }>(
          'SELECT on_hand, allocated FROM public.inventory_balances WHERE product_id=$1', [p])
        expect(rows.rows.length).toBe(3)
        for (const row of rows.rows) expect(row.on_hand).toBe(2)
      })
    })

    it("raises rather than caps when another order's pick has taken this order's reserved units", async () => {
      await withRollbackTx(async (client) => {
        const s = await seed(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 10)
        const x = newInvoice()
        const xOrder = `QB-${x}`
        await callImport(client, s, x, [line(p, 5)])
        // Another order with no reservation of its own picks from the same row:
        // inv_pick_order_line deallocates whatever the row holds.
        const other = await plainOrder(client, s, p, 8, false)
        await client.query('SELECT public.inv_pick_order_line($1, 8, $2, $3)', [other.itemId, s.binA, s.actor])
        expect(await allocatedAt(client, p, s.binA)).toBe(0)
        const before = await snapshot(client, xOrder, x, p)

        await expectRaise(
          client,
          `SELECT public.qb_update_invoice_tx($1, $2, '2026-10-01'::date, $3::jsonb, $4, $5::int[])`,
          [x, s.horecaId, JSON.stringify([line(p, 2)]), s.actor, [s.warehouseId]],
          /^QB_ALLOCATION_MISMATCH:/,
        )

        expect(await snapshot(client, xOrder, x, p)).toEqual(before)
      })
    })
  })
})

/**
 * NX-0029 A1, A9, A10, A13, A14 — pick_differences, closing a line short, and when an
 * imported order is pick-complete (mig 00140), against the live database.
 *
 * Every test runs inside BEGIN … ROLLBACK via `withRollbackTx`. If 00140 is not applied
 * yet, its text runs on the same client inside that same transaction.
 *
 * Run with: `npx vitest run -c vitest.integration.config.ts shortPick`
 */
import { describe, expect, it } from 'vitest'
import { expectRaise, hasDbCreds, withRollbackTx } from './support/pgTestClient'
import {
  callUpdate,
  itemsOf,
  line,
  netOf,
  newProduct,
  newWarehouse,
  plainOrder,
  receive,
  snapshot,
} from './support/qbImportTxHelpers'
import {
  addLine,
  bin,
  cancel,
  closeShort,
  differences,
  ensureShortPick,
  importedOrder,
  movementCount,
  pick,
  pickComplete,
  release,
  scene,
  setStatus,
  warningsDuring,
} from './support/shortPickHelpers'

const CLOSE = 'SELECT public.inv_close_line_short($1, $2, $3)'

describe('NX-0029 closing a line short (live RPCs, rollback-isolated)', () => {
  it('has database credentials', () => {
    expect(hasDbCreds()).toBe(true)
  })

  describe('A1: lockdown', () => {
    it('gives client roles nothing on the table, its sequence or the functions', async () => {
      await withRollbackTx(async (client) => {
        await ensureShortPick(client)
        for (const role of ['anon', 'authenticated']) {
          for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
            const r = await client.query<{ ok: boolean }>(
              "SELECT has_table_privilege($1, 'public.pick_differences', $2) AS ok", [role, priv])
            expect(r.rows[0].ok, `${role} ${priv}`).toBe(false)
          }
          const seq = await client.query<{ ok: boolean }>(
            "SELECT has_sequence_privilege($1, 'public.pick_differences_id_seq', 'USAGE') AS ok", [role])
          expect(seq.rows[0].ok, `${role} sequence`).toBe(false)
        }
        const rls = await client.query<{ on: boolean; policies: number }>(
          `SELECT c.relrowsecurity AS on,
                  (SELECT count(*)::int FROM pg_policies p WHERE p.tablename = c.relname) AS policies
             FROM pg_class c WHERE c.oid = 'public.pick_differences'::regclass`)
        expect(rls.rows[0]).toEqual({ on: true, policies: 0 })

        const fns = await client.query<{ sig: string }>(
          `SELECT p.oid::regprocedure::text AS sig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('inv_close_line_short', 'inv_pick_imported_line', 'inv_release_bin',
                                'inv_order_bin_remainder', 'inv_others_bin_holdings', 'inv_assert_pick_location',
                                'inv_pick_order_line', 'inv_release_reservation', 'qb_update_invoice_tx')`)
        expect(fns.rows).toHaveLength(9)
        for (const { sig } of fns.rows) {
          for (const role of ['anon', 'authenticated']) {
            const r = await client.query<{ ok: boolean }>(
              "SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [role, sig])
            expect(r.rows[0].ok, `${role} ${sig}`).toBe(false)
          }
          const svc = await client.query<{ ok: boolean }>(
            "SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS ok", [sig])
          expect(svc.rows[0].ok, `service_role ${sig}`).toBe(true)
        }
      })
    })

    it('keeps one overload of each replaced function', async () => {
      await withRollbackTx(async (client) => {
        await ensureShortPick(client)
        const r = await client.query<{ sig: string }>(
          `SELECT p.oid::regprocedure::text AS sig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('inv_pick_order_line', 'inv_release_reservation', 'inv_warehouse_pick_complete')
            ORDER BY 1`)
        expect(r.rows.map((x) => x.sig)).toEqual([
          'inv_pick_order_line(integer,numeric,integer,uuid)',
          'inv_release_reservation(text,integer,uuid)',
          'inv_warehouse_pick_complete(text,integer)',
        ])
      })
    })

    it('runs the whole flow as service_role, the role the Edge Functions use', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 5)
        const x = await importedOrder(client, s, p, 10)

        await client.query('SET LOCAL ROLE service_role')
        expect((await pick(client, s, x.itemId, 2, s.binA)).unrecorded_qty_base).toBe(0)
        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(false)
        expect((await closeShort(client, s, x.itemId, s.binA)).status).toBe('closed')
        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(true)
        await release(client, s, x.orderId, s.warehouseId)
        await client.query('RESET ROLE')
      })
    })

    it('allows one short row per line and one unrecorded row per line and bin', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        const x = await importedOrder(client, s, p, 5)
        const insert = `INSERT INTO public.pick_differences
            (order_id, order_item_id, product_id, location_id, kind, ordered_qty, picked_qty, recount_needed)
          VALUES ($1, $2, $3, $4, $5, 5, 0, false)`

        await client.query(insert, [x.orderId, x.itemId, p, s.binA, 'short'])
        await expectRaise(client, insert, [x.orderId, x.itemId, p, s.binB, 'short'], /idx_pick_differences_one_short/)
        await client.query(insert, [x.orderId, x.itemId, p, s.binA, 'unrecorded_stock'])
        await client.query(insert, [x.orderId, x.itemId, p, s.binB, 'unrecorded_stock'])
        await expectRaise(client, insert, [x.orderId, x.itemId, p, s.binA, 'unrecorded_stock'], /idx_pick_differences_one_unrecorded/)
        await expectRaise(client, insert, [x.orderId, x.itemId, p, null, 'unrecorded_stock'], /pick_differences_unrecorded_has_bin/)
        await expectRaise(client, insert, [x.orderId, x.itemId, p, s.binA, 'lost'], /pick_differences_kind_check/)
      })
    })
  })

  describe('A9: one difference, on-hand untouched', () => {
    it('zero found records the line, flags the bin and gives back only its units', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 15)
        const other = await plainOrder(client, s, p, 5)
        const x = await importedOrder(client, s, p, 10)
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 15, allocated: 15 })

        const res = await closeShort(client, s, x.itemId, s.binA)

        expect(res).toEqual({ status: 'closed', line_closed: true, order_fully_resolved: true })
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 15, allocated: 5 })
        expect(await netOf(client, other.orderId, p)).toBe(5)
        const rows = await differences(client, x.orderId)
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
          order_item_id: x.itemId, product_id: p, location_id: s.binA, kind: 'short',
          ordered_qty: 10, picked_qty: 0, unrecorded_qty_base: 0, recount_needed: true,
          resolved_at: null, created_by: s.actor,
        })
      })
    })

    it('with no bin, flags no recount: a product never counted has none to flag', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        const x = await importedOrder(client, s, p, 3)

        expect((await closeShort(client, s, x.itemId)).status).toBe('closed')

        expect(await differences(client, x.orderId)).toMatchObject([{ location_id: null, recount_needed: false }])
      })
    })

    it('a retry adds no row and releases nothing more', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 20)
        const other = await plainOrder(client, s, p, 10)
        const x = await importedOrder(client, s, p, 10)
        await closeShort(client, s, x.itemId, s.binA)
        const movements = await movementCount(client, p)

        const again = await closeShort(client, s, x.itemId, s.binA)

        expect(again).toEqual({ status: 'already_closed', line_closed: true })
        expect(await differences(client, x.orderId)).toHaveLength(1)
        expect(await movementCount(client, p)).toBe(movements)
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 20, allocated: 10 })
        expect(await netOf(client, other.orderId, p)).toBe(10)
      })
    })

    it('a part-picked line releases the open part only and records what was found', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 20)
        const other = await plainOrder(client, s, p, 10)
        const x = await importedOrder(client, s, p, 10)
        await pick(client, s, x.itemId, 4, s.binA)
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 16, allocated: 16 })

        await closeShort(client, s, x.itemId, s.binA)

        expect(await bin(client, p, s.binA)).toEqual({ onHand: 16, allocated: 10 })
        expect(await netOf(client, other.orderId, p)).toBe(10)
        expect(await differences(client, x.orderId)).toMatchObject([{ ordered_qty: 10, picked_qty: 4 }])
      })
    })

    it('a line already fully picked records nothing', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 5)
        const x = await importedOrder(client, s, p, 5)
        await pick(client, s, x.itemId, 5, s.binA)

        expect(await closeShort(client, s, x.itemId, s.binA)).toEqual({ status: 'already_picked' })
        expect(await differences(client, x.orderId)).toEqual([])
      })
    })

    it('counts in base units on a carton line', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 36)
        const x = await importedOrder(client, s, p, 3, { pack: 12 })
        await pick(client, s, x.itemId, 1, s.binA)

        await closeShort(client, s, x.itemId, s.binA)

        expect(await bin(client, p, s.binA)).toEqual({ onHand: 24, allocated: 0 })
        expect(await differences(client, x.orderId)).toMatchObject([{ ordered_qty: 3, picked_qty: 1 }])
      })
    })

    it('a shortfall in the bin warns, still closes, and takes nothing from the other holder', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 20)
        const other = await plainOrder(client, s, p, 10)
        const x = await importedOrder(client, s, p, 10)
        const thief = await plainOrder(client, s, p, 15, false)
        await pick(client, s, thief.itemId, 15, s.binA)
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 5, allocated: 5 })

        let res = { status: '' } as Awaited<ReturnType<typeof closeShort>>
        const warnings = await warningsDuring(client, async () => {
          res = await closeShort(client, s, x.itemId, s.binA)
        })

        expect(res.status).toBe('closed')
        expect(warnings[0]).toContain('RELEASE_SHORTFALL')
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 5, allocated: 5 })
        expect(await netOf(client, other.orderId, p)).toBe(10)
      })
    })
  })

  describe('A9: a product on two lines shares one reservation', () => {
    it('closing one line keeps what the other line still needs, then picks draw on it', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 30)
        const x = await importedOrder(client, s, p, 10)
        const cartons = await addLine(client, s, x.orderId, p, 2, 5)
        expect((await bin(client, p, s.binA)).allocated).toBe(20)

        const res = await closeShort(client, s, x.itemId, s.binA)

        expect(res).toEqual({ status: 'closed', line_closed: true, order_fully_resolved: false })
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 30, allocated: 10 })

        expect((await pick(client, s, cartons, 2, s.binA)).order_fully_picked).toBe(true)
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 20, allocated: 0 })
      })
    })

    it('with a part reservation, gives back only what the other line cannot use', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 15)
        const x = await importedOrder(client, s, p, 10)
        const second = await addLine(client, s, x.orderId, p, 10)
        expect((await bin(client, p, s.binA)).allocated).toBe(15)

        await closeShort(client, s, x.itemId)
        expect((await bin(client, p, s.binA)).allocated).toBe(10)
        await closeShort(client, s, second)
        expect((await bin(client, p, s.binA)).allocated).toBe(0)
      })
    })

    it('gives back nothing while the other line needs all of it', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 5)
        const x = await importedOrder(client, s, p, 5)
        await addLine(client, s, x.orderId, p, 5)
        const before = await movementCount(client, p)

        await closeShort(client, s, x.itemId)

        expect((await bin(client, p, s.binA)).allocated).toBe(5)
        expect(await movementCount(client, p)).toBe(before)
      })
    })

    it('prefers the bin it was told, then the order’s other bins', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 5)
        await receive(client, p, s.binB, 5)
        const x = await importedOrder(client, s, p, 3)
        const second = await addLine(client, s, x.orderId, p, 7)
        expect((await bin(client, p, s.binA)).allocated + (await bin(client, p, s.binB)).allocated).toBe(10)
        const before = (await bin(client, p, s.binB)).allocated

        await closeShort(client, s, x.itemId, s.binB)
        expect((await bin(client, p, s.binB)).allocated).toBe(before - 3)
        expect((await bin(client, p, s.binA)).allocated).toBe(10 - before)

        await closeShort(client, s, second, s.binB)
        expect((await bin(client, p, s.binA)).allocated).toBe(0)
        expect((await bin(client, p, s.binB)).allocated).toBe(0)
      })
    })
  })

  describe('A10: refusals', () => {
    it('refuses an unknown line and a bad location, recording nothing', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 5)
        const x = await importedOrder(client, s, p, 5)

        await expectRaise(client, CLOSE, [2147483646, null, s.actor], /ORDER_ITEM_NOT_FOUND/)
        await expectRaise(client, CLOSE, [x.itemId, 2147483646, s.actor], /BAD_LOCATION/)
        await client.query('UPDATE public.locations SET is_active=false WHERE id=$1', [s.warehouseId])
        await expectRaise(client, CLOSE, [x.itemId, s.binA, s.actor], /BAD_LOCATION/)

        expect(await differences(client, x.orderId)).toEqual([])
        expect((await bin(client, p, s.binA)).allocated).toBe(5)
      })
    })

    it('refuses an order with no invoice number', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 5)
        const x = await plainOrder(client, s, p, 5)
        await setStatus(client, x.orderId, 'processed')

        await expectRaise(client, CLOSE, [x.itemId, null, s.actor], /NOT_IMPORTED/)
      })
    })

    it('refuses a cancelled order', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 5)
        const x = await importedOrder(client, s, p, 5)
        expect((await cancel(client, s, x.orderId)).ok).toBe(true)

        await expectRaise(client, CLOSE, [x.itemId, null, s.actor], /ORDER_CANCELLED/)
      })
    })

    it('refuses an order outside processed and picked, and allows both', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 5)
        const fresh = await importedOrder(client, s, p, 1, { process: false })
        await expectRaise(client, CLOSE, [fresh.itemId, null, s.actor], /INVALID_STATUS/)

        const x = await importedOrder(client, s, p, 1)
        for (const status of ['packed', 'dispatched', 'delivered']) {
          await setStatus(client, x.orderId, status)
          await expectRaise(client, CLOSE, [x.itemId, null, s.actor], /INVALID_STATUS/)
        }

        await setStatus(client, x.orderId, 'picked')
        expect((await closeShort(client, s, x.itemId)).status).toBe('closed')

        const y = await importedOrder(client, s, p, 1)
        expect((await closeShort(client, s, y.itemId)).status).toBe('closed')
      })
    })
  })

  describe('A13: completion', () => {
    it('is not complete with no reservation and an open line, until it is closed', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        const x = await importedOrder(client, s, p, 5)
        expect(await netOf(client, x.orderId, p)).toBe(0)

        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(false)

        await closeShort(client, s, x.itemId)
        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(true)
      })
    })

    it('is not complete with a little reserved and picked but the line still open', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 2)
        const x = await importedOrder(client, s, p, 5)
        await pick(client, s, x.itemId, 2, s.binA)

        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(false)

        await pick(client, s, x.itemId, 3, s.binA)
        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(true)
      })
    })

    it('is complete here when another warehouse still holds the open part, and not there', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        const second = await newWarehouse(client)
        await receive(client, p, s.binA, 4)
        await receive(client, p, second.bin, 6)
        const x = await importedOrder(client, s, p, 10, { pref: [s.warehouseId, second.warehouseId] })
        expect(await netOf(client, x.orderId, p, second.bin)).toBe(6)

        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(false)

        await pick(client, s, x.itemId, 4, s.binA)
        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(true)
        expect(await pickComplete(client, x.orderId, second.warehouseId)).toBe(false)

        await pick(client, s, x.itemId, 6, second.bin)
        expect(await pickComplete(client, x.orderId, second.warehouseId)).toBe(true)
      })
    })

    it('is not complete when the other warehouse holds only part of the open units', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        const second = await newWarehouse(client)
        await receive(client, p, s.binA, 2)
        await receive(client, p, second.bin, 3)
        const x = await importedOrder(client, s, p, 10, { pref: [s.warehouseId, second.warehouseId] })
        await pick(client, s, x.itemId, 2, s.binA)

        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(false)
      })
    })

    it('shares what another warehouse holds across a product’s open lines', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        const second = await newWarehouse(client)
        await receive(client, p, second.bin, 5)
        const x = await importedOrder(client, s, p, 5, { pref: [second.warehouseId] })
        await client.query(
          `INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, product_name, product_sku)
           VALUES ($1, $2, 5, 10, 'Test', 'TEST')`, [x.orderId, p])

        // 5 held there against 10 open: one line's worth does not cover two.
        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(false)

        await closeShort(client, s, x.itemId)
        // Closing one line gave back nothing, as the other line needs all 5.
        expect(await netOf(client, x.orderId, p)).toBe(5)
        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(true)
      })
    })

    it('counts a closed line as done on an order with a reservation, part picked', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 10)
        const x = await importedOrder(client, s, p, 10)
        await pick(client, s, x.itemId, 3, s.binA)
        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(false)

        await closeShort(client, s, x.itemId, s.binA)

        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(true)
      })
    })
  })

  describe('A13: a product with no open units cannot hold an imported order back', () => {
    it('a closed line whose release the bin could not cover is complete, and dispatch takes nothing', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 20)
        const other = await plainOrder(client, s, p, 10)
        const x = await importedOrder(client, s, p, 10)
        const thief = await plainOrder(client, s, p, 15, false)
        await pick(client, s, thief.itemId, 15, s.binA)
        await closeShort(client, s, x.itemId, s.binA)
        expect(await netOf(client, x.orderId, p)).toBe(10)

        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(true)

        const warnings = await warningsDuring(client, () => release(client, s, x.orderId, s.warehouseId))
        expect(warnings).toHaveLength(1)
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 5, allocated: 5 })
        expect(await netOf(client, other.orderId, p)).toBe(10)
      })
    })

    it('a line fully picked at one warehouse leaves both complete, and dispatch at the other frees its units', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        const second = await newWarehouse(client)
        await receive(client, p, s.binA, 5)
        await receive(client, p, second.bin, 5)
        const x = await importedOrder(client, s, p, 10, { pref: [s.warehouseId, second.warehouseId] })
        await receive(client, p, s.binA, 5)
        expect(await pickComplete(client, x.orderId, second.warehouseId)).toBe(false)

        await pick(client, s, x.itemId, 10, s.binA)

        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(true)
        expect(await pickComplete(client, x.orderId, second.warehouseId)).toBe(true)
        expect(await closeShort(client, s, x.itemId)).toEqual({ status: 'already_picked' })
        expect(await bin(client, p, second.bin)).toEqual({ onHand: 5, allocated: 5 })

        // What update-order-status does when warehouse B dispatches.
        await release(client, s, x.orderId, second.warehouseId)

        expect(await bin(client, p, second.bin)).toEqual({ onHand: 5, allocated: 0 })
        expect(await netOf(client, x.orderId, p, second.bin)).toBe(0)
        expect((await bin(client, p, s.binA)).onHand).toBe(0)
      })
    })

    it('an open line not covered elsewhere stays incomplete, closed line beside it or not', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 10)
        const x = await importedOrder(client, s, p, 5)
        const second = await addLine(client, s, x.orderId, p, 5)
        await closeShort(client, s, x.itemId)

        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(false)

        await closeShort(client, s, second)
        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(true)
      })
    })

    it('a product’s open units reserved here and unpicked stay incomplete, even if covered elsewhere', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        const second = await newWarehouse(client)
        await receive(client, p, s.binA, 5)
        await receive(client, p, second.bin, 10)
        const x = await importedOrder(client, s, p, 5, { pref: [s.warehouseId] })
        await client.query('SELECT public.inv_reserve_order($1, $2::jsonb, $3::int[], $4, true)', [
          x.orderId, JSON.stringify([{ product_id: p, quantity: 5 }]), [second.warehouseId], s.actor,
        ])

        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(false)
      })
    })

    it('an ordinary order in the second scenario keeps today’s result', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        const second = await newWarehouse(client)
        await receive(client, p, s.binA, 5)
        await receive(client, p, second.bin, 5)
        const x = await plainOrder(client, s, p, 10, false)
        await client.query('SELECT public.inv_reserve_order($1, $2::jsonb, $3::int[], $4, true)', [
          x.orderId, JSON.stringify([{ product_id: p, quantity: 10 }]), [s.warehouseId, second.warehouseId], s.actor,
        ])
        await receive(client, p, s.binA, 5)

        await pick(client, s, x.itemId, 10, s.binA)

        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(true)
        expect(await pickComplete(client, x.orderId, second.warehouseId)).toBe(false)
      })
    })
  })

  describe('A14: completion on an order with no invoice number', () => {
    it('stays vacuously complete with nothing reserved, whatever its lines say', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        const x = await plainOrder(client, s, p, 5, false)

        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(true)
      })
    })

    it('compares reserved and picked at the warehouse, as before', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 5)
        const x = await plainOrder(client, s, p, 5)
        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(false)

        await pick(client, s, x.itemId, 5, s.binA)

        expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(true)
      })
    })
  })

  describe('a difference holds the invoice to the order', () => {
    it('refuses an invoice update once a line is closed short with zero picks, changing nothing', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 20)
        const x = await importedOrder(client, s, p, 5)
        await closeShort(client, s, x.itemId, s.binA)
        const before = await snapshot(client, x.orderId, x.number, p)

        expect(await callUpdate(client, s, x.number, [line(p, 2, 50)]))
          .toEqual({ status: 'refused', reason: 'difference_recorded' })

        expect(await snapshot(client, x.orderId, x.number, p)).toEqual(before)
        expect(await itemsOf(client, x.orderId)).toHaveLength(1)
        expect(await differences(client, x.orderId)).toHaveLength(1)
      })
    })

    it('still updates an order with no difference', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 20)
        const x = await importedOrder(client, s, p, 5)

        expect((await callUpdate(client, s, x.number, [line(p, 2, 50)])).status).toBe('updated')
      })
    })
  })
})

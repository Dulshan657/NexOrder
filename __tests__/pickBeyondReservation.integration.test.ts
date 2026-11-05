/**
 * NX-0029 A10-A12, A14 — a pick on an imported order takes this order's own stock and
 * free stock, never another order's, and records what the bin did not have (mig 00140).
 * Every other order keeps the previous path.
 *
 * Every test runs inside BEGIN … ROLLBACK via `withRollbackTx`. If 00140 is not applied
 * yet, its text runs on the same client inside that same transaction.
 *
 * Run with: `npx vitest run -c vitest.integration.config.ts pickBeyondReservation`
 */
import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { expectRaise, hasDbCreds, withRollbackTx } from './support/pgTestClient'
import {
  netOf,
  newBatch,
  newProduct,
  onHandOf,
  plainOrder,
  receive,
} from './support/qbImportTxHelpers'
import {
  addLine,
  bin,
  cancel,
  closeShort,
  differences,
  importedOrder,
  movementCount,
  pick,
  pickComplete,
  picksOf,
  release,
  row,
  scene,
  warningsDuring,
} from './support/shortPickHelpers'

const PICK = 'SELECT public.inv_pick_order_line($1, $2, $3, $4)'

/** No balance row of the product may leave 0 <= allocated <= on_hand. */
async function expectRowBounds(client: pg.Client, productId: number): Promise<void> {
  const r = await client.query(
    `SELECT id, on_hand, allocated FROM public.inventory_balances
      WHERE product_id=$1 AND NOT (allocated >= 0 AND allocated <= on_hand)`, [productId])
  expect(r.rows).toEqual([])
}

describe('NX-0029 own units settled when free stock is taken first (live RPCs, rollback-isolated)', () => {
  it('leaves no allocation stranded on the later batch, and the release finds nothing', async () => {
    await withRollbackTx(async (client) => {
      const s = await scene(client)
      const p = await newProduct(client, s.supplierId)
      const early = await newBatch(client, p, '2027-01-01')
      const late = await newBatch(client, p, '2027-06-01')
      await receive(client, p, s.binA, 10, { batchId: early })
      await receive(client, p, s.binA, 10, { batchId: late })
      const y = await plainOrder(client, s, p, 10)
      const x = await importedOrder(client, s, p, 10)
      expect((await row(client, p, s.binA, late)).allocated).toBe(10)
      await cancel(client, s, y.orderId)
      expect(await row(client, p, s.binA, early)).toEqual({ on_hand: 10, allocated: 0 })

      const res = await pick(client, s, x.itemId, 10, s.binA)

      expect(res).toEqual({ line_fully_picked: true, order_fully_picked: true, unrecorded_qty_base: 0 })
      expect(await row(client, p, s.binA, early)).toEqual({ on_hand: 0, allocated: 0 })
      expect(await row(client, p, s.binA, late)).toEqual({ on_hand: 10, allocated: 0 })
      expect(await differences(client, x.orderId)).toEqual([])
      await expectRowBounds(client, p)

      const before = await movementCount(client, p)
      const warnings = await warningsDuring(client, () => release(client, s, x.orderId, s.warehouseId))
      expect(warnings).toEqual([])
      expect(await movementCount(client, p)).toBe(before)
      expect(await row(client, p, s.binA, late)).toEqual({ on_hand: 10, allocated: 0 })
    })
  })

  it('writes the settling leg as a pick with no on-hand change, which no netting reads as anything', async () => {
    await withRollbackTx(async (client) => {
      const s = await scene(client)
      const p = await newProduct(client, s.supplierId)
      const early = await newBatch(client, p, '2027-01-01')
      const late = await newBatch(client, p, '2027-06-01')
      await receive(client, p, s.binA, 10, { batchId: early })
      await receive(client, p, s.binA, 10, { batchId: late })
      const y = await plainOrder(client, s, p, 10)
      const x = await importedOrder(client, s, p, 10)
      await cancel(client, s, y.orderId)
      const netBefore = await netOf(client, x.orderId, p)

      await pick(client, s, x.itemId, 4, s.binA)

      const legs = await client.query<{ batch_id: number; qty_delta: number }>(
        `SELECT batch_id, qty_delta FROM public.inventory_movements
          WHERE ref_id=$1 AND movement_type='pick' ORDER BY id`, [x.orderId])
      expect(legs.rows).toEqual([
        { batch_id: early, qty_delta: -4 },
        { batch_id: late, qty_delta: 0 },
      ])
      // allocate and deallocate are all the holding reads; the picks come from pick_progress.
      expect(await netOf(client, x.orderId, p)).toBe(netBefore)
      const own = await client.query<{ q: number }>(
        'SELECT public.inv_order_bin_remainder($1, $2, $3) AS q', [x.orderId, p, s.binA])
      expect(own.rows[0].q).toBe(6)
      const seenByOther = await client.query<{ q: number }>(
        "SELECT public.inv_others_bin_holdings('NX0029-NO-SUCH-ORDER', $1, $2) AS q", [p, s.binA])
      expect(seenByOther.rows[0].q).toBe(6)
      expect(await bin(client, p, s.binA)).toEqual({ onHand: 16, allocated: 6 })

      // The second part of the line settles the rest, and the order then holds nothing.
      await pick(client, s, x.itemId, 6, s.binA)
      expect(await bin(client, p, s.binA)).toEqual({ onHand: 10, allocated: 0 })
      expect(await pickComplete(client, x.orderId, s.warehouseId)).toBe(true)
    })
  })

  it('another order in the bin keeps its holding across the settling', async () => {
    await withRollbackTx(async (client) => {
      const s = await scene(client)
      const p = await newProduct(client, s.supplierId)
      const early = await newBatch(client, p, '2027-01-01')
      const late = await newBatch(client, p, '2027-06-01')
      await receive(client, p, s.binA, 10, { batchId: early })
      await receive(client, p, s.binA, 20, { batchId: late })
      const leaver = await plainOrder(client, s, p, 10)
      const other = await plainOrder(client, s, p, 5)
      const x = await importedOrder(client, s, p, 10)
      expect(await bin(client, p, s.binA)).toEqual({ onHand: 30, allocated: 25 })
      await cancel(client, s, leaver.orderId)

      await pick(client, s, x.itemId, 10, s.binA)

      expect(await bin(client, p, s.binA)).toEqual({ onHand: 20, allocated: 5 })
      expect(await netOf(client, other.orderId, p)).toBe(5)
      await expectRowBounds(client, p)

      // The other order still gets all of its units.
      const warnings = await warningsDuring(client, async () => { await pick(client, s, other.itemId, 5, s.binA) })
      expect(warnings).toEqual([])
      expect(await bin(client, p, s.binA)).toEqual({ onHand: 15, allocated: 0 })
    })
  })

  it('settles across several later rows, within each row’s bounds', async () => {
    await withRollbackTx(async (client) => {
      const s = await scene(client)
      const p = await newProduct(client, s.supplierId)
      const a = await newBatch(client, p, '2027-01-01')
      const b = await newBatch(client, p, '2027-02-01')
      const c = await newBatch(client, p, '2027-03-01')
      await receive(client, p, s.binA, 10, { batchId: a })
      await receive(client, p, s.binA, 5, { batchId: b })
      await receive(client, p, s.binA, 10, { batchId: c })
      const leaver = await plainOrder(client, s, p, 10)
      const x = await importedOrder(client, s, p, 10)
      expect((await row(client, p, s.binA, b)).allocated).toBe(5)
      expect((await row(client, p, s.binA, c)).allocated).toBe(5)
      await cancel(client, s, leaver.orderId)

      await pick(client, s, x.itemId, 10, s.binA)

      expect(await row(client, p, s.binA, a)).toEqual({ on_hand: 0, allocated: 0 })
      expect(await row(client, p, s.binA, b)).toEqual({ on_hand: 5, allocated: 0 })
      expect(await row(client, p, s.binA, c)).toEqual({ on_hand: 10, allocated: 0 })
      await expectRowBounds(client, p)
    })
  })

  it('in a drained bin, warns and leaves what the other order holds', async () => {
    await withRollbackTx(async (client) => {
      const s = await scene(client)
      const p = await newProduct(client, s.supplierId)
      const late = await newBatch(client, p, '2027-06-01')
      const mid = await newBatch(client, p, '2027-03-01')
      await receive(client, p, s.binA, 10, { batchId: mid })
      await receive(client, p, s.binA, 10, { batchId: late })
      const y = await plainOrder(client, s, p, 10)
      const x = await importedOrder(client, s, p, 10)
      // An ordinary pick with no reservation draws what the earlier row holds.
      const thief = await plainOrder(client, s, p, 10, false)
      await pick(client, s, thief.itemId, 10, s.binA)
      expect(await bin(client, p, s.binA)).toEqual({ onHand: 10, allocated: 10 })
      const earliest = await newBatch(client, p, '2027-01-01')
      await receive(client, p, s.binA, 10, { batchId: earliest })

      const warnings = await warningsDuring(client, async () => { await pick(client, s, x.itemId, 10, s.binA) })

      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('PICK_SETTLE_SHORTFALL')
      expect(await row(client, p, s.binA, earliest)).toEqual({ on_hand: 0, allocated: 0 })
      expect(await row(client, p, s.binA, late)).toEqual({ on_hand: 10, allocated: 10 })
      expect(await netOf(client, y.orderId, p)).toBe(10)
      await expectRowBounds(client, p)
    })
  })

  it('an ordinary order is not settled: the same pick leaves its later row as today', async () => {
    await withRollbackTx(async (client) => {
      const s = await scene(client)
      const p = await newProduct(client, s.supplierId)
      const early = await newBatch(client, p, '2027-01-01')
      const late = await newBatch(client, p, '2027-06-01')
      await receive(client, p, s.binA, 10, { batchId: early })
      await receive(client, p, s.binA, 10, { batchId: late })
      const y = await plainOrder(client, s, p, 10)
      const x = await plainOrder(client, s, p, 10)
      await cancel(client, s, y.orderId)

      await pick(client, s, x.itemId, 10, s.binA)

      // The flaw recorded for FINAL: A14 keeps this path exactly as it was.
      expect(await row(client, p, s.binA, late)).toEqual({ on_hand: 10, allocated: 10 })
    })
  })
})

describe('NX-0029 picking beyond a reservation (live RPCs, rollback-isolated)', () => {
  it('has database credentials', () => {
    expect(hasDbCreds()).toBe(true)
  })

  describe('A11: own stock and free stock only', () => {
    it('a pick beyond the reservation takes its own units, then free stock', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 5)
        const x = await importedOrder(client, s, p, 10)
        await receive(client, p, s.binA, 10)
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 15, allocated: 5 })

        const res = await pick(client, s, x.itemId, 10, s.binA)

        expect(res).toEqual({ line_fully_picked: true, order_fully_picked: true, unrecorded_qty_base: 0 })
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 5, allocated: 0 })
        expect(await differences(client, x.orderId)).toEqual([])
      })
    })

    it('never lowers another order’s allocated when both hold units in the bin', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 20)
        const other = await plainOrder(client, s, p, 10)
        const x = await importedOrder(client, s, p, 5)
        await receive(client, p, s.binB, 3)

        await pick(client, s, x.itemId, 5, s.binA)

        expect(await bin(client, p, s.binA)).toEqual({ onHand: 15, allocated: 10 })
        expect(await netOf(client, other.orderId, p)).toBe(10)
      })
    })

    it('a pick in a bin this order did not reserve leaves that bin’s holder alone', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 5)
        const x = await importedOrder(client, s, p, 5)
        await receive(client, p, s.binB, 8)
        await plainOrder(client, s, p, 6)
        expect(await bin(client, p, s.binB)).toEqual({ onHand: 8, allocated: 6 })

        await pick(client, s, x.itemId, 2, s.binB)

        expect(await bin(client, p, s.binB)).toEqual({ onHand: 6, allocated: 6 })
        expect((await bin(client, p, s.binA)).allocated).toBe(5)
      })
    })

    it('across batches, in FEFO order, the bin keeps every unit the other order holds', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        const early = await newBatch(client, p, '2027-01-01')
        const late = await newBatch(client, p, '2027-06-01')
        await receive(client, p, s.binA, 10, { batchId: early })
        await receive(client, p, s.binA, 10, { batchId: late })
        const other = await plainOrder(client, s, p, 10)
        const x = await importedOrder(client, s, p, 6)
        expect((await row(client, p, s.binA, late)).allocated).toBe(6)

        await pick(client, s, x.itemId, 6, s.binA)

        // The early row gives up 6 by expiry, and the bin still covers the other order's 10.
        expect(await row(client, p, s.binA, early)).toEqual({ on_hand: 4, allocated: 4 })
        expect(await row(client, p, s.binA, late)).toEqual({ on_hand: 10, allocated: 6 })
        expect((await bin(client, p, s.binA)).allocated).toBe(10)
        expect(await netOf(client, other.orderId, p)).toBe(10)
      })
    })

    it('a product on two lines draws on one shared reservation', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 30)
        const x = await importedOrder(client, s, p, 10)
        const second = await addLine(client, s, x.orderId, p, 1, 10)
        expect((await bin(client, p, s.binA)).allocated).toBe(20)

        await pick(client, s, x.itemId, 10, s.binA)
        expect((await bin(client, p, s.binA)).allocated).toBe(10)
        const res = await pick(client, s, second, 1, s.binA)

        expect(res.order_fully_picked).toBe(true)
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 10, allocated: 0 })
      })
    })
  })

  describe('A12: less on record than was physically picked', () => {
    it('when the only stock is another order’s, records the pick and leaves the bin as it was', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 10)
        const other = await plainOrder(client, s, p, 10)
        const x = await importedOrder(client, s, p, 3)
        expect((await bin(client, p, s.binA)).allocated).toBe(10)

        const res = await pick(client, s, x.itemId, 3, s.binA)

        expect(res).toEqual({ line_fully_picked: true, order_fully_picked: true, unrecorded_qty_base: 3 })
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 10, allocated: 10 })
        expect(await netOf(client, other.orderId, p)).toBe(10)
        const [d, ...rest] = await differences(client, x.orderId)
        expect(rest).toEqual([])
        expect(d).toMatchObject({
          kind: 'unrecorded_stock', location_id: s.binA, unrecorded_qty_base: 3,
          ordered_qty: 3, picked_qty: 3, recount_needed: true, created_by: s.actor,
        })
      })
    })

    it('stops on-hand at what is free and adds the rest to one row per bin on a second pick', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 8)
        await plainOrder(client, s, p, 5)
        const x = await importedOrder(client, s, p, 9, { process: true })
        // x reserved the 3 that were free. Nothing is free now.
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 8, allocated: 8 })

        expect((await pick(client, s, x.itemId, 5, s.binA)).unrecorded_qty_base).toBe(2)
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 5, allocated: 5 })

        expect((await pick(client, s, x.itemId, 4, s.binA)).unrecorded_qty_base).toBe(4)
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 5, allocated: 5 })

        const rows = await differences(client, x.orderId)
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ unrecorded_qty_base: 6, picked_qty: 9, recount_needed: true })
        expect((await picksOf(client, x.orderId)).map((r) => r.picked_qty)).toEqual([5, 4])
      })
    })

    it('flags each bin on its own row', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        const x = await importedOrder(client, s, p, 4)

        await pick(client, s, x.itemId, 1, s.binA)
        await pick(client, s, x.itemId, 3, s.binB)

        const rows = await differences(client, x.orderId)
        expect(rows.map((r) => [r.location_id, r.unrecorded_qty_base])).toEqual([[s.binA, 1], [s.binB, 3]])
      })
    })

    it('allows a pick with no balance row at that bin, with no batch and no stock written', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        const x = await importedOrder(client, s, p, 2, { pack: 6 })

        const res = await pick(client, s, x.itemId, 2, s.binB)

        expect(res).toEqual({ line_fully_picked: true, order_fully_picked: true, unrecorded_qty_base: 12 })
        const balances = await client.query('SELECT 1 FROM public.inventory_balances WHERE product_id=$1', [p])
        expect(balances.rowCount).toBe(0)
        expect(await onHandOf(client, p)).toBe(0)
        expect(await picksOf(client, x.orderId)).toMatchObject([{ location_id: s.binB, batch_id: null, picked_qty: 2 }])
        expect(await differences(client, x.orderId)).toMatchObject([{ unrecorded_qty_base: 12, picked_qty: 2 }])
      })
    })
  })

  describe('A10 and guards on an imported pick', () => {
    it('refuses a pick on a line closed short, changing nothing', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 10)
        const x = await importedOrder(client, s, p, 5)
        await closeShort(client, s, x.itemId, s.binA)

        await expectRaise(client, PICK, [x.itemId, 1, s.binA, s.actor], /LINE_CLOSED_SHORT/)

        expect(await picksOf(client, x.orderId)).toEqual([])
        expect((await bin(client, p, s.binA)).onHand).toBe(10)
      })
    })

    it('keeps OVER_PICK', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 10)
        const x = await importedOrder(client, s, p, 5)
        await pick(client, s, x.itemId, 4, s.binA)

        await expectRaise(client, PICK, [x.itemId, 2, s.binA, s.actor], /OVER_PICK/)
      })
    })

    it('refuses a location that is unknown or under an inactive warehouse', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        const x = await importedOrder(client, s, p, 5)

        await expectRaise(client, PICK, [x.itemId, 1, 2147483646, s.actor], /BAD_LOCATION/)

        await client.query('UPDATE public.locations SET is_active=false WHERE id=$1', [s.warehouseId])
        await expectRaise(client, PICK, [x.itemId, 1, s.binA, s.actor], /BAD_LOCATION/)
        expect(await picksOf(client, x.orderId)).toEqual([])
      })
    })

    it('does not count a closed line as open in order_fully_picked', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 10)
        const x = await importedOrder(client, s, p, 2)
        const second = await addLine(client, s, x.orderId, p, 2)
        await closeShort(client, s, second)

        expect((await pick(client, s, x.itemId, 2, s.binA)).order_fully_picked).toBe(true)
      })
    })
  })

  describe('A14: an order with no invoice number', () => {
    it('still raises INSUFFICIENT_STOCK, atomically, and records nothing', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 3)
        const x = await plainOrder(client, s, p, 5, false)

        await expectRaise(client, PICK, [x.itemId, 5, s.binA, s.actor], /INSUFFICIENT_STOCK/)
        await expectRaise(client, PICK, [x.itemId, 1, s.binB, s.actor], /INSUFFICIENT_STOCK/)

        expect(await bin(client, p, s.binA)).toEqual({ onHand: 3, allocated: 0 })
        expect(await picksOf(client, x.orderId)).toEqual([])
        expect(await differences(client, x.orderId)).toEqual([])
      })
    })

    it('draws as it did before, on-hand and allocated together, with the same result fields', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 10)
        const holder = await plainOrder(client, s, p, 10)
        const x = await plainOrder(client, s, p, 4, false)

        const res = await pick(client, s, x.itemId, 4, s.binA)

        expect(res).toEqual({ line_fully_picked: true, order_fully_picked: true })
        // The previous behaviour, kept on purpose: an ordinary pick lowers what the row holds.
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 6, allocated: 6 })
        expect(await netOf(client, holder.orderId, p)).toBe(10)
        expect(await differences(client, x.orderId)).toEqual([])
      })
    })

    it('keeps OVER_PICK and leaves an unknown location to the stock check', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 10)
        const x = await plainOrder(client, s, p, 2)

        await expectRaise(client, PICK, [x.itemId, 3, s.binA, s.actor], /OVER_PICK/)
        await expectRaise(client, PICK, [x.itemId, 1, 2147483646, s.actor], /INSUFFICIENT_STOCK/)
      })
    })

    it('a line cannot be closed short on it', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 2)
        const x = await plainOrder(client, s, p, 2)

        await expectRaise(client, 'SELECT public.inv_close_line_short($1, NULL, $2)', [x.itemId, s.actor], /NOT_IMPORTED/)
      })
    })
  })
})

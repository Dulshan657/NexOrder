/**
 * NX-0029 A7, A8 — inv_release_reservation gives back only this order's own stock
 * (mig 00140), against the live database.
 *
 * Every test runs inside BEGIN … ROLLBACK via `withRollbackTx`. If 00140 is not applied
 * yet, its text runs on the same client inside that same transaction.
 *
 * Run with: `npx vitest run -c vitest.integration.config.ts releaseOwnReservation`
 */
import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { hasDbCreds, withRollbackTx } from './support/pgTestClient'
import {
  convertRack,
  netOf,
  newBatch,
  newPlate,
  newProduct,
  newWarehouse,
  plainOrder,
  receive,
  type Scene,
} from './support/qbImportTxHelpers'
import {
  bin,
  cancel,
  importedOrder,
  movementCount,
  pick,
  release,
  row,
  scene,
  setStatus,
  warningsDuring,
} from './support/shortPickHelpers'

/** A plain order reserving what there is of `qty`, as place-order does on a short shelf. */
async function partlyReserved(
  client: pg.Client, s: Scene, productId: number, qty: number,
): Promise<{ orderId: string; itemId: number }> {
  const o = await plainOrder(client, s, productId, qty, false)
  await client.query('SELECT public.inv_reserve_order($1, $2::jsonb, $3::int[], $4, true)', [
    o.orderId, JSON.stringify([{ product_id: productId, quantity: qty }]), [s.warehouseId], s.actor,
  ])
  return o
}

describe('NX-0029 releasing an order’s own reservation (live RPCs, rollback-isolated)', () => {
  it('has database credentials', () => {
    expect(hasDbCreds()).toBe(true)
  })

  describe('A7: another order keeps every unit', () => {
    it('a cancel takes only this order’s part, and a second order on the bin keeps all of its own', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 15)
        const other = await plainOrder(client, s, p, 10)
        // Ordered 10, but only 5 were left to reserve.
        const x = await partlyReserved(client, s, p, 10)
        expect((await bin(client, p, s.binA)).allocated).toBe(15)

        expect((await cancel(client, s, x.orderId)).ok).toBe(true)

        expect(await bin(client, p, s.binA)).toEqual({ onHand: 15, allocated: 10 })
        expect(await netOf(client, x.orderId, p)).toBe(0)
        expect(await netOf(client, other.orderId, p)).toBe(10)
      })
    })

    it('a dispatch of a part-picked order takes only what it still holds', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 20)
        const other = await plainOrder(client, s, p, 10)
        const x = await plainOrder(client, s, p, 10)
        await pick(client, s, x.itemId, 6, s.binA)
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 14, allocated: 14 })

        await release(client, s, x.orderId, s.warehouseId)

        expect(await bin(client, p, s.binA)).toEqual({ onHand: 14, allocated: 10 })
        expect(await netOf(client, x.orderId, p)).toBe(6)
        expect(await netOf(client, other.orderId, p)).toBe(10)
      })
    })

    it('an order holding nothing takes nothing, however much it ordered', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 10)
        await plainOrder(client, s, p, 10)
        const x = await plainOrder(client, s, p, 10, false)
        const before = await movementCount(client, p)

        await release(client, s, x.orderId)

        expect(await bin(client, p, s.binA)).toEqual({ onHand: 10, allocated: 10 })
        expect(await movementCount(client, p)).toBe(before)
      })
    })

    it('a release then re-reserve leaves the other order whole and this order holding the same', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 15)
        const other = await plainOrder(client, s, p, 10)
        const x = await partlyReserved(client, s, p, 10)

        await release(client, s, x.orderId)
        await client.query('SELECT public.inv_reserve_order($1, $2::jsonb, $3::int[], $4, true)', [
          x.orderId, JSON.stringify([{ product_id: p, quantity: 10 }]), [s.warehouseId], s.actor,
        ])

        expect(await netOf(client, other.orderId, p)).toBe(10)
        expect(await netOf(client, x.orderId, p)).toBe(5)
        expect((await bin(client, p, s.binA)).allocated).toBe(15)
      })
    })
  })

  describe('A7: a second release changes nothing', () => {
    it('writes no ledger row and moves no balance', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 20)
        await plainOrder(client, s, p, 10)
        const x = await plainOrder(client, s, p, 10)
        await pick(client, s, x.itemId, 4, s.binA)

        await release(client, s, x.orderId)
        const balance = await bin(client, p, s.binA)
        const movements = await movementCount(client, p)

        await release(client, s, x.orderId)
        await release(client, s, x.orderId, s.warehouseId)

        expect(await bin(client, p, s.binA)).toEqual(balance)
        expect(await movementCount(client, p)).toBe(movements)
      })
    })

    it('a fully picked order releases nothing', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 10)
        const x = await plainOrder(client, s, p, 10)
        await pick(client, s, x.itemId, 10, s.binA)
        const before = await movementCount(client, p)

        await release(client, s, x.orderId, s.warehouseId)

        expect(await movementCount(client, p)).toBe(before)
      })
    })
  })

  describe('A7: a release never raises', () => {
    it('warns with the counts and releases what is safe when the bin cannot cover it', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 20)
        const x = await plainOrder(client, s, p, 10)
        const y = await plainOrder(client, s, p, 10)
        // An ordinary pick with no reservation still draws whatever the row holds.
        const thief = await plainOrder(client, s, p, 15, false)
        await pick(client, s, thief.itemId, 15, s.binA)
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 5, allocated: 5 })

        const warnings = await warningsDuring(client, () => release(client, s, x.orderId))

        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toContain('RELEASE_SHORTFALL')
        expect(warnings[0]).toContain(x.orderId)
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 5, allocated: 5 })
        expect(await netOf(client, y.orderId, p)).toBe(10)
      })
    })

    it('counts nothing for another order once it is dispatched, delivered or cancelled', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 15)
        const closed = await plainOrder(client, s, p, 5)
        const x = await plainOrder(client, s, p, 10)
        const thief = await plainOrder(client, s, p, 5, false)
        await pick(client, s, thief.itemId, 5, s.binA)
        await setStatus(client, closed.orderId, 'dispatched')
        await setStatus(client, thief.orderId, 'dispatched')

        const warnings = await warningsDuring(client, () => release(client, s, x.orderId))

        expect(warnings).toEqual([])
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 10, allocated: 0 })
      })
    })
  })

  describe('A7: an ordinary order that picked somewhere other than it reserved', () => {
    it('gives back the bin it reserved, and takes nothing more from anyone', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 15)
        const holderAtA = await plainOrder(client, s, p, 5)
        const x = await plainOrder(client, s, p, 10)
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 15, allocated: 15 })

        await receive(client, p, s.binB, 10)
        const holderAtB = await plainOrder(client, s, p, 10)
        expect(await bin(client, p, s.binB)).toEqual({ onHand: 10, allocated: 10 })

        // The old pick path, still used by every ordinary order: x takes holderAtB's units.
        await pick(client, s, x.itemId, 10, s.binB)
        expect(await bin(client, p, s.binB)).toEqual({ onHand: 0, allocated: 0 })

        await release(client, s, x.orderId, s.warehouseId)

        // The 10 x never picked at A go back. The old release saw ordered - picked = 0
        // and stranded them. holderAtA keeps its 5.
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 15, allocated: 5 })
        expect(await netOf(client, holderAtA.orderId, p)).toBe(5)
        // B is untouched by the release, and holderAtB's later release warns and holds.
        expect(await bin(client, p, s.binB)).toEqual({ onHand: 0, allocated: 0 })
        const warnings = await warningsDuring(client, () => release(client, s, holderAtB.orderId))
        expect(warnings).toHaveLength(1)
        expect(await bin(client, p, s.binB)).toEqual({ onHand: 0, allocated: 0 })
      })
    })
  })

  describe('A7: batches, plates and pack sizes', () => {
    it('reverses each row on its own batch, this order’s own keys first', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        const early = await newBatch(client, p, '2027-01-01')
        const late = await newBatch(client, p, '2027-06-01')
        await receive(client, p, s.binA, 10, { batchId: early })
        await receive(client, p, s.binA, 10, { batchId: late })
        const other = await plainOrder(client, s, p, 6)
        const x = await plainOrder(client, s, p, 8)
        expect((await row(client, p, s.binA, early)).allocated).toBe(10)
        expect((await row(client, p, s.binA, late)).allocated).toBe(4)

        await release(client, s, x.orderId)

        expect((await row(client, p, s.binA, early)).allocated).toBe(6)
        expect((await row(client, p, s.binA, late)).allocated).toBe(0)
        expect(await netOf(client, other.orderId, p)).toBe(6)
        const legs = await client.query<{ batch_id: number; qty_delta: number }>(
          `SELECT batch_id, qty_delta FROM public.inventory_movements
            WHERE ref_id=$1 AND movement_type='deallocate' ORDER BY batch_id`, [x.orderId])
        expect(legs.rows).toEqual([
          { batch_id: early, qty_delta: -4 },
          { batch_id: late, qty_delta: -4 },
        ])
      })
    })

    it('carries the plate of the row it reverses', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        const plate = await newPlate(client, s, s.binA)
        await receive(client, p, s.binA, 10, { huId: plate })
        const x = await plainOrder(client, s, p, 10)

        await release(client, s, x.orderId)

        expect((await row(client, p, s.binA, null, plate)).allocated).toBe(0)
        const legs = await client.query(
          `SELECT handling_unit_id FROM public.inventory_movements
            WHERE ref_id=$1 AND movement_type='deallocate'`, [x.orderId])
        expect(legs.rows.map((r) => Number(r.handling_unit_id))).toEqual([Number(plate)])
      })
    })

    it('finds a holding a rack conversion moved to level 1', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 15)
        const other = await plainOrder(client, s, p, 5)
        const x = await plainOrder(client, s, p, 10)
        const level = await convertRack(client, s, s.binA)
        expect((await bin(client, p, level)).allocated).toBe(15)

        await release(client, s, x.orderId, s.warehouseId)

        expect((await bin(client, p, level)).allocated).toBe(5)
        expect(await netOf(client, other.orderId, p)).toBe(5)
      })
    })

    it('counts picks in base units on a carton line', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 36)
        const x = await importedOrder(client, s, p, 2, { pack: 12 })
        await pick(client, s, x.itemId, 1, s.binA)
        expect(await bin(client, p, s.binA)).toEqual({ onHand: 24, allocated: 12 })

        await release(client, s, x.orderId, s.warehouseId)

        expect(await bin(client, p, s.binA)).toEqual({ onHand: 24, allocated: 0 })
      })
    })
  })

  describe('A8: dispatching from a warehouse with racked bins', () => {
    it('releases what this order holds across the warehouse’s bins when given the warehouse id', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.binA, 6)
        await receive(client, p, s.binB, 6)
        const x = await plainOrder(client, s, p, 10)
        expect((await bin(client, p, s.binA)).allocated + (await bin(client, p, s.binB)).allocated).toBe(10)
        const held = await client.query('SELECT 1 FROM public.inventory_balances WHERE location_id=$1', [s.warehouseId])
        expect(held.rowCount).toBe(0)

        await release(client, s, x.orderId, s.warehouseId)

        expect((await bin(client, p, s.binA)).allocated).toBe(0)
        expect((await bin(client, p, s.binB)).allocated).toBe(0)
        expect(await netOf(client, x.orderId, p)).toBe(0)
      })
    })

    it('leaves another warehouse’s holding alone, and a bin id means that bin alone', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        const second = await newWarehouse(client)
        await receive(client, p, s.binA, 4)
        await receive(client, p, s.binB, 4)
        await receive(client, p, second.bin, 4)
        const x = await plainOrder(client, s, p, 8)
        await client.query('SELECT public.inv_reserve_order($1, $2::jsonb, $3::int[], $4, false)', [
          x.orderId, JSON.stringify([{ product_id: p, quantity: 4 }]), [second.warehouseId], s.actor,
        ])

        await release(client, s, x.orderId, s.binA)
        expect((await bin(client, p, s.binA)).allocated).toBe(0)
        expect((await bin(client, p, s.binB)).allocated).toBe(4)
        expect((await bin(client, p, second.bin)).allocated).toBe(4)

        await release(client, s, x.orderId, s.warehouseId)
        expect((await bin(client, p, s.binB)).allocated).toBe(0)
        expect((await bin(client, p, second.bin)).allocated).toBe(4)
      })
    })

    it('still covers stock on the warehouse row itself, on a flat warehouse', async () => {
      await withRollbackTx(async (client) => {
        const s = await scene(client)
        const p = await newProduct(client, s.supplierId)
        await receive(client, p, s.warehouseId, 10)
        const x = await plainOrder(client, s, p, 10)
        expect((await bin(client, p, s.warehouseId)).allocated).toBe(10)

        await release(client, s, x.orderId, s.warehouseId)

        expect((await bin(client, p, s.warehouseId)).allocated).toBe(0)
      })
    })
  })
})

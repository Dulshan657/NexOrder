/**
 * NX-0050 — "Not this product?" (mig 00152), against the live dev database.
 *
 * Every test runs inside BEGIN … ROLLBACK (withRollbackTx), with made-up data
 * only (TST-LBL-* products in a made-up warehouse), so nothing survives.
 *
 * Run with: `npm run test:integration -- labelMismatch` (dev credentials;
 * migration 00152 applied).
 */
import { describe, it, expect } from 'vitest'
import type pg from 'pg'
import { hasDbCreds, withRollbackTx, expectRaise } from './support/pgTestClient'

let seq = 0
const uniq = (): string => `${Date.now()}-${++seq}`

interface World { token: string; warehouseId: number; warehousePath: string; layoutId: number; bin: number }

async function newProduct(client: pg.Client, token: string, suffix: string): Promise<{ id: number; sku: string }> {
  const supplier = await client.query<{ id: number }>(
    `INSERT INTO public.suppliers (id, name, contact_person, email, phone)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.suppliers), $1, '', $2, '') RETURNING id`,
    [`TST-LBL Supplier ${token}${suffix}`, `tst-lbl-${token}${suffix}@test.local`],
  )
  const sku = `TST-LBL-${token}${suffix}`
  const product = await client.query<{ id: number }>(
    `INSERT INTO public.products (id, sku, name, price, category, unit, carton_size, supplier_id, inventory, size_factor, barcode)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.products), $1, $2, 5, 'Other', 'EA', 12, $3, 0, 1, $4)
     RETURNING id`,
    [sku, `TST-LBL Product ${token}${suffix}`, supplier.rows[0].id, `999${String(Date.now()).slice(-9)}${seq}`],
  )
  return { id: product.rows[0].id, sku }
}

async function seed(client: pg.Client): Promise<World> {
  const token = uniq()
  const warehousePath = `TSTLBLWH${token}`
  const wh = await client.query<{ id: number }>(
    `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, location_type)
     VALUES (NULL, 'WAREHOUSE', $1, $1, $2, true, 'racked') RETURNING id`,
    [`TST-LBL-WH-${token}`, warehousePath],
  )
  const warehouseId = wh.rows[0].id
  const layout = await client.query<{ id: number }>(
    `INSERT INTO public.warehouse_layouts (warehouse_id, name, status, cell_size_m)
     VALUES ($1, 'Test', 'published', 2) RETURNING id`, [warehouseId])
  const layoutId = layout.rows[0].id
  await client.query('UPDATE public.locations SET active_layout_id=$1 WHERE id=$2', [layoutId, warehouseId])
  const code = `TST-LBL-B-${token}`
  const bin = await client.query<{ id: number }>(
    `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, capacity_slots)
     VALUES ($1, 'BIN', $2, $2, $3, true, 100) RETURNING id`,
    [warehouseId, code, `${warehousePath}/${code}`])
  return { token, warehouseId, warehousePath, layoutId, bin: bin.rows[0].id }
}

async function plate(client: pg.Client, w: World, lines: Array<[number, number]>): Promise<number> {
  const h = await client.query<{ id: number }>(
    `INSERT INTO public.handling_units (hu_type, warehouse_id, location_id) VALUES ('carton', $1, $1) RETURNING id`,
    [w.warehouseId])
  for (const [productId, qty] of lines) {
    await client.query(
      `SELECT public.inv_apply_leg($1, $2, NULL, $3, 0, 'receipt', NULL, 'test', NULL, NULL, NULL, $4)`,
      [productId, w.warehouseId, qty, h.rows[0].id])
  }
  return h.rows[0].id
}

async function task(client: pg.Client, w: World, productId: number, qty: number, huId: number | null, status = 'assigned'): Promise<number> {
  const r = await client.query<{ id: string }>(
    `INSERT INTO public.wie_putaway_recommendations
       (warehouse_id, layout_id, product_id, quantity, recommended_location_id, assigned_location_id,
        explanation, engine_version, status, suggestion_source, handling_unit_id)
     VALUES ($1, $2, $3, $4, $5, $5, '{}'::jsonb, 'test', $6, 'engine', $7) RETURNING id`,
    [w.warehouseId, w.layoutId, productId, qty, w.bin, status, huId])
  return Number(r.rows[0].id)
}

async function onHand(client: pg.Client, productId: number, locationId: number): Promise<number> {
  const r = await client.query<{ q: string }>(
    'SELECT COALESCE(SUM(on_hand),0) AS q FROM public.inventory_balances WHERE product_id=$1 AND location_id=$2',
    [productId, locationId])
  return Number(r.rows[0].q)
}

const report = 'SELECT public.wie_report_wrong_product_tx($1, $2, $3, $4, NULL) AS r'

describe('NX-0050 label mismatch (live RPCs, rollback-isolated)', () => {
  it('has database credentials', () => {
    expect(hasDbCreds()).toBe(true)
  })

  it('re-records the stop as the real product at the root, closes it and records the mismatch', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const label = await newProduct(client, w.token, '-L')
      const real = await newProduct(client, w.token, '-R')
      const hu = await plate(client, w, [[label.id, 40]])
      const id = await task(client, w, label.id, 40, hu)

      const out = await client.query<{ r: Record<string, unknown> }>(report, [id, real.id, 70, 'SCANNED-123'])
      const r = out.rows[0].r
      expect(r).toMatchObject({ warehouse_id: w.warehouseId, label_product_id: label.id, scanned_code: 'SCANNED-123' })

      expect(await onHand(client, label.id, w.warehouseId)).toBe(0)
      expect(await onHand(client, real.id, w.warehouseId)).toBe(70)
      const onPlate = await client.query<{ product_id: number; q: string }>(
        'SELECT product_id, SUM(on_hand) AS q FROM public.inventory_balances WHERE handling_unit_id=$1 AND on_hand>0 GROUP BY 1',
        [hu])
      expect(onPlate.rows.map((x) => [x.product_id, Number(x.q)])).toEqual([[real.id, 70]])

      const t = await client.query<{ status: string; resolution_reason: string }>(
        'SELECT status, resolution_reason FROM public.wie_putaway_recommendations WHERE id=$1', [id])
      expect(t.rows[0]).toEqual({ status: 'written_off', resolution_reason: 'label mismatch' })

      const m = await client.query(
        `SELECT scanned_code, label_product_id, real_product_id, quantity::float AS quantity, warehouse_id, putaway_rec_id::int AS rec, status
           FROM public.label_mismatches WHERE id=$1`, [r.mismatch_id])
      expect(m.rows[0]).toEqual({
        scanned_code: 'SCANNED-123', label_product_id: label.id, real_product_id: real.id, quantity: 70,
        warehouse_id: w.warehouseId, rec: id, status: 'open',
      })
    })
  })

  it("with no scanned code, records the label product's barcode", async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const label = await newProduct(client, w.token, '-L')
      const real = await newProduct(client, w.token, '-R')
      const id = await task(client, w, label.id, 5, await plate(client, w, [[label.id, 5]]))
      const out = await client.query<{ r: { scanned_code: string } }>(report, [id, real.id, 5, null])
      const bc = await client.query<{ barcode: string }>('SELECT barcode FROM public.products WHERE id=$1', [label.id])
      expect(out.rows[0].r.scanned_code).toBe(bc.rows[0].barcode)
    })
  })

  it('a lot-received carton comes off under its own batch', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const label = await newProduct(client, w.token, '-L')
      const real = await newProduct(client, w.token, '-R')
      const batch = await client.query<{ id: number }>(
        `INSERT INTO public.batches (product_id, lot_code, expiry_date) VALUES ($1, $2, '2030-01-01') RETURNING id`,
        [label.id, `LOT-${w.token}`])
      const h = await client.query<{ id: number }>(
        `INSERT INTO public.handling_units (hu_type, warehouse_id, location_id) VALUES ('carton', $1, $1) RETURNING id`,
        [w.warehouseId])
      await client.query(
        `SELECT public.inv_apply_leg($1, $2, $3, $4, 0, 'receipt', NULL, 'test', NULL, NULL, NULL, $5)`,
        [label.id, w.warehouseId, batch.rows[0].id, 12, h.rows[0].id])
      const id = await task(client, w, label.id, 12, h.rows[0].id)
      await client.query(report, [id, real.id, 12, 'X'])
      expect(await onHand(client, label.id, w.warehouseId)).toBe(0)
      expect(await onHand(client, real.id, w.warehouseId)).toBe(12)
    })
  })

  it('every open task of the product on that plate is closed together, so none keeps phantom stock', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const label = await newProduct(client, w.token, '-L')
      const real = await newProduct(client, w.token, '-R')
      const hu = await plate(client, w, [[label.id, 100]])
      // One line split into a home part and an overflow part: two tasks, one plate.
      const a = await task(client, w, label.id, 60, hu)
      const b = await task(client, w, label.id, 40, hu, 'suggested')
      const out = await client.query<{ r: { closed_task_ids: number[] } }>(report, [a, real.id, 100, 'X'])
      expect(out.rows[0].r.closed_task_ids.map(Number).sort((x, y) => x - y)).toEqual([a, b].sort((x, y) => x - y))
      const st = await client.query<{ status: string }>(
        'SELECT status FROM public.wie_putaway_recommendations WHERE id = ANY($1::bigint[]) ORDER BY id', [[a, b]])
      expect(st.rows.map((x) => x.status)).toEqual(['written_off', 'written_off'])
      expect(await onHand(client, label.id, w.warehouseId)).toBe(0)
      expect(await onHand(client, real.id, w.warehouseId)).toBe(100)
    })
  })

  it('refuses when the stock is no longer there to re-record, and writes nothing', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const label = await newProduct(client, w.token, '-L')
      const real = await newProduct(client, w.token, '-R')
      const hu = await plate(client, w, [[label.id, 5]])
      const id = await task(client, w, label.id, 8, hu) // the task promises more than the plate holds
      await expectRaise(client, report, [id, real.id, 8, 'X'], /CONFLICT: That stock has been moved or reserved/)
      expect(await onHand(client, label.id, w.warehouseId)).toBe(5)
      expect(await onHand(client, real.id, w.warehouseId)).toBe(0)
    })
  })

  it('refuses the same product, a non-whole quantity, a closed stop and a mixed plate', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const label = await newProduct(client, w.token, '-L')
      const real = await newProduct(client, w.token, '-R')
      const id = await task(client, w, label.id, 5, await plate(client, w, [[label.id, 5]]))
      await expectRaise(client, report, [id, label.id, 5, 'X'], /INVALID_INPUT: That is the same product/)
      await expectRaise(client, report, [id, real.id, 2.5, 'X'], /INVALID_INPUT: Enter how many there are/)
      await expectRaise(client, report, [id, real.id, 0, 'X'], /INVALID_INPUT: Enter how many there are/)

      const done = await task(client, w, label.id, 5, null, 'accepted')
      await expectRaise(client, report, [done, real.id, 5, 'X'], /CONFLICT: This stop is already done/)

      const other = await newProduct(client, w.token, '-O')
      const mixed = await plate(client, w, [[label.id, 3], [other.id, 3]])
      const onMixed = await task(client, w, label.id, 3, mixed)
      await expectRaise(client, report, [onMixed, real.id, 3, 'X'], /CONFLICT: Break this pallet down first/)
      expect(await onHand(client, real.id, w.warehouseId)).toBe(0)
    })
  })

  it('label_mismatches has RLS and only SELECT for signed-in users; the function is service_role only', async () => {
    await withRollbackTx(async (client) => {
      const rls = await client.query<{ r: boolean }>(
        "SELECT relrowsecurity AS r FROM pg_class WHERE oid = 'public.label_mismatches'::regclass")
      expect(rls.rows[0].r).toBe(true)
      const g = await client.query<{ grantee: string; privilege_type: string }>(
        `SELECT grantee, privilege_type FROM information_schema.role_table_grants
          WHERE table_schema='public' AND table_name='label_mismatches' AND grantee IN ('anon','authenticated')`)
      expect(g.rows.map((x) => `${x.grantee}:${x.privilege_type}`).sort()).toEqual(['authenticated:SELECT'])
      const f = await client.query<{ acl: string; definer: boolean }>(
        `SELECT p.proacl::text AS acl, p.prosecdef AS definer FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname='public' AND p.proname='wie_report_wrong_product_tx'`)
      expect(f.rows).toHaveLength(1)
      expect(f.rows[0].definer).toBe(true)
      expect(f.rows[0].acl).toContain('service_role=X')
      expect(f.rows[0].acl).not.toMatch(/(^|[{,])=X|anon=|authenticated=/)
    })
  })
})

/**
 * NX-0006 — single-stage putaway against the live database (mig 00135).
 *
 * Exercises the SQL half of home-first putaway: completing a SUGGESTED task
 * with no assign step, the reason backstop, a short count, both shortage
 * resolutions, pooled completion with "make this the home bin", the desk
 * redirect, and the closest-to-home candidate ranking. Every test runs inside
 * BEGIN … ROLLBACK via `withRollbackTx`, so nothing it writes survives.
 *
 * Run with: `npm run test:integration` (dev credentials; migration 00135 applied).
 */
import { describe, it, expect } from 'vitest'
import type pg from 'pg'
import { hasDbCreds, withRollbackTx, expectRaise } from './support/pgTestClient'

let seq = 0
const uniq = (): string => `${Date.now()}-${++seq}`

interface Scenario {
  warehouseId: number
  layoutId: number
  homeBin: number
  otherBin: number
  farBin: number
  productId: number
}

async function seed(client: pg.Client): Promise<Scenario> {
  const token = uniq()
  const supplier = await client.query<{ id: number }>(
    `INSERT INTO public.suppliers (id, name, contact_person, email, phone)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.suppliers), $1, '', $2, '') RETURNING id`,
    [`PA Supplier ${token}`, `pa-${token}@test.local`],
  )
  const product = await client.query<{ id: number }>(
    `INSERT INTO public.products (id, sku, name, price, category, unit, carton_size, supplier_id, inventory, size_factor)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.products), $1, $2, 5, 'Other', 'EA', 12, $3, 0, 1)
     RETURNING id`,
    [`PA-${token}`, `PA Product ${token}`, supplier.rows[0].id],
  )
  const whPath = `PAWH${token}`
  const wh = await client.query<{ id: number }>(
    `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, location_type)
     VALUES (NULL, 'WAREHOUSE', $1, $1, $2, true, 'racked') RETURNING id`,
    [`PAWH-${token}`, whPath],
  )
  const warehouseId = wh.rows[0].id
  const layout = await client.query<{ id: number }>(
    `INSERT INTO public.warehouse_layouts (warehouse_id, name, status, cell_size_m)
     VALUES ($1, 'Test', 'published', 2) RETURNING id`,
    [warehouseId],
  )
  const layoutId = layout.rows[0].id
  await client.query('UPDATE public.locations SET active_layout_id=$1 WHERE id=$2', [layoutId, warehouseId])

  const bin = async (suffix: string, x: number): Promise<number> => {
    const code = `PA-${suffix}-${token}`
    const r = await client.query<{ id: number }>(
      `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, capacity_slots)
       VALUES ($1, 'BIN', $2, $2, $3, true, 100) RETURNING id`,
      [warehouseId, code, `${whPath}/${code}`],
    )
    await client.query(
      `INSERT INTO public.layout_placements (layout_id, location_id, floor, x, y, w, h, rotation, graph_node_id, access_offset_m)
       VALUES ($1, $2, 0, $3, 0, 1, 1, 0, NULL, 0)`,
      [layoutId, r.rows[0].id, x],
    )
    return r.rows[0].id
  }
  const homeBin = await bin('HOME', 0)
  const otherBin = await bin('NEAR', 1)
  const farBin = await bin('FAR', 9)

  // Ten units received at the warehouse root: where un-placed goods sit.
  await client.query(
    `SELECT public.inv_apply_leg($1, $2, NULL, 10, 0, 'receipt', NULL, 'test', NULL, NULL)`,
    [product.rows[0].id, warehouseId],
  )
  return { warehouseId, layoutId, homeBin, otherBin, farBin, productId: product.rows[0].id }
}

async function task(client: pg.Client, s: Scenario, qty: number, binId: number): Promise<number> {
  const r = await client.query<{ id: number }>(
    `INSERT INTO public.wie_putaway_recommendations
       (warehouse_id, layout_id, product_id, quantity, recommended_location_id,
        explanation, engine_version, status, suggestion_source)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, 'test', 'suggested', 'home') RETURNING id`,
    [s.warehouseId, s.layoutId, s.productId, qty, binId],
  )
  return r.rows[0].id
}

async function onHand(client: pg.Client, productId: number, locationId: number): Promise<number> {
  const r = await client.query<{ q: string }>(
    'SELECT COALESCE(SUM(on_hand),0) AS q FROM public.inventory_balances WHERE product_id=$1 AND location_id=$2',
    [productId, locationId],
  )
  return Number(r.rows[0].q)
}

async function row(client: pg.Client, id: number): Promise<Record<string, unknown>> {
  const r = await client.query('SELECT * FROM public.wie_putaway_recommendations WHERE id=$1', [id])
  return r.rows[0]
}

// No credential-less fallback: this file runs only under
// vitest.integration.config.ts, whose setup loads dev credentials, so missing
// credentials are a broken run and should fail loudly rather than pass empty.
describe('NX-0006 putaway, home first (live RPCs, rollback-isolated)', () => {
  it('has database credentials', () => {
    expect(hasDbCreds()).toBe(true)
  })

  it('completes a suggested task with no assign step and moves the stock', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      const id = await task(client, s, 10, s.homeBin)
      const r = await client.query('SELECT public.wie_complete_putaway_tx($1, $2) AS r', [id, s.homeBin])
      expect(r.rows[0].r.status).toBe('accepted')
      expect(await onHand(client, s.productId, s.homeBin)).toBe(10)
      expect(await onHand(client, s.productId, s.warehouseId)).toBe(0)
    })
  })

  it('refuses a different bin without a reason, and records one when given', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      const id = await task(client, s, 10, s.homeBin)
      await expectRaise(
        client,
        'SELECT public.wie_complete_putaway_tx($1, $2)', [id, s.otherBin],
        /reason is required/,
      )
      await client.query(
        "SELECT public.wie_complete_putaway_tx($1, $2, NULL, NULL, 'full')", [id, s.otherBin])
      const after = await row(client, id)
      expect(after.status).toBe('overridden')
      expect(after.override_reason).toBe('full')
    })
  })

  it('a short count leaves the remainder at the dock as a shortage; write-off clears it', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      const id = await task(client, s, 10, s.homeBin)
      const r = await client.query(
        'SELECT public.wie_complete_putaway_tx($1, $2, 8, NULL, NULL, true) AS r', [id, s.homeBin])
      expect(r.rows[0].r.remainder_status).toBe('short')
      expect((await row(client, id)).status).toBe('short')
      expect(await onHand(client, s.productId, s.warehouseId)).toBe(2)

      await expectRaise(
        client,
        "SELECT public.wie_resolve_short_putaway_tx($1, 'write_off', '  ', NULL)", [id],
        /needs a reason/,
      )
      await client.query(
        "SELECT public.wie_resolve_short_putaway_tx($1, 'write_off', 'not on the truck', NULL)", [id])
      expect((await row(client, id)).status).toBe('written_off')
      expect(await onHand(client, s.productId, s.warehouseId)).toBe(0)
    })
  })

  it('found puts a shortage back on the floor list', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      const id = await task(client, s, 10, s.homeBin)
      await client.query('SELECT public.wie_complete_putaway_tx($1, $2, 8, NULL, NULL, true)', [id, s.homeBin])
      await client.query("SELECT public.wie_resolve_short_putaway_tx($1, 'found', NULL, NULL)", [id])
      expect((await row(client, id)).status).toBe('suggested')
    })
  })

  it('pools tasks oldest first and sets a home only when there is none', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      const a = await task(client, s, 6, s.otherBin)
      const b = await task(client, s, 4, s.otherBin)
      const r = await client.query(
        'SELECT public.wie_complete_putaway_many_tx($1::jsonb, $2, NULL, NULL, false, true) AS r',
        [JSON.stringify([{ id: a, qty: 6 }, { id: b, qty: 4 }]), s.otherBin],
      )
      expect(r.rows[0].r.home_set).toBe(true)
      expect(await onHand(client, s.productId, s.otherBin)).toBe(10)
      const home = await client.query(
        'SELECT bin_id FROM public.product_home_bins WHERE product_id=$1 AND warehouse_id=$2',
        [s.productId, s.warehouseId])
      expect(home.rows[0].bin_id).toBe(s.otherBin)

      // A second "make home" never moves an existing home.
      await client.query(
        `SELECT public.inv_apply_leg($1, $2, NULL, 3, 0, 'receipt', NULL, 'test', NULL, NULL)`,
        [s.productId, s.warehouseId])
      const c = await task(client, s, 3, s.farBin)
      const again = await client.query(
        'SELECT public.wie_complete_putaway_many_tx($1::jsonb, $2, NULL, NULL, false, true) AS r',
        [JSON.stringify([{ id: c, qty: 3 }]), s.farBin],
      )
      expect(again.rows[0].r.home_set).toBe(false)
      const still = await client.query(
        'SELECT bin_id FROM public.product_home_bins WHERE product_id=$1 AND warehouse_id=$2',
        [s.productId, s.warehouseId])
      expect(still.rows[0].bin_id).toBe(s.otherBin)
    })
  })

  it('redirect changes a suggested bin and remembers the old one', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      const id = await task(client, s, 10, s.homeBin)
      await client.query('SELECT public.wie_redirect_putaway_tx($1, $2, NULL)', [id, s.farBin])
      const after = await row(client, id)
      expect(after.recommended_location_id).toBe(s.farBin)
      expect(after.redirected_from_location_id).toBe(s.homeBin)
      expect(after.suggestion_source).toBe('desk')
    })
  })

  it('ranks candidates by grid distance from the home bin when no travel distance exists', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      const r = await client.query<{ location_id: number; anchor_distance_m: string | null }>(
        'SELECT location_id, anchor_distance_m FROM public.wie_putaway_candidates($1, $2, 50, NULL, false, NULL, $3)',
        [s.layoutId, s.productId, s.homeBin],
      )
      const dist = new Map(r.rows.map((x) => [x.location_id, Number(x.anchor_distance_m)]))
      // One cell over at 2 m per cell; nine cells over is 18 m.
      expect(dist.get(s.homeBin)).toBe(0)
      expect(dist.get(s.otherBin)).toBe(2)
      expect(dist.get(s.farBin)).toBe(18)
    })
  })
})

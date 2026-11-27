/**
 * NX-0049 — one product per location at putaway, and the switch to ignore
 * capacity (mig 00151), against the live dev database.
 *
 * Every test runs inside BEGIN … ROLLBACK (withRollbackTx), with made-up data
 * only (TST-MIX-* products on made-up locations), so nothing it writes
 * survives, including the app_settings switch it flips.
 *
 * Run with: `npm run test:integration -- locationMix` (dev credentials;
 * migration 00151 applied).
 */
import { describe, it, expect } from 'vitest'
import type pg from 'pg'
import { hasDbCreds, withRollbackTx, expectRaise } from './support/pgTestClient'

let seq = 0
const uniq = (): string => `${Date.now()}-${++seq}`

interface World {
  token: string
  warehouseId: number
  warehousePath: string
  layoutId: number
  /** Product A's home (capacity 10). */
  home: number
  /** Two ordinary locations with room. */
  x: number
  y: number
  productId: number
  sku: string
}

async function newProduct(client: pg.Client, token: string, suffix: string, brand: string | null): Promise<{ id: number; sku: string }> {
  const supplier = await client.query<{ id: number }>(
    `INSERT INTO public.suppliers (id, name, contact_person, email, phone)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.suppliers), $1, '', $2, '') RETURNING id`,
    [`TST-MIX Supplier ${token}${suffix}`, `tst-mix-${token}${suffix}@test.local`],
  )
  const sku = `TST-MIX-${token}${suffix}`
  const product = await client.query<{ id: number }>(
    `INSERT INTO public.products (id, sku, name, price, category, unit, carton_size, supplier_id, inventory, size_factor, brand)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.products), $1, $2, 5, 'Other', 'EA', 12, $3, 0, 1, $4)
     RETURNING id`,
    [sku, `TST-MIX Product ${token}${suffix}`, supplier.rows[0].id, brand],
  )
  return { id: product.rows[0].id, sku }
}

async function addBin(
  client: pg.Client, w: { warehouseId: number; warehousePath: string; layoutId: number; token: string },
  name: string, x: number, capacity: number | null, parent?: { id: number; path: string },
): Promise<number> {
  const code = `TST-MIX-${name}-${w.token}`
  const parentId = parent?.id ?? w.warehouseId
  const parentPath = parent?.path ?? w.warehousePath
  const r = await client.query<{ id: number }>(
    `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, capacity_slots)
     VALUES ($1, 'BIN', $2, $2, $3, true, $4) RETURNING id`,
    [parentId, code, `${parentPath}/${code}`, capacity],
  )
  await client.query(
    `INSERT INTO public.layout_placements (layout_id, location_id, floor, x, y, w, h, rotation, graph_node_id, access_offset_m)
     VALUES ($1, $2, 0, $3, 0, 1, 1, 0, NULL, 0)`,
    [w.layoutId, r.rows[0].id, x],
  )
  return r.rows[0].id
}

async function receive(client: pg.Client, productId: number, locationId: number, qty: number, huId?: number): Promise<void> {
  if (huId === undefined) {
    await client.query(
      `SELECT public.inv_apply_leg($1, $2, NULL, $3, 0, 'receipt', NULL, 'test', NULL, NULL)`,
      [productId, locationId, qty],
    )
  } else {
    await client.query(
      `SELECT public.inv_apply_leg($1, $2, NULL, $3, 0, 'receipt', NULL, 'test', NULL, NULL, NULL, $4)`,
      [productId, locationId, qty, huId],
    )
  }
}

async function seed(client: pg.Client, brand: string | null = 'TSTCO'): Promise<World> {
  const token = uniq()
  const p = await newProduct(client, token, '', brand)
  const warehousePath = `TSTMIXWH${token}`
  const wh = await client.query<{ id: number }>(
    `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, location_type)
     VALUES (NULL, 'WAREHOUSE', $1, $1, $2, true, 'racked') RETURNING id`,
    [`TST-MIX-WH-${token}`, warehousePath],
  )
  const warehouseId = wh.rows[0].id
  const layout = await client.query<{ id: number }>(
    `INSERT INTO public.warehouse_layouts (warehouse_id, name, status, cell_size_m)
     VALUES ($1, 'Test', 'published', 2) RETURNING id`,
    [warehouseId],
  )
  const layoutId = layout.rows[0].id
  await client.query('UPDATE public.locations SET active_layout_id=$1 WHERE id=$2', [layoutId, warehouseId])
  const base = { warehouseId, warehousePath, layoutId, token }
  const home = await addBin(client, base, 'H', 0, 10)
  const x = await addBin(client, base, 'X', 1, 100)
  const y = await addBin(client, base, 'Y', 2, 100)
  await receive(client, p.id, warehouseId, 20)
  return { ...base, home, x, y, productId: p.id, sku: p.sku }
}

async function setHome(client: pg.Client, w: World, binId: number, productId = w.productId): Promise<void> {
  await client.query(
    `INSERT INTO public.product_home_bins (product_id, warehouse_id, bin_id, purpose) VALUES ($1, $2, $3, 'primary')`,
    [productId, w.warehouseId, binId],
  )
}

async function task(
  client: pg.Client, w: World, qty: number, binId: number,
  o: { productId?: number; huId?: number; source?: 'home' | 'overflow' | 'engine'; status?: 'suggested' | 'assigned' } = {},
): Promise<number> {
  const r = await client.query<{ id: number }>(
    `INSERT INTO public.wie_putaway_recommendations
       (warehouse_id, layout_id, product_id, quantity, recommended_location_id, assigned_location_id,
        explanation, engine_version, status, suggestion_source, handling_unit_id)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $8 = 'assigned' THEN $5 END, '{}'::jsonb, 'test', $8, $7, $6) RETURNING id`,
    [w.warehouseId, w.layoutId, o.productId ?? w.productId, qty, binId, o.huId ?? null, o.source ?? 'engine', o.status ?? 'suggested'],
  )
  return r.rows[0].id
}

async function plate(client: pg.Client, w: World, lines: Array<[number, number]>): Promise<number> {
  const h = await client.query<{ id: number }>(
    `INSERT INTO public.handling_units (hu_type, warehouse_id, location_id) VALUES ('pallet', $1, $1) RETURNING id`,
    [w.warehouseId],
  )
  for (const [productId, qty] of lines) await receive(client, productId, w.warehouseId, qty, h.rows[0].id)
  return h.rows[0].id
}

async function block(client: pg.Client, rec: number, loc: number): Promise<string | null> {
  const r = await client.query<{ b: string | null }>('SELECT public.wie_home_block($1, $2) AS b', [rec, loc])
  return r.rows[0].b
}

async function onHand(client: pg.Client, productId: number, locationId: number): Promise<number> {
  const r = await client.query<{ q: string }>(
    'SELECT COALESCE(SUM(on_hand),0) AS q FROM public.inventory_balances WHERE product_id=$1 AND location_id=$2',
    [productId, locationId],
  )
  return Number(r.rows[0].q)
}

const completeWithReason = "SELECT public.wie_complete_putaway_tx($1, $2, $3, NULL, 'full')"
const HOLDS = /CONFLICT: TST-MIX-X-\S+ already holds TST-MIX-\S+ \(TST-MIX Product [^)]+\)\. Put this in an empty location/

describe('NX-0049 one product per location (live RPCs, rollback-isolated)', () => {
  it('has database credentials', () => {
    expect(hasDbCreds()).toBe(true)
  })

  it('a location holding another product is refused; an empty one is allowed', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const b = await newProduct(client, w.token, '-B', 'OTHERCO')
      await receive(client, b.id, w.x, 5)
      const id = await task(client, w, 4, w.x)

      expect(await block(client, id, w.x)).toBe(
        `TST-MIX-X-${w.token} already holds ${b.sku} (TST-MIX Product ${w.token}-B). Put this in an empty location.`)
      await expectRaise(client, completeWithReason, [id, w.x, 4], HOLDS)
      await expectRaise(client, "SELECT public.wie_decide_putaway_tx($1, 'accept', $2)", [id, w.x], HOLDS)
      await expectRaise(client, 'SELECT public.wie_assign_putaway_tx($1, $2)', [id, w.x], HOLDS)
      expect(await onHand(client, w.productId, w.x)).toBe(0)

      expect(await block(client, id, w.y)).toBeNull()
      await client.query(completeWithReason, [id, w.y, 4])
      expect(await onHand(client, w.productId, w.y)).toBe(4)
    })
  })

  it('a location holding only this product is allowed', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      await receive(client, w.productId, w.x, 3)
      const id = await task(client, w, 4, w.x)
      expect(await block(client, id, w.x)).toBeNull()
    })
  })

  it('a homed product is told its home first, then the location rule', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      await setHome(client, w, w.home)
      const b = await newProduct(client, w.token, '-B', 'OTHERCO')
      await receive(client, b.id, w.x, 5)
      const id = await task(client, w, 4, w.home, { source: 'home' })
      // The home rule wins while the home has room.
      expect(await block(client, id, w.x)).toMatch(/^Put this in its home location TST-MIX-H-/)
      expect(await block(client, id, w.home)).toBeNull()
    })
  })

  it('a shared home of same-brand homed products is allowed; another brand or a blank brand is not', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client, 'TSTCO')
      const b = await newProduct(client, w.token, '-B', ' tstco ')
      await setHome(client, w, w.home)
      await setHome(client, w, w.home, b.id)
      await receive(client, b.id, w.home, 5)
      const id = await task(client, w, 4, w.home, { source: 'home' })
      expect(await block(client, id, w.home)).toBeNull()

      await client.query('UPDATE public.products SET brand = $1 WHERE id = $2', ['OTHERCO', b.id])
      expect(await block(client, id, w.home)).toMatch(/already holds/)
      await client.query('UPDATE public.products SET brand = NULL WHERE id = $1', [b.id])
      expect(await block(client, id, w.home)).toMatch(/already holds/)
    })
  })

  it('a home holding a stray product is not one the line is held to', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      await setHome(client, w, w.home)
      const stray = await newProduct(client, w.token, '-S', 'OTHERCO')
      await receive(client, stray.id, w.home, 2)
      const id = await task(client, w, 4, w.home, { source: 'home' })
      expect(await block(client, id, w.home)).toMatch(/already holds/)
      // Not stranded: an empty location takes it.
      expect(await block(client, id, w.y)).toBeNull()
    })
  })

  it("another product's open line headed for a location counts; the line's own plate does not", async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const b = await newProduct(client, w.token, '-B', 'OTHERCO')
      await task(client, w, 4, w.x, { productId: b.id, status: 'assigned' })
      const id = await task(client, w, 4, w.x)
      expect(await block(client, id, w.x)).toMatch(/already holds/)

      const mixed = await plate(client, w, [[w.productId, 4], [b.id, 4]])
      const ta = await task(client, w, 4, w.y, { huId: mixed })
      await task(client, w, 4, w.y, { productId: b.id, huId: mixed, status: 'assigned' })
      expect(await block(client, ta, w.y)).toBeNull()
    })
  })

  it('a hold location is never refused by the location rule', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const zp = await client.query<{ id: number }>(
        `INSERT INTO public.zone_profiles (name, zone_type, is_hold) VALUES ($1, 'quarantine', true) RETURNING id`,
        [`TST-MIX hold ${w.token}`])
      const zoneCode = `TST-MIX-QZ-${w.token}`
      const zonePath = `${w.warehousePath}/${zoneCode}`
      const zone = await client.query<{ id: number }>(
        `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, zone_profile_id)
         VALUES ($1, 'ZONE', $2, $2, $3, true, $4) RETURNING id`,
        [w.warehouseId, zoneCode, zonePath, zp.rows[0].id])
      const held = await addBin(client, w, 'Q', 6, 100, { id: zone.rows[0].id, path: zonePath })
      const b = await newProduct(client, w.token, '-B', 'OTHERCO')
      await receive(client, b.id, held, 5)
      const id = await task(client, w, 4, held)
      expect(await block(client, id, held)).toBeNull()
    })
  })

  it('ignoring capacity: a full home still holds the line, in the short words', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      await setHome(client, w, w.home)
      await receive(client, w.productId, w.home, 10) // capacity 10: full
      const id = await task(client, w, 4, w.home, { source: 'home' })
      expect(await block(client, id, w.x)).toBeNull()

      await client.query('UPDATE public.app_settings SET putaway_ignore_capacity = true WHERE id = 1')
      expect(await block(client, id, w.x)).toBe(`Put this in its home location TST-MIX-H-${w.token}.`)
      expect(await block(client, id, w.home)).toBeNull()
    })
  })

  it('putaway_ignore_capacity defaults to off', async () => {
    await withRollbackTx(async (client) => {
      const r = await client.query<{ d: string | null; n: boolean }>(
        `SELECT column_default AS d, is_nullable = 'NO' AS n FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'app_settings' AND column_name = 'putaway_ignore_capacity'`)
      expect(r.rows[0]).toEqual({ d: 'false', n: true })
    })
  })

  it('wie_location_occupants lists stock and open lines in the warehouse', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const b = await newProduct(client, w.token, '-B', 'OTHERCO')
      await receive(client, b.id, w.x, 5)
      const id = await task(client, w, 4, w.y, { status: 'assigned' })
      const r = await client.query<{ location_id: number; product_id: number; rec_id: string | null }>(
        'SELECT location_id, product_id, rec_id FROM public.wie_location_occupants($1)', [w.warehouseId])
      const rows = r.rows.map((x) => [x.location_id, x.product_id, x.rec_id === null ? null : Number(x.rec_id)])
      expect(rows).toEqual(expect.arrayContaining([[w.x, b.id, null], [w.y, w.productId, id]]))
      // Stock still at the warehouse root (not yet put away) is not "in" a location.
      expect(rows.some(([loc]) => loc === w.warehouseId)).toBe(false)
    })
  })

  it('the four functions are service_role only, one overload each', async () => {
    await withRollbackTx(async (client) => {
      const r = await client.query<{ name: string; acl: string; definer: boolean }>(
        `SELECT p.proname AS name, p.proacl::text AS acl, p.prosecdef AS definer
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname IN ('wie_home_block','wie_home_rule','wie_location_mix_block','wie_location_occupants')
          ORDER BY 1`)
      expect(r.rows.map((x) => x.name)).toEqual(
        ['wie_home_block', 'wie_home_rule', 'wie_location_mix_block', 'wie_location_occupants'])
      for (const row of r.rows) {
        expect(row.definer).toBe(true)
        expect(row.acl).toContain('service_role=X')
        expect(row.acl).not.toMatch(/(^|[{,])=X|anon=|authenticated=/)
      }
    })
  })
})

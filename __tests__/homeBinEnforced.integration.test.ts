/**
 * NX-0032 — putaway goes to the home bin, or is refused while the home has room
 * (mig 00142, `wie_home_block`), against the live dev database.
 *
 * Every entry that moves or plans stock is exercised: complete, complete-many,
 * Place now / accept / override (`wie_decide_putaway_tx`), assign and redirect.
 * A bin that is ANOTHER product's primary home is neither offered by
 * `wie_putaway_candidates` nor accepted by any of them.
 *
 * Made-up data only (TST-HOME-* products on made-up bins). Every test runs
 * inside BEGIN … ROLLBACK via `withRollbackTx`, so nothing it writes survives.
 *
 * Run with: `npm run test:integration -- homeBinEnforced` (dev credentials;
 * migration 00142 applied).
 */
import { describe, it, expect } from 'vitest'
import type pg from 'pg'
import { hasDbCreds, withRollbackTx, expectRaise } from './support/pgTestClient'

let seq = 0
const uniq = (): string => `${Date.now()}-${++seq}`

const HOME_ROOM = (n: number): RegExp =>
  new RegExp(`CONFLICT: Put this in its home bin TST-HOME-H-[^;]+; it still has room for ${n}\\. If it is full, ask a manager to set its maximum\\.`)
const OTHERS_HOME = /CONFLICT: TST-HOME-H-\S+ is the home bin of TST-HOME-\S+; choose another bin\./

interface Scenario {
  token: string
  warehouseId: number
  warehousePath: string
  layoutId: number
  /** The home bin: capacity 10, size_factor 1 products. */
  home: number
  /** Another bin with plenty of room. */
  other: number
  /** A third bin, for a second product's home. */
  spare: number
  productId: number
  sku: string
}

async function newProduct(client: pg.Client, token: string, suffix: string): Promise<{ id: number; sku: string }> {
  const supplier = await client.query<{ id: number }>(
    `INSERT INTO public.suppliers (id, name, contact_person, email, phone)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.suppliers), $1, '', $2, '') RETURNING id`,
    [`TST-HOME Supplier ${token}${suffix}`, `tst-home-${token}${suffix}@test.local`],
  )
  const sku = `TST-HOME-${token}${suffix}`
  const product = await client.query<{ id: number }>(
    `INSERT INTO public.products (id, sku, name, price, category, unit, carton_size, supplier_id, inventory, size_factor)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.products), $1, $2, 5, 'Other', 'EA', 12, $3, 0, 1)
     RETURNING id`,
    [sku, `TST-HOME Product ${token}${suffix}`, supplier.rows[0].id],
  )
  return { id: product.rows[0].id, sku }
}

async function addBin(
  client: pg.Client, s: { warehouseId: number; warehousePath: string; layoutId: number; token: string },
  name: string, x: number, capacity: number | null, parent?: { id: number; path: string },
): Promise<number> {
  const code = `TST-HOME-${name}-${s.token}`
  const parentId = parent?.id ?? s.warehouseId
  const parentPath = parent?.path ?? s.warehousePath
  const r = await client.query<{ id: number }>(
    `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, capacity_slots)
     VALUES ($1, 'BIN', $2, $2, $3, true, $4) RETURNING id`,
    [parentId, code, `${parentPath}/${code}`, capacity],
  )
  await client.query(
    `INSERT INTO public.layout_placements (layout_id, location_id, floor, x, y, w, h, rotation, graph_node_id, access_offset_m)
     VALUES ($1, $2, 0, $3, 0, 1, 1, 0, NULL, 0)`,
    [s.layoutId, r.rows[0].id, x],
  )
  return r.rows[0].id
}

async function seed(client: pg.Client): Promise<Scenario> {
  const token = uniq()
  const p = await newProduct(client, token, '')
  const warehousePath = `TSTHOMEWH${token}`
  const wh = await client.query<{ id: number }>(
    `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, location_type)
     VALUES (NULL, 'WAREHOUSE', $1, $1, $2, true, 'racked') RETURNING id`,
    [`TST-HOME-WH-${token}`, warehousePath],
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
  const other = await addBin(client, base, 'X', 1, 100)
  const spare = await addBin(client, base, 'Y', 2, 100)

  // Twenty units received at the warehouse root: where un-placed goods sit.
  await receive(client, p.id, warehouseId, 20)
  return { ...base, home, other, spare, productId: p.id, sku: p.sku }
}

async function receive(client: pg.Client, productId: number, locationId: number, qty: number): Promise<void> {
  await client.query(
    `SELECT public.inv_apply_leg($1, $2, NULL, $3, 0, 'receipt', NULL, 'test', NULL, NULL)`,
    [productId, locationId, qty],
  )
}

async function setHome(
  client: pg.Client, s: Scenario, binId: number, o: { productId?: number; maxQty?: number } = {},
): Promise<void> {
  await client.query(
    `INSERT INTO public.product_home_bins (product_id, warehouse_id, bin_id, purpose, max_qty)
     VALUES ($1, $2, $3, 'primary', $4)`,
    [o.productId ?? s.productId, s.warehouseId, binId, o.maxQty ?? null],
  )
}

async function task(
  client: pg.Client, s: Scenario, qty: number, binId: number,
  o: { productId?: number; huId?: number } = {},
): Promise<number> {
  const r = await client.query<{ id: number }>(
    `INSERT INTO public.wie_putaway_recommendations
       (warehouse_id, layout_id, product_id, quantity, recommended_location_id,
        explanation, engine_version, status, suggestion_source, handling_unit_id)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, 'test', 'suggested', 'home', $6) RETURNING id`,
    [s.warehouseId, s.layoutId, o.productId ?? s.productId, qty, binId, o.huId ?? null],
  )
  return r.rows[0].id
}

async function plate(client: pg.Client, s: Scenario, lines: Array<[number, number]>): Promise<number> {
  const h = await client.query<{ id: number }>(
    `INSERT INTO public.handling_units (hu_type, warehouse_id, location_id) VALUES ('pallet', $1, $1) RETURNING id`,
    [s.warehouseId],
  )
  for (const [productId, qty] of lines) {
    await client.query(
      `SELECT public.inv_apply_leg($1, $2, NULL, $3, 0, 'receipt', NULL, 'test', NULL, NULL, NULL, $4)`,
      [productId, s.warehouseId, qty, h.rows[0].id],
    )
  }
  return h.rows[0].id
}

async function onHand(client: pg.Client, productId: number, locationId: number): Promise<number> {
  const r = await client.query<{ q: string }>(
    'SELECT COALESCE(SUM(on_hand),0) AS q FROM public.inventory_balances WHERE product_id=$1 AND location_id=$2',
    [productId, locationId],
  )
  return Number(r.rows[0].q)
}

async function status(client: pg.Client, id: number): Promise<string> {
  const r = await client.query<{ status: string }>(
    'SELECT status FROM public.wie_putaway_recommendations WHERE id=$1', [id])
  return r.rows[0].status
}

const complete = 'SELECT public.wie_complete_putaway_tx($1, $2)'
const completeWithReason = "SELECT public.wie_complete_putaway_tx($1, $2, $3, NULL, 'full')"

// No credential-less fallback: this file runs only under
// vitest.integration.config.ts, whose setup loads dev credentials, so missing
// credentials are a broken run and should fail loudly rather than pass empty.
describe('NX-0032 home bin enforced (live RPCs, rollback-isolated)', () => {
  it('has database credentials', () => {
    expect(hasDbCreds()).toBe(true)
  })

  // ── A9: another product's home ────────────────────────────────────────────
  it("another product's home is not offered, and completing into it is refused", async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      const b = await newProduct(client, s.token, '-B')
      await setHome(client, s, s.home, { productId: b.id })
      await setHome(client, s, s.spare)        // A has a home of its own elsewhere

      const c = await client.query<{ location_id: number }>(
        'SELECT location_id FROM public.wie_putaway_candidates($1, $2)', [s.layoutId, s.productId])
      const offered = c.rows.map((r) => r.location_id)
      expect(offered).not.toContain(s.home)
      expect(offered).toContain(s.other)

      const id = await task(client, s, 4, s.spare)
      await expectRaise(client, completeWithReason, [id, s.home, 4], OTHERS_HOME)
      await expectRaise(client, completeWithReason, [id, s.home, 4], new RegExp(`home bin of ${b.sku};`))
      expect(await onHand(client, s.productId, s.home)).toBe(0)
    })
  })

  it("an unhomed product is refused another product's home", async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      const b = await newProduct(client, s.token, '-B')
      await setHome(client, s, s.home, { productId: b.id })

      const c = await client.query<{ location_id: number }>(
        'SELECT location_id FROM public.wie_putaway_candidates($1, $2)', [s.layoutId, s.productId])
      expect(c.rows.map((r) => r.location_id)).not.toContain(s.home)

      const id = await task(client, s, 4, s.home)
      await expectRaise(client, complete, [id, s.home], OTHERS_HOME)
      await expectRaise(client, "SELECT public.wie_decide_putaway_tx($1, 'accept', $2)", [id, s.home], OTHERS_HOME)
      expect(await onHand(client, s.productId, s.home)).toBe(0)
    })
  })

  it('two products may share one home bin', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      const b = await newProduct(client, s.token, '-B')
      await setHome(client, s, s.home, { productId: b.id })
      await setHome(client, s, s.home)

      const c = await client.query<{ location_id: number }>(
        'SELECT location_id FROM public.wie_putaway_candidates($1, $2)', [s.layoutId, s.productId])
      expect(c.rows.map((r) => r.location_id)).toContain(s.home)

      const id = await task(client, s, 4, s.home)
      await client.query(complete, [id, s.home])
      expect(await onHand(client, s.productId, s.home)).toBe(4)
    })
  })

  // ── A1: every entry refuses X while H has room ────────────────────────────
  it('refuses completing to X while H has room, before asking for a reason', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      const id = await task(client, s, 4, s.home)
      await expectRaise(client, complete, [id, s.other], HOME_ROOM(10))
      await expectRaise(client, completeWithReason, [id, s.other, 4], HOME_ROOM(10))
      expect(await status(client, id)).toBe('suggested')
      expect(await onHand(client, s.productId, s.other)).toBe(0)
    })
  })

  it('refuses Place now / accept / override / assign / redirect to X', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      const id = await task(client, s, 4, s.home)
      await expectRaise(client, "SELECT public.wie_decide_putaway_tx($1, 'accept', $2)", [id, s.other], HOME_ROOM(10))
      await expectRaise(client, "SELECT public.wie_decide_putaway_tx($1, 'override', $2)", [id, s.other], HOME_ROOM(10))
      await expectRaise(client, "SELECT public.wie_decide_putaway_tx($1, 'override', $2, 2)", [id, s.other], HOME_ROOM(10))
      await expectRaise(client, 'SELECT public.wie_assign_putaway_tx($1, $2)', [id, s.other], HOME_ROOM(10))
      await expectRaise(client, 'SELECT public.wie_redirect_putaway_tx($1, $2, NULL)', [id, s.other], HOME_ROOM(10))
      expect(await status(client, id)).toBe('suggested')
      expect(await onHand(client, s.productId, s.other)).toBe(0)

      // The home itself is accepted through every entry.
      await client.query('SELECT public.wie_redirect_putaway_tx($1, $2, NULL)', [id, s.home])
      await client.query('SELECT public.wie_assign_putaway_tx($1, $2, 1)', [id, s.home])
      await client.query("SELECT public.wie_decide_putaway_tx($1, 'accept', $2, 1)", [id, s.home])
    })
  })

  it('complete-many refuses X while H has room', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      const a = await task(client, s, 3, s.home)
      const b = await task(client, s, 2, s.home)
      await expectRaise(
        client,
        "SELECT public.wie_complete_putaway_many_tx($1::jsonb, $2, NULL, 'full')",
        [JSON.stringify([{ id: a, qty: 3 }, { id: b, qty: 2 }]), s.other],
        /CONFLICT: Put this in its home bin TST-HOME-H-/,
      )
      expect(await status(client, a)).toBe('suggested')
      expect(await status(client, b)).toBe('suggested')
      expect(await onHand(client, s.productId, s.other)).toBe(0)
    })
  })

  // ── A2: full by capacity or by max_qty ────────────────────────────────────
  it('allows X when H is full by capacity', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      await receive(client, s.productId, s.home, 10)
      const id = await task(client, s, 4, s.other)
      await client.query(complete, [id, s.other])
      expect(await onHand(client, s.productId, s.other)).toBe(4)
    })
  })

  it('allows X when H is full by max_qty', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home, { maxQty: 3 })
      await receive(client, s.productId, s.home, 3)
      const id = await task(client, s, 4, s.home)
      await client.query(completeWithReason, [id, s.other, 4])
      expect(await onHand(client, s.productId, s.other)).toBe(4)
    })
  })

  it('a blank capacity and a blank max never fill, so X is refused', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await client.query('UPDATE public.locations SET capacity_slots = NULL WHERE id = $1', [s.home])
      await setHome(client, s, s.home)
      await receive(client, s.productId, s.home, 500)
      const id = await task(client, s, 4, s.other)
      await expectRaise(client, complete, [id, s.other], /CONFLICT: Put this in its home bin TST-HOME-H-[^;]+; it still has room for \d+\./)
    })
  })

  // ── A3: the task's own pending ────────────────────────────────────────────
  it("excludes the task's own pending from the home's room", async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      const id = await task(client, s, 10, s.home)
      await expectRaise(client, completeWithReason, [id, s.other, 10], HOME_ROOM(10))
    })
  })

  it("another task's pending does count against the home's room", async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      await task(client, s, 7, s.home)
      const id = await task(client, s, 4, s.other)
      await expectRaise(client, complete, [id, s.other], HOME_ROOM(3))
    })
  })

  it('partial room: refuses 12 elsewhere naming 5; 5 home then 7 elsewhere is allowed', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      await receive(client, s.productId, s.home, 5)
      const id = await task(client, s, 12, s.home)
      await expectRaise(client, completeWithReason, [id, s.other, 12], HOME_ROOM(5))

      await client.query('SELECT public.wie_complete_putaway_tx($1, $2, 5)', [id, s.home])
      await client.query(completeWithReason, [id, s.other, 7])
      expect(await onHand(client, s.productId, s.home)).toBe(10)
      expect(await onHand(client, s.productId, s.other)).toBe(7)
    })
  })

  // ── A4: pallets ───────────────────────────────────────────────────────────
  it('single-product pallet is exempt; mixed pallet line is not', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      const single = await plate(client, s, [[s.productId, 6]])
      const t1 = await task(client, s, 6, s.other, { huId: single })
      await client.query(complete, [t1, s.other])
      expect(await onHand(client, s.productId, s.other)).toBe(6)

      const b = await newProduct(client, s.token, '-B')
      const mixed = await plate(client, s, [[s.productId, 4], [b.id, 4]])
      const t2 = await task(client, s, 4, s.other, { huId: mixed })
      await expectRaise(client, complete, [t2, s.other], HOME_ROOM(10))
    })
  })

  // ── A5: a home putaway could not use does not block ───────────────────────
  it('ineligible home does not block: inactive, then a level role outside allowed_level_roles', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      await client.query('UPDATE public.locations SET is_active = false WHERE id = $1', [s.home])
      const t1 = await task(client, s, 4, s.other)
      await client.query(complete, [t1, s.other])
      expect(await onHand(client, s.productId, s.other)).toBe(4)

      await client.query("UPDATE public.locations SET is_active = true, level_role = 'pick' WHERE id = $1", [s.home])
      await client.query(
        "INSERT INTO public.product_wms_attributes (product_id, allowed_level_roles) VALUES ($1, ARRAY['reserve'])",
        [s.productId])
      const t2 = await task(client, s, 4, s.other)
      await client.query(complete, [t2, s.other])
      expect(await onHand(client, s.productId, s.other)).toBe(8)

      // Same home, role now allowed: it blocks again.
      await client.query(
        "UPDATE public.product_wms_attributes SET allowed_level_roles = ARRAY['pick'] WHERE product_id = $1",
        [s.productId])
      const t3 = await task(client, s, 4, s.other)
      await expectRaise(client, complete, [t3, s.other], HOME_ROOM(10))
    })
  })

  it('a home in a hold zone does not block', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      const zp = await client.query<{ id: number }>(
        `INSERT INTO public.zone_profiles (name, zone_type, is_hold) VALUES ($1, 'quarantine', true) RETURNING id`,
        [`TST-HOME hold ${s.token}`])
      const zoneCode = `TST-HOME-Z-${s.token}`
      const zonePath = `${s.warehousePath}/${zoneCode}`
      const zone = await client.query<{ id: number }>(
        `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, zone_profile_id)
         VALUES ($1, 'ZONE', $2, $2, $3, true, $4) RETURNING id`,
        [s.warehouseId, zoneCode, zonePath, zp.rows[0].id])
      const heldHome = await addBin(client, s, 'H-HOLD', 5, 10, { id: zone.rows[0].id, path: zonePath })
      await setHome(client, s, heldHome)

      const id = await task(client, s, 4, s.other)
      await client.query(complete, [id, s.other])
      expect(await onHand(client, s.productId, s.other)).toBe(4)
    })
  })

  it('product with no home is unchanged', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      const id = await task(client, s, 4, s.home)
      // The pre-00142 rules still apply: a different bin needs a reason.
      await expectRaise(client, complete, [id, s.other], /reason is required/)
      await client.query(completeWithReason, [id, s.other, 4])
      expect(await onHand(client, s.productId, s.other)).toBe(4)
      const r = await client.query<{ b: string | null }>(
        'SELECT public.wie_home_block($1, $2) AS b', [id, s.spare])
      expect(r.rows[0].b).toBeNull()
    })
  })

  it('wie_home_block is service_role only, one overload', async () => {
    await withRollbackTx(async (client) => {
      const r = await client.query<{ sig: string; acl: string; definer: boolean }>(
        `SELECT p.oid::regprocedure::text AS sig, p.proacl::text AS acl, p.prosecdef AS definer
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'wie_home_block'`)
      expect(r.rows).toHaveLength(1)
      expect(r.rows[0].sig).toBe('wie_home_block(bigint,integer)')
      expect(r.rows[0].definer).toBe(true)
      expect(r.rows[0].acl).toContain('service_role=X')
      expect(r.rows[0].acl).not.toMatch(/(^|[{,])=X|anon=|authenticated=/)
    })
  })
})

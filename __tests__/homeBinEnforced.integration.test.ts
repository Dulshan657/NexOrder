/**
 * NX-0032 — putaway goes to the home bin, or is refused while the home has room
 * (mig 00142, `wie_home_block`), against the live dev database.
 *
 * Every entry that moves or plans stock is exercised: complete, complete-many,
 * Place now / accept / override (`wie_decide_putaway_tx`), assign and redirect.
 * A bin that is ANOTHER product's primary home is neither offered by
 * `wie_putaway_candidates` nor accepted by any of them.
 *
 * Made-up data only (TST-HOME-* products on made-up bins). Two kinds of test:
 *
 *  1. "live RPCs": every test runs inside BEGIN … ROLLBACK via `withRollbackTx`,
 *     so nothing it writes survives.
 *  2. "live HTTP" (last describe): calls the deployed `complete-putaway` and
 *     `decide-putaway` functions, which read through their own connections, so
 *     it COMMITS its made-up data (warehouse, bins, product, two tasks) and
 *     creates a made-up Admin auth user, and deletes all of it again in
 *     afterAll. It moves no stock. It needs VITE_SUPABASE_ANON_KEY and
 *     SUPABASE_SERVICE_ROLE_KEY as well as the database password, and it fails
 *     until the two functions with the pre-check are deployed to dev
 *     (`npm run fn:deploy:dev -- complete-putaway decide-putaway`).
 *
 * Run with: `npm run test:integration -- homeBinEnforced` (dev credentials;
 * migration 00142 applied). Add `-t "live RPCs"` to run only the first kind.
 */
import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { connect, hasDbCreds, withRollbackTx, expectRaise } from './support/pgTestClient'
import {
  homeBinFactsFromRow,
  homeBinProblems,
  type HomeBinFactsRow,
} from '../supabase/functions/_shared/wie/homeBinHealth'

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

async function seed(client: pg.Client, o: { stock?: boolean } = {}): Promise<Scenario> {
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
  // The HTTP cases below commit their data and never move stock, so they skip
  // the receipt: a ledger row could not be cleaned up afterwards.
  if (o.stock !== false) await receive(client, p.id, warehouseId, 20)
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
  o: { productId?: number; huId?: number; source?: 'home' | 'overflow' | 'engine'; unitLoad?: boolean } = {},
): Promise<number> {
  // unit_load (00142) only when a case sets it, so the default (false) is what
  // every other case gets, exactly as a pre-00142 row does.
  const withUnitLoad = o.unitLoad !== undefined
  const r = await client.query<{ id: number }>(
    `INSERT INTO public.wie_putaway_recommendations
       (warehouse_id, layout_id, product_id, quantity, recommended_location_id,
        explanation, engine_version, status, suggestion_source, handling_unit_id${withUnitLoad ? ', unit_load' : ''})
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, 'test', 'suggested', $7, $6${withUnitLoad ? ', $8' : ''}) RETURNING id`,
    [s.warehouseId, s.layoutId, o.productId ?? s.productId, qty, binId, o.huId ?? null, o.source ?? 'home',
      ...(withUnitLoad ? [o.unitLoad] : [])],
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

/** The home-bin health facts for one warehouse (mig 00142), one row per primary home. */
async function factsRows(client: pg.Client, warehouseId: number): Promise<HomeBinFactsRow[]> {
  const r = await client.query<HomeBinFactsRow>('SELECT * FROM public.wie_home_bin_facts($1)', [warehouseId])
  return r.rows
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
  // A unit load is what the planner sends past the home: homeFirst.ts plans a
  // single-product pallet line with homeQty 0, and putawayTasks.ts records
  // that decision as unit_load. Only those are exempt (final review C1/I1),
  // and a desk redirect does not change it.
  it('single-product pallet is exempt; mixed pallet line is not', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      const single = await plate(client, s, [[s.productId, 6]])
      const t1 = await task(client, s, 6, s.other, { huId: single, source: 'overflow', unitLoad: true })
      await client.query(complete, [t1, s.other])
      expect(await onHand(client, s.productId, s.other)).toBe(6)

      const b = await newProduct(client, s.token, '-B')
      const mixed = await plate(client, s, [[s.productId, 4], [b.id, 4]])
      const t2 = await task(client, s, 4, s.other, { huId: mixed })
      await expectRaise(client, complete, [t2, s.other], HOME_ROOM(10))
    })
  })

  it('mixed pallet: once product A is home, product B left alone on the plate is refused off-home', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      const b = await newProduct(client, s.token, '-B')
      await setHome(client, s, s.spare, { productId: b.id })
      const mixed = await plate(client, s, [[s.productId, 4], [b.id, 4]])
      const tA = await task(client, s, 4, s.home, { huId: mixed })
      const tB = await task(client, s, 4, s.spare, { productId: b.id, huId: mixed })
      await client.query(complete, [tA, s.home])
      expect(await onHand(client, s.productId, s.home)).toBe(4)

      // The plate now holds B alone, but the planner sent B home.
      await expectRaise(client, complete, [tB, s.other],
        /CONFLICT: Put this in its home bin TST-HOME-Y-[^;]+; it still has room for 100\./)
      expect(await onHand(client, b.id, s.other)).toBe(0)
    })
  })

  it("a 'pallet' plate on a line the planner sent home is refused off-home", async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      // An auto-minted root plate is typed 'pallet' whatever it carries.
      const minted = await plate(client, s, [[s.productId, 6]])
      const id = await task(client, s, 6, s.home, { huId: minted, source: 'home' })
      await expectRaise(client, complete, [id, s.other], HOME_ROOM(10))
      expect(await onHand(client, s.productId, s.other)).toBe(0)
    })
  })

  it("a single-product unit load the planner sent to overflow is still exempt", async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      const unit = await plate(client, s, [[s.productId, 6]])
      const id = await task(client, s, 6, s.other, { huId: unit, source: 'overflow', unitLoad: true })
      const r = await client.query<{ b: string | null }>('SELECT public.wie_home_block($1, $2) AS b', [id, s.other])
      expect(r.rows[0].b).toBeNull()
      await client.query(complete, [id, s.other])
      expect(await onHand(client, s.productId, s.other)).toBe(6)
    })
  })

  it('a home-sent pallet the desk redirected to its home is still refused elsewhere', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      const p = await plate(client, s, [[s.productId, 6]])
      const id = await task(client, s, 6, s.home, { huId: p, source: 'home', unitLoad: false })
      await client.query('SELECT public.wie_redirect_putaway_tx($1, $2, NULL)', [id, s.home])
      const r = await client.query<{ suggestion_source: string; unit_load: boolean }>(
        'SELECT suggestion_source, unit_load FROM public.wie_putaway_recommendations WHERE id = $1', [id])
      expect(r.rows[0]).toEqual({ suggestion_source: 'desk', unit_load: false })
      await expectRaise(client, complete, [id, s.other], HOME_ROOM(10))
      expect(await onHand(client, s.productId, s.other)).toBe(0)
    })
  })

  it('a genuine unit load the desk redirected to another reserve bin stays exempt', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      const p = await plate(client, s, [[s.productId, 6]])
      const id = await task(client, s, 6, s.other, { huId: p, source: 'overflow', unitLoad: true })
      await client.query('SELECT public.wie_redirect_putaway_tx($1, $2, NULL)', [id, s.spare])
      await client.query(complete, [id, s.spare])
      expect(await onHand(client, s.productId, s.spare)).toBe(6)
    })
  })

  it('a split keeps unit_load: partial complete, partial assign and partial Place now', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      const p = await plate(client, s, [[s.productId, 9]])
      const id = await task(client, s, 9, s.other, { huId: p, source: 'overflow', unitLoad: true })
      await client.query('SELECT public.wie_complete_putaway_tx($1, $2, 2)', [id, s.other])
      await client.query('SELECT public.wie_assign_putaway_tx($1, $2, 3, NULL)', [id, s.spare])
      await client.query("SELECT public.wie_decide_putaway_tx($1, 'accept', $2, 1, NULL)", [id, s.other])
      const rows = await client.query<{ id: number; quantity: string; status: string; unit_load: boolean }>(
        `SELECT id, quantity, status, unit_load FROM public.wie_putaway_recommendations
          WHERE product_id = $1 ORDER BY id`, [s.productId])
      expect(rows.rows).toHaveLength(4)
      expect(rows.rows.map((r) => r.unit_load)).toEqual([true, true, true, true])
      const original = rows.rows.find((r) => String(r.id) === String(id))
      expect(original?.status).toBe('suggested')
      expect(Number(original?.quantity)).toBe(3)
    })
  })

  it('a row written before 00142 (unit_load default false) is not exempt', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      const p = await plate(client, s, [[s.productId, 6]])
      const id = await task(client, s, 6, s.other, { huId: p, source: 'overflow' })
      const r = await client.query<{ unit_load: boolean }>(
        'SELECT unit_load FROM public.wie_putaway_recommendations WHERE id = $1', [id])
      expect(r.rows[0].unit_load).toBe(false)
      await expectRaise(client, complete, [id, s.other], HOME_ROOM(10))
    })
  })

  it('unit_load true but the plate is now mixed is not exempt', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      const b = await newProduct(client, s.token, '-B')
      const mixed = await plate(client, s, [[s.productId, 4], [b.id, 4]])
      const id = await task(client, s, 4, s.other, { huId: mixed, source: 'overflow', unitLoad: true })
      await expectRaise(client, complete, [id, s.other], HOME_ROOM(10))
      expect(await onHand(client, s.productId, s.other)).toBe(0)
    })
  })

  it('break-down: a pallet portion keeps the unit-load exemption, a carton portion is held', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      const p = await plate(client, s, [[s.productId, 12]])
      const parent = await task(client, s, 12, s.other, { huId: p, source: 'overflow', unitLoad: true })
      await client.query('SELECT public.wie_assign_putaway_tx($1, $2, NULL, NULL)', [parent, s.other])
      const r = await client.query<{ out: { plates: Array<{ recommendation_id: number; hu_type: string }> } }>(
        'SELECT public.wie_break_down_putaway_tx($1, $2::jsonb, NULL) AS out',
        [parent, JSON.stringify([
          { qty: 6, hu_type: 'pallet', location_id: s.spare },
          { qty: 6, hu_type: 'carton', location_id: s.spare },
        ])])
      const plates = r.rows[0].out.plates
      const palletRec = plates.find((x) => x.hu_type === 'pallet')!.recommendation_id
      const cartonRec = plates.find((x) => x.hu_type === 'carton')!.recommendation_id
      const flags = await client.query<{ id: string; unit_load: boolean }>(
        'SELECT id, unit_load FROM public.wie_putaway_recommendations WHERE id = ANY($1::bigint[]) ORDER BY id',
        [[palletRec, cartonRec]])
      expect(Object.fromEntries(flags.rows.map((x) => [String(x.id), x.unit_load]))).toEqual({
        [String(palletRec)]: true, [String(cartonRec)]: false,
      })

      // The pallet portion goes to the reserve bin it was assigned while the
      // home has room; the carton portion does not.
      await client.query(complete, [palletRec, s.spare])
      expect(await onHand(client, s.productId, s.spare)).toBe(6)
      await expectRaise(client, complete, [cartonRec, s.spare], HOME_ROOM(10))
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

  it("a home not on the warehouse's active layout does not block (M1)", async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      await client.query('DELETE FROM public.layout_placements WHERE layout_id = $1 AND location_id = $2', [s.layoutId, s.home])
      const id = await task(client, s, 4, s.other)
      const r = await client.query<{ b: string | null }>('SELECT public.wie_home_block($1, $2) AS b', [id, s.other])
      expect(r.rows[0].b).toBeNull()
      await client.query(complete, [id, s.other])
      expect(await onHand(client, s.productId, s.other)).toBe(4)
    })
  })

  it("a home outside the task's warehouse does not block, even when placed on its layout (M1)", async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      const wh2Path = `TSTHOMEWH2${s.token}`
      const wh2 = await client.query<{ id: number }>(
        `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, location_type)
         VALUES (NULL, 'WAREHOUSE', $1, $1, $2, true, 'racked') RETURNING id`,
        [`TST-HOME-WH2-${s.token}`, wh2Path])
      // On THIS warehouse's layout, so only the path test can tell.
      const foreign = await addBin(client, s, 'H-FAR', 6, 10, { id: wh2.rows[0].id, path: wh2Path })
      await setHome(client, s, foreign)
      const id = await task(client, s, 4, s.other)
      const r = await client.query<{ b: string | null }>('SELECT public.wie_home_block($1, $2) AS b', [id, s.other])
      expect(r.rows[0].b).toBeNull()
      await client.query(complete, [id, s.other])
      expect(await onHand(client, s.productId, s.other)).toBe(4)
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

  // ── Task 5: the home-bin health facts ─────────────────────────────────────
  it('wie_home_bin_facts returns the made-up home with the expected flags', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await client.query("UPDATE public.locations SET level_role = 'pick' WHERE id = $1", [s.home])
      await setHome(client, s, s.home, { maxQty: 6 })
      await receive(client, s.productId, s.home, 2)
      await task(client, s, 3, s.home)

      const rows = await factsRows(client, s.warehouseId)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        product_id: s.productId,
        sku: s.sku,
        bin_id: s.home,
        bin_code: `TST-HOME-H-${s.token}`,
        bin_warehouse_id: s.warehouseId,
        is_active: true,
        is_hold: false,
        level_role: 'pick',
        is_pick_zone: true,
        allowed_level_roles: [],
        in_active_layout: true,
        // The made-up placement has no walk node, so there is no route.
        has_dock_route: false,
        zone_allowed_categories: null,
        category: 'Other',
        capacity_slots: 10,
        used_slots: 2,
        pending_slots: 3,
        size_factor: 1,
        max_qty: 6,
        on_hand_at_home: 2,
        pending_qty: 3,
      })
      expect(rows[0].level_hu_types).toContain('carton')
    })
  })

  it('wie_home_bin_facts reads the route, layout, activity, role rule, zone and warehouse', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)

      // A dock and a walk node joined by a precomputed distance: a route.
      const dock = await client.query<{ id: number }>(
        "INSERT INTO public.layout_graph_nodes (layout_id, floor, x, y, node_type) VALUES ($1, 0, 0, 0, 'dock') RETURNING id",
        [s.layoutId])
      const walk = await client.query<{ id: number }>(
        "INSERT INTO public.layout_graph_nodes (layout_id, floor, x, y, node_type) VALUES ($1, 0, 1, 0, 'walk') RETURNING id",
        [s.layoutId])
      await client.query(
        'INSERT INTO public.layout_travel_distances (layout_id, from_node_id, to_node_id, distance_m) VALUES ($1, $2, $3, 4)',
        [s.layoutId, dock.rows[0].id, walk.rows[0].id])
      await client.query(
        'UPDATE public.layout_placements SET graph_node_id = $1 WHERE layout_id = $2 AND location_id = $3',
        [walk.rows[0].id, s.layoutId, s.home])
      expect((await factsRows(client, s.warehouseId))[0]).toMatchObject({ has_dock_route: true, in_active_layout: true })

      // Off the published layout, and retired.
      await client.query('DELETE FROM public.layout_placements WHERE layout_id = $1 AND location_id = $2', [s.layoutId, s.home])
      await client.query('UPDATE public.locations SET is_active = false WHERE id = $1', [s.home])
      expect((await factsRows(client, s.warehouseId))[0]).toMatchObject({
        in_active_layout: false, has_dock_route: false, is_active: false,
      })

      // The product's own level-role rule.
      await client.query(
        "INSERT INTO public.product_wms_attributes (product_id, allowed_level_roles) VALUES ($1, ARRAY['reserve'])",
        [s.productId])
      expect((await factsRows(client, s.warehouseId))[0].allowed_level_roles).toEqual(['reserve'])

      // A hold zone with a category allow-list around a second home.
      const zp = await client.query<{ id: number }>(
        `INSERT INTO public.zone_profiles (name, zone_type, is_hold, allowed_categories)
         VALUES ($1, 'quarantine', true, '["Frozen"]'::jsonb) RETURNING id`,
        [`TST-HOME zone ${s.token}`])
      const zoneCode = `TST-HOME-Z-${s.token}`
      const zonePath = `${s.warehousePath}/${zoneCode}`
      const zone = await client.query<{ id: number }>(
        `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, zone_profile_id)
         VALUES ($1, 'ZONE', $2, $2, $3, true, $4) RETURNING id`,
        [s.warehouseId, zoneCode, zonePath, zp.rows[0].id])
      const zoned = await addBin(client, s, 'H-ZONE', 5, 10, { id: zone.rows[0].id, path: zonePath })
      const second = await newProduct(client, s.token, '-B')
      await setHome(client, s, zoned, { productId: second.id })
      const zonedRow = (await factsRows(client, s.warehouseId)).find((r) => r.product_id === second.id)
      expect(zonedRow).toMatchObject({
        bin_id: zoned, is_hold: true, zone_allowed_categories: ['Frozen'], category: 'Other',
      })

      // A home whose bin sits in another warehouse than the one the row is for.
      const otherWh = await client.query<{ id: number }>(
        `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, location_type)
         VALUES (NULL, 'WAREHOUSE', $1, $1, $2, true, 'racked') RETURNING id`,
        [`TST-HOME-WH2-${s.token}`, `TSTHOMEWH2${s.token}`])
      const third = await newProduct(client, s.token, '-C')
      await client.query(
        `INSERT INTO public.product_home_bins (product_id, warehouse_id, bin_id, purpose)
         VALUES ($1, $2, $3, 'primary')`,
        [third.id, otherWh.rows[0].id, s.other])
      const crossed = await factsRows(client, otherWh.rows[0].id)
      expect(crossed).toHaveLength(1)
      expect(crossed[0]).toMatchObject({ bin_id: s.other, bin_warehouse_id: s.warehouseId, in_active_layout: false })
    })
  })

  it('a home that is a legacy bin with no level role reports no role at all', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      const row = (await factsRows(client, s.warehouseId))[0]
      expect(row.level_role).toBeNull()
      expect(row.is_pick_zone).toBe(false)
      expect(row.level_hu_types ?? []).toEqual([])
      const found = homeBinProblems(homeBinFactsFromRow(row, s.warehouseId)).map((p) => p.code)
      expect(found).not.toContain('not_pick_level')
      expect(found).not.toContain('carton_not_allowed')
      expect(found).not.toContain('level_role_not_allowed')
    })
  })

  it('homeBinProblems reports full exactly when wie_home_block would allow an off-home putaway', async () => {
    await withRollbackTx(async (client) => {
      const s = await seed(client)
      await setHome(client, s, s.home)
      const probe = await task(client, s, 1, s.other)

      // Room 0 here means wie_home_block lets the product go elsewhere.
      const agree = async (why: string, expectFull: boolean, productId = s.productId, rec = probe): Promise<void> => {
        const row = (await factsRows(client, s.warehouseId)).find((r) => r.product_id === productId)
        if (!row) throw new Error(`no facts row for product ${productId}`)
        const full = homeBinProblems(homeBinFactsFromRow(row, s.warehouseId)).some((p) => p.code === 'full')
        const block = await client.query<{ b: string | null }>(
          'SELECT public.wie_home_block($1, $2) AS b', [rec, s.other])
        const allows = block.rows[0].b === null
        expect({ why, full, allows }).toEqual({ why, full: expectFull, allows: expectFull })
      }

      await agree('empty home, capacity 10', false)

      await task(client, s, 7, s.home)
      await agree('7 promised to the home, room 3', false)
      await task(client, s, 3, s.home)
      await agree('10 promised to the home, room 0', true)
      await client.query('DELETE FROM public.wie_putaway_recommendations WHERE recommended_location_id = $1', [s.home])

      await client.query('UPDATE public.product_home_bins SET max_qty = 4 WHERE product_id = $1', [s.productId])
      await agree('max 4, nothing there', false)
      await receive(client, s.productId, s.home, 4)
      await agree('max 4, 4 there', true)
      await task(client, s, 2, s.home)
      await agree('still full with a task heading there', true)
      await client.query('DELETE FROM public.wie_putaway_recommendations WHERE recommended_location_id = $1', [s.home])

      await client.query('UPDATE public.product_home_bins SET max_qty = 5 WHERE product_id = $1', [s.productId])
      await agree('max 5, 4 there, room 1', false)
      await task(client, s, 1, s.home)
      await agree('max 5, 4 there and 1 on the way', true)
      await client.query('DELETE FROM public.wie_putaway_recommendations WHERE recommended_location_id = $1', [s.home])

      await client.query('UPDATE public.product_home_bins SET max_qty = NULL WHERE product_id = $1', [s.productId])
      await client.query('UPDATE public.locations SET capacity_slots = NULL WHERE id = $1', [s.home])
      await receive(client, s.productId, s.home, 500)
      await agree('blank capacity and blank max never fill', false)

      await client.query('UPDATE public.locations SET capacity_slots = 10 WHERE id = $1', [s.home])
      await agree('capacity 10 with 504 there', true)

      // A size factor makes room a fraction of a unit: floor(1.5) = 1, floor(0.5) = 0.
      const big = await newProduct(client, s.token, '-S')
      await client.query('UPDATE public.products SET size_factor = 4 WHERE id = $1', [big.id])
      await client.query('UPDATE public.locations SET capacity_slots = 10 WHERE id = $1', [s.spare])
      await setHome(client, s, s.spare, { productId: big.id })
      const bigProbe = await task(client, s, 1, s.other, { productId: big.id })
      await receive(client, big.id, s.spare, 1)
      await agree('size factor 4, one there: 6 slots free = room 1.5', false, big.id, bigProbe)
      await receive(client, big.id, s.spare, 1)
      await agree('size factor 4, two there: 2 slots free = room 0.5', true, big.id, bigProbe)
    })
  })

  it('wie_home_bin_facts is service_role only, one overload', async () => {
    await withRollbackTx(async (client) => {
      const r = await client.query<{ sig: string; acl: string }>(
        `SELECT p.oid::regprocedure::text AS sig, p.proacl::text AS acl
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'wie_home_bin_facts'`)
      expect(r.rows).toHaveLength(1)
      expect(r.rows[0].sig).toBe('wie_home_bin_facts(integer)')
      expect(r.rows[0].acl).toContain('service_role=X')
      expect(r.rows[0].acl).not.toMatch(/(^|[{,])=X|anon=|authenticated=/)
    })
  })
})

// ── The edge functions refuse FIRST (live HTTP, committed made-up data) ──────
//
// The transactions above are the backstop; these prove the functions say the
// home message before anything else is asked of the floor. An edge function
// reads through PostgREST on its own connections, so the data has to be
// COMMITTED: it is made up (TST-HOME-*), moves no stock, and is deleted again
// in afterAll. The caller is a made-up Admin created for the run, so nothing
// depends on a seeded login.
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

/** The refusal as the floor reads it: no "CONFLICT:" prefix, that is the wire code. */
const HOME_ROOM_MSG = (n: number | string): RegExp =>
  new RegExp(`^Put this in its home bin TST-HOME-H-[^;]+; it still has room for ${n}\\. If it is full, ask a manager to set its maximum\\.$`)
const SAY_WHY = /say why it went to a different bin/
const LEVEL_ROLE = /level; .* is only allowed on/

interface HttpFixture {
  s: Scenario
  userId: string
  jwt: string
  /** Suggested to the home; 4 units. */
  taskAtHome: number
  /** Suggested to another bin; 3 units. */
  taskAtOther: number
  /** A bin whose level role this product may not use. */
  levelBin: number
}

interface Reply { status: number; body: { error?: { code: string; message: string } } & Record<string, unknown> }

async function callFn(fn: string, jwt: string, body: unknown): Promise<Reply> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

async function buildHttpFixture(): Promise<HttpFixture> {
  const token = uniq()
  const email = `tst-home-${token}@test.local`
  const password = `Tst-${randomUUID()}`
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // handle_new_user() makes the profile from user_metadata; the role lives there.
  const created = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name: 'TST-HOME Tester', role: 'Admin' },
  })
  if (created.error || !created.data.user) throw new Error(`create test user: ${created.error?.message}`)
  const userId = created.data.user.id

  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const signedIn = await anon.auth.signInWithPassword({ email, password })
  if (signedIn.error || !signedIn.data.session) throw new Error(`sign in test user: ${signedIn.error?.message}`)

  const client = await connect()
  try {
    await client.query('BEGIN')
    const s = await seed(client, { stock: false })
    await setHome(client, s, s.home)
    // BIGINT ids come back from pg as strings; the functions want numbers.
    const taskAtHome = Number(await task(client, s, 4, s.home))
    const taskAtOther = Number(await task(client, s, 3, s.other))
    // A pick-level bin the product is not allowed on: the level-role gate the
    // home rule has to come before.
    const levelBin = await addBin(client, s, 'L', 3, 100)
    await client.query("UPDATE public.locations SET level_role = 'pick' WHERE id = $1", [levelBin])
    await client.query(
      "INSERT INTO public.product_wms_attributes (product_id, allowed_level_roles) VALUES ($1, ARRAY['reserve'])",
      [s.productId])
    await client.query('COMMIT')
    return { s, userId, jwt: signedIn.data.session.access_token, taskAtHome, taskAtOther, levelBin }
  } catch (err) {
    await client.query('ROLLBACK')
    // The user outlives a failed seed otherwise.
    await admin.auth.admin.deleteUser(userId)
    throw err
  } finally {
    await client.end()
  }
}

/** Delete every row the fixture committed, children first. */
async function tearDownHttpFixture(f: HttpFixture): Promise<void> {
  const { s } = f
  const client = await connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM public.wie_putaway_recommendations WHERE warehouse_id = $1', [s.warehouseId])
    await client.query('DELETE FROM public.product_wms_attributes WHERE product_id = $1', [s.productId])
    await client.query('DELETE FROM public.product_home_bins WHERE warehouse_id = $1', [s.warehouseId])
    await client.query('UPDATE public.locations SET active_layout_id = NULL WHERE id = $1', [s.warehouseId])
    await client.query('DELETE FROM public.layout_placements WHERE layout_id = $1', [s.layoutId])
    await client.query('DELETE FROM public.warehouse_layouts WHERE id = $1', [s.layoutId])
    await client.query('DELETE FROM public.locations WHERE parent_id = $1', [s.warehouseId])
    await client.query('DELETE FROM public.locations WHERE id = $1', [s.warehouseId])
    await client.query('DELETE FROM public.products WHERE id = $1', [s.productId])
    await client.query('DELETE FROM public.suppliers WHERE email = $1', [`tst-home-${s.token}@test.local`])
    await client.query('DELETE FROM public.rate_limit_counters WHERE key = ANY ($1)', [
      [`complete-putaway:${f.userId}`, `decide-putaway:${f.userId}`, `decide-putaway:desk:${f.userId}`],
    ])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const removed = await admin.auth.admin.deleteUser(f.userId)
  if (removed.error) throw new Error(`delete test user: ${removed.error.message}`)
}

describe('NX-0032 edge functions refuse an off-home putaway first (live HTTP)', () => {
  let f: HttpFixture

  beforeAll(async () => {
    expect(Boolean(SUPABASE_URL && ANON_KEY && SERVICE_KEY)).toBe(true)
    f = await buildHttpFixture()
  })

  afterAll(async () => {
    if (f) await tearDownHttpFixture(f)
  })

  it('refuses with the home message before asking for a reason', async () => {
    const r = await callFn('complete-putaway', f.jwt, {
      recommendation_id: f.taskAtHome, actual_location_id: f.s.other,
    })
    expect(r.body.error?.message).toMatch(HOME_ROOM_MSG(10))
    expect(r.body.error?.message).not.toMatch(SAY_WHY)
    expect(r.body.error?.code).toBe('CONFLICT')
    expect(r.status).toBe(409)
  })

  it('complete-putaway refuses the same way when the bin comes from a scan', async () => {
    const r = await callFn('complete-putaway', f.jwt, {
      recommendation_id: f.taskAtHome, scan: { locationCode: `TST-HOME-X-${f.s.token}` },
    })
    expect(r.body.error?.message).toMatch(HOME_ROOM_MSG(10))
    expect(r.status).toBe(409)
  })

  it('decide-putaway override to another bin is refused even with role_override', async () => {
    // The opening-stock importer's path: decision override, role_override on.
    const r = await callFn('decide-putaway', f.jwt, {
      recommendation_id: f.taskAtHome, decision: 'override',
      chosen_location_id: f.s.other, role_override: true,
    })
    expect(r.body.error?.message).toMatch(HOME_ROOM_MSG(10))
    expect(r.body.error?.code).toBe('CONFLICT')
    expect(r.status).toBe(409)
  })

  it('decide-putaway accept of a suggestion that is not the home is refused', async () => {
    // Three units suggested elsewhere; four more are already on their way home.
    const r = await callFn('decide-putaway', f.jwt, {
      recommendation_id: f.taskAtOther, decision: 'accept',
    })
    expect(r.body.error?.message).toMatch(HOME_ROOM_MSG(6))
    expect(r.status).toBe(409)
  })

  it('decide-putaway assign_only to another bin is refused', async () => {
    const r = await callFn('decide-putaway', f.jwt, {
      recommendation_id: f.taskAtHome, decision: 'override',
      chosen_location_id: f.s.other, assign_only: true,
    })
    expect(r.body.error?.message).toMatch(HOME_ROOM_MSG(10))
    expect(r.status).toBe(409)
  })

  it('decide-putaway redirect to another bin is refused', async () => {
    const r = await callFn('decide-putaway', f.jwt, {
      recommendation_id: f.taskAtHome, decision: 'redirect', chosen_location_id: f.s.other,
    })
    expect(r.body.error?.message).toMatch(HOME_ROOM_MSG(10))
    expect(r.status).toBe(409)
  })

  it('the home message comes before the level-role gate, and role_override does not lift it', async () => {
    const plain = await callFn('decide-putaway', f.jwt, {
      recommendation_id: f.taskAtHome, decision: 'override', chosen_location_id: f.levelBin,
    })
    expect(plain.body.error?.message).not.toMatch(LEVEL_ROLE)
    expect(plain.body.error?.message).toMatch(HOME_ROOM_MSG(10))
    expect(plain.status).toBe(409)

    const forced = await callFn('decide-putaway', f.jwt, {
      recommendation_id: f.taskAtHome, decision: 'override',
      chosen_location_id: f.levelBin, role_override: true,
    })
    expect(forced.body.error?.message).toMatch(HOME_ROOM_MSG(10))
    expect(forced.status).toBe(409)
  })

  it('a redirect hears the home message before the level-role message', async () => {
    const r = await callFn('decide-putaway', f.jwt, {
      recommendation_id: f.taskAtHome, decision: 'redirect', chosen_location_id: f.levelBin,
    })
    expect(r.body.error?.message).not.toMatch(LEVEL_ROLE)
    expect(r.body.error?.message).toMatch(HOME_ROOM_MSG(10))
    expect(r.status).toBe(409)
  })

  it('left both tasks untouched and moved no stock', async () => {
    const client = await connect()
    try {
      const rows = await client.query<{ id: number; status: string; recommended_location_id: number }>(
        'SELECT id, status, recommended_location_id FROM public.wie_putaway_recommendations WHERE warehouse_id = $1 ORDER BY id',
        [f.s.warehouseId])
      expect(rows.rows.map((r) => [Number(r.id), r.status, r.recommended_location_id])).toEqual([
        [f.taskAtHome, 'suggested', f.s.home],
        [f.taskAtOther, 'suggested', f.s.other],
      ])
      const moved = await client.query<{ n: string }>(
        'SELECT COUNT(*) AS n FROM public.inventory_balances WHERE product_id = $1', [f.s.productId])
      expect(Number(moved.rows[0].n)).toBe(0)
    } finally {
      await client.end()
    }
  })
})

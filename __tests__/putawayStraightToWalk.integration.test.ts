/**
 * NX-0033 — putaway lines go straight onto the Walk (mig 00143), against the
 * live dev database.
 *
 *   wie_confirm_overflow_tx        the walk confirms a loose overflow line: a
 *                                  compare-and-set on the suggested bin, under
 *                                  the same row lock as the desk's Assign
 *   wie_decide_putaway_tx          Place now / accept / override also act on a
 *                                  line the system assigned (assigned_by NULL)
 *   wie_putaway_stops              the walk lists assigned lines and overflow
 *                                  lines awaiting confirmation
 *   wie_home_bin_candidate_facts   every bin in a warehouse read as if it were
 *                                  the product's home (for "Give it a home"),
 *                                  with the line being placed given its own
 *                                  reservation back (mig 00144)
 *
 * Made-up data only (TST-WALK-* products on made-up bins). Two kinds of test:
 *
 *  1. "live RPCs": every test runs inside BEGIN … ROLLBACK via `withRollbackTx`,
 *     so nothing it writes survives.
 *  2. "at once" (last describe): two connections race for one row's lock, so the
 *     made-up world has to be COMMITTED for the second connection to see it. It
 *     is deleted again in afterAll, ledger rows included (the way
 *     tests/e2e/rack-levels/homeBlockWorld.ts tears down).
 *
 * Run with: `npm run test:integration -- putawayStraightToWalk` (dev
 * credentials; migrations 00143 and 00144 applied). Add `-t "live RPCs|at once"` to pick.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type pg from 'pg'
import { connect, hasDbCreds, withRollbackTx, expectRaise } from './support/pgTestClient'
import {
  homeBinCandidateFactsFromRow,
  homeBinChoices,
  homeChoiceRefusal,
  type HomeBinCandidateFacts,
  type HomeBinCandidateFactsRow,
} from '../supabase/functions/_shared/wie/homeBinHealth'

let seq = 0
const uniq = (): string => `${Date.now()}-${++seq}`

const ALREADY_DEALT = /CONFLICT: This line was already dealt with \(it is now (assigned|accepted|expired)\)\./
const NO_LONGER_WAITS = /CONFLICT: This line no longer waits for an overflow confirmation\./
const SUGGESTED_IS_NOW_O1 = /CONFLICT: The suggested bin for this line is now TST-WALK-O1-[^;]+; scan that one\./
const HOME_HAS_ROOM = /CONFLICT: Put this in its home bin TST-WALK-H-/

type Source = 'home' | 'overflow' | 'engine' | 'desk' | null

interface World {
  token: string
  warehouseId: number
  warehousePath: string
  layoutId: number
  /** The product's home: capacity 10. */
  h: number
  /** Overflow bins, capacity 100. */
  o1: number
  o2: number
  /** A spare bin, capacity 100. */
  n: number
  /** An inactive bin. */
  i: number
  /** Another product's home. */
  p: number
  productId: number
  sku: string
  /** The product homed at P. */
  otherProductId: number
  otherSku: string
}

async function newProduct(client: pg.Client, token: string, suffix: string): Promise<{ id: number; sku: string }> {
  const supplier = await client.query<{ id: number }>(
    `INSERT INTO public.suppliers (id, name, contact_person, email, phone)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.suppliers), $1, '', $2, '') RETURNING id`,
    [`TST-WALK Supplier ${token}${suffix}`, `tst-walk-${token}${suffix}@test.local`],
  )
  const sku = `TST-WALK-${token}${suffix}`
  const product = await client.query<{ id: number }>(
    `INSERT INTO public.products (id, sku, name, price, category, unit, carton_size, supplier_id, inventory, size_factor)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.products), $1, $2, 5, 'Other', 'EA', 12, $3, 0, 1)
     RETURNING id`,
    [sku, `TST-WALK Product ${token}${suffix}`, supplier.rows[0].id],
  )
  return { id: product.rows[0].id, sku }
}

async function addBin(
  client: pg.Client, w: { warehouseId: number; warehousePath: string; layoutId: number; token: string },
  name: string, x: number, capacity: number | null, active = true,
): Promise<number> {
  const code = `TST-WALK-${name}-${w.token}`
  const r = await client.query<{ id: number }>(
    `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, capacity_slots)
     VALUES ($1, 'BIN', $2, $2, $3, $4, $5) RETURNING id`,
    [w.warehouseId, code, `${w.warehousePath}/${code}`, active, capacity],
  )
  await client.query(
    `INSERT INTO public.layout_placements (layout_id, location_id, floor, x, y, w, h, rotation, graph_node_id, access_offset_m)
     VALUES ($1, $2, 0, $3, 0, 1, 1, 0, NULL, 0)`,
    [w.layoutId, r.rows[0].id, x],
  )
  return r.rows[0].id
}

/** The made-up world. The product is homed at H; another product at P. */
async function seed(client: pg.Client, o: { stock?: boolean } = {}): Promise<World> {
  const token = uniq()
  const a = await newProduct(client, token, '')
  const b = await newProduct(client, token, '-B')
  const warehousePath = `TSTWALKWH${token}`
  const wh = await client.query<{ id: number }>(
    `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, location_type)
     VALUES (NULL, 'WAREHOUSE', $1, $1, $2, true, 'racked') RETURNING id`,
    [`TST-WALK-WH-${token}`, warehousePath],
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
  const h = await addBin(client, base, 'H', 0, 10)
  const o1 = await addBin(client, base, 'O1', 1, 100)
  const o2 = await addBin(client, base, 'O2', 2, 100)
  const n = await addBin(client, base, 'N', 3, 100)
  const i = await addBin(client, base, 'I', 4, 100, false)
  const p = await addBin(client, base, 'P', 5, 100)
  await client.query(
    `INSERT INTO public.product_home_bins (product_id, warehouse_id, bin_id, purpose)
     VALUES ($1, $3, $4, 'primary'), ($2, $3, $5, 'primary')`,
    [a.id, b.id, warehouseId, h, p],
  )
  // Twenty units received at the warehouse root: where un-placed goods sit.
  if (o.stock !== false) await receive(client, a.id, warehouseId, 20)
  return {
    ...base, h, o1, o2, n, i, p,
    productId: a.id, sku: a.sku, otherProductId: b.id, otherSku: b.sku,
  }
}

async function receive(client: pg.Client, productId: number, locationId: number, qty: number): Promise<void> {
  await client.query(
    `SELECT public.inv_apply_leg($1, $2, NULL, $3, 0, 'receipt', NULL, 'test', NULL, NULL)`,
    [productId, locationId, qty],
  )
}

async function adjust(client: pg.Client, productId: number, locationId: number, delta: number): Promise<void> {
  await client.query(
    `SELECT public.inv_apply_leg($1, $2, NULL, $3, 0, 'adjustment', NULL, 'test', NULL, NULL)`,
    [productId, locationId, delta],
  )
}

interface TaskOpts {
  productId?: number
  source?: Source
  status?: 'suggested' | 'assigned' | 'accepted' | 'expired'
  /** The bin a desk or the system assigned it to (status 'assigned'). */
  assignedTo?: number
  assignedBy?: string | null
  /** The plate the line carries, if any. */
  handlingUnitId?: number | null
}

/** A putaway line. `bin` is the suggested bin (recommended_location_id), or null. */
async function task(client: pg.Client, w: World, qty: number, bin: number | null, o: TaskOpts = {}): Promise<number> {
  const r = await client.query<{ id: string }>(
    `INSERT INTO public.wie_putaway_recommendations
       (warehouse_id, layout_id, product_id, quantity, recommended_location_id,
        explanation, engine_version, status, suggestion_source,
        assigned_location_id, assigned_at, assigned_by, handling_unit_id)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, 'test', $6, $7, $8,
             CASE WHEN $8::int IS NULL THEN NULL ELSE now() END, $9, $10) RETURNING id`,
    [w.warehouseId, w.layoutId, o.productId ?? w.productId, qty, bin,
      o.status ?? 'suggested', o.source === undefined ? 'home' : o.source,
      o.assignedTo ?? null, o.assignedBy ?? null, o.handlingUnitId ?? null],
  )
  // BIGINT comes back as a string; the RPCs take numbers.
  return Number(r.rows[0].id)
}

/** A loose overflow line the planner made because H is full: H holds 10 of 10. */
async function overflowLine(client: pg.Client, w: World, qty: number): Promise<number> {
  await receive(client, w.productId, w.h, 10)
  return task(client, w, qty, w.o1, { source: 'overflow' })
}

interface Row {
  id: number
  status: string
  quantity: number
  assigned_location_id: number | null
  assigned_by: string | null
  recommended_location_id: number | null
}

async function row(client: pg.Client, id: number): Promise<Row> {
  const r = await client.query<Row & { id: string }>(
    `SELECT id, status, quantity, assigned_location_id, assigned_by, recommended_location_id
       FROM public.wie_putaway_recommendations WHERE id = $1`, [id])
  return { ...r.rows[0], id: Number(r.rows[0].id) }
}

async function onHand(client: pg.Client, productId: number, locationId: number): Promise<number> {
  const r = await client.query<{ q: number }>(
    'SELECT COALESCE(SUM(on_hand),0) AS q FROM public.inventory_balances WHERE product_id=$1 AND location_id=$2',
    [productId, locationId],
  )
  return Number(r.rows[0].q)
}

/** Two existing profiles, to stamp assigned_by (it references profiles). Read only. */
async function actors(client: pg.Client): Promise<[string, string]> {
  const r = await client.query<{ id: string }>('SELECT id FROM public.profiles ORDER BY id LIMIT 2')
  if (r.rows.length < 2) throw new Error('dev needs two profiles to tell the walker from the desk')
  return [r.rows[0].id, r.rows[1].id]
}

const confirm = 'SELECT public.wie_confirm_overflow_tx($1, $2, $3) AS out'
const complete = 'SELECT public.wie_complete_putaway_tx($1, $2, $3)'

describe('NX-0033 straight to the walk (live RPCs, rollback-isolated)', () => {
  it('has database credentials', () => {
    expect(hasDbCreds()).toBe(true)
  })

  // ── wie_confirm_overflow_tx ───────────────────────────────────────────────
  it('wie_confirm_overflow_tx assigns an overflow line to its suggested bin, assigned_by the worker', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const [actor] = await actors(client)
      const id = await overflowLine(client, w, 4)
      const rootBefore = await onHand(client, w.productId, w.warehouseId)

      const r = await client.query<{ out: { assigned_id: number; location_id: number } }>(confirm, [id, w.o1, actor])
      expect(Number(r.rows[0].out.assigned_id)).toBe(id)
      expect(r.rows[0].out.location_id).toBe(w.o1)

      expect(await row(client, id)).toMatchObject({
        status: 'assigned', quantity: 4, assigned_location_id: w.o1, assigned_by: actor,
      })
      const at = await client.query<{ assigned_at: Date | null }>(
        'SELECT assigned_at FROM public.wie_putaway_recommendations WHERE id = $1', [id])
      expect(at.rows[0].assigned_at).not.toBeNull()
      // Whole quantity, no split, no stock move.
      const n = await client.query<{ n: string }>(
        'SELECT count(*) AS n FROM public.wie_putaway_recommendations WHERE product_id = $1', [w.productId])
      expect(Number(n.rows[0].n)).toBe(1)
      expect(await onHand(client, w.productId, w.warehouseId)).toBe(rootBefore)
      expect(await onHand(client, w.productId, w.o1)).toBe(0)
    })
  })

  it('refuses a bin other than the suggested one, naming the current one', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const [actor] = await actors(client)
      const id = await overflowLine(client, w, 4)
      await expectRaise(client, confirm, [id, w.o2, actor], SUGGESTED_IS_NOW_O1)
      expect((await row(client, id)).status).toBe('suggested')
    })
  })

  it('refuses a line that is not overflow (home, engine, desk) or has no bin', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const [actor] = await actors(client)
      await receive(client, w.productId, w.h, 10)
      for (const source of ['home', 'engine', 'desk', null] as const) {
        const id = await task(client, w, 4, w.o1, { source })
        await expectRaise(client, confirm, [id, w.o1, actor], NO_LONGER_WAITS)
        expect((await row(client, id)).status).toBe('suggested')
      }
      const noBin = await task(client, w, 4, null, { source: 'overflow' })
      await expectRaise(client, confirm, [noBin, w.o1, actor], NO_LONGER_WAITS)
      expect((await row(client, noBin)).status).toBe('suggested')
    })
  })

  it('refuses a line already assigned, placed or expired', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const [actor] = await actors(client)
      await receive(client, w.productId, w.h, 10)
      const assigned = await task(client, w, 4, w.o1, { source: 'overflow', status: 'assigned', assignedTo: w.o1, assignedBy: actor })
      const placed = await task(client, w, 4, w.o1, { source: 'overflow', status: 'accepted' })
      const expired = await task(client, w, 4, w.o1, { source: 'overflow', status: 'expired' })
      await expectRaise(client, confirm, [assigned, w.o1, actor], /already dealt with \(it is now assigned\)/)
      await expectRaise(client, confirm, [placed, w.o1, actor], /already dealt with \(it is now accepted\)/)
      await expectRaise(client, confirm, [expired, w.o1, actor], /already dealt with \(it is now expired\)/)
      await expectRaise(client, confirm, [expired, w.o1, actor], ALREADY_DEALT)
    })
  })

  it('a confirm is refused by the home rule once the home has room again', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const [actor] = await actors(client)
      const id = await overflowLine(client, w, 4)
      // Stock picked out of the home since the overflow line was made.
      await adjust(client, w.productId, w.h, -5)
      await expectRaise(client, confirm, [id, w.o1, actor], HOME_HAS_ROOM)
      expect((await row(client, id)).status).toBe('suggested')
    })
  })

  it('assign after a walk confirm is refused, and a confirm after a desk assign is refused', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const [walker, desk] = await actors(client)
      const first = await overflowLine(client, w, 4)
      await client.query(confirm, [first, w.o1, walker])
      await expectRaise(client, 'SELECT public.wie_assign_putaway_tx($1, $2, NULL, $3)', [first, w.o1, desk],
        /recommendation already assigned/)
      expect(await row(client, first)).toMatchObject({ status: 'assigned', assigned_by: walker })

      const second = await task(client, w, 3, w.o1, { source: 'overflow' })
      await client.query('SELECT public.wie_assign_putaway_tx($1, $2, NULL, $3)', [second, w.o2, desk])
      await expectRaise(client, confirm, [second, w.o1, walker], /already dealt with/)
      expect(await row(client, second)).toMatchObject({ status: 'assigned', assigned_location_id: w.o2, assigned_by: desk })
    })
  })

  // ── wie_decide_putaway_tx on a system-assigned line (R4) ───────────────────
  it('Place now on a system-assigned line works; on a person-assigned line it is refused', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const [actor] = await actors(client)
      const system = await task(client, w, 4, w.h, { status: 'assigned', assignedTo: w.h, assignedBy: null })
      await client.query("SELECT public.wie_decide_putaway_tx($1, 'accept', $2, NULL, $3)", [system, w.h, actor])
      expect((await row(client, system)).status).toBe('accepted')
      expect(await onHand(client, w.productId, w.h)).toBe(4)
      expect(await onHand(client, w.productId, w.warehouseId)).toBe(16)

      const person = await task(client, w, 4, w.h, { status: 'assigned', assignedTo: w.h, assignedBy: actor })
      await expectRaise(client, "SELECT public.wie_decide_putaway_tx($1, 'accept', $2, NULL, $3)", [person, w.h, actor],
        /recommendation already assigned/)
      await expectRaise(client, "SELECT public.wie_decide_putaway_tx($1, 'override', $2, NULL, $3)", [person, w.h, actor],
        /recommendation already assigned/)
      expect((await row(client, person)).status).toBe('assigned')
      expect(await onHand(client, w.productId, w.h)).toBe(4)
    })
  })

  it('a partial Place now on a system-assigned line leaves the remainder assigned on the walk', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const id = await task(client, w, 6, w.h, { status: 'assigned', assignedTo: w.h, assignedBy: null })
      const r = await client.query<{ out: { decided_id: number; remainder_id: number; remainder_qty: number } }>(
        "SELECT public.wie_decide_putaway_tx($1, 'accept', $2, 2) AS out", [id, w.h])
      expect(Number(r.rows[0].out.remainder_id)).toBe(id)
      expect(Number(r.rows[0].out.remainder_qty)).toBe(4)
      expect(await row(client, id)).toMatchObject({
        status: 'assigned', quantity: 4, assigned_location_id: w.h, assigned_by: null,
      })
      expect((await row(client, Number(r.rows[0].out.decided_id))).status).toBe('accepted')
      expect(await onHand(client, w.productId, w.h)).toBe(2)

      const stops = await client.query<{ rec_id: string; location_id: number; qty_base: number }>(
        'SELECT rec_id, location_id, qty_base FROM public.wie_putaway_stops($1)', [w.warehouseId])
      expect(stops.rows.map((s) => [Number(s.rec_id), s.location_id, s.qty_base])).toEqual([[id, w.h, 4]])
    })
  })

  it('a partial complete of a confirmed overflow line leaves the remainder assigned to the same bin', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const [actor] = await actors(client)
      const id = await overflowLine(client, w, 6)
      await client.query(confirm, [id, w.o1, actor])
      await client.query(complete, [id, w.o1, 2])
      expect(await onHand(client, w.productId, w.o1)).toBe(2)
      expect(await row(client, id)).toMatchObject({
        status: 'assigned', quantity: 4, assigned_location_id: w.o1, assigned_by: actor,
      })
      // Still a plain stop at O1; it does not go back to needing confirmation.
      await expectRaise(client, confirm, [id, w.o1, actor], /already dealt with \(it is now assigned\)/)
      const stops = await client.query<{ rec_id: string; location_id: number }>(
        'SELECT rec_id, location_id FROM public.wie_putaway_stops($1)', [w.warehouseId])
      expect(stops.rows.map((s) => [Number(s.rec_id), s.location_id])).toEqual([[id, w.o1]])
    })
  })

  // ── wie_putaway_stops ─────────────────────────────────────────────────────
  it('wie_putaway_stops lists assigned lines and overflow lines awaiting confirmation at their suggested bin, not other suggested lines', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const [actor] = await actors(client)
      const assigned = await task(client, w, 2, w.h, { status: 'assigned', assignedTo: w.n, assignedBy: actor, source: 'engine' })
      const waiting = await task(client, w, 3, w.o1, { source: 'overflow' })
      await task(client, w, 1, w.h, { source: 'home' })
      await task(client, w, 1, w.n, { source: 'engine' })
      await task(client, w, 1, w.o2, { source: 'desk' })
      await task(client, w, 1, null, { source: 'overflow' })
      await task(client, w, 1, w.o2, { source: 'overflow', status: 'accepted' })

      const stops = await client.query<{ rec_id: string; location_id: number; code: string; qty_base: number; sku: string }>(
        'SELECT rec_id, location_id, code, qty_base, sku FROM public.wie_putaway_stops($1)', [w.warehouseId])
      expect(stops.rows.map((s) => [Number(s.rec_id), s.location_id, s.code, s.qty_base, s.sku])).toEqual([
        [assigned, w.n, `TST-WALK-N-${w.token}`, 2, w.sku],
        [waiting, w.o1, `TST-WALK-O1-${w.token}`, 3, w.sku],
      ])
    })
  })

  // ── wie_home_bin_candidate_facts ──────────────────────────────────────────
  it('wie_home_bin_candidate_facts matches wie_home_bin_facts for an existing home (except max_qty)', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      await client.query("UPDATE public.locations SET level_role = 'pick' WHERE id = $1", [w.h])
      await client.query('UPDATE public.product_home_bins SET max_qty = 6 WHERE product_id = $1', [w.productId])
      await receive(client, w.productId, w.h, 2)
      await task(client, w, 3, w.h)

      const facts = await client.query<Record<string, unknown>>(
        'SELECT * FROM public.wie_home_bin_facts($1) WHERE product_id = $2', [w.warehouseId, w.productId])
      const cand = await client.query<Record<string, unknown>>(
        'SELECT * FROM public.wie_home_bin_candidate_facts($1, $2, $3)', [w.warehouseId, w.productId, w.h])
      expect(facts.rows).toHaveLength(1)
      expect(cand.rows).toHaveLength(1)

      const f = facts.rows[0]
      const c = cand.rows[0]
      // Same columns, same order, then the two extra ones.
      expect(Object.keys(c)).toEqual([...Object.keys(f), 'bin_name', 'other_home_skus'])
      const { max_qty: fMax, ...fShared } = f
      const { max_qty: cMax, bin_name: name, other_home_skus: others, ...cShared } = c
      expect(cShared).toEqual(fShared)
      expect(fMax).toBe(6)
      expect(cMax).toBeNull()
      expect(name).toBe(`TST-WALK-H-${w.token}`)
      expect(others).toEqual([])
      expect(c).toMatchObject({ on_hand_at_home: 2, pending_qty: 3, used_slots: 2, pending_slots: 3 })
    })
  })

  it('wie_home_bin_candidate_facts names another product\'s home in other_home_skus and reads an inactive bin as inactive', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const all = await client.query<{ bin_id: number; bin_code: string; is_active: boolean; other_home_skus: string[] }>(
        'SELECT bin_id, bin_code, is_active, other_home_skus FROM public.wie_home_bin_candidate_facts($1, $2)',
        [w.warehouseId, w.productId])
      // One row per BIN in the warehouse, active or not; not the warehouse itself.
      expect(all.rows.map((r) => r.bin_id).sort((x, y) => x - y)).toEqual(
        [w.h, w.o1, w.o2, w.n, w.i, w.p].sort((x, y) => x - y))
      const byBin = new Map<number, (typeof all.rows)[number]>(all.rows.map((r) => [r.bin_id, r]))
      expect(byBin.get(w.p)?.other_home_skus).toEqual([w.otherSku])
      expect(byBin.get(w.i)?.is_active).toBe(false)
      expect(byBin.get(w.n)).toMatchObject({ is_active: true, other_home_skus: [] })
      // Its own home is not "another product's".
      expect(byBin.get(w.h)?.other_home_skus).toEqual([])

      const one = await client.query<{ bin_id: number; other_home_skus: string[] }>(
        'SELECT bin_id, other_home_skus FROM public.wie_home_bin_candidate_facts($1, $2, $3)',
        [w.warehouseId, w.productId, w.p])
      expect(one.rows).toEqual([{ bin_id: w.p, other_home_skus: [w.otherSku] }])

      // Read for the other product, P is its own and H is someone else's.
      const flipped = await client.query<{ bin_id: number; other_home_skus: string[] }>(
        'SELECT bin_id, other_home_skus FROM public.wie_home_bin_candidate_facts($1, $2) WHERE bin_id = ANY ($3)',
        [w.warehouseId, w.otherProductId, [w.h, w.p]])
      expect(new Map(flipped.rows.map((r) => [r.bin_id, r.other_home_skus]))).toEqual(
        new Map([[w.h, [w.sku]], [w.p, []]]))
    })
  })

  // ── wie_home_bin_candidate_facts: the line's own reservation (mig 00144) ──
  /** Every bin of the warehouse, read for `productId`, with `exclude` lines given back. */
  async function candidateRows(
    client: pg.Client, w: World, productId: number, exclude: number[] | null,
  ): Promise<HomeBinCandidateFactsRow[]> {
    const r = await client.query<HomeBinCandidateFactsRow>(
      'SELECT * FROM public.wie_home_bin_candidate_facts($1, $2, NULL, $3::bigint[])',
      [w.warehouseId, productId, exclude])
    return r.rows
  }

  /** A pallet plate at the warehouse root. */
  async function newPlate(client: pg.Client, w: World): Promise<number> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.handling_units (hu_type, warehouse_id, location_id) VALUES ('pallet', $1, $1) RETURNING id`,
      [w.warehouseId])
    return Number(r.rows[0].id)
  }

  it('wie_home_bin_candidate_facts: no excluded lines (NULL, empty, or lines that are nowhere) reads exactly what v_bin_pending_putaway says, for every bin', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      // Loose lines to O1 (two products), and a pallet-slot bin O2 where a plate
      // is shared by two lines and a second plate stands alone.
      await task(client, w, 3, w.o1, { status: 'suggested' })
      await task(client, w, 4, w.o1, { productId: w.otherProductId, status: 'assigned', assignedTo: w.o1 })
      await client.query("UPDATE public.locations SET slot_kind = 'pallet' WHERE id = $1", [w.o2])
      const shared = await newPlate(client, w)
      const alone = await newPlate(client, w)
      await task(client, w, 2, w.o2, { status: 'assigned', assignedTo: w.o2, handlingUnitId: shared })
      await task(client, w, 5, w.o2, { productId: w.otherProductId, status: 'assigned', assignedTo: w.o2, handlingUnitId: shared })
      await task(client, w, 1, w.o2, { status: 'assigned', assignedTo: w.o2, handlingUnitId: alone })

      const bins = [w.h, w.o1, w.o2, w.n, w.i, w.p]
      const view = await client.query<{ location_id: number; pending_slots: number }>(
        'SELECT location_id, pending_slots FROM public.v_bin_pending_putaway WHERE location_id = ANY ($1)', [bins])
      const expected = new Map<number, number>(view.rows.map((r) => [r.location_id, Number(r.pending_slots)]))
      // The world is not trivial: loose stock counts as quantity x size factor,
      // and a pallet-slot bin counts distinct plates.
      expect(expected.get(w.o1)).toBe(7)
      expect(expected.get(w.o2)).toBe(2)

      for (const exclude of [null, [], [2147483000]]) {
        const rows = await candidateRows(client, w, w.productId, exclude)
        expect(rows).toHaveLength(bins.length)
        const got = new Map<number, number>(rows.map((r) => [r.bin_id, Number(r.pending_slots)]))
        for (const bin of bins) {
          expect({ exclude, bin, slots: got.get(bin) }).toEqual({ exclude, bin, slots: expected.get(bin) ?? 0 })
        }
      }
    })
  })

  it('wie_home_bin_candidate_facts: excluded lines give back their own space and quantity, and nothing else', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      const a = await task(client, w, 3, w.o1, { status: 'suggested' })
      const b = await task(client, w, 4, w.o1, { productId: w.otherProductId, status: 'assigned', assignedTo: w.o1 })
      const at = async (exclude: number[] | null) => {
        const row = (await candidateRows(client, w, w.productId, exclude)).find((r) => r.bin_id === w.o1)
        return { slots: Number(row?.pending_slots), qty: Number(row?.pending_qty) }
      }

      // Read for A: the slots are everyone's, the quantity is A's own.
      expect(await at(null)).toEqual({ slots: 7, qty: 3 })
      expect(await at([a])).toEqual({ slots: 4, qty: 0 })
      // B's line is another product's: its space comes back, A's quantity does not move.
      expect(await at([b])).toEqual({ slots: 3, qty: 3 })
      expect(await at([a, b])).toEqual({ slots: 0, qty: 0 })
      // A line that is no longer open promises nothing, so excluding it changes nothing.
      await client.query("UPDATE public.wie_putaway_recommendations SET status = 'expired' WHERE id = $1", [a])
      expect(await at([a])).toEqual({ slots: 4, qty: 0 })
    })
  })

  it('wie_home_bin_candidate_facts: a plate shared by two lines keeps its slot until both are excluded', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      await client.query("UPDATE public.locations SET slot_kind = 'pallet' WHERE id = $1", [w.o2])
      const shared = await newPlate(client, w)
      const alone = await newPlate(client, w)
      const a = await task(client, w, 2, w.o2, { status: 'assigned', assignedTo: w.o2, handlingUnitId: shared })
      const b = await task(client, w, 5, w.o2, { productId: w.otherProductId, status: 'assigned', assignedTo: w.o2, handlingUnitId: shared })
      const c = await task(client, w, 1, w.o2, { status: 'assigned', assignedTo: w.o2, handlingUnitId: alone })
      const slots = async (exclude: number[] | null) =>
        Number((await candidateRows(client, w, w.productId, exclude)).find((r) => r.bin_id === w.o2)?.pending_slots)

      expect(await slots(null)).toBe(2)
      // B still holds the shared plate's slot after A is given back.
      expect(await slots([a])).toBe(2)
      expect(await slots([a, b])).toBe(1)
      expect(await slots([c])).toBe(1)
      expect(await slots([a, b, c])).toBe(0)
    })
  })

  it('a bin with room for exactly the line is offered as a home, and make_home onto it is accepted', async () => {
    await withRollbackTx(async (client) => {
      const w = await seed(client)
      // A route from a dock, so putaway could use the bin: the rule judges that too.
      const dock = await client.query<{ id: number }>(
        "INSERT INTO public.layout_graph_nodes (layout_id, floor, x, y, node_type) VALUES ($1, 0, 0, 0, 'dock') RETURNING id",
        [w.layoutId])
      const walk = await client.query<{ id: number }>(
        "INSERT INTO public.layout_graph_nodes (layout_id, floor, x, y, node_type) VALUES ($1, 0, 9, 0, 'walk') RETURNING id",
        [w.layoutId])
      await client.query(
        'INSERT INTO public.layout_travel_distances (layout_id, from_node_id, to_node_id, distance_m) VALUES ($1, $2, $3, 4)',
        [w.layoutId, dock.rows[0].id, walk.rows[0].id])

      // A product with no home, twelve of it at the dock, and a bin of exactly twelve.
      const x = await newProduct(client, w.token, '-X')
      await receive(client, x.id, w.warehouseId, 12)
      const t = await addBin(client, w, 'T', 9, 12)
      await client.query(
        'UPDATE public.layout_placements SET graph_node_id = $1 WHERE layout_id = $2 AND location_id = $3',
        [walk.rows[0].id, w.layoutId, t])
      // The planner has already sent the whole line there: assigned straight to T.
      const line = await task(client, w, 12, t, { productId: x.id, status: 'assigned', source: 'engine' })

      const judged = async (exclude: number[] | null): Promise<HomeBinCandidateFacts[]> =>
        (await candidateRows(client, w, x.id, exclude)).map((r) => homeBinCandidateFactsFromRow(r, w.warehouseId))

      // Counting the line against its own bin, T reads full and is not offered.
      const crowded = (await judged(null)).find((f) => f.binId === t)!
      expect(homeChoiceRefusal(crowded)).toMatch(/^Bin TST-WALK-T-.* is full/)
      expect(homeBinChoices(await judged(null)).map((c) => c.binId)).not.toContain(t)

      // Giving the line its own space back, T has room for exactly it: offered, and fit.
      const fit = (await judged([line])).find((f) => f.binId === t)!
      expect(fit).toMatchObject({ capacitySlots: 12, usedSlots: 0, pendingSlots: 0, pendingQty: 0 })
      expect(homeChoiceRefusal(fit)).toBeNull()
      expect(homeBinChoices(await judged([line])).map((c) => c.binCode)).toContain(`TST-WALK-T-${w.token}`)

      // Another line's promise to T still counts: only the line's own is given back.
      const other = await task(client, w, 12, t, { productId: w.otherProductId, status: 'suggested' })
      expect(homeChoiceRefusal((await judged([line])).find((f) => f.binId === t)!)).toMatch(/is full/)
      await client.query("UPDATE public.wie_putaway_recommendations SET status = 'expired' WHERE id = $1", [other])

      // make_home onto it is accepted: the stock moves and the home is set in the same call.
      const done = await client.query<{ r: { home_set: boolean } }>(
        'SELECT public.wie_complete_putaway_many_tx($1::jsonb, $2, NULL, NULL, false, true) AS r',
        [JSON.stringify([{ id: line, qty: 12 }]), t])
      expect(done.rows[0].r.home_set).toBe(true)
      expect(await onHand(client, x.id, t)).toBe(12)
      const home = await client.query<{ bin_id: number }>(
        'SELECT bin_id FROM public.product_home_bins WHERE product_id = $1 AND warehouse_id = $2 AND purpose = $3',
        [x.id, w.warehouseId, 'primary'])
      expect(home.rows).toEqual([{ bin_id: t }])
    })
  })


  // ── Grants ────────────────────────────────────────────────────────────────
  it('the new and redefined functions are service_role only, one overload', async () => {
    await withRollbackTx(async (client) => {
      const sigs: Array<[string, string]> = [
        ['wie_confirm_overflow_tx', 'wie_confirm_overflow_tx(bigint,integer,uuid)'],
        ['wie_home_bin_candidate_facts', 'wie_home_bin_candidate_facts(integer,integer,integer,bigint[])'],
        ['wie_decide_putaway_tx', 'wie_decide_putaway_tx(bigint,text,integer,numeric,uuid)'],
        ['wie_putaway_stops', 'wie_putaway_stops(integer)'],
      ]
      for (const [name, sig] of sigs) {
        const r = await client.query<{ sig: string }>(
          `SELECT p.oid::regprocedure::text AS sig
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = $1`, [name])
        expect(r.rows.map((x) => x.sig)).toEqual([sig])
        const g = await client.query<{ anon: boolean; authed: boolean; service: boolean }>(
          `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                  has_function_privilege('authenticated', $1, 'EXECUTE') AS authed,
                  has_function_privilege('service_role', $1, 'EXECUTE') AS service`, [`public.${sig}`])
        expect({ sig, ...g.rows[0] }).toEqual({ sig, anon: false, authed: false, service: true })
      }
      const definer = await client.query<{ proname: string; prosecdef: boolean }>(
        `SELECT p.proname, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname IN ('wie_confirm_overflow_tx', 'wie_home_bin_candidate_facts')
          ORDER BY 1`)
      expect(definer.rows).toEqual([
        { proname: 'wie_confirm_overflow_tx', prosecdef: true },
        { proname: 'wie_home_bin_candidate_facts', prosecdef: true },
      ])
    })
  })
})

// ── Desk and walk at once (two connections, committed made-up data) ─────────
//
// A row lock only shows itself between two sessions, and the second session
// can only see what the first committed. So this world is COMMITTED: made up
// (TST-WALK-*), deleted again in afterAll, ledger rows included.

interface RaceWorld {
  w: World
  /** A product with no home, for the stock-moving race. */
  loose: { id: number; sku: string }
}

async function buildRaceWorld(): Promise<RaceWorld> {
  const client = await connect()
  try {
    await client.query('BEGIN')
    const w = await seed(client, { stock: false })
    const loose = await newProduct(client, w.token, '-L')
    await client.query('COMMIT')
    return { w, loose }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

/** Delete every row the race world, or the RPCs it ran, wrote. Children first. */
async function tearDownRaceWorld(r: RaceWorld): Promise<void> {
  const { w } = r
  const productIds = [w.productId, w.otherProductId, r.loose.id]
  const client = await connect()
  try {
    await client.query('BEGIN')
    const locs = await client.query<{ id: number }>(
      'SELECT id FROM public.locations WHERE id = $1 OR parent_id = $1', [w.warehouseId])
    const locationIds = locs.rows.map((x) => x.id)
    await client.query(
      'DELETE FROM public.wie_putaway_recommendations WHERE warehouse_id = $1 OR product_id = ANY ($2)',
      [w.warehouseId, productIds])
    await client.query(
      'DELETE FROM public.inventory_movements WHERE product_id = ANY ($1) OR location_id = ANY ($2)',
      [productIds, locationIds])
    await client.query('DELETE FROM public.inventory_balances WHERE product_id = ANY ($1)', [productIds])
    await client.query('DELETE FROM public.handling_units WHERE warehouse_id = $1', [w.warehouseId])
    await client.query('DELETE FROM public.product_home_bins WHERE warehouse_id = $1 OR product_id = ANY ($2)',
      [w.warehouseId, productIds])
    await client.query('UPDATE public.locations SET active_layout_id = NULL WHERE id = $1', [w.warehouseId])
    await client.query('DELETE FROM public.layout_placements WHERE layout_id = $1', [w.layoutId])
    await client.query('DELETE FROM public.warehouse_layouts WHERE id = $1', [w.layoutId])
    await client.query('DELETE FROM public.locations WHERE parent_id = $1', [w.warehouseId])
    await client.query('DELETE FROM public.locations WHERE id = $1', [w.warehouseId])
    await client.query('DELETE FROM public.products WHERE id = ANY ($1)', [productIds])
    await client.query('DELETE FROM public.suppliers WHERE email LIKE $1', [`tst-walk-${w.token}%@test.local`])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

/** Wait until session `pid` is blocked on a lock (bounded; never raises the timeout). */
async function waitUntilBlocked(observer: pg.Client, pid: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const r = await observer.query<{ w: string | null }>(
      'SELECT wait_event_type AS w FROM pg_stat_activity WHERE pid = $1', [pid])
    if (r.rows[0]?.w === 'Lock') return
    await new Promise((res) => setTimeout(res, 50))
  }
  throw new Error(`session ${pid} never waited on the row lock`)
}

/** The error a promise rejects with, or null if it resolved; never an unhandled rejection. */
function errorOf(p: Promise<unknown>): Promise<Error | null> {
  return p.then(() => null, (error: Error) => error)
}

describe('NX-0033 desk and walk at once (two connections, committed made-up data)', () => {
  let r: RaceWorld

  beforeAll(async () => {
    r = await buildRaceWorld()
  })

  afterAll(async () => {
    if (r) await tearDownRaceWorld(r)
  })

  it('desk assign and walk confirm at once: exactly one wins, one row assigned, no stock moved', async () => {
    const { w } = r
    const a = await connect()
    const b = await connect()
    try {
      const [walker, desk] = await actors(a)
      // H is full by what is already on its way there; the line went to O1.
      await task(a, w, 10, w.h, { source: 'home' })
      const id = await task(a, w, 4, w.o1, { source: 'overflow' })
      const bPid = (await b.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid

      await a.query('BEGIN')
      await a.query(confirm, [id, w.o1, walker])
      const deskAssign = errorOf(b.query('SELECT public.wie_assign_putaway_tx($1, $2, NULL, $3)', [id, w.o2, desk]))
      await waitUntilBlocked(a, bPid)
      await a.query('COMMIT')

      expect((await deskAssign)?.message).toMatch(/recommendation already assigned/)

      const rows = await a.query<{ id: string; status: string; assigned_location_id: number; assigned_by: string; quantity: number }>(
        `SELECT id, status, assigned_location_id, assigned_by, quantity FROM public.wie_putaway_recommendations
          WHERE warehouse_id = $1 AND suggestion_source = 'overflow'`, [w.warehouseId])
      expect(rows.rows.map((x) => [Number(x.id), x.status, x.assigned_location_id, x.assigned_by, x.quantity])).toEqual([
        [id, 'assigned', w.o1, walker, 4],
      ])
      const moved = await a.query<{ n: string }>(
        'SELECT count(*) AS n FROM public.inventory_balances WHERE product_id = $1', [w.productId])
      expect(Number(moved.rows[0].n)).toBe(0)
    } finally {
      await a.end()
      await b.end()
    }
  })

  it('walk confirm waits for a desk assign holding the line: the desk keeps its bin, the walk is refused', async () => {
    // The mirror of the test above. Without FOR UPDATE in wie_confirm_overflow_tx
    // the walk would read the line as still waiting, pass every check, block
    // only at its UPDATE, and then overwrite the desk's bin once the desk commits.
    const { w } = r
    const a = await connect()
    const b = await connect()
    try {
      const [walker, desk] = await actors(a)
      // H full by what is on its way there, so this test stands on its own.
      await task(a, w, 10, w.h, { source: 'home' })
      const id = await task(a, w, 3, w.o1, { source: 'overflow' })
      const bPid = (await b.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid

      await a.query('BEGIN')
      await a.query('SELECT public.wie_assign_putaway_tx($1, $2, NULL, $3)', [id, w.o2, desk])
      const walkConfirm = errorOf(b.query(confirm, [id, w.o1, walker]))
      await waitUntilBlocked(a, bPid)
      await a.query('COMMIT')

      expect((await walkConfirm)?.message).toMatch(/already dealt with \(it is now assigned\)/)
      expect(await row(a, id)).toMatchObject({ status: 'assigned', assigned_location_id: w.o2, assigned_by: desk, quantity: 3 })
    } finally {
      await a.end()
      await b.end()
    }
  })

  it('walk complete and desk Place now at once move the stock exactly once', async () => {
    const { w, loose } = r
    const a = await connect()
    const b = await connect()
    try {
      await receive(a, loose.id, w.warehouseId, 5)
      // A line for a product with no home, written straight onto the walk.
      const id = await task(a, w, 5, w.n, { productId: loose.id, source: 'engine', status: 'assigned', assignedTo: w.n, assignedBy: null })
      const bPid = (await b.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid
      const before = await onHand(a, loose.id, w.n)

      await a.query('BEGIN')
      await a.query(complete, [id, w.n, null])
      const placeNow = errorOf(b.query("SELECT public.wie_decide_putaway_tx($1, 'accept', $2)", [id, w.n]))
      await waitUntilBlocked(a, bPid)
      await a.query('COMMIT')

      expect((await placeNow)?.message).toMatch(/already accepted/)
      expect(await onHand(a, loose.id, w.n)).toBe(before + 5)
      expect(await onHand(a, loose.id, w.warehouseId)).toBe(0)
    } finally {
      await a.end()
      await b.end()
    }
  })
})

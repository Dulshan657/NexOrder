// Made-up worlds for the NX-0033 end-to-end specs: putaway straight to the walk
// (putaway-straight-to-walk) and the Bin detail wheel (bin-detail-wheel).
//
// Everything here is invented (TST-WALK-*): no customer, SKU, bin code or quantity
// belongs to anyone. The specs seed a world before the browser starts, and
// `tearDownWorld` / `tearDownWheelWorld` remove every row it, or the browser,
// wrote -- looked up by name, so a crashed run leaves nothing a re-run cannot
// sweep first.
//
// THE WALK WORLD (seedWorld) is one racked warehouse with a published layout, a
// dock, and a walking node per bin; seven pick bins in a row; five products with
// carton UOMs; and a Warehouse-role user homed at the warehouse.
//
//   H           home of TST-WALK-200, unbounded, no maximum until a spec sets one
//   O1, O2      the bins nearest H, so O1 is where H's overflow goes
//   N1, N2, N3  ordinary bins, further away: homes for the products that have none
//   I           inactive, to prove a chooser never offers it
//   301..304    products with no home
//
// Why a seeded warehouse rather than the permanent "E2E RackLevels Test" one the
// sibling specs share: the room at a home is arithmetic on its max, its on-hand
// and what is already promised. The shared warehouse carries other specs' stock
// and tasks, so none of those is a number a spec could control there.
//
// Direct SQL, through the integration suite's guarded connection: it refuses a
// tenant's database outright (see __tests__/support/loadEnv.ts), which is the same
// promise playwright.config.ts makes for the browser side. The Warehouse user is
// made, and removed, through the Auth admin API with the dev project's service
// key from the same file.
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type pg from 'pg'
import { connect } from '../../../__tests__/support/pgTestClient'

export const WORLD_NAMES = {
  warehouseCode: 'TST-WALK-E2E',
  warehouseName: 'TST-WALK E2E Warehouse',
  supplierName: 'E2E Test Supplier',
  /** The Warehouse user's address is `${prefix}${token}@test.local`. */
  userEmailPrefix: 'tst-walk-warehouse-',
} as const

/** Base units in one carton of any made-up product, so 4 cartons are 24 units. */
export const CARTON_SIZE = 6

/** One lock for every seed, so two specs seeding at once cannot pick the same MAX(id)+1. */
const SEED_LOCK = 7_330_033

export interface WorldBin {
  readonly id: number
  readonly code: string
}

export interface WorldProduct {
  readonly id: number
  readonly sku: string
  readonly name: string
  readonly barcode: string
  readonly cartonSize: number
}

export interface WorldUser {
  readonly id: string
  readonly email: string
  readonly password: string
}

export interface WalkWorld {
  readonly warehouseId: number
  readonly warehouseCode: string
  readonly warehouseName: string
  readonly layoutId: number
  readonly bins: {
    readonly h: WorldBin
    readonly o1: WorldBin
    readonly o2: WorldBin
    readonly n1: WorldBin
    readonly n2: WorldBin
    readonly n3: WorldBin
    readonly i: WorldBin
  }
  /** TST-WALK-200: homed at H. */
  readonly homed: WorldProduct
  /** TST-WALK-301..304: no home bin. */
  readonly noHome: {
    readonly p301: WorldProduct
    readonly p302: WorldProduct
    readonly p303: WorldProduct
    readonly p304: WorldProduct
  }
  /** A Warehouse-role user, homed at this warehouse. */
  readonly user: WorldUser
}

export interface TaskRow {
  readonly id: number
  readonly status: string
  readonly quantity: number
  readonly recommendedLocationId: number | null
  readonly assignedLocationId: number | null
  readonly assignedBy: string | null
  readonly suggestionSource: string | null
  readonly overrideReason: string | null
}

export interface HomeRow {
  readonly binId: number
  readonly maxQty: number | null
}

async function withClient<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = await connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

async function one<T extends pg.QueryResultRow>(client: pg.Client, sql: string, params: unknown[]): Promise<T> {
  const result = await client.query<T>(sql, params)
  if (result.rows.length !== 1) throw new Error(`expected one row from: ${sql.trim().split('\n')[0]}`)
  return result.rows[0]
}

async function supplierId(client: pg.Client): Promise<number> {
  const found = await client.query<{ id: number }>('SELECT id FROM public.suppliers WHERE name = $1 LIMIT 1', [
    WORLD_NAMES.supplierName,
  ])
  if (found.rows[0]) return found.rows[0].id
  const made = await one<{ id: number }>(
    client,
    `INSERT INTO public.suppliers (id, name, contact_person, email, phone)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.suppliers), $1, '', '', '') RETURNING id`,
    [WORLD_NAMES.supplierName],
  )
  return made.id
}

/** Take the seed lock for this transaction: the next seed waits for the commit. */
async function lockSeeds(client: pg.Client): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK])
}

// ── The Auth admin API, for the one user the world needs ─────────────────────

function authAdmin() {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.dev.local)')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** A made-up Warehouse user. handle_new_user() makes the profile from user_metadata. */
async function createWarehouseUser(warehouseId: number): Promise<WorldUser> {
  const admin = authAdmin()
  const token = randomUUID().slice(0, 8)
  const email = `${WORLD_NAMES.userEmailPrefix}${token}@test.local`
  const password = `Tst-${randomUUID()}`
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: `TST-WALK Warehouse ${token}`, role: 'Warehouse' },
  })
  if (created.error || !created.data.user) throw new Error(`create the Warehouse user: ${created.error?.message}`)
  const id = created.data.user.id
  await withClient(async (client) => {
    const set = await client.query('UPDATE public.profiles SET home_warehouse_id = $1 WHERE id = $2', [warehouseId, id])
    if (set.rowCount !== 1) throw new Error('the Warehouse user has no profile to home')
  })
  return { id, email, password }
}

// ── Seed ─────────────────────────────────────────────────────────────────────

async function insertProduct(client: pg.Client, supplier: number, sku: string, label: string): Promise<WorldProduct> {
  const name = `TST-WALK Product ${label}`
  const barcode = `TSTWALK${label}`
  const row = await one<{ id: number }>(
    client,
    `INSERT INTO public.products
       (id, sku, name, price, category, unit, carton_size, supplier_id, inventory, size_factor, barcode)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.products), $1, $2, 5, 'Other', 'EA', $3, $4, 0, 1, $5)
     RETURNING id`,
    [sku, name, CARTON_SIZE, supplier, barcode],
  )
  // The receive screen can only pick "carton" when the product has real UOM rows;
  // the derived default pair shares id 0 and the select cannot tell them apart.
  await client.query(
    `INSERT INTO public.product_uoms (product_id, code, factor_to_base, is_base, price, is_orderable, is_receivable, sort_order)
     VALUES ($1, 'EA', 1, true, 5, true, true, 0),
            ($1, 'carton', $2, false, $3, true, true, 1)`,
    [row.id, CARTON_SIZE, 5 * CARTON_SIZE],
  )
  return { id: row.id, sku, name, barcode, cartonSize: CARTON_SIZE }
}

/**
 * The bins, left to right. The position is what the planner reads as "near the
 * home": an overflow line goes to the bin nearest H that can take it, so O1 is
 * H's overflow bin for as long as O1 is usable.
 */
const BIN_ROW = [
  { key: 'h', letter: 'H', x: 1, active: true },
  { key: 'o1', letter: 'O1', x: 2, active: true },
  { key: 'o2', letter: 'O2', x: 3, active: true },
  { key: 'i', letter: 'I', x: 4, active: false },
  { key: 'n1', letter: 'N1', x: 6, active: true },
  { key: 'n2', letter: 'N2', x: 7, active: true },
  { key: 'n3', letter: 'N3', x: 8, active: true },
] as const

type BinKey = (typeof BIN_ROW)[number]['key']

/**
 * The layout's graph: a dock, and one walking node under each bin, with a
 * distance between every pair. A node per bin (rather than one shared node) is
 * what lets "nearest to the home" tell the bins apart.
 */
async function insertGraph(
  client: pg.Client,
  layoutId: number,
): Promise<{ readonly dockNodeId: number; readonly nodeByKey: ReadonlyMap<BinKey, number> }> {
  const dock = await one<{ id: number }>(
    client,
    `INSERT INTO public.layout_graph_nodes (layout_id, floor, x, y, node_type)
     VALUES ($1, 0, 0, 0, 'dock') RETURNING id`,
    [layoutId],
  )
  const nodeByKey = new Map<BinKey, number>()
  const nodes: Array<{ id: number; x: number }> = [{ id: dock.id, x: 0 }]
  for (const bin of BIN_ROW) {
    const node = await one<{ id: number }>(
      client,
      `INSERT INTO public.layout_graph_nodes (layout_id, floor, x, y, node_type)
       VALUES ($1, 0, $2, 1, 'walk') RETURNING id`,
      [layoutId, bin.x],
    )
    nodeByKey.set(bin.key, node.id)
    nodes.push({ id: node.id, x: bin.x })
  }
  const from: number[] = []
  const to: number[] = []
  const metres: number[] = []
  for (const a of nodes) {
    for (const b of nodes) {
      from.push(a.id)
      to.push(b.id)
      metres.push(Math.abs(a.x - b.x))
    }
  }
  await client.query(
    `INSERT INTO public.layout_travel_distances (layout_id, from_node_id, to_node_id, distance_m)
     SELECT $1, f, t, d FROM unnest($2::int[], $3::int[], $4::numeric[]) AS u(f, t, d)`,
    [layoutId, from, to, metres],
  )
  await client.query(
    `INSERT INTO public.layout_objects (layout_id, object_type, floor, x, y, w, h, meta)
     VALUES ($1, 'dock', 0, 0, 0, 1, 1, '{}'::jsonb)`,
    [layoutId],
  )
  return { dockNodeId: dock.id, nodeByKey }
}

async function insertBin(
  client: pg.Client,
  w: { warehouseId: number; layoutId: number },
  bin: (typeof BIN_ROW)[number],
  nodeId: number,
): Promise<WorldBin> {
  const code = `TST-WALK-${bin.letter}`
  // No capacity: how full a bin is must come from a maximum the spec sets, not
  // from a number of slots that quietly runs out.
  const row = await one<{ id: number }>(
    client,
    `INSERT INTO public.locations
       (parent_id, kind, code, name, materialized_path, is_active, capacity_slots, level_role)
     VALUES ($1, 'BIN', $2, $2, $3, $4, NULL, 'pick') RETURNING id`,
    [w.warehouseId, code, `${WORLD_NAMES.warehouseCode}/${code}`, bin.active],
  )
  await client.query(
    `INSERT INTO public.layout_placements
       (layout_id, location_id, floor, x, y, w, h, rotation, graph_node_id, access_offset_m)
     VALUES ($1, $2, 0, $3, 0, 1, 1, 0, $4, 0.5)`,
    [w.layoutId, row.id, bin.x, nodeId],
  )
  return { id: row.id, code }
}

/** Build the world. Sweeps a previous run's leftovers first. */
export async function seedWorld(): Promise<WalkWorld> {
  await tearDownWorld()
  const built = await withClient(async (client) => {
    await client.query('BEGIN')
    try {
      await lockSeeds(client)
      const { warehouseCode, warehouseName } = WORLD_NAMES
      const wh = await one<{ id: number }>(
        client,
        `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, location_type)
         VALUES (NULL, 'WAREHOUSE', $1, $2, $1, true, 'racked') RETURNING id`,
        [warehouseCode, warehouseName],
      )
      const layout = await one<{ id: number }>(
        client,
        `INSERT INTO public.warehouse_layouts (warehouse_id, name, status, cell_size_m)
         VALUES ($1, 'TST-WALK E2E', 'published', 1) RETURNING id`,
        [wh.id],
      )
      await client.query('UPDATE public.locations SET active_layout_id = $1 WHERE id = $2', [layout.id, wh.id])

      const { nodeByKey } = await insertGraph(client, layout.id)
      const placed = new Map<BinKey, WorldBin>()
      for (const bin of BIN_ROW) {
        const nodeId = nodeByKey.get(bin.key)
        if (nodeId === undefined) throw new Error(`no walking node for bin ${bin.letter}`)
        placed.set(bin.key, await insertBin(client, { warehouseId: wh.id, layoutId: layout.id }, bin, nodeId))
      }
      const bin = (key: BinKey): WorldBin => {
        const found = placed.get(key)
        if (!found) throw new Error(`bin ${key} was not placed`)
        return found
      }

      const supplier = await supplierId(client)
      const homed = await insertProduct(client, supplier, 'TST-WALK-200', '200')
      const p301 = await insertProduct(client, supplier, 'TST-WALK-301', '301')
      const p302 = await insertProduct(client, supplier, 'TST-WALK-302', '302')
      const p303 = await insertProduct(client, supplier, 'TST-WALK-303', '303')
      const p304 = await insertProduct(client, supplier, 'TST-WALK-304', '304')

      // The home, with no minimum and no maximum: it takes everything until a spec
      // sets a maximum.
      await client.query(
        `INSERT INTO public.product_home_bins (product_id, warehouse_id, bin_id, purpose)
         VALUES ($1, $2, $3, 'primary')`,
        [homed.id, wh.id, bin('h').id],
      )

      await client.query('COMMIT')
      return {
        warehouseId: wh.id,
        warehouseCode,
        warehouseName,
        layoutId: layout.id,
        bins: { h: bin('h'), o1: bin('o1'), o2: bin('o2'), n1: bin('n1'), n2: bin('n2'), n3: bin('n3'), i: bin('i') },
        homed,
        noHome: { p301, p302, p303, p304 },
      }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
  try {
    return { ...built, user: await createWarehouseUser(built.warehouseId) }
  } catch (err) {
    await tearDownWorld()
    throw err
  }
}

// ── Teardown ─────────────────────────────────────────────────────────────────

/**
 * The ids the world's names resolve to right now. Taken BEFORE `tearDownWorld`,
 * so that `leftovers` can look for rows that still point at what was removed;
 * once the products and locations are gone their names resolve to nothing.
 */
export interface WorldIds {
  readonly warehouseId: number | null
  readonly locationIds: readonly number[]
  readonly layoutIds: readonly number[]
  readonly productIds: readonly number[]
  readonly userIds: readonly string[]
}

const WORLD_SKUS = ['TST-WALK-200', 'TST-WALK-301', 'TST-WALK-302', 'TST-WALK-303', 'TST-WALK-304']

export function snapshotWorld(): Promise<WorldIds> {
  return withClient(async (client) => {
    const wh = await client.query<{ id: number }>(
      "SELECT id FROM public.locations WHERE kind = 'WAREHOUSE' AND code = $1",
      [WORLD_NAMES.warehouseCode],
    )
    const warehouseId = wh.rows[0]?.id ?? null
    const locations = await client.query<{ id: number }>(
      "SELECT id FROM public.locations WHERE id = $1 OR materialized_path LIKE $2 || '/%'",
      [warehouseId, WORLD_NAMES.warehouseCode],
    )
    const layouts = await client.query<{ id: number }>(
      'SELECT id FROM public.warehouse_layouts WHERE warehouse_id = $1',
      [warehouseId],
    )
    const products = await client.query<{ id: number }>('SELECT id FROM public.products WHERE sku = ANY ($1)', [
      WORLD_SKUS,
    ])
    const users = await client.query<{ id: string }>('SELECT id FROM auth.users WHERE email LIKE $1', [
      `${WORLD_NAMES.userEmailPrefix}%@test.local`,
    ])
    return {
      warehouseId,
      locationIds: locations.rows.map((r) => r.id),
      layoutIds: layouts.rows.map((r) => r.id),
      productIds: products.rows.map((r) => r.id),
      userIds: users.rows.map((r) => r.id),
    }
  })
}

/**
 * Remove everything the world and the browser wrote, children first. Looked up by
 * name, so it works after a crash with no `WalkWorld` in hand, and does nothing
 * when there is nothing to remove.
 */
export async function tearDownWorld(): Promise<void> {
  const { warehouseId, locationIds, productIds, userIds } = await snapshotWorld()
  if (warehouseId === null && productIds.length === 0 && userIds.length === 0) return

  await withClient(async (client) => {
    await client.query('BEGIN')
    try {
      await client.query(
        'DELETE FROM public.wie_putaway_recommendations WHERE warehouse_id = $1 OR product_id = ANY ($2)',
        [warehouseId, productIds],
      )
      for (const table of ['wie_replen_tasks', 'wie_slotting_suggestions', 'wie_offhome_tasks']) {
        await client.query(`DELETE FROM public.${table} WHERE warehouse_id = $1`, [warehouseId])
      }
      await client.query(
        'DELETE FROM public.inventory_movements WHERE product_id = ANY ($1) OR location_id = ANY ($2)',
        [productIds, locationIds],
      )
      await client.query('DELETE FROM public.inventory_balances WHERE product_id = ANY ($1)', [productIds])
      await client.query('DELETE FROM public.goods_receipts WHERE location_id = $1', [warehouseId])
      await client.query('DELETE FROM public.handling_units WHERE warehouse_id = $1', [warehouseId])
      await client.query('DELETE FROM public.product_home_bins WHERE warehouse_id = $1 OR product_id = ANY ($2)', [
        warehouseId,
        productIds,
      ])
      // The user's own traces, so the account can go: these reference it with no cascade.
      await client.query('DELETE FROM public.audit_events WHERE actor_id = ANY ($1)', [userIds])
      await client.query('DELETE FROM public.client_errors WHERE actor_id = ANY ($1)', [userIds])
      await client.query('DELETE FROM public.notifications WHERE user_id = ANY ($1)', [userIds])
      await client.query('DELETE FROM public.rate_limit_counters WHERE key LIKE ANY ($1::text[])', [
        userIds.map((id) => `%:${id}`),
      ])
      await client.query('UPDATE public.profiles SET home_warehouse_id = NULL WHERE id = ANY ($1)', [userIds])
      if (warehouseId !== null) {
        await client.query('UPDATE public.locations SET active_layout_id = NULL WHERE id = $1', [warehouseId])
        await client.query('DELETE FROM public.warehouse_layouts WHERE warehouse_id = $1', [warehouseId])
        await client.query('DELETE FROM public.locations WHERE parent_id = $1', [warehouseId])
        await client.query('DELETE FROM public.locations WHERE id = $1', [warehouseId])
      }
      await client.query('DELETE FROM public.products WHERE id = ANY ($1)', [productIds])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })

  const failed: string[] = []
  for (const id of userIds) {
    const removed = await authAdmin().auth.admin.deleteUser(id)
    if (removed.error) failed.push(`${id}: ${removed.error.message}`)
  }
  if (failed.length > 0) throw new Error(`delete the Warehouse user: ${failed.join('; ')}`)
}

/**
 * Rows still present for the ids `snapshotWorld` captured before the teardown:
 * the things themselves, and everything that could still point at them. Zero for
 * every key means a clean teardown. Counted by id, not by name, so it cannot be
 * emptied by the thing it is checking having already gone.
 */
export function leftovers(ids: WorldIds): Promise<Record<string, number>> {
  const { warehouseId, locationIds, layoutIds, productIds, userIds } = ids
  return withClient(async (client) => {
    const count = async (table: string, where: string, params: unknown[]): Promise<number> =>
      Number((await client.query<{ n: string }>(`SELECT count(*) n FROM ${table} WHERE ${where}`, params)).rows[0].n)
    return {
      warehouse: await count('public.locations', 'id = $1', [warehouseId]),
      locations: await count('public.locations', 'id = ANY ($1)', [locationIds]),
      products: await count('public.products', 'id = ANY ($1)', [productIds]),
      uoms: await count('public.product_uoms', 'product_id = ANY ($1)', [productIds]),
      homes: await count('public.product_home_bins', 'warehouse_id = $1 OR product_id = ANY ($2)', [warehouseId, productIds]),
      tasks: await count('public.wie_putaway_recommendations', 'warehouse_id = $1 OR product_id = ANY ($2)', [warehouseId, productIds]),
      balances: await count('public.inventory_balances', 'product_id = ANY ($1) OR location_id = ANY ($2)', [productIds, locationIds]),
      movements: await count('public.inventory_movements', 'product_id = ANY ($1) OR location_id = ANY ($2)', [productIds, locationIds]),
      receipts: await count('public.goods_receipts', 'location_id = $1', [warehouseId]),
      plates: await count('public.handling_units', 'warehouse_id = $1', [warehouseId]),
      replenTasks: await count('public.wie_replen_tasks', 'warehouse_id = $1', [warehouseId]),
      layouts: await count('public.warehouse_layouts', 'id = ANY ($1) OR warehouse_id = $2', [layoutIds, warehouseId]),
      placements: await count('public.layout_placements', 'layout_id = ANY ($1) OR location_id = ANY ($2)', [layoutIds, locationIds]),
      graphNodes: await count('public.layout_graph_nodes', 'layout_id = ANY ($1)', [layoutIds]),
      travelDistances: await count('public.layout_travel_distances', 'layout_id = ANY ($1)', [layoutIds]),
      layoutObjects: await count('public.layout_objects', 'layout_id = ANY ($1)', [layoutIds]),
      users: await count('auth.users', 'id = ANY ($1) OR email LIKE $2', [userIds, `${WORLD_NAMES.userEmailPrefix}%@test.local`]),
      profiles: await count('public.profiles', 'id = ANY ($1)', [userIds]),
    }
  })
}

// ── Reads and the one write the specs make ───────────────────────────────────

export function tasksOf(productId: number): Promise<TaskRow[]> {
  return withClient(async (client) => {
    const r = await client.query<{
      id: string
      status: string
      quantity: number
      recommended_location_id: number | null
      assigned_location_id: number | null
      assigned_by: string | null
      suggestion_source: string | null
      override_reason: string | null
    }>(
      `SELECT id, status, quantity, recommended_location_id, assigned_location_id,
              assigned_by, suggestion_source, override_reason
         FROM public.wie_putaway_recommendations WHERE product_id = $1 ORDER BY id`,
      [productId],
    )
    return r.rows.map((row) => ({
      id: Number(row.id),
      status: row.status,
      quantity: Number(row.quantity),
      recommendedLocationId: row.recommended_location_id,
      assignedLocationId: row.assigned_location_id,
      assignedBy: row.assigned_by,
      suggestionSource: row.suggestion_source,
      overrideReason: row.override_reason,
    }))
  })
}

export function homeOf(w: WalkWorld, productId: number): Promise<HomeRow | null> {
  return withClient(async (client) => {
    const r = await client.query<{ bin_id: number; max_qty: number | null }>(
      `SELECT bin_id, max_qty FROM public.product_home_bins
        WHERE product_id = $1 AND warehouse_id = $2 AND purpose = 'primary'`,
      [productId, w.warehouseId],
    )
    return r.rows[0] ? { binId: r.rows[0].bin_id, maxQty: r.rows[0].max_qty } : null
  })
}

export function onHandAt(productId: number, locationId: number): Promise<number> {
  return withClient(async (client) => {
    const r = await client.query<{ q: number }>(
      'SELECT COALESCE(SUM(on_hand), 0) AS q FROM public.inventory_balances WHERE product_id = $1 AND location_id = $2',
      [productId, locationId],
    )
    return Number(r.rows[0].q)
  })
}

/** On hand in the whole world: the proof that a refused request moved nothing anywhere. */
export function onHandAnywhere(productId: number, w: WalkWorld): Promise<number> {
  return withClient(async (client) => {
    const r = await client.query<{ q: number }>(
      `SELECT COALESCE(SUM(b.on_hand), 0) AS q
         FROM public.inventory_balances b
         JOIN public.locations l ON l.id = b.location_id
        WHERE b.product_id = $1 AND l.materialized_path LIKE $2 || '/%'`,
      [productId, w.warehouseCode],
    )
    return Number(r.rows[0].q)
  })
}

/**
 * Set the maximum of a product's home. SEEDED, not driven through the app: the
 * screens for it are NX-0032's and are proved there; here it is how the home is
 * made to read "full" at a number the spec knows.
 */
export function setHomeMax(w: WalkWorld, productId: number, maxQty: number): Promise<void> {
  return withClient(async (client) => {
    const r = await client.query(
      `UPDATE public.product_home_bins SET max_qty = $3, updated_at = now()
        WHERE product_id = $1 AND warehouse_id = $2 AND purpose = 'primary'`,
      [productId, w.warehouseId, maxQty],
    )
    if (r.rowCount !== 1) throw new Error(`product ${productId} has no home to give a maximum`)
  })
}

// ── The Bin detail wheel world ───────────────────────────────────────────────
//
// One racked warehouse with a published layout, ONE bin, and enough products
// stocked in that bin that its detail panel is taller than the panel is allowed
// to be. Deliberately separate from the walk world: a scroll box needs none of
// the putaway machinery, and the two specs can run side by side.

export const WHEEL_NAMES = {
  warehouseCode: 'TST-WALK-WHL',
  warehouseName: 'TST-WALK Wheel Warehouse',
  binCode: 'TST-WALK-WHL-B1',
  binName: 'TST-WALK Wheel Bin',
  /** `TST-WALK-WHL-P01` .. `TST-WALK-WHL-Pnn` */
  skuPrefix: 'TST-WALK-WHL-P',
} as const

/** Enough rows that the detail overflows a 70svh panel at any laptop viewport. */
export const WHEEL_PRODUCT_COUNT = 40

export interface WheelWorld {
  readonly warehouseId: number
  readonly warehouseCode: string
  readonly warehouseName: string
  readonly binId: number
  readonly binCode: string
  readonly binName: string
  readonly productNames: readonly string[]
}

const wheelProductName = (n: number): string => `TST-WALK Wheel Product ${String(n).padStart(2, '0')}`

/** Build the wheel world. Sweeps a previous run's leftovers first. */
export async function seedWheelWorld(): Promise<WheelWorld> {
  await tearDownWheelWorld()
  return withClient(async (client) => {
    await client.query('BEGIN')
    try {
      await lockSeeds(client)
      const { warehouseCode, warehouseName, binCode, binName, skuPrefix } = WHEEL_NAMES
      const wh = await one<{ id: number }>(
        client,
        `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, location_type)
         VALUES (NULL, 'WAREHOUSE', $1, $2, $1, true, 'racked') RETURNING id`,
        [warehouseCode, warehouseName],
      )
      const layout = await one<{ id: number }>(
        client,
        `INSERT INTO public.warehouse_layouts (warehouse_id, name, status, cell_size_m)
         VALUES ($1, 'TST-WALK wheel', 'published', 1) RETURNING id`,
        [wh.id],
      )
      await client.query('UPDATE public.locations SET active_layout_id = $1 WHERE id = $2', [layout.id, wh.id])

      const bin = await one<{ id: number }>(
        client,
        `INSERT INTO public.locations
           (parent_id, kind, code, name, materialized_path, is_active, capacity_slots, level_role)
         VALUES ($1, 'BIN', $2, $3, $4, true, 1000, 'pick') RETURNING id`,
        [wh.id, binCode, binName, `${warehouseCode}/${binCode}`],
      )
      await client.query(
        `INSERT INTO public.layout_placements (layout_id, location_id, floor, x, y, w, h, rotation)
         VALUES ($1, $2, 0, 0, 0, 1, 1, 0)`,
        [layout.id, bin.id],
      )

      const supplier = await supplierId(client)
      const products = await client.query<{ id: number }>(
        `INSERT INTO public.products
           (id, sku, name, price, category, unit, carton_size, supplier_id, inventory, size_factor, barcode)
         SELECT (SELECT COALESCE(MAX(id),0) FROM public.products) + g,
                $1 || lpad(g::text, 2, '0'),
                'TST-WALK Wheel Product ' || lpad(g::text, 2, '0'),
                5, 'Other', 'EA', 1, $2, 0, 1,
                'TSTWALKWHL' || lpad(g::text, 2, '0')
           FROM generate_series(1, $3::int) g
         RETURNING id`,
        [skuPrefix, supplier, WHEEL_PRODUCT_COUNT],
      )
      await client.query(
        `INSERT INTO public.inventory_balances (product_id, location_id, on_hand)
         SELECT unnest($1::int[]), $2, 3`,
        [products.rows.map((r) => r.id), bin.id],
      )

      await client.query('COMMIT')
      return {
        warehouseId: wh.id,
        warehouseCode,
        warehouseName,
        binId: bin.id,
        binCode,
        binName,
        productNames: Array.from({ length: WHEEL_PRODUCT_COUNT }, (_, i) => wheelProductName(i + 1)),
      }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
}

/**
 * Remove everything the wheel world wrote, children first. Looked up by name, so
 * it works after a crash with no `WheelWorld` in hand, and does nothing when there
 * is nothing to remove.
 */
export async function tearDownWheelWorld(): Promise<void> {
  await withClient(async (client) => {
    await client.query('BEGIN')
    try {
      const wh = await client.query<{ id: number }>(
        "SELECT id FROM public.locations WHERE kind = 'WAREHOUSE' AND code = $1",
        [WHEEL_NAMES.warehouseCode],
      )
      const warehouseId = wh.rows[0]?.id ?? null
      const locations = await client.query<{ id: number }>(
        "SELECT id FROM public.locations WHERE id = $1 OR materialized_path LIKE $2 || '/%'",
        [warehouseId, WHEEL_NAMES.warehouseCode],
      )
      const locationIds = locations.rows.map((r) => r.id)
      const products = await client.query<{ id: number }>('SELECT id FROM public.products WHERE sku LIKE $1', [
        `${WHEEL_NAMES.skuPrefix}%`,
      ])
      const productIds = products.rows.map((r) => r.id)

      await client.query('DELETE FROM public.inventory_movements WHERE product_id = ANY ($1) OR location_id = ANY ($2)', [
        productIds,
        locationIds,
      ])
      await client.query('DELETE FROM public.inventory_balances WHERE product_id = ANY ($1) OR location_id = ANY ($2)', [
        productIds,
        locationIds,
      ])
      if (warehouseId !== null) {
        await client.query('UPDATE public.locations SET active_layout_id = NULL WHERE id = $1', [warehouseId])
        await client.query('DELETE FROM public.warehouse_layouts WHERE warehouse_id = $1', [warehouseId])
        await client.query('DELETE FROM public.locations WHERE parent_id = $1', [warehouseId])
        await client.query('DELETE FROM public.locations WHERE id = $1', [warehouseId])
      }
      await client.query('DELETE FROM public.products WHERE id = ANY ($1)', [productIds])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
}

/** Rows of the wheel world still on dev: all zero after a clean teardown. */
export function wheelLeftovers(): Promise<Record<string, number>> {
  return withClient(async (client) => {
    const count = async (sql: string, params: unknown[]): Promise<number> =>
      Number((await client.query<{ n: string }>(sql, params)).rows[0].n)
    return {
      locations: await count('SELECT count(*) n FROM public.locations WHERE code LIKE $1', [`${WHEEL_NAMES.warehouseCode}%`]),
      products: await count('SELECT count(*) n FROM public.products WHERE sku LIKE $1', [`${WHEEL_NAMES.skuPrefix}%`]),
      balances: await count(
        `SELECT count(*) n FROM public.inventory_balances b
           JOIN public.locations l ON l.id = b.location_id WHERE l.code LIKE $1`,
        [`${WHEEL_NAMES.warehouseCode}%`],
      ),
      layouts: await count(`SELECT count(*) n FROM public.warehouse_layouts WHERE name = 'TST-WALK wheel'`, []),
    }
  })
}
